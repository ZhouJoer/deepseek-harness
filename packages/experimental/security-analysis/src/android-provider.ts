/** Android package inspection through JADX and explicitly selected adb devices. @module */
import assert from 'node:assert/strict'
import { fileAsset } from './workbench/assessment.ts'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { readdir, open } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { z } from 'zod'
import type {} from './workbench/index.ts'
import type { AnalysisContext, AnalysisProvider } from './workbench/providers.ts'
import { operationSchema, type AnalysisOperation } from './workbench/model.ts'
import { runProcess, requireProcessSuccess, installation } from './workbench/process.ts'

/** Android provider process limits. */
export interface Config {
  graceMs: number
  maxFiles: number
}
/** Plugin identity. */
export const name = 'experimental-security-reverse-android'
/** Provider dependencies. */
export const inject = ['securityWorkbench', 'subprocess']
/** Bounds on package extraction and subprocess cleanup. */
export const Config: Schema<Config> = Schema.object({
  graceMs: Schema.number().step(1).min(1).default(3000),
  maxFiles: Schema.number().step(1).min(1).default(10000),
})
const argsSchema = z
  .object({
    packageName: z
      .string()
      .regex(/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+$/u)
      .optional(),
    className: z
      .string()
      .regex(/^[a-zA-Z0-9_.$]+$/u)
      .optional(),
  })
  .strict()

/** JADX supplies application code; adb never accepts an arbitrary shell command. */
export class AndroidProvider implements AnalysisProvider {
  readonly id = 'android'
  readonly inputGuide = 'decompile accepts optional className and requires an APK or DEX plus configured jadx. device and packages require {}; package-info requires packageName. Device queries require configured adb and an explicit environment deviceId. Missing root, USB authorization or server prerequisites are operator setup tasks.'
  readonly operations = ['decompile', 'device', 'packages', 'package-info'] as const
  constructor(
    private readonly ctx: Context,
    private readonly config: Config,
  ) {}
  resolve(request: AnalysisOperation, context: AnalysisContext): AnalysisOperation {
    if (!this.operations.some(operation => operation === request.operation) || request.script)
      throw new Error('Unsupported Android operation')
    const args = argsSchema.parse(request.parameters)
    if (request.operation === 'decompile' && !['apk', 'dex'].includes(fileAsset(context.asset).format))
      throw new Error('JADX requires an APK or DEX asset')
    if (request.operation !== 'decompile' && !context.environment.deviceId) throw new Error('Select an Android device')
    if (request.operation === 'package-info' && !args.packageName) throw new Error('Select the package name')
    return { ...request, parameters: operationSchema.shape.parameters.parse(args), impact: 'observe' }
  }
  async run(request: AnalysisOperation, context: AnalysisContext) {
    const args = argsSchema.parse(request.parameters)
    const limits = {
      signal: context.signal,
      durationMs: context.durationMs,
      maxOutputBytes: context.maxOutputBytes,
      graceMs: this.config.graceMs,
    }
    const tool = installation(context.environment, request.operation === 'decompile' ? 'jadx' : 'adb')
    const version = await runProcess(this.ctx, context.environment, tool.id, tool.versionArgs, limits)
    requireProcessSuccess(version)
    if (version.truncated) throw new Error('Tool version output exceeded its limit')
    const toolVersion = (version.stdout || version.stderr).trim()
    if (!toolVersion) throw new Error('Tool did not report its version')
    if (request.operation !== 'decompile') {
      assert(context.environment.deviceId, 'Resolved Android operation requires a device')
      if (request.operation === 'package-info') assert(args.packageName, 'Resolved package query requires a package')
      const command =
        request.operation === 'device'
          ? ['get-state']
          : request.operation === 'packages'
            ? ['shell', 'pm', 'list', 'packages', '-f']
            : ['shell', 'dumpsys', 'package', args.packageName as string]
      const result = await runProcess(
        this.ctx,
        context.environment,
        'adb',
        ['-s', context.environment.deviceId, ...command],
        limits,
      )
      requireProcessSuccess(result)
      return {
        bytes: Buffer.from(JSON.stringify(result)),
        mediaType: 'application/json',
        summary: result.stdout.slice(0, 4096),
        incomplete: result.truncated,
        toolVersion,
      }
    }
    const path = await context.artifacts.materialize(fileAsset(context.asset).artifact)
    const root = dirname(path)
    const output = join(root, 'jadx')
    try {
      const command = ['--output-dir', output, ...(args.className ? ['--single-class', args.className] : []), path]
      const result = await runProcess(this.ctx, context.environment, 'jadx', command, limits)
      if (result.timedOut || result.cancelled) requireProcessSuccess(result)
      const files: { path: string; text: string }[] = []
      let total = 0
      let incomplete = result.exitCode !== 0 || result.truncated
      const visit = async (directory: string, prefix: string): Promise<void> => {
        for (const entry of await readdir(directory, { withFileTypes: true })) {
          context.signal.throwIfAborted()
          if (files.length >= this.config.maxFiles || total >= context.maxOutputBytes) {
            incomplete = true
            return
          }
          const relative = prefix + entry.name
          if (entry.isSymbolicLink()) {
            incomplete = true
            continue
          }
          if (entry.isDirectory()) await visit(join(directory, entry.name), relative + '/')
          else if (entry.isFile() && /\.(java|xml|json|smali)$/iu.test(entry.name)) {
            const remaining = context.maxOutputBytes - total
            const file = await open(join(directory, entry.name), 'r')
            const size = (await file.stat()).size
            const bytes = Buffer.alloc(Math.min(size, remaining))
            try {
              await file.read(bytes, 0, bytes.length, 0)
            } finally {
              await file.close()
            }
            const text = bytes.subarray(0, remaining).toString('utf8')
            files.push({ path: relative, text })
            total += Buffer.byteLength(text)
            if (size > remaining) incomplete = true
          }
        }
      }
      await visit(output, '')
      return {
        bytes: Buffer.from(JSON.stringify({ files, diagnostics: result.stderr, incomplete })),
        mediaType: 'application/json',
        summary: 'JADX produced ' + String(files.length) + ' source/resource files',
        incomplete,
        toolVersion,
      }
    } finally {
      await context.artifacts.release(path)
    }
  }
}
/**
 * Register Android package analysis.
 * @param ctx - injected security context.
 * @param config - resource limits.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const controller = await ctx.securityWorkbench.ready
  ctx.effect(() => controller.providers.register(new AndroidProvider(ctx, config)))
}
