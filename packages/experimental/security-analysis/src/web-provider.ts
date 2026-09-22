/** Plan-bound HTTP evidence from an isolated, manager-owned Web laboratory. @module */
import assert from 'node:assert/strict'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { z } from 'zod'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type {} from './workbench/index.ts'
import { runProcess, requireProcessSuccess } from './workbench/process.ts'
import type { AnalysisContext, AnalysisProvider, AnalysisResult, SecurityEnvironment } from './workbench/providers.ts'
import type { AnalysisOperation } from './workbench/model.ts'

/** Helper cleanup deadline. */
export interface Config { graceMs: number }
/** Web evidence plugin identity. */
export const name = 'experimental-security-web'
/** Host execution services. */
export const inject = ['securityWorkbench', 'subprocess']
/** Validated deployment limits. */
export const Config: Schema<Config> = Schema.object({ graceMs: Schema.number().step(1).min(1).default(3000) })
const parameters = z.object({
  path: z.string().min(1), method: z.enum(['GET', 'HEAD']).default('GET'),
  imageId: z.string().optional(), instanceId: z.string().optional(),
}).strict()

/** Resolve a path within an operator-declared endpoint.
 * @param origin - fixed laboratory origin.
 * @param prefix - permitted absolute path prefix.
 * @param path - proposed request path.
 * @returns normalized path and query, without a redirect capability. */
