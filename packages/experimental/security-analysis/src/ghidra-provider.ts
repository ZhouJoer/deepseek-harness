/** Authenticated managed GhidraMCP queries bound to measured samples. @module */
import assert from 'node:assert/strict'
import { fileAsset } from './workbench/assessment.ts'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { z } from 'zod'
import type {} from './workbench/index.ts'
import type { AnalysisContext, AnalysisProvider } from './workbench/providers.ts'
import { operationSchema, type AnalysisOperation } from './workbench/model.ts'

/** One managed GUI program; credentials never enter tool results. */
export interface GhidraBinding {
  sha256: string
  programId: string
  baseUrl: string
  token: string
}
/** Deployment-owned Ghidra instances. */
export interface Config {
  programs: GhidraBinding[]
  maxPageSize: number
}
/** Plugin identity. */
export const name = 'experimental-security-reverse-ghidra'
/** Security owner owns registration and execution admission. */
export const inject = ['securityWorkbench']
/** Exact program bindings and authentication. */
export const Config: Schema<Config> = Schema.object({
  maxPageSize: Schema.number().step(1).min(1).max(1000).default(100),
  programs: Schema.array(
    Schema.object({
      sha256: Schema.string()
        .pattern(/^[a-f0-9]{64}$/u)
        .required(),
      programId: Schema.string().required(),
      baseUrl: Schema.string().required(),
      token: Schema.string().required(),
    }),
  ).required(),
})
const queries: Record<string, string> = {
  identity: '/dsh/identity',
  functions: '/methods',
  imports: '/imports',
  exports: '/exports',
  strings: '/strings',
  decompile: '/decompile_function',
  disassemble: '/disassemble_function',
  'xrefs-to': '/xrefs_to',
  'xrefs-from': '/xrefs_from',
}
const writes: Record<string, string> = {
  rename: '/rename_function_by_address',
  comment: '/set_decompiler_comment',
  prototype: '/set_function_prototype',
}
const parameters = z
  .object({
    address: z
      .string()
      .regex(/^(0x)?[a-f0-9]+$/iu)
      .optional(),
    offset: z.number().int().nonnegative().optional(),
    limit: z.number().int().positive().max(1000).optional(),
    filter: z.string().optional(),
    name: z.string().min(1).optional(),
    comment: z.string().optional(),
    prototype: z.string().optional(),
  })
  .strict()

