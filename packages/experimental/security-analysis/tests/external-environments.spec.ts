/** External Docker execution preserves deployment identity and lifecycle ownership. @module */
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { delimiter, dirname, join } from 'node:path'
import { parseSecurityEnvironments } from '../src/security-environment-config.ts'
import { environmentPath, runProcess, toolInvocation } from '../src/workbench/process.ts'
import type { SecurityEnvironment } from '../src/workbench/providers.ts'
import { LocalEnvironmentManager } from '../src/environment-local.ts'

const contexts: Context[] = []
afterEach(async () => { await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())) })
const environment: SecurityEnvironment = { id: 'remote', label: 'Remote', kind: 'docker', cwd: process.cwd(),
  externalContainer: { name: 'existing-analysis', workdir: '/analysis' }, tools: [
    { id: 'docker', command: 'docker', prefixArgs: ['--context', 'remote'], versionArgs: ['--version'], source: 'Host' },
    { id: 'example', command: 'example-cli', prefixArgs: ['--plain'], versionArgs: ['--version'], source: 'Container' },
  ] }
const limits = { durationMs: 30000, maxOutputBytes: 8192, graceMs: 3000 }

function fixture(onSpawn?: (spec: SubprocessSpawnSpec) => void) {
  const command = join(process.cwd(), 'fixture-tools', 'docker')
  const terminate = vi.fn()
  const waitForExit = vi.fn(async () => true)
  const handle: SubprocessHandle = { stdin: undefined, stdout: undefined, stderr: undefined, control: undefined,
    done: Promise.resolve({ exitCode: 0, signal: null }),
    collected: { stdout: { readFrom: () => ({ text: 'finished', nextOffset: 8, lossy: false }) },
      stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) } },
    terminate, waitForExit }
  const subprocess = { resolveExecutable: vi.fn(async () => command),
    spawn: vi.fn((spec: SubprocessSpawnSpec) => { onSpawn?.(spec); return handle }) }
  const ctx = Object.assign(new Context(), { subprocess })
  contexts.push(ctx)
  return { ctx, subprocess, handle, command, terminate, waitForExit }
}

it('runs remote-container arguments without translating container paths into Host mounts', async () => {
  const { ctx, subprocess, command, terminate, waitForExit } = fixture()
  const result = await runProcess(ctx, environment, 'example', ['/data/input.bin', 'a b'], {
    ...limits, signal: new AbortController().signal,
  })
  expect(result).toMatchObject({ stdout: 'finished', cancelled: false, timedOut: false, exitCode: 0 })
  expect(subprocess.spawn).toHaveBeenCalledWith(expect.objectContaining({ cwd: environment.cwd,
    argv: [command, '--context', 'remote', 'exec', '-i', '--workdir', '/analysis', 'existing-analysis', 'example-cli', '--plain', '/data/input.bin', 'a b'],
    env: { PATH: dirname(command) + delimiter + (process.env.PATH ?? '') },
  }))
  expect(terminate).toHaveBeenCalledOnce()
  expect(waitForExit).toHaveBeenCalledOnce()
  expect(environmentPath(environment, '/data/input.bin')).toBe('/data/input.bin')
})

it('joins the Host client on cancellation without stopping or deleting the external container', async () => {
  const abort = new AbortController()
  const { ctx, subprocess, waitForExit } = fixture(() => { abort.abort(new Error('Operator cancelled')) })
  const quiescent = Promise.withResolvers<boolean>()
  const observing = Promise.withResolvers<undefined>()
  waitForExit.mockImplementation(() => { observing.resolve(undefined); return quiescent.promise })
  const pending = runProcess(ctx, environment, 'example', ['--version'], { ...limits, signal: abort.signal })
  try {
    await observing.promise
    let settled = false
    void pending.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
  } finally { quiescent.resolve(true); await pending }
  expect(await pending).toMatchObject({ cancelled: true })
  expect(subprocess.spawn).toHaveBeenCalledOnce()
  expect(subprocess.spawn.mock.calls[0]?.[0].argv).toContain('exec')
  expect(environment.containerId).toBeUndefined()
})

it('rejects external lifecycle mutations before launching Docker', async () => {
  const { ctx, subprocess } = fixture()
  const manager = new LocalEnvironmentManager(ctx, { timeoutMs: 30000, maxOutputBytes: 8192, graceMs: 3000,
    memoryMb: 256, cpus: 1, pids: 64, temporaryMb: 32 })
  await expect(manager.start(environment, new AbortController().signal)).rejects.toThrow('managed outside DSH')
  await expect(manager.stop(environment, new AbortController().signal)).rejects.toThrow('managed outside DSH')
  expect(subprocess.spawn).not.toHaveBeenCalled()
})

it('keeps local invocations and managed-container path mappings distinct', () => {
  const tool = environment.tools[1]!
  const { externalContainer: _external, ...configuration } = environment
  expect(toolInvocation({ ...configuration, kind: 'local' }, tool)).toEqual({
    command: 'example-cli', prefixArgs: ['--plain'],
  })
  const managed = { ...configuration, containerId: 'owned' }
  expect(toolInvocation(managed, tool).prefixArgs).toContain('/workspace')
  expect(environmentPath(managed, join(environment.cwd, 'input.bin'))).toBe('/workspace/input.bin')
  expect(() => toolInvocation(configuration, tool)).toThrow('Start the configured Docker environment')
})

it('accepts environment-relative deployments and rejects invalid external-container configuration', () => {
  expect(parseSecurityEnvironments([environment])[0]).toMatchObject(environment)
  for (const changed of [
    { kind: 'local' }, { image: 'analysis:latest' }, { cwd: 'relative-host-workspace' }, { tools: [] },
    { externalContainer: { name: '--help', workdir: '/analysis' } },
    { externalContainer: { name: 'existing-analysis', workdir: 'relative' } },
    { externalContainer: { name: 'existing-analysis', workdir: '/bad\0path' } },
    { tools: [environment.tools[0], environment.tools[0]] },
    ...['containerId', 'resolvedImageId', 'exchangeRoot', 'webTarget', 'manifest'].map(key => ({ [key]: 'runtime' })),
  ]) expect(() => parseSecurityEnvironments([{ ...environment, ...changed }])).toThrow()
  expect(() => parseSecurityEnvironments([environment, environment])).toThrow('Environment IDs must be unique')
})

it('parses existing local and managed Docker deployments without an external container declaration', () => {
  const environments = parseSecurityEnvironments([
    { id: 'local', kind: 'local', label: 'Host', cwd: process.cwd(), tools: [] },
    { id: 'managed', kind: 'docker', label: 'Managed', cwd: process.cwd(), image: 'analysis:fixture',
      tools: [environment.tools[0]] },
  ])
  expect(environments.map(item => item.kind)).toEqual(['local', 'docker'])
  expect(environments.every(item => item.externalContainer === undefined)).toBe(true)
})