export function scopedWebPath(origin: string, prefix: string, path: string): string {
  if (!path.startsWith('/') || path.startsWith('//') || /[\\#\r\n]/u.test(path)) throw new Error('Request must use a scoped absolute path')
  const query = path.indexOf('?')
  let decoded = query < 0 ? path : path.slice(0, query)
  for (let i = 0; i < 3; i++) {
    const next = decodeURIComponent(decoded)
    if (next === decoded) break
    decoded = next
  }
  if (decoded.includes('%') || decoded.startsWith('//') || decoded.includes('\\') || decoded.split('/').some(part => part === '..' || part === '.')) throw new Error('Path traversal is outside Web scope')
  const url = new URL(path, origin)
  const base = prefix.endsWith('/') ? prefix : prefix + '/'
  if (url.origin !== origin || !(url.pathname === prefix || url.pathname.startsWith(base))) throw new Error('Request is outside Web scope')
  return url.pathname + url.search
}

/** Verify current Docker image identities and the exclusive internal network before sending HTTP.
 * @param input - Docker inspect JSON for worker, target and network, in that order.
 * @param environment - approved manager-owned runtime.
 */
export function verifyWebLaboratory(input: unknown, environment: SecurityEnvironment): void {
  const container = z.object({ Id: z.string(), Image: z.string(), State: z.object({ Running: z.boolean() }),
    Config: z.object({ Labels: z.record(z.string(), z.string()) }),
    NetworkSettings: z.object({ Networks: z.record(z.string(), z.object({ IPAddress: z.string() })) }) })
  const network = z.object({ Internal: z.boolean(), Labels: z.record(z.string(), z.string()),
    Options: z.record(z.string(), z.string()), Containers: z.record(z.string(), z.unknown()) })
  const [worker, target, net] = z.tuple([container, container, network]).parse(input)
  const expected = environment.webTarget
  assert(expected, 'Managed Web target is required')
  const label = 'dsh.security.laboratory'
  if (!worker.State.Running || !target.State.Running || worker.Image !== environment.resolvedImageId ||
    target.Image !== expected.targetImageId ||
    [worker.Config.Labels[label], target.Config.Labels[label], net.Labels[label]].some(value => value !== expected.laboratoryId) ||
    !net.Internal || net.Options['com.docker.network.bridge.gateway_mode_ipv4'] !== 'isolated' ||
    Object.keys(net.Containers).length !== 2 || !(worker.Id in net.Containers) || !(target.Id in net.Containers) ||
    [worker, target].some(item => Object.keys(item.NetworkSettings.Networks).length !== 1 ||
      !(expected.networkId in item.NetworkSettings.Networks)) ||
    target.NetworkSettings.Networks[expected.networkId]?.IPAddress !== expected.address)
    throw new Error('Laboratory identity or network isolation changed; inspect and register the current target')
}

/** HTTP requests are evidence collection, admitted only by the plan executor. */
export class WebProvider implements AnalysisProvider {
  readonly id = 'web'
  readonly operations = ['request']
  readonly inputGuide = 'request accepts {path, method: GET|HEAD}. Requires a registered Web laboratory target and an approved plan. Redirects are recorded but never followed. imageId and instanceId are resolved by the provider.'
  constructor(private readonly ctx: Context, private readonly graceMs: number) {}
  resolve(request: AnalysisOperation, context: AnalysisContext): AnalysisOperation {
    const asset = context.asset
    const target = context.environment.webTarget
    if (!('kind' in asset) || asset.kind !== 'web' || !target || context.environment.kind !== 'docker' || !context.environment.containerId)
      throw new Error('Start the managed Web laboratory before preparing a request')
    if (asset.environmentId !== context.environment.id || asset.origin !== target.origin || asset.instanceId !== target.instanceId)
      throw new Error('Laboratory identity changed; register the current target')
    if (new URL(asset.origin).protocol !== 'http:') throw new Error('This laboratory provider supports HTTP endpoints only')
    if (request.operation !== 'request' || request.script || request.impact !== 'observe') throw new Error('Unsupported Web operation')
    const args = parameters.parse(request.parameters)
    const imageId = context.environment.resolvedImageId
    if (!imageId) throw new Error('Tool image identity is unavailable')
    return { ...request, parameters: { path: scopedWebPath(asset.origin, asset.pathPrefix, args.path), method: args.method,
      imageId, instanceId: target.instanceId } }
  }
  async run(request: AnalysisOperation, context: AnalysisContext): Promise<AnalysisResult> {
    const resolved = this.resolve(request, context)
    const target = context.environment.webTarget
    const worker = context.environment.containerId
    assert(target && worker, 'Managed Web runtime is required')
    const inspection = await runProcess(this.ctx, context.environment, 'docker',
      ['inspect', worker, target.target, target.networkId], {
        signal: context.signal, durationMs: context.durationMs, maxOutputBytes: context.maxOutputBytes, graceMs: this.graceMs,
      })
    requireProcessSuccess(inspection)
    if (inspection.truncated) throw new Error('Laboratory inspection was truncated')
    verifyWebLaboratory(JSON.parse(inspection.stdout), context.environment)
    const helper = await readFile(fileURLToPath(new URL('../resources/web_runner.py', import.meta.url)), 'utf8')
    const result = await runProcess(this.ctx, context.environment, 'python', ['-c', helper], {
      signal: context.signal, durationMs: context.durationMs, maxOutputBytes: context.maxOutputBytes, graceMs: this.graceMs,
    }, JSON.stringify({ ...resolved.parameters, origin: target.origin, address: target.address,
      timeout: context.durationMs / 1000, maxBytes: Math.floor(context.maxOutputBytes / 8) }))
    let failure: string | undefined
    let incomplete = result.truncated || result.timedOut || result.cancelled || result.exitCode !== 0
    if (result.exitCode !== 0) failure = result.stderr || result.stdout || 'HTTP helper failed'
    if (!result.truncated) {
      try {
        const payload = z.object({ incomplete: z.boolean(), failure: z.string().optional() }).loose().parse(JSON.parse(result.stdout))
        incomplete ||= payload.incomplete
        failure ??= payload.failure
      } catch (error) {
        incomplete = true
        failure ??= 'Invalid HTTP helper response: ' + (error instanceof Error ? error.message : String(error))
      }
    }
    return { bytes: Buffer.from(JSON.stringify(result)), mediaType: 'application/json',
      summary: failure ?? 'HTTP request completed; inspect status, headers and body before drawing a conclusion',
      incomplete, toolVersion: context.environment.manifest?.tools.python ?? 'Python HTTP client',
      ...(failure ? { failure } : {}), cleanup: result.cancelled || result.timedOut ? 'Worker cancellation requested' : 'HTTP connection closed' }
  }
}
/** Register the bounded Web provider.
 * @param ctx - injected services.
 * @param config - helper cleanup deadline. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const controller = await ctx.securityWorkbench.ready
  ctx.effect(() => controller.providers.register(new WebProvider(ctx, config.graceMs)))
}
