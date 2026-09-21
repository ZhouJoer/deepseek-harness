/** Deployment-owned engagement scope and bounded provider settings. @module */

import Schema from '@deepseek-ai/schemastery'
import { isAbsolute } from 'node:path'
import { validateGhidraConfig } from './ghidra.ts'

/** One authorized binary and its separately declared analysis environments. */
export interface SecurityAsset {
  /** Stable engagement-local identifier selected by the operator. */
  id: string
  /** Human-readable asset name. */
  label: string
  /** Operator-declared SHA-256 of the original binary, not a remote attestation. */
  sha256: string
  /** Dedicated GhidraMCP Java-plugin instance with a declared current program. */
  ghidra?: { baseUrl: string; programBinding: string } | undefined
  /** Exact existing Frida process; the agent cannot select another process or device. */
  frida?: { deviceId: string; pid: number; processName: string } | undefined
}

/** Trusted configuration; no model-facing operation can enlarge this scope. */
export interface Config {
  /** Durable assessment namespace; different engagements never share records. */
  engagementId: string
  /** Authorized analysis objective shown in the scope tool. */
  objective: string
  /** Explicit assets accessible to this process's security sessions. */
  assets: SecurityAsset[]
  /** Whether each fixed Frida probe asks or has explicit deployment authorization. */
  dynamicPolicy: 'ask' | 'preauthorized' | 'disabled'
  /** Installed Python with Frida; omit for static-only deployments. */
  python?: { command: string; cwd: string } | undefined
  /** In-process fresh-session subagent provider. */
  subagentProvider: string
  /** Maximum provider request or subprocess duration, including setup. */
  timeoutMs: number
  /** Managed subprocess termination grace. */
  graceMs: number
  /** Maximum complete serialized tool result and retained evidence size. */
  maxOutputBytes: number
  /** Maximum provider page or knowledge-search page size. */
  maxPageSize: number
  /** Maximum duration of a fixed exported-symbol trace. */
  maxTraceDurationMs: number
  /** Maximum simultaneous reconnaissance jobs per plugin activation. */
  maxConcurrentDelegations: number
  /** Maximum lifetime of one reconnaissance job. */
  delegationTimeoutMs: number
}

/** Validate deployment fields and expose every operational bound as configuration. */
export const Config: Schema<Config> = Schema.object({
  engagementId: Schema.string()
    .pattern(/^[a-z0-9][a-z0-9-]{0,47}$/u)
    .required(),
  objective: Schema.string().pattern(/\S/u).required(),
  assets: Schema.array(
    Schema.object({
      id: Schema.string()
        .pattern(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/u)
        .required(),
      label: Schema.string().pattern(/\S/u).required(),
      sha256: Schema.string()
        .pattern(/^[a-fA-F0-9]{64}$/u)
        .required(),
      ghidra: Schema.union([
        Schema.const(undefined),
        Schema.object({
          baseUrl: Schema.string().required(),
          programBinding: Schema.string().pattern(/\S/u).required(),
        }),
      ]),
      frida: Schema.union([
        Schema.const(undefined),
        Schema.object({
          deviceId: Schema.string().pattern(/\S/u).required(),
          pid: Schema.number().step(1).min(1).max(2147483647).required(),
          processName: Schema.string().pattern(/\S/u).required(),
        }),
      ]),
    }),
  ).required(),
  dynamicPolicy: Schema.union(['ask', 'preauthorized', 'disabled'] as const).default('ask'),
  python: Schema.union([
    Schema.const(undefined),
    Schema.object({ command: Schema.string().required(), cwd: Schema.string().required() }),
  ]),
  subagentProvider: Schema.string().default('spawn'),
  timeoutMs: Schema.number().step(1).min(1).max(2147483647).default(60000),
  graceMs: Schema.number().step(1).min(1).max(2147483647).default(3000),
  maxOutputBytes: Schema.number().step(1).min(4096).max(1048576).default(32768),
  maxPageSize: Schema.number().step(1).min(1).max(1000).default(100),
  maxTraceDurationMs: Schema.number().step(1).min(1).max(2147483647).default(10000),
  maxConcurrentDelegations: Schema.number().step(1).min(1).max(32).default(3),
  delegationTimeoutMs: Schema.number().step(1).min(1).max(2147483647).default(300000),
})

/**
 * Check relationships that field schemas cannot express before registering effects.
 * @param config - resolved deployment configuration.
 */
export function validateConfig(config: Config): void {
  if (config.assets.length === 0) throw new Error('security-analysis requires at least one authorized asset')
  const ids = new Set<string>()
  const endpoints = new Set<string>()
  for (const asset of config.assets) {
    if (ids.has(asset.id)) throw new Error(`duplicate security asset: ${asset.id}`)
    ids.add(asset.id)
    if (asset.ghidra !== undefined) {
      validateGhidraConfig({
        baseUrl: asset.ghidra.baseUrl,
        timeoutMs: config.timeoutMs,
        maxResponseBytes: config.maxOutputBytes,
        maxPageSize: config.maxPageSize,
      })
      const endpoint = new URL(asset.ghidra.baseUrl).href
      if (endpoints.has(endpoint)) throw new Error('each asset needs a dedicated GhidraMCP endpoint')
      endpoints.add(endpoint)
    }
    if (asset.frida !== undefined && config.python === undefined && config.dynamicPolicy !== 'disabled') {
      throw new Error('Frida assets require an installed Python command and its absolute working directory')
    }
  }
  if (config.python !== undefined && !isAbsolute(config.python.cwd)) throw new Error('Python cwd must be absolute')
  if (config.maxTraceDurationMs >= config.timeoutMs)
    throw new Error('trace duration must be shorter than the provider timeout')
}
