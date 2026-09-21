/** Runs bounded Frida probes through the configured subprocess provider. */

import assert from 'node:assert/strict'
import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle } from '@deepseek-ai/dsh-subprocess'
import { FRIDA_PYTHON_SCRIPT } from './frida-script.ts'

/** Explicit execution limits for the Python Frida adapter. */
export interface FridaConfig {
  pythonCommand: string
  cwd: string
  timeoutMs: number
  graceMs: number
  maxOutputBytes: number
  maxItems: number
  maxTraceDurationMs: number
}

/** Operator-selected device and currently running process. */
export interface FridaTarget {
  deviceId: string
  pid: number
  processName: string
}

/** Fixed metadata and function-hit probes; arbitrary scripts are not accepted. */
export interface FridaRequest {
  operation: 'modules' | 'exports' | 'trace-export'
  module?: string
  symbol?: string
  durationMs?: number
}

/** Probe text and whether item or byte limits removed any result content. */
export interface FridaResult {
  text: string
  truncated: boolean
}

function boundedResult(text: string, truncated: boolean, maxBytes: number): FridaResult {
  const result = { text, truncated }
  if (Buffer.byteLength(JSON.stringify(result)) <= maxBytes) return result
  const points = Array.from(new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text), part => part.segment)
  let low = 0
  let high = points.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    const candidate = { text: points.slice(0, middle).join(''), truncated: true }
    if (Buffer.byteLength(JSON.stringify(candidate)) <= maxBytes) low = middle
    else high = middle - 1
  }
  const bounded = { text: points.slice(0, low).join(''), truncated: true }
  if (Buffer.byteLength(JSON.stringify(bounded)) > maxBytes)
    throw new Error('Frida output budget cannot hold result metadata')
  return bounded
}

/**
 * Attaches to one configured process, runs a fixed probe, and waits for cleanup.
 * The caller owns target authorization and exclusion of concurrent probes.
 * @param ctx - context providing subprocess execution with scrubbed child environment.
 * @param config - explicit interpreter, output, deadline, and cleanup limits.
 * @param target - device ID plus PID and exact process name, checked before and after attach.
 * @param request - metadata enumeration or a bounded function-hit observation.
 * @param signal - cancels lookup and execution, then waits for process termination.
 * @returns bounded text; truncation never implies a complete inventory.
 * @throws when identity checks, probe execution, cancellation, deadlines, or cleanup fail.
 */
export async function runDynamic(
  ctx: Context,
  config: FridaConfig,
  target: FridaTarget,
  request: FridaRequest,
  signal: AbortSignal,
): Promise<FridaResult> {
  const durationMs = request.durationMs ?? config.maxTraceDurationMs
  if (!Number.isInteger(durationMs) || durationMs <= 0 || durationMs > config.maxTraceDurationMs) {
    throw new Error('Frida trace duration must be a positive integer within maxTraceDurationMs')
  }
  boundedResult('', false, config.maxOutputBytes)
  const deadline = new AbortController()
  const combined = AbortSignal.any([signal, deadline.signal])
  const timer = setTimeout(() => {
    deadline.abort(new Error('Frida probe timed out'))
  }, config.timeoutMs)
  let handle: SubprocessHandle | undefined
  try {
    const executable = await ctx.subprocess.resolveExecutable(config.pythonCommand, {}, combined)
    combined.throwIfAborted()
    handle = ctx.subprocess.spawn({
      argv: [executable, '-I', '-c', FRIDA_PYTHON_SCRIPT],
      cwd: config.cwd,
      stdio: {
        stdin: {
          data: JSON.stringify({
            ...target,
            ...request,
            durationMs,
            maxItems: config.maxItems,
            maxOutputBytes: config.maxOutputBytes,
          }),
        },
        stdout: { maxBytes: config.maxOutputBytes },
        stderr: { maxBytes: config.maxOutputBytes },
      },
      graceMs: config.graceMs,
      signal: combined,
      env: {},
    })
    const outcome = await handle.done
    assert(handle.collected.stdout && handle.collected.stderr, 'Requested output collectors must be present')
    const stdout = handle.collected.stdout.readFrom(0)
    const stderr = handle.collected.stderr.readFrom(0)
    const facts = {
      cancelled: signal.aborted,
      timedOut: deadline.signal.aborted,
      exitCode: outcome.exitCode,
      signal: outcome.signal,
      outputTruncated: stdout.lossy || stderr.lossy,
    }
    if (facts.cancelled || facts.timedOut || facts.exitCode !== 0 || facts.signal !== null || stdout.lossy) {
      throw new Error(`Frida probe failed ${JSON.stringify(facts)}: ${stderr.text}`)
    }
    const result: unknown = JSON.parse(stdout.text)
    if (
      typeof result !== 'object' ||
      result === null ||
      !('truncated' in result) ||
      typeof result.truncated !== 'boolean' ||
      !('items' in result) ||
      !Array.isArray(result.items)
    ) {
      throw new Error('Frida helper returned an invalid probe result')
    }
    return boundedResult(stdout.text, result.truncated, config.maxOutputBytes)
  } finally {
    clearTimeout(timer)
    if (handle !== undefined) {
      handle.terminate()
      await handle.done.catch(() => undefined)
      if (!(await handle.waitForExit())) throw new Error('Frida helper termination did not reach process quiescence')
    }
  }
}
