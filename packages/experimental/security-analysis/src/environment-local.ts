/** Local tool health and explicitly owned Docker environment lifecycle. @module */
import { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { randomUUID } from 'node:crypto'
import { runProcess, requireProcessSuccess } from './workbench/process.ts'
import type { EnvironmentStatus, SecurityEnvironment } from './workbench/providers.ts'
import type {} from './workbench/index.ts'

/** Environment manager configuration. */
export interface Config {
  timeoutMs: number
  maxOutputBytes: number
  graceMs: number
  memoryMb: number
  cpus: number
  pids: number
  temporaryMb: number
}
/** Environment manager plugin identity. */
export const name = 'experimental-security-environment-local'
/** Host service dependencies. */
export const inject = ['securityWorkbench', 'subprocess']
/** Health and lifecycle command bounds. */
export const Config: Schema<Config> = Schema.object({
  memoryMb: Schema.number().step(1).min(64).default(2048),
  cpus: Schema.number().min(0.1).default(2),
  pids: Schema.number().step(1).min(16).default(256),
  temporaryMb: Schema.number().step(1).min(16).default(512),
  timeoutMs: Schema.number().step(1).min(1).default(60000),
  maxOutputBytes: Schema.number().step(1).min(4096).default(32768),
  graceMs: Schema.number().step(1).min(1).default(3000),
})

/** Managed environment actions exposed only through the authenticated operator carrier. */
export class LocalEnvironmentManager {
  private readonly containers = new Map<string, string>()
  private readonly starting = new Set<string>()
  constructor(
    private readonly ctx: Context,
    private readonly config: Config,
  ) {}
  /**
   * Inspect installed tools without provisioning them.
   * @param environment - operator configuration.
   * @param signal - cancellation lifetime.
   * @returns independent installation and readiness facts.
   */
  async inspect(environment: SecurityEnvironment, signal: AbortSignal): Promise<EnvironmentStatus> {
    const tools: EnvironmentStatus['tools'] = []
    const diagnostics: string[] = []
    for (const tool of environment.tools) {
      try {
        const result = await runProcess(this.ctx, environment, tool.id, tool.versionArgs, {
          signal,
          durationMs: this.config.timeoutMs,
          maxOutputBytes: this.config.maxOutputBytes,
          graceMs: this.config.graceMs,
        })
        requireProcessSuccess(result)
        tools.push({
          id: tool.id,
          available: true,
          version: (result.stdout || result.stderr).trim(),
          source: tool.source,
        })
      } catch (error) {
        tools.push({ id: tool.id, available: false, version: '', source: tool.source })
        diagnostics.push(tool.id + ': ' + (error instanceof Error ? error.message : String(error)))
      }
    }
    if (environment.kind === 'android') {
      if (!environment.deviceId) diagnostics.push('Android device identity is not configured')
      else {
        try {
          const result = await runProcess(this.ctx, environment, 'adb', ['-s', environment.deviceId, 'get-state'], {
            signal,
            durationMs: this.config.timeoutMs,
            maxOutputBytes: this.config.maxOutputBytes,
            graceMs: this.config.graceMs,
          })
          requireProcessSuccess(result)
          if (result.stdout.trim() !== 'device') diagnostics.push('Android device is not authorized or connected')
        } catch (error) {
          diagnostics.push(error instanceof Error ? error.message : String(error))
        }
      }
    }
    return { id: environment.id, ready: diagnostics.length === 0, diagnostics, tools }
  }
  /**
   * Start one container from the exact configured image.
   * @param environment - Docker environment whose image already exists locally.
   * @param signal - cancellation lifetime.
   * @returns the owned container identity.
   */
  async start(environment: SecurityEnvironment, signal: AbortSignal): Promise<string> {
    if (environment.kind !== 'docker' || !environment.image)
      throw new Error('A Docker environment and explicit image are required')
    if (this.containers.has(environment.id) || this.starting.has(environment.id))
      throw new Error('Environment already owns a container or is starting')
    this.starting.add(environment.id)
    const container = 'dsh-security-' + randomUUID()
    const limits = {
      signal,
      durationMs: this.config.timeoutMs,
      maxOutputBytes: this.config.maxOutputBytes,
      graceMs: this.config.graceMs,
    }
    let attempted = false
    try {
      const inspected = await runProcess(this.ctx, environment, 'docker', ['image', 'inspect', '--format', '{{.Id}}', environment.image], limits)
      requireProcessSuccess(inspected)
      const imageId = inspected.stdout.trim()
      if (inspected.truncated || !/^sha256:[a-f0-9]{64}$/u.test(imageId)) throw new Error('Docker did not return an immutable image identity')
      attempted = true
      const result = await runProcess(
        this.ctx,
        environment,
        'docker',
        [
          'run',
          '--detach',
          '--pull=never',
          '--entrypoint',
          'sleep',
          '--name',
          container,
          '--label',
          'dsh.security.environment=' + environment.id,
          '--network=none',
          '--cap-drop=ALL',
          '--security-opt=no-new-privileges',
          '--read-only',
          '--memory',
          String(this.config.memoryMb) + 'm',
          '--cpus',
          String(this.config.cpus),
          '--pids-limit',
          String(this.config.pids),
          '--tmpfs',
          '/tmp:rw,nosuid,nodev,size=' + String(this.config.temporaryMb) + 'm',
          '--mount',
          'type=bind,source=' + environment.cwd + ',target=/workspace,readonly',
          ...(environment.exchangeRoot
            ? ['--mount', 'type=bind,source=' + environment.exchangeRoot + ',target=/dsh-inputs']
            : []),
          imageId,
          'infinity',
        ],
        limits,
      )
      requireProcessSuccess(result)
      const state = await runProcess(this.ctx, environment, 'docker', ['inspect', '--format', '{{.State.Running}}', container], limits)
      requireProcessSuccess(state)
      if (state.stdout.trim() !== 'true') throw new Error('The selected image did not keep its analysis container running')
      this.containers.set(environment.id, container)
      environment.containerId = container
      environment.resolvedImageId = imageId
      return container
    } catch (error) {
      if (attempted) {
        this.containers.set(environment.id, container)
        environment.containerId = container
        try {
          await this.stop(environment, new AbortController().signal)
        } catch (cleanupError) {
          throw new AggregateError([error, cleanupError], 'Docker start failed and its container needs cleanup')
        }
      }
      throw error
    } finally {
      this.starting.delete(environment.id)
    }
  }
  /**
   * Stop only the container created by this manager.
   * @param environment - configured owner.
   * @param signal - cancellation lifetime.
   * @returns completion after Docker confirms removal.
   */
  async stop(environment: SecurityEnvironment, signal: AbortSignal): Promise<void> {
    if (this.starting.has(environment.id) && !this.containers.has(environment.id)) throw new Error('Environment is starting')
    const container = this.containers.get(environment.id)
    if (!container) throw new Error('This activation does not own the environment container')
    const result = await runProcess(this.ctx, environment, 'docker', ['rm', '--force', container], {
      signal,
      durationMs: this.config.timeoutMs,
      maxOutputBytes: this.config.maxOutputBytes,
      graceMs: this.config.graceMs,
    })
    requireProcessSuccess(result)
    this.containers.delete(environment.id)
    delete environment.containerId
  }
}
/**
 * Register the environment manager beside the security service.
 * @param ctx - injected host context.
 * @param config - command limits.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const controller = await ctx.securityWorkbench.ready
  const manager = new LocalEnvironmentManager(ctx, config)
  ctx.effect(() => controller.environments.register({ id: 'local', manager }))
  ctx.effect(() => async () => {
    await controller.dispose()
    for (const environment of controller.options.environments) {
      if (environment.containerId) await manager.stop(environment, new AbortController().signal)
    }
  })
}
