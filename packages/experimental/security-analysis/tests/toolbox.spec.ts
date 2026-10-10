/** Tool discovery preserves configured installations and separates runtime health. @module */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { SubprocessExecutableNotFoundError } from '@deepseek-ai/dsh-subprocess'
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
const pythonIdentity = (location = 'python') => JSON.stringify({ version: '3.12', location,
  prefix: '/env', basePrefix: '/base', virtualEnvironment: true, pipAvailable: true })
const missingContainerCommand = (command: string) =>
  `OCI runtime exec failed: exec failed: unable to start container process: exec: "${command}": executable file not found in $PATH`
function fixture(available = ['python', 'radare2', 'docker']) {
  const resolveExecutable = vi.fn(async (command: string) => {
    if (!available.includes(command)) throw new SubprocessExecutableNotFoundError('Executable not found: ' + command)
    return command
  })
  // The process runner is mocked; inventory uses only the executable resolver on this context.
  const ctx = Object.assign(new Context(), { subprocess: { resolveExecutable } })
  const inspect = (environment = env, signal = new AbortController().signal, toolIds?: readonly string[]) =>
    inspectToolbox(ctx, environment, limits, signal, toolIds)
  return { inspect, resolveExecutable }
}
beforeEach(() => {
  run.mockReset()
  run.mockImplementation(async (_ctx, _env, id) => ok(id === 'python' ? pythonIdentity()
    : id === 'r2ghidra' ? '[{"name":"r2ghidra","version":"6.2","path":"plugins/core.dll"}]'
      : ['r2pipe', 'frida', 'capstone', 'pefile'].includes(id) ? '{"version":"1.0","location":"site-packages"}' : '6.2'))
})
describe('tool inventory', () => {
  it.each(['capstone', 'pefile'])('probes %s only through the selected Python and preserves failure diagnostics', async (id) => {
    const environment: SecurityEnvironment = { ...env, tools: [
      { id: 'python', command: 'selected-python', prefixArgs: ['-I'], versionArgs: ['--version'], source: 'Configured' },
    ] }
    const { inspect, resolveExecutable } = fixture(['selected-python'])
    const result = await inspect(environment, undefined, [id])
    expect(result.tools.find(tool => tool.id === id)).toMatchObject({ status: 'available', command: 'selected-python', prefixArgs: ['-I'] })
    expect(run.mock.calls.map(call => call[2])).toEqual(['python', id])
    expect(run.mock.calls[1]?.[1].tools.find(tool => tool.id === id)).toMatchObject({ command: 'selected-python', prefixArgs: ['-I'] })
    expect(resolveExecutable.mock.calls.every(call => call[0] === 'selected-python')).toBe(true)
    run.mockImplementation(async (_ctx, _env, tool) => tool === 'python' ? ok(pythonIdentity('selected-python'))
      : { ...ok(''), exitCode: 1, stderr: `ModuleNotFoundError: No module named '${id}'` })
    const missing = (await inspect(environment, undefined, [id])).tools.find(tool => tool.id === id)
    expect(missing?.status).toBe('missing')
    expect(missing?.detail).toContain('ModuleNotFoundError')
    run.mockImplementation(async (_ctx, _env, tool) => tool === 'python' ? ok(pythonIdentity('selected-python')) : ok('invalid JSON'))
    expect((await inspect(environment, undefined, [id])).tools.find(tool => tool.id === id)?.status).toBe('error')
  })
  it.each([
    { name: 'analysis-one', workdir: '/work/first', context: 'lab-one' },
    { name: 'analysis-two', workdir: '/opt/second run', context: 'lab-two' },
  ])('binds Metasploit to the selected container $name without package inventory', async (container) => {
    run.mockImplementation(async (_ctx, _env, id, args) => id === 'docker'
      ? ok(args[0] === 'inspect' ? 'true' : '29.0') : ok('Framework: 6.4'))
    const environment: SecurityEnvironment = { ...env, id: container.name, kind: 'docker',
      externalContainer: { name: container.name, workdir: container.workdir }, tools: [
        { id: 'docker', command: 'docker', prefixArgs: ['--context', container.context], versionArgs: ['--version'], source: 'Host' },
        { id: 'metasploit', command: '/opt/msf/msfconsole', prefixArgs: ['-n'], versionArgs: ['--version'], source: 'Container' },
      ] }
    const inventory = await fixture().inspect(environment, undefined, ['metasploit'])
    expect(inventory).toMatchObject({ environmentId: container.name, runtime: 'ready',
      containerId: container.name, workdir: container.workdir })
    expect(inventory.tools).toMatchObject([{ id: 'metasploit', status: 'available', version: 'Framework: 6.4',
      command: 'docker', installation: { command: '/opt/msf/msfconsole', prefixArgs: ['-n'] },
      prefixArgs: ['--context', container.context, 'exec', '-i', '--workdir', container.workdir,
        container.name, '/opt/msf/msfconsole', '-n'],
    }])
    expect(run.mock.calls.map(call => [call[2], call[3]])).toEqual([
      ['docker', ['info', '--format', '{{.ServerVersion}}']],
      ['docker', ['inspect', '--format', '{{.State.Running}}', container.name]],
      ['metasploit', ['--version']],
    ])
  })
  it('returns the configured local Metasploit launcher without Docker arguments', async () => {
    const command = 'selected-msfconsole'
    const inventory = await fixture([command]).inspect({ ...env, tools: [
      { id: 'metasploit', command, prefixArgs: ['-n'], versionArgs: ['--version'], source: 'Local' },
    ] }, undefined, ['metasploit'])
    expect(inventory).toMatchObject({ environmentId: 'local', runtime: 'ready', workdir: env.cwd,
      tools: [{ id: 'metasploit', command, prefixArgs: ['-n'], status: 'available', version: '6.2' }] })
    expect(inventory.containerId).toBeUndefined()
    expect(inventory.tools[0]?.installation).toBeUndefined()
    expect(run.mock.calls.map(call => [call[2], call[3]])).toEqual([['metasploit', ['--version']]])
  })
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
  it('tries another command only when executable lookup reports that the first is absent', async () => {
    const { inspect, resolveExecutable } = fixture(['python3'])
    const result = await inspect(env, undefined, ['python'])
    expect(result.tools).toMatchObject([{ id: 'python', status: 'available', command: 'python3', python: {
      prefix: '/env', basePrefix: '/base', virtualEnvironment: true, pipAvailable: true,
    } }])
    expect(resolveExecutable.mock.calls.map(call => call[0])).toEqual(['python', 'python3'])
  })
  it.each([
    { ...ok(''), exitCode: 1, stderr: 'broken installation' },
    { ...ok(''), timedOut: true },
    ok('invalid identity'),
    ok(''),
  ])('keeps a failed selected installation instead of probing another candidate: %j', async (failure) => {
    run.mockResolvedValue(failure)
    const { inspect, resolveExecutable } = fixture(['python', 'python3'])
    const result = await inspect(env, undefined, ['python'])
    expect(result.tools).toMatchObject([{ id: 'python', status: 'error', command: 'python' }])
    expect(resolveExecutable.mock.calls.map(call => call[0])).toEqual(['python'])
    expect(run).toHaveBeenCalledTimes(1)
  })
  it('reports unexpected lookup errors without trying another executable', async () => {
    const { inspect, resolveExecutable } = fixture(['python', 'python3'])
    resolveExecutable.mockRejectedValueOnce(new Error('Execution world unavailable'))
    expect((await inspect(env, undefined, ['python'])).tools).toMatchObject([
      { id: 'python', status: 'error', detail: 'Execution world unavailable' },
    ])
    expect(resolveExecutable.mock.calls.map(call => call[0])).toEqual(['python'])
    expect(run).not.toHaveBeenCalled()
  })
  it('does not substitute another program when the selected executable disappears before the probe', async () => {
    run.mockRejectedValue(new SubprocessExecutableNotFoundError('Selected executable disappeared'))
    const { inspect, resolveExecutable } = fixture(['python', 'python3'])
    expect((await inspect(env, undefined, ['python'])).tools).toMatchObject([
      { id: 'python', status: 'error', command: 'python', detail: 'Selected executable disappeared' },
    ])
    expect(resolveExecutable.mock.calls.map(call => call[0])).toEqual(['python'])
    expect(run).toHaveBeenCalledTimes(1)
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
      : ok(id === 'python' ? pythonIdentity() : '[]'))
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
    run.mockImplementation(async (_ctx, environment, id, args) => id === 'docker' ? ok(args[0] === 'inspect' ? 'true' : '27.0')
      : { ...ok(''), exitCode: 127, stdout: missingContainerCommand(environment.tools.find(tool => tool.id === id)!.command) })
    const result = await fixture().inspect({ ...env, kind: 'docker', containerId: 'owned',
      tools: [{ id: 'docker', command: 'docker', versionArgs: [], source: 'Host' }] })
    expect(result.runtime).toBe('ready')
    expect(result.tools.find(tool => tool.id === 'radare2')?.status).toBe('missing')
  })
  it.each([
    { exitCode: 127, channel: 'stdout' },
    { exitCode: 126, channel: 'stderr' },
  ] as const)('tries a second container command after Docker reports the executable absent on $channel (exit $exitCode)', async ({ exitCode, channel }) => {
    run.mockImplementation(async (_ctx, environment, id, args) => {
      if (id === 'docker') return ok(args[0] === 'inspect' ? 'true' : '29.0')
      return environment.tools.find(tool => tool.id === id)?.command === 'python'
        ? { ...ok(''), exitCode, [channel]: missingContainerCommand('python') } : ok(pythonIdentity('/usr/bin/python3'))
    })
    const result = await fixture().inspect({ ...env, kind: 'docker', containerId: 'owned',
      tools: [{ id: 'docker', command: 'docker', versionArgs: [], source: 'Host' }] }, undefined, ['python'])
    expect(result.tools[0]?.status).toBe('available')
    expect(run.mock.calls.filter(call => call[2] === 'python')
      .map(call => call[1].tools.find(tool => tool.id === 'python')?.command)).toEqual(['python', 'python3'])
  })
  it.each([
    { ...ok(''), exitCode: 127, stderr: 'executable failed' },
    { ...ok(''), exitCode: 127, stderr: 'executable file not found' },
    { ...ok(''), exitCode: 127, stderr: missingContainerCommand('pip') },
    { ...ok(''), exitCode: 126, stderr: 'exec: "python": permission denied' },
    { ...ok(''), exitCode: 1, stderr: missingContainerCommand('python') },
    { ...ok(''), exitCode: 127, stdout: missingContainerCommand('python'), timedOut: true },
    { ...ok(''), exitCode: 127, stdout: missingContainerCommand('python'), cancelled: true },
    { ...ok(''), exitCode: 127, stdout: missingContainerCommand('python'), truncated: true },
    { ...ok(''), exitCode: 127, stdout: missingContainerCommand('python'), signal: 'SIGTERM' as const },
  ])('preserves failed or incomplete container probes without replacing their executable: %j', async (failure) => {
    run.mockImplementation(async (_ctx, _environment, id, args) => id === 'docker'
      ? ok(args[0] === 'inspect' ? 'true' : '29.0') : failure)
    const result = await fixture().inspect({ ...env, kind: 'docker', containerId: 'owned',
      tools: [{ id: 'docker', command: 'docker', versionArgs: [], source: 'Host' }] }, undefined, ['python'])
    expect(result.tools[0]).toMatchObject({ status: 'error', command: 'python' })
    expect(run.mock.calls.filter(call => call[2] === 'python')).toHaveLength(1)
  })
  it('reports a missing configured container executable without probing another candidate', async () => {
    run.mockImplementation(async (_ctx, _environment, id, args) => id === 'docker'
      ? ok(args[0] === 'inspect' ? 'true' : '29.0')
      : { ...ok(''), exitCode: 127, stdout: missingContainerCommand('selected-python') })
    const result = await fixture().inspect({ ...env, kind: 'docker', containerId: 'owned', tools: [
      { id: 'docker', command: 'docker', versionArgs: [], source: 'Host' },
      { id: 'python', command: 'selected-python', versionArgs: [], source: 'Configured' },
    ] }, undefined, ['python'])
    expect(result.tools[0]).toMatchObject({ status: 'error', command: 'selected-python' })
    expect(run.mock.calls.filter(call => call[2] === 'python')).toHaveLength(1)
  })
  it('reports a conflicting module interpreter override without silently replacing it', async () => {
    const result = await fixture().inspect({ ...env,
      tools: [{ id: 'r2pipe', command: 'other-python', versionArgs: [], source: 'Custom' }] })
    expect(result.tools.find(tool => tool.id === 'r2pipe')).toMatchObject({ status: 'error', command: 'other-python' })
    expect(run.mock.calls.some(call => call[2] === 'r2pipe')).toBe(false)
  })
  it('returns remote Docker invocations after probing dependencies inside the selected container', async () => {
    run.mockImplementation(async (_ctx, _env, id, args) => id === 'docker' ? ok(args[0] === 'inspect' ? 'true' : '29.0')
      : ok(id === 'python' ? pythonIdentity('/opt/python/bin/python3')
        : id === 'r2ghidra' ? '[{"name":"r2ghidra","version":"6.2","path":"/plugins/core.so"}]'
          : id === 'r2pipe' || id === 'frida' ? '{"version":"1.0","location":"/site-packages"}' : '6.2'))
    const environment: SecurityEnvironment = { ...env, kind: 'docker',
      externalContainer: { name: 'remote-analysis', workdir: '/analysis' }, tools: [
        { id: 'docker', command: 'docker', prefixArgs: ['--context', 'remote'], versionArgs: [], source: 'Host' },
        { id: 'python', command: 'python3', prefixArgs: ['-I'], versionArgs: [], source: 'Container' },
      ] }
    const result = await fixture().inspect(environment)
    expect(result).toMatchObject({ runtime: 'ready', containerId: 'remote-analysis', workdir: '/analysis' })
    expect(result.tools.find(tool => tool.id === 'r2pipe')).toMatchObject({ status: 'available', command: 'docker',
      installation: { command: 'python3', prefixArgs: ['-I'] },
      location: '/site-packages', prefixArgs: ['--context', 'remote', 'exec', '-i', '--workdir', '/analysis', 'remote-analysis', 'python3', '-I'] })
    const moduleProbe = run.mock.calls.find(call => call[2] === 'r2pipe')!
    expect(moduleProbe[1].tools.find(tool => tool.id === 'r2pipe')).toMatchObject({ command: 'python3', prefixArgs: ['-I'] })
    expect(moduleProbe[3][1]).toContain('importlib.import_module("r2pipe")')
    expect(run.mock.calls.find(call => call[2] === 'docker' && call[3][0] === 'inspect')?.[3]).toEqual([
      'inspect', '--format', '{{.State.Running}}', 'remote-analysis',
    ])
    expect(environment.tools[1]?.command).toBe('python3')
    expect(environment.containerId).toBeUndefined()
  })
  it('does not probe tools or publish wrapper invocations for a stopped external container', async () => {
    run.mockImplementation(async (_ctx, _env, _id, args) => ok(args[0] === 'inspect' ? 'false' : '29.0'))
    const result = await fixture().inspect({ ...env, kind: 'docker',
      externalContainer: { name: 'stopped-analysis', workdir: '/analysis' },
      tools: [{ id: 'docker', command: 'docker', versionArgs: [], source: 'Host' }] })
    expect(result.runtime).toBe('stopped')
    expect(result.tools.every(tool => tool.status === 'not-checked')).toBe(true)
    expect(run.mock.calls.every(call => call[2] === 'docker')).toBe(true)
  })
})
