/** Plan-bound Python and browser checks against immutable source snapshots. @module */
import { randomUUID } from 'node:crypto'
import { chmod, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { z } from 'zod'
import type {} from './workbench/index.ts'
import { sourceManifest } from './workbench/source.ts'
import { runProcess, requireProcessSuccess } from './workbench/process.ts'
import type { AnalysisContext, AnalysisProvider, AnalysisResult } from './workbench/providers.ts'
import type { AnalysisOperation } from './workbench/model.ts'

/** Limits for one disposable offline container. */
export interface Config {
  image: string
  memoryMb: number
  cpus: number
  pids: number
  temporaryMb: number
  graceMs: number
}
/** Plugin identity. */
export const name = 'experimental-security-offline'
/** Host execution and project authority. */
export const inject = ['securityWorkbench', 'subprocess']
/** Missing images fail preparation; analysis never installs dependencies. */
export const Config: Schema<Config> = Schema.object({
  image: Schema.string().default('dsh-security-offline:1'),
  memoryMb: Schema.number().step(1).min(128).default(2048),
  cpus: Schema.number().min(0.1).default(2),
  pids: Schema.number().step(1).min(16).default(256),
  temporaryMb: Schema.number().step(1).min(16).default(512),
  graceMs: Schema.number().step(1).min(1).default(3000),
})
const parameters = z.object({
  imageId: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  memoryMb: z.number(), cpus: z.number(), pids: z.number(), temporaryMb: z.number(),
}).strict()

/** Runs approved code with read-only inputs, no devices and no external network. */
export class OfflineProvider implements AnalysisProvider {
  resourceKey(): null { return null }
  readonly id = 'offline'
  readonly operations = ['python', 'browser']
  readonly inputGuide = 'Requires a source asset, local environment with docker configured, and an approved immutable script plan. Propose parameters {}: preparation pins the installed image and limits. python runs CPython; source is at /input/source (DSH_SOURCE_ROOT), use temporary files under /tmp and mock hardware. browser script exports default async ({page, context, sourceRoot, open}) => {}; open(relativePath) loads the original HTML from the snapshot on intercepted http://localhost. Add context.addInitScript before open to simulate device APIs. Print JSON observations, assumptions and assertions. These are offline simulations, never physical-device evidence.'
  constructor(private readonly ctx: Context, private readonly config: Config) {}
  async prepare(request: AnalysisOperation, context: AnalysisContext): Promise<AnalysisOperation> {
    if (Object.keys(request.parameters).length) throw new Error('Offline preparation accepts empty parameters')
    if (context.environment.kind !== 'local') throw new Error('Offline containers require the local Docker manager')
    const image = await runProcess(this.ctx, context.environment, 'docker',
      ['image', 'inspect', '--format', '{{.Id}}', this.config.image], {
        signal: context.signal, durationMs: context.durationMs, maxOutputBytes: context.maxOutputBytes, graceMs: this.config.graceMs,
      })
    requireProcessSuccess(image)
    if (image.truncated) throw new Error('Offline image inspection was truncated')
    const { memoryMb, cpus, pids, temporaryMb } = this.config
    return this.resolve({ ...request, parameters: { imageId: image.stdout.trim(), memoryMb, cpus, pids, temporaryMb } }, context)
  }
  resolve(request: AnalysisOperation, context: AnalysisContext): AnalysisOperation {
    if (!('kind' in context.asset) || context.asset.kind !== 'source') throw new Error('Offline checks require a source snapshot')
    if (!this.operations.includes(request.operation) || !request.script) throw new Error('Select python or browser and supply an immutable script')
    if (context.environment.kind !== 'local') throw new Error('Offline containers require the local Docker manager')
    const args = parameters.parse(request.parameters)
    const { memoryMb, cpus, pids, temporaryMb } = this.config
    return { ...request, impact: 'observe', parameters: { ...args, memoryMb, cpus, pids, temporaryMb } }
  }
  async run(request: AnalysisOperation, context: AnalysisContext): Promise<AnalysisResult> {
    const args = parameters.parse(request.parameters)
    if (!request.script) throw new Error('Missing approved script')
    const manifest = await sourceManifest(context)
    const input = await context.artifacts.materialize(request.script)
    const directory = dirname(input)
    const container = 'dsh-offline-' + randomUUID()
    const limits = { signal: context.signal, durationMs: context.durationMs,
      maxOutputBytes: Math.max(1, Math.floor((context.maxOutputBytes - 1024) / 2)), graceMs: this.config.graceMs }
    let result: AnalysisResult | undefined
    let attempted = false
    try {
      await chmod(directory, 0o755)
      await mkdir(join(directory, 'source'), { mode: 0o755 })
      for (const file of manifest.files) {
        context.signal.throwIfAborted()
        const path = join(directory, 'source', ...file.path.split('/'))
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, await context.artifacts.read(file.artifact), { flag: 'wx' })
      }
      const scriptName = request.operation === 'python' ? 'check.py' : 'check.mjs'
      await writeFile(join(directory, scriptName), await context.artifacts.read(request.script), { flag: 'wx' })
      attempted = true
      const process = await runProcess(this.ctx, context.environment, 'docker', [
        'run', '--pull=never', '--name', container, '--label', 'dsh.security.offline=' + container,
        '--network=none', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--read-only',
        '--user', '65534:65534', '--init', '--memory', String(args.memoryMb) + 'm', '--cpus', String(args.cpus),
        '--pids-limit', String(args.pids), '--tmpfs', '/tmp:rw,nosuid,nodev,size=' + String(args.temporaryMb) + 'm',
        '--shm-size', String(args.temporaryMb) + 'm',
        '--mount', 'type=bind,source=' + directory + ',target=/input,readonly',
        '--workdir', '/tmp', '--env', 'HOME=/tmp', '--env', 'DSH_SOURCE_ROOT=/input/source',
        '--entrypoint', request.operation === 'python' ? 'python3' : 'node', args.imageId,
        ...(request.operation === 'python' ? ['-u', '-B', '/input/check.py'] : ['/opt/dsh-offline/browser.mjs', '/input/check.mjs']),
      ], limits)
      const raw = { method: 'simulation', imageId: args.imageId, ...process }
      let bytes = Buffer.from(JSON.stringify(raw))
      while (bytes.length > context.maxOutputBytes && (raw.stdout.length || raw.stderr.length)) {
        const field = raw.stdout.length >= raw.stderr.length ? 'stdout' : 'stderr'
        raw[field] = raw[field].slice(0, Math.floor(raw[field].length / 2))
        raw.truncated = true
        bytes = Buffer.from(JSON.stringify(raw))
      }
      const failure = process.exitCode !== 0 || process.cancelled || process.timedOut
        ? process.stderr || 'Offline check did not complete' : undefined
      result = { bytes,
        mediaType: 'application/json', summary: (failure ?? process.stdout).slice(0, 4096),
        incomplete: raw.truncated || process.cancelled || process.timedOut || !!failure,
        toolVersion: 'offline image ' + args.imageId, method: 'simulation', ...(failure ? { failure } : {}) }
      return result
    } finally {
      try {
        if (attempted) {
          let cleanup
          try {
            cleanup = await runProcess(this.ctx, context.environment, 'docker', ['rm', '--force', container],
              { ...limits, signal: new AbortController().signal, durationMs: this.config.graceMs * 2 })
          } catch (error) {
            if (!result) throw error
            result.cleanup = 'Container removal failed: ' + String(error)
            result.failure ??= result.cleanup
            result.incomplete = true
          }
          if (cleanup) {
            const ok = cleanup.exitCode === 0 || cleanup.stderr.includes('No such container')
            if (result) {
              result.cleanup = ok ? 'Owned offline container removed' : 'Container removal failed: ' + cleanup.stderr
              if (!ok) { result.incomplete = true; result.failure ??= result.cleanup }
            }
            if (!ok && !result) throw new Error('Failed to remove owned offline container: ' + container)
          }
        }
      } finally { await context.artifacts.release(input) }
    }
  }
}
/** Register isolated source validation.
 * @param ctx - execution services.
 * @param config - installed image and resource limits. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const controller = await ctx.securityWorkbench.ready
  ctx.effect(() => controller.providers.register(new OfflineProvider(ctx, config)))
}
