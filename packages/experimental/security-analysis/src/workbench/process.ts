/** Structured subprocess execution in operator-selected Host and Docker environments. @module */
import assert from 'node:assert/strict'
import { isAbsolute, relative, sep, dirname, delimiter } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-subprocess'
import type { SecurityEnvironment, ToolInstallation } from './providers.ts'

/** Settled process output; callers inspect every termination fact. */
export interface ProcessResult {
  stdout: string
  stderr: string
  exitCode: number | null
  signal: NodeJS.Signals | null
  timedOut: boolean
  cancelled: boolean
  truncated: boolean
}
/**
 * Select an installed tool by identity, never by a model-supplied command.
 * @param environment - operator configuration.
 * @param id - registered tool identity.
 * @returns configured executable and version query.
 */
export function installation(environment: SecurityEnvironment, id: string): ToolInstallation {
  const tool = environment.tools.find(item => item.id === id)
  if (!tool) throw new Error('Tool is not configured: ' + id)
  return tool
}
/**
 * Map an owned host path into the selected container mounts.
 * @param environment - selected execution world.
 * @param path - provider argument; external-container arguments already use container paths.
 * @returns mapped path for managed mounts, otherwise the original argument. External containers do not stage Host files.
 */
export function environmentPath(environment: SecurityEnvironment, path: string): string {
  if (environment.externalContainer) return path
  if (environment.kind !== 'docker' || !isAbsolute(path)) return path
  for (const [host, target] of [
    [environment.exchangeRoot, '/dsh-inputs'],
    [environment.cwd, '/workspace'],
  ] as const) {
    if (!host) continue
    const tail = relative(host, path)
    if (tail !== '..' && !tail.startsWith('..' + sep) && !isAbsolute(tail))
      return target + '/' + tail.split(sep).join('/')
  }
  throw new Error('Provider path is outside the selected container mounts')
}

/** Resolve a tool to its Host command and fixed launcher arguments.
 * @param environment - selected execution environment.
 * @param tool - installation selected in that environment.
 * @returns invocation on the Host; append operation arguments separately.
 */
export function toolInvocation(environment: SecurityEnvironment, tool: Pick<ToolInstallation, 'id' | 'command' | 'prefixArgs'>): {
  command: string
  prefixArgs: string[]
} {
  if (environment.kind !== 'docker' || tool.id === 'docker')
    return { command: tool.command, prefixArgs: [...tool.prefixArgs ?? []] }
  const container = environment.externalContainer?.name ?? environment.containerId
  if (!container) throw new Error('Start the configured Docker environment before using its tools')
  const docker = installation(environment, 'docker')
  return { command: docker.command, prefixArgs: [...docker.prefixArgs ?? [], 'exec', '-i', '--workdir',
    environment.externalContainer?.workdir ?? (environment.webTarget ? '/tmp' : '/workspace'),
    container, tool.command, ...tool.prefixArgs ?? []] }
}

/**
 * Run one explicit argv request and await subprocess quiescence.
 * @param ctx - configured subprocess service.
 * @param environment - selected working directory and tool paths.
 * @param toolId - operator-registered executable.
 * @param args - provider-resolved argv, not a shell program.
 * @param limits - cancellation, timeout and output limits; read-only inventory disables container shutdown on abort.
 * @param input - optional protocol input on stdin.
 * @returns output and independent termination facts. External-container cancellation stops the Host client; remote work may continue.
 */
export async function runProcess(
  ctx: Context,
  environment: SecurityEnvironment,
  toolId: string,
  args: string[],
  limits: { signal: AbortSignal; durationMs: number; maxOutputBytes: number; graceMs: number; stopContainerOnAbort?: boolean },
  input?: string,
): Promise<ProcessResult> {
  const tool = installation(environment, toolId)
  const deadline = new AbortController()
  const timer = setTimeout(() => {
    deadline.abort(new Error('Tool deadline exceeded'))
  }, limits.durationMs)
  const signal = AbortSignal.any([limits.signal, deadline.signal])
  let handle
  try {
    const container = environment.kind === 'docker' && toolId !== 'docker'
    const invocation = toolInvocation(environment, tool)
    const command = await ctx.subprocess.resolveExecutable(
      invocation.command,
      {},
      signal,
    )
    const argv = [command, ...invocation.prefixArgs, ...(container ? args.map(arg => environmentPath(environment, arg)) : args)]
    signal.throwIfAborted()
    handle = ctx.subprocess.spawn({
      argv,
      cwd: environment.cwd,
      env: container || toolId === 'docker' ? { PATH: dirname(command) + delimiter + (process.env.PATH ?? '') } : {},
      signal,
      graceMs: limits.graceMs,
      stdio: {
        stdin: input === undefined ? 'ignore' : { data: input },
        stdout: { maxBytes: limits.maxOutputBytes },
        stderr: { maxBytes: limits.maxOutputBytes },
      },
    })
    const outcome = await handle.done
    assert(handle.collected.stdout && handle.collected.stderr, 'Requested output collectors must be present')
    const stdout = handle.collected.stdout.readFrom(0)
    const stderr = handle.collected.stderr.readFrom(0)
    return {
      stdout: stdout.text,
      stderr: stderr.text,
      exitCode: outcome.exitCode,
      signal: outcome.signal,
      timedOut: deadline.signal.aborted,
      cancelled: limits.signal.aborted,
      truncated: stdout.lossy || stderr.lossy,
    }
  } finally {
    clearTimeout(timer)
    if (handle) {
      handle.terminate()
      await handle.done
      if (!(await handle.waitForExit())) throw new Error('Tool process did not reach quiescence')
      if (signal.aborted && limits.stopContainerOnAbort !== false && environment.kind === 'docker' && !environment.externalContainer && toolId !== 'docker' && environment.containerId) {
        const cleanup = await runProcess(ctx, environment, 'docker', ['kill', environment.containerId], {
          ...limits,
          signal: new AbortController().signal,
          durationMs: limits.graceMs,
        })
        requireProcessSuccess(cleanup)
      }
    }
  }
}
/**
 * Reject incomplete execution without mistaking an exit code for complete work.
 * @param result - complete process outcome.
 */
export function requireProcessSuccess(result: ProcessResult): void {
  if (result.exitCode !== 0 || result.signal !== null || result.timedOut || result.cancelled) {
    throw new Error(JSON.stringify(result))
  }
}
