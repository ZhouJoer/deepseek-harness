/** Frida adapter limits, fixed probe behavior, and managed process cleanup. */
import { runInNewContext } from 'node:vm'
import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FRIDA_PYTHON_SCRIPT } from '../src/frida-script.ts'
import { runDynamic } from '../src/frida.ts'
import type { FridaConfig } from '../src/frida.ts'

const config: FridaConfig = {
  pythonCommand: 'python',
  cwd: '/fixture',
  timeoutMs: 30_000,
  graceMs: 30,
  maxOutputBytes: 4096,
  maxItems: 2,
  maxTraceDurationMs: 50,
}
const target = { deviceId: 'local', pid: 41, processName: 'owned-fixture' }

function fixture(stdout = JSON.stringify({ items: [], truncated: false }), lossy = false) {
  const completion = Promise.withResolvers<SubprocessOutcome>()
  const quiescence = Promise.withResolvers<boolean>()
  const spawned = Promise.withResolvers<SubprocessSpawnSpec>()
  const cleanupStarted = Promise.withResolvers<undefined>()
  const terminate = vi.fn(() => {
    cleanupStarted.resolve(undefined)
  })
  const handle: SubprocessHandle = {
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    control: undefined,
    collected: {
      stdout: { readFrom: () => ({ text: stdout, nextOffset: Buffer.byteLength(stdout), lossy }) },
      stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
    },
    done: completion.promise,
    terminate,
    waitForExit: () => quiescence.promise,
  }
  const resolveExecutable = vi.fn(async () => '/fixture/python')
  const spawn = vi.fn((spec: SubprocessSpawnSpec) => {
    spawned.resolve(spec)
    return handle
  })
  // The consumer exercises only this service; no Cordis registry or live process is acquired.
  const ctx = { subprocess: { resolveExecutable, spawn } } as unknown as Context
  return { ctx, completion, quiescence, spawned, cleanupStarted, terminate, resolveExecutable, spawn }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('Frida subprocess adapter', () => {
  it('uses isolated Python and stdin data, then waits for managed-range exit', async () => {
    const test = fixture()
    const finished = vi.fn()
    const pending = runDynamic(test.ctx, config, target, { operation: 'modules' }, new AbortController().signal)
    void pending.then(finished)
    const spec = await test.spawned.promise
    expect(spec.argv).toEqual(['/fixture/python', '-I', '-c', FRIDA_PYTHON_SCRIPT])
    expect(spec.env).toEqual({})
    expect(spec.stdio.stdin).toEqual({
      data: JSON.stringify({ ...target, operation: 'modules', durationMs: 50, maxItems: 2, maxOutputBytes: 4096 }),
    })
    test.completion.resolve({ exitCode: 0, signal: null })
    await test.cleanupStarted.promise
    expect(test.terminate).toHaveBeenCalledOnce()
    expect(finished).not.toHaveBeenCalled()
    test.quiescence.resolve(true)
    await expect(pending).resolves.toEqual({ text: '{"items":[],"truncated":false}', truncated: false })
  })

  it('reports cancellation even when the helper traps termination and exits zero', async () => {
    const test = fixture()
    const abort = new AbortController()
    const pending = runDynamic(test.ctx, config, target, { operation: 'modules' }, abort.signal)
    const rejected = expect(pending).rejects.toThrow('"cancelled":true,"timedOut":false,"exitCode":0')
    const spec = await test.spawned.promise
    abort.abort()
    expect(spec.signal?.aborted).toBe(true)
    test.completion.resolve({ exitCode: 0, signal: null })
    test.quiescence.resolve(true)
    await rejected
    expect(test.terminate).toHaveBeenCalledOnce()
  })

  it('keeps timeout, exit signal, and truncation as independent failure facts', async () => {
    vi.useFakeTimers()
    const test = fixture('', true)
    const pending = runDynamic(
      test.ctx,
      { ...config, timeoutMs: 100 },
      target,
      { operation: 'modules' },
      new AbortController().signal,
    )
    const rejected = expect(pending).rejects.toThrow(
      '"timedOut":true,"exitCode":null,"signal":"SIGTERM","outputTruncated":true',
    )
    const spec = await test.spawned.promise
    await vi.advanceTimersByTimeAsync(100)
    expect(spec.signal?.aborted).toBe(true)
    test.completion.resolve({ exitCode: null, signal: 'SIGTERM' })
    test.quiescence.resolve(true)
    await rejected
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects partial helper JSON instead of presenting it as a successful inventory', async () => {
    const test = fixture('{"items":[],"truncated":false}', true)
    const pending = runDynamic(test.ctx, config, target, { operation: 'modules' }, new AbortController().signal)
    const rejected = expect(pending).rejects.toThrow('"outputTruncated":true')
    await test.spawned.promise
    test.completion.resolve({ exitCode: 0, signal: null })
    test.quiescence.resolve(true)
    await rejected
  })

  it.each(['not json', '{"items":[],"truncated":"false"}'])(
    'cleans up when helper output is malformed: %s',
    async (output) => {
      const test = fixture(output)
      const pending = runDynamic(test.ctx, config, target, { operation: 'modules' }, new AbortController().signal)
      const rejected = expect(pending).rejects.toThrow()
      await test.spawned.promise
      test.completion.resolve({ exitCode: 0, signal: null })
      test.quiescence.resolve(true)
      await rejected
      expect(test.terminate).toHaveBeenCalledOnce()
    },
  )

  it('bounds the complete UTF-8 result including escaping and the truncation marker', async () => {
    const test = fixture(JSON.stringify({ items: ['中文😀'.repeat(50)], truncated: false }))
    const pending = runDynamic(
      test.ctx,
      { ...config, maxOutputBytes: 101 },
      target,
      { operation: 'modules' },
      new AbortController().signal,
    )
    await test.spawned.promise
    test.completion.resolve({ exitCode: 0, signal: null })
    test.quiescence.resolve(true)
    const result = await pending
    expect(result.truncated).toBe(true)
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(101)
    expect(result.text).not.toContain('\uFFFD')
  })

  it('rejects an excessive observation duration before spawning', async () => {
    const test = fixture()
    await expect(
      runDynamic(test.ctx, config, target, { operation: 'trace-export', durationMs: 51 }, new AbortController().signal),
    ).rejects.toThrow('maxTraceDurationMs')
    expect(test.spawn).not.toHaveBeenCalled()
  })

  it('rejects an output budget too small for metadata before spawning', async () => {
    const test = fixture()
    await expect(
      runDynamic(
        test.ctx,
        { ...config, maxOutputBytes: 1 },
        target,
        { operation: 'modules' },
        new AbortController().signal,
      ),
    ).rejects.toThrow('metadata')
    expect(test.spawn).not.toHaveBeenCalled()
  })

  it('terminates and waits after a provider rejects the process outcome', async () => {
    const test = fixture()
    const pending = runDynamic(test.ctx, config, target, { operation: 'modules' }, new AbortController().signal)
    const rejected = expect(pending).rejects.toThrow('spawn failed')
    await test.spawned.promise
    test.completion.reject(new Error('spawn failed'))
    test.quiescence.resolve(true)
    await rejected
    expect(test.terminate).toHaveBeenCalledOnce()
  })
})

function fixedProbe() {
  const source = FRIDA_PYTHON_SCRIPT.match(/PROBE = r'''([\s\S]*?)'''/)?.[1]
  if (source === undefined) throw new Error('Fixed Frida probe source is missing')
  const module = {
    name: 'owned.so',
    base: { toString: () => '0x100' },
    size: 64,
    path: '/owned.so',
    enumerateExports: () => [{ name: 'entry', type: 'function', address: { toString: () => '0x104' } }],
    getExportByName: vi.fn(() => '0x104'),
  }
  const detach = vi.fn()
  const hooks: { onEnter?: () => void } = {}
  const rpc = { exports: {} as { run(request: Record<string, unknown>): unknown } }
  runInNewContext(source, {
    rpc,
    setTimeout,
    Process: {
      id: 41,
      enumerateModules: () => [module, module],
      getModuleByName: (name: string) => {
        if (name !== module.name) throw new Error('Module not found')
        return module
      },
    },
    Interceptor: {
      attach: (_address: string, callbacks: { onEnter: () => void }) => {
        hooks.onEnter = callbacks.onEnter
        return { detach }
      },
      flush: vi.fn(),
    },
  })
  return { run: rpc.exports.run.bind(rpc.exports), hooks, detach, module }
}

describe('fixed injected probes', () => {
  it('limits module inventory and uses current module-instance export enumeration', () => {
    const probe = fixedProbe()
    const modules = probe.run({ pid: 41, operation: 'modules', maxItems: 1 }) as {
      items: unknown[]
      truncated: boolean
    }
    expect(modules.items).toHaveLength(1)
    expect(modules.truncated).toBe(true)
    expect(probe.run({ pid: 41, operation: 'exports', module: 'owned.so', maxItems: 2 })).toEqual({
      items: [{ name: 'entry', type: 'function', address: '0x104' }],
      truncated: false,
    })
  })

  it('waits for the observation window and reports only function hits', async () => {
    vi.useFakeTimers()
    const probe = fixedProbe()
    const pending = probe.run({
      pid: 41,
      operation: 'trace-export',
      module: 'owned.so',
      symbol: 'entry',
      durationMs: 20,
    }) as Promise<unknown>
    const finished = vi.fn()
    void pending.then(finished)
    probe.hooks.onEnter?.()
    probe.hooks.onEnter?.()
    await vi.advanceTimersByTimeAsync(19)
    expect(finished).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await expect(pending).resolves.toEqual({
      items: [{ module: 'owned.so', symbol: 'entry', hits: 2, durationMs: 20 }],
      truncated: false,
    })
    expect(probe.detach).toHaveBeenCalledOnce()
  })

  it('rejects mismatched processes, missing modules, missing functions and unknown probes', () => {
    const probe = fixedProbe()
    expect(() => probe.run({ pid: 42, operation: 'modules' })).toThrow('process ID')
    expect(() => probe.run({ pid: 41, operation: 'exports', module: 'absent' })).toThrow('Module not found')
    expect(() => probe.run({ pid: 41, operation: 'trace-export', module: 'owned.so', symbol: 'missing' })).toThrow(
      'function not found',
    )
    expect(() => probe.run({ pid: 41, operation: 'evaluate', module: 'owned.so' })).toThrow('Unsupported probe')
  })
})