/** Managed Ghidra implementation; GUI selection cannot change the bound program. */
export class GhidraProvider implements AnalysisProvider {
  readonly id = 'ghidra'
  readonly inputGuide = 'identity requires {}. Lists accept offset, limit and filter. decompile, disassemble, xrefs-to and xrefs-from require a hexadecimal address. rename requires address and name; comment requires address and comment; prototype requires address and prototype. Database writes require an approved plan. A managed open GUI program must be configured for the measured sample hash.'
  readonly operations = [...Object.keys(queries), ...Object.keys(writes)]
  constructor(private readonly programs: GhidraBinding[], private readonly maxPageSize: number) {
    for (const program of programs) {
      const url = new URL(program.baseUrl)
      if (
        !['127.0.0.1', '[::1]'].includes(url.hostname) ||
        url.protocol !== 'http:' ||
        url.username ||
        url.password ||
        url.pathname !== '/' ||
        url.search ||
        url.hash ||
        program.token.length < 32
      )
        throw new Error('Ghidra requires an authenticated literal loopback origin')
    }
  }
  resolve(request: AnalysisOperation, context: AnalysisContext): AnalysisOperation {
    if (!this.operations.includes(request.operation)) throw new Error('Unsupported Ghidra operation')
    if (!this.programs.some(program => program.sha256 === fileAsset(context.asset).artifact.sha256))
      throw new Error('No managed Ghidra program matches this sample')
    if (request.script) throw new Error('Ghidra does not accept arbitrary scripts')
    const args = parameters.parse(request.parameters)
    if (
      ['decompile', 'disassemble', 'xrefs-to', 'xrefs-from', ...Object.keys(writes)].includes(request.operation) &&
      !args.address
    ) {
      throw new Error('This Ghidra operation requires an address')
    }
    if (
      (request.operation === 'rename' && !args.name) ||
      (request.operation === 'comment' && args.comment === undefined) ||
      (request.operation === 'prototype' && !args.prototype)
    )
      throw new Error('Ghidra modification is missing its value')
    if (args.filter !== undefined && !['functions', 'strings'].includes(request.operation))
      throw new Error('Filters apply only to functions and strings')
    if (['functions', 'imports', 'exports', 'strings', 'xrefs-to', 'xrefs-from'].includes(request.operation)) {
      args.offset ??= 0
      args.limit ??= this.maxPageSize
      if (args.limit > this.maxPageSize || args.offset + args.limit > 2147483647)
        throw new Error('Ghidra pagination exceeds the configured limit')
    } else if (args.offset !== undefined || args.limit !== undefined) throw new Error('This operation has no pagination')
    return {
      ...request,
      parameters: operationSchema.shape.parameters.parse(args),
      impact: request.operation in writes ? 'analysis-write' : 'observe',
    }
  }
  async run(request: AnalysisOperation, context: AnalysisContext) {
    const binding = this.programs.find(program => program.sha256 === fileAsset(context.asset).artifact.sha256)
    const endpoint = request.operation === 'functions' && request.parameters.filter !== undefined
      ? '/searchFunctions' : queries[request.operation] ?? writes[request.operation]
    assert(binding && endpoint, 'Resolved Ghidra binding and operation must remain available')
    const url = new URL(endpoint, binding.baseUrl)
    const args = parameters.parse(request.parameters)
    const values: Record<string, string> = Object.fromEntries(
      Object.entries(args).map(([key, value]) => [key, String(value)]),
    )
    if (request.operation === 'rename') {
      assert(values.name, 'Resolved rename requires a name')
      values.new_name = values.name
      delete values.name
    }
    if (request.operation === 'rename' || request.operation === 'prototype') {
      assert(values.address, 'Resolved database change requires an address')
      values.function_address = values.address
      delete values.address
    }
    if (request.operation === 'functions' && values.filter !== undefined) {
      values.query = values.filter
      delete values.filter
    }
    const form = new URLSearchParams(values)
    const mutation = request.operation in writes
    if (!mutation) url.search = form.toString()
    const response = await fetch(url, {
      method: mutation ? 'POST' : 'GET',
      redirect: 'error',
      headers: {
        Authorization: 'Bearer ' + binding.token,
        'X-DSH-SHA256': binding.sha256,
        'X-DSH-Program': encodeURIComponent(binding.programId),
        ...(mutation ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      },
      ...(mutation ? { body: form.toString() } : {}),
      signal: AbortSignal.any([context.signal, AbortSignal.timeout(context.durationMs)]),
    })
    if (!response.ok || !response.body) throw new Error('Ghidra rejected the request: HTTP ' + String(response.status))
    const version = response.headers.get('X-DSH-Ghidra-Version')
    if (response.headers.get('X-DSH-SHA256') !== binding.sha256 || !version) {
      await response.body.cancel()
      throw new Error('Ghidra response lacks managed program identity or version')
    }
    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let size = 0
    let incomplete = false
    try {
      while (true) {
        const item = await reader.read()
        if (item.done) break
        const remaining = context.maxOutputBytes - size
        if (item.value.length > remaining) {
          chunks.push(item.value.subarray(0, remaining))
          incomplete = true
          break
        }
        chunks.push(item.value)
        size += item.value.length
      }
    } finally {
      await reader.cancel()
    }
    const bytes = Buffer.concat(chunks)
    const text = bytes.toString('utf8')
    if (/^(Error|Failed|No program)/iu.test(text)) throw new Error('Ghidra analysis failed: ' + text)
    if (request.operation === 'identity' && text.split('\n')[0] !== binding.sha256)
      throw new Error('Ghidra returned another sample identity')
    return {
      bytes,
      mediaType: 'text/plain',
      summary: text.slice(0, 4096),
      incomplete,
      toolVersion: 'Ghidra ' + version + '; GhidraMCP 1.4 + dsh binding v1',
    }
  }
}
/**
 * Register authenticated Ghidra analysis.
 * @param ctx - security context.
 * @param config - operator-owned program bindings.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const controller = await ctx.securityWorkbench.ready
  ctx.effect(() => controller.providers.register(new GhidraProvider(config.programs, config.maxPageSize)))
}
