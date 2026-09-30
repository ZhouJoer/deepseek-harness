/** Tool discovery preserves configured installations and separates runtime health. @module */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { inspectToolbox } from '../src/toolbox.ts'
import { runProcess } from '../src/workbench/process.ts'
import type { SecurityEnvironment } from '../src/workbench/providers.ts'

vi.mock('../src/workbench/process.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/workbench/process.ts')>(), runProcess: vi.fn(),
}))
const run = vi.mocked(runProcess)
const env: SecurityEnvironment = { id: 'local', label: 'Local', kind: 'local', cwd: process.cwd(), tools: [] }
const limits = { durationMs: 1000, maxOutputBytes: 8192, graceMs: 100 }
const ok = (stdout: string) => ({ stdout, stderr: '', exitCode: 0, signal: null, timedOut: false, cancelled: false, truncated: false })
function fixture(available = ['python', 'radare2']) {
  const resolveExecutable = vi.fn(async (command: string) => {
    if (!available.includes(command)) throw new Error('Executable not found: ' + command)
    return command
  })
  // The process runner is mocked; inventory uses only the executable resolver on this context.
  const ctx = Object.assign(new Context(), { subprocess: { resolveExecutable } })
  const inspect = (environment = env, signal = new AbortController().signal) => inspectToolbox(ctx, environment, limits, signal)
  return { inspect, resolveExecutable }
}
beforeEach(() => {
  run.mockReset()
  run.mockImplementation(async (_ctx, _env, id) => ok(id === 'python' ? '{"version":"3.12","location":"python"}'
    : id === 'r2ghidra' ? '[{"name":"r2ghidra","version":"6.2","path":"plugins/core.dll"}]'
      : id === 'r2pipe' || id === 'frida' ? '{"version":"1.0","location":"site-packages"}' : '6.2'))
})
describe('tool inventory', () => {
  it('discovers tools and binds plugins and modules to the selected executable', async () => {
    const { inspect } = fixture()
    const result = await inspect()
    expect(result.runtime).toBe('ready')
    expect(result.tools.find(tool => tool.id === 'r2ghidra')).toMatchObject({ status: 'available', command: 'radare2', location: 'plugins/core.dll' })
    expect(result.tools.find(tool => tool.id === 'r2pipe')).toMatchObject({ status: 'available', command: 'python' })
    expect(result.tools.find(tool => tool.id === 'jadx')?.status).toBe('missing')
    expect(run.mock.calls.find(call => call[2] === 'r2pipe')?.[1].tools.find(tool => tool.id === 'r2pipe')?.command).toBe('python')
  })
  it('does not replace an invalid explicit executable with a PATH installation', async () => {
    const { inspect, resolveExecutable } = fixture()
    const result = await inspect({ ...env, tools: [{ id: 'radare2', command: 'missing-r2', versionArgs: ['-v'], source: 'Selected installation' }] })
    expect(result.tools.find(tool => tool.id === 'radare2')?.status).toBe('error')
    expect(resolveExecutable).not.toHaveBeenCalledWith('radare2', expect.anything(), expect.anything())
    expect(result.tools.find(tool => tool.id === 'r2ghidra')).toMatchObject({ status: 'not-checked', detail: 'dependency-unavailable' })
  })
  it('rejects Python placeholders and records missing plugins and modules independently', async () => {
    run.mockImplementation(async (_ctx, _env, id) => id === 'r2pipe'
      ? { ...ok(''), exitCode: 1, stderr: 'ModuleNotFoundError: r2pipe' }
      : ok(id === 'python' ? 'WindowsApps placeholder' : id === 'r2ghidra' ? '[]' : '6.2'))
    const first = await fixture().inspect()
    expect(first.tools.find(tool => tool.id === 'python')?.status).toBe('error')
    expect(first.tools.find(tool => tool.id === 'r2ghidra')?.status).toBe('missing')
    run.mockImplementation(async (_ctx, _env, id) => id === 'r2pipe'
      ? { ...ok(''), exitCode: 1, stderr: 'ModuleNotFoundError: r2pipe' }
      : ok(id === 'python' ? '{"version":"3.12","location":"python"}' : '[]'))
    expect((await fixture().inspect()).tools.find(tool => tool.id === 'r2pipe')?.status).toBe('missing')
  })
  it('marks stopped containers uninspected and never executes tools inside them', async () => {
    const docker = { ...env, kind: 'docker' as const, tools: [{ id: 'docker', command: 'docker', versionArgs: ['--version'], source: 'Host' }] }
    const result = await fixture().inspect(docker)
    expect(result.runtime).toBe('stopped')
    expect(result.tools.every(tool => tool.status === 'not-checked')).toBe(true)
    expect(run.mock.calls.map(call => call[2])).toEqual(['docker'])
    run.mockRejectedValue(new Error('Docker daemon unavailable'))
    expect((await fixture().inspect(docker)).runtime).toBe('unavailable')
  })
  it('propagates cancellation and reports timed out queries as probe errors', async () => {
    const abort = new AbortController(); abort.abort(new Error('Cancelled'))
    await expect(fixture().inspect(env, abort.signal)).rejects.toThrow('Cancelled')
    run.mockResolvedValue({ ...ok(''), timedOut: true })
    expect((await fixture().inspect()).tools.find(tool => tool.id === 'radare2')?.status).toBe('error')
  })
  it('keeps a running container ready when optional PATH tools are absent', async () => {
    run.mockImplementation(async (_ctx, _env, id, args) => id === 'docker' ? ok(args[0] === 'inspect' ? 'true' : '27.0')
      : { ...ok(''), exitCode: 127, stderr: 'executable file not found' })
    const result = await fixture().inspect({ ...env, kind: 'docker', containerId: 'owned',
      tools: [{ id: 'docker', command: 'docker', versionArgs: [], source: 'Host' }] })
    expect(result.runtime).toBe('ready')
    expect(result.tools.find(tool => tool.id === 'radare2')?.status).toBe('missing')
  })
  it('reports a conflicting module interpreter override without silently replacing it', async () => {
    const result = await fixture().inspect({ ...env,
      tools: [{ id: 'r2pipe', command: 'other-python', versionArgs: [], source: 'Custom' }] })
    expect(result.tools.find(tool => tool.id === 'r2pipe')).toMatchObject({ status: 'error', command: 'other-python' })
    expect(run.mock.calls.some(call => call[2] === 'r2pipe')).toBe(false)
  })
})
