/** Packaged scripts expose usable paths and bounded dynamic observers. @module */
import { access, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { isAbsolute } from 'node:path'
import { runInNewContext } from 'node:vm'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { expect, it, vi } from 'vitest'
import { analysisScripts } from '../src/analysis-scripts.ts'

it('ships every catalog resource and returns independent metadata', async () => {
  const entries = analysisScripts()
  expect(new Set(entries.map(entry => entry.id)).size).toBe(7)
  for (const entry of entries) {
    expect(isAbsolute(entry.path)).toBe(true)
    await access(entry.path)
    expect(entry.parameters.some(parameter => parameter.flag === '--output' && parameter.required)).toBe(true)
  }
  entries[0]!.parameters[0]!.value = 'changed'
  expect(analysisScripts()[0]!.parameters[0]!.value).not.toBe('changed')
})

it('runs offline fixtures and parameter preparation from an independent working directory', async () => {
  const python = process.env.DSH_SECURITY_SCRIPT_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3')
  const { stderr } = await promisify(execFile)(python, [fileURLToPath(new URL('./analysis_scripts_test.py', import.meta.url)), '-v'], { timeout: 60_000 })
  expect(stderr).toContain('OK')
}, 90_000)

it('decodes synthetic wireless fixtures with TShark when installed', async () => {
  const python = process.env.DSH_SECURITY_SCRIPT_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3')
  const { stderr } = await promisify(execFile)(python, [fileURLToPath(new URL('./wireless_capture_test.py', import.meta.url)), '-v'], { timeout: 60_000 })
  expect(stderr).toContain('OK')
}, 90_000)

it('bounds initial module callbacks and detaches its observer', async () => {
  const code = await readFile(analysisScripts().find(entry => entry.kind === 'moduleWatch')!.path, 'utf8')
  const detach = vi.fn(), send = vi.fn<(value: Record<string, unknown>) => void>()
  const module = { name: 'owned', path: '/owned', base: { toString: () => '0x1' }, size: 12 }
  runInNewContext(code, { securityScriptOptions: { maxEvents: 1 }, send, Process: {
    id: 10, attachModuleObserver(callbacks: { onAdded(module: object): void; onRemoved(module: object): void }) {
      callbacks.onAdded(module); callbacks.onAdded(module); callbacks.onRemoved(module)
      return { detach }
    },
  } })
  expect(send.mock.calls.map(call => call[0])).toEqual([
    { event: 'existing', pid: 10, name: 'owned', path: '/owned', base: '0x1', size: 12 },
    { event: 'limit', incomplete: true, observed: 1 },
  ])
  expect(detach).toHaveBeenCalledOnce()
})

it('records bounded backtraces and stops hooks at the event limit', async () => {
  const code = await readFile(analysisScripts().find(entry => entry.kind === 'functionTrace')!.path, 'utf8')
  const send = vi.fn<(value: Record<string, unknown>) => void>(), detach = vi.fn()
  const callbacks: Array<{ onEnter(this: { threadId: number; context: object }): void }> = []
  runInNewContext(code, { securityScriptOptions: { module: 'owned', symbols: ['foo'], maxEvents: 2, stackDepth: 1 }, send,
    Process: { id: 11, getModuleByName: () => ({ name: 'owned', getExportByName: () => 1 }) },
    Interceptor: { attach: (_address: number, callback: typeof callbacks[number]) => { callbacks.push(callback); return { detach } } },
    Thread: { backtrace: () => [1, 2, 3] }, Backtracer: { ACCURATE: 1 }, DebugSymbol: { fromAddress: String },
  })
  for (let index = 0; index < 3; index++) callbacks[0]!.onEnter.call({ threadId: 1, context: {} })
  expect(send.mock.calls.map(call => call[0].event)).toEqual(['ready', 'call', 'call', 'limit'])
  expect(send.mock.calls[1]![0].backtrace).toEqual(['1'])
  expect(send.mock.calls[3]![0]).toMatchObject({ incomplete: true, counts: { foo: 2 } })
  expect(detach).toHaveBeenCalledOnce()
})
