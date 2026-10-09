/** Native validation preserves the approved script, environment and process outcomes. @module */
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi, onTestFinished } from 'vitest'
import { NativeProvider } from '../src/native-provider.ts'
import { ArtifactStore } from '../src/workbench/artifacts.ts'
import { operationSchema, sourceAssetSchema } from '../src/workbench/model.ts'
import { runProcess } from '../src/workbench/process.ts'
import { inspectToolbox } from '../src/toolbox.ts'
import type { AnalysisContext } from '../src/workbench/providers.ts'

vi.mock('../src/workbench/process.ts', async original => ({
  ...await original<typeof import('../src/workbench/process.ts')>(), runProcess: vi.fn(),
}))
vi.mock('../src/toolbox.ts', () => ({ inspectToolbox: vi.fn() }))
const completed = { stdout: '', stderr: '', exitCode: 0, signal: null, timedOut: false, cancelled: false, truncated: false }
const identity = { ...completed, stdout: JSON.stringify({ version: '3.12.1', platform: process.platform }) }
async function fixture() {
  vi.mocked(runProcess).mockReset().mockResolvedValue(identity)
  const root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-native-')))
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  const python = join(root, 'python.exe')
  vi.mocked(inspectToolbox).mockReset().mockResolvedValue({ environmentId: 'local', kind: 'local', runtime: 'ready',
    detail: '', checkedAt: 0, workdir: root, tools: [{ id: 'python', category: 'runtime', status: 'available',
      command: 'py', location: python, version: '3.12.1', source: 'PATH', detail: '', installUrl: '', invocation: 'shell' }] })
  const artifacts = new ArtifactStore(join(root, 'store'), 65536)
  const script = await artifacts.put(Buffer.from('print("approved content")\n'), 'text/x-python')
  const context: AnalysisContext = { artifacts, signal: new AbortController().signal, durationMs: 10000, maxOutputBytes: 4096,
    asset: sourceAssetSchema.parse({ id: 'asset', engagementId: 'project', kind: 'source', label: 'Source', identity: 'measured', artifact: script }),
    environment: { id: 'local', kind: 'local', label: 'Host', cwd: root, tools: [] } }
  const provider = new NativeProvider(ctx, { graceMs: 100 })
  const request = operationSchema.parse({ provider: 'native', operation: 'python', environmentId: 'local', assetId: 'asset', parameters: {}, impact: 'observe', script })
  const resolved = await provider.prepare(request, context)
  return { provider, context, request, resolved, root, python }
}
it('pins native Python and runs only the stored script via stdin in the approved directory', async () => {
  const { provider, context, resolved, root, python } = await fixture()
  expect(resolved).toMatchObject({ impact: 'target-write', parameters: { cwd: root, python, version: '3.12.1', platform: process.platform } })
  vi.mocked(runProcess).mockResolvedValueOnce(identity).mockResolvedValueOnce({ ...completed, stdout: 'approved content\n' })
  expect(await provider.run(resolved, context)).toMatchObject({ incomplete: false, summary: 'approved content\n' })
  const call = vi.mocked(runProcess).mock.calls.at(-1)!
  expect(call[1].cwd).toBe(root)
  expect(call[1].tools[0]?.command).toBe(python)
  expect(call[3]).toEqual(['-I', '-u', '-B', '-'])
  expect(call[5]).toBe('print("approved content")\n')
  expect(call[4].signal).toBeInstanceOf(AbortSignal)
})
it('rejects container environments, missing scripts and changed platform before running code', async () => {
  const { provider, context, resolved, request } = await fixture()
  const docker = { ...context, environment: { ...context.environment, kind: 'docker' as const } }
  await expect(provider.prepare(request, docker)).rejects.toThrow('local environment')
  expect(() => provider.resolve(resolved, docker)).toThrow('local environment')
  expect(() => provider.resolve({ ...resolved, script: undefined }, context)).toThrow('complete immutable script')
  expect(() => provider.resolve({ ...resolved, parameters: { ...resolved.parameters, platform: 'other' } }, context)).toThrow('platform changed')
  await expect(provider.prepare({ ...request, parameters: { cwd: tmpdir() } }, context)).rejects.toThrow('inside')
  await expect(provider.prepare({ ...request, parameters: { command: 'other' } }, context)).rejects.toThrow()
})
it('refuses unavailable Python and changed interpreter versions without executing the script', async () => {
  const { provider, context, resolved, request } = await fixture()
  vi.mocked(inspectToolbox).mockResolvedValueOnce({ environmentId: 'local', kind: 'local', runtime: 'ready',
    detail: '', checkedAt: 0, workdir: context.environment.cwd, tools: [] })
  await expect(provider.prepare(request, context)).rejects.toThrow('Configure an available native Python')
  vi.mocked(runProcess).mockClear().mockResolvedValue({ ...identity, stdout: JSON.stringify({ version: '3.13.0', platform: process.platform }) })
  await expect(provider.run(resolved, context)).rejects.toThrow('changed')
  expect(runProcess).toHaveBeenCalledTimes(1)
})
it.each([
  { ...completed, exitCode: 1, stderr: 'native failure' },
  { ...completed, timedOut: true },
  { ...completed, signal: 'SIGTERM' as const },
])('retains incomplete process output for $stderr $timedOut $signal', async (result) => {
  const { provider, context, resolved } = await fixture()
  vi.mocked(runProcess).mockResolvedValueOnce(identity).mockResolvedValueOnce({ ...result, stdout: 'partial' })
  const evidence = await provider.run(resolved, context)
  expect(evidence.incomplete).toBe(true)
  expect(evidence.failure).toBeTruthy()
  expect(JSON.parse(Buffer.from(evidence.bytes).toString())).toMatchObject({ stdout: 'partial' })
})
it('bounds JSON output even when escaping expands stdout', async () => {
  const { provider, context, resolved } = await fixture()
  vi.mocked(runProcess).mockResolvedValueOnce(identity).mockResolvedValueOnce({ ...completed, stdout: '\\'.repeat(4096) })
  const result = await provider.run(resolved, context)
  expect(result.incomplete).toBe(true)
  expect(result.bytes.byteLength).toBeLessThanOrEqual(context.maxOutputBytes)
})
