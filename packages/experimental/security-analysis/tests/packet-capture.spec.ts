/** Offline decoder admission, evidence identity and owned-directory cleanup. @module */
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { PacketCaptureProvider } from '../src/packet-capture-provider.ts'
import { ArtifactStore } from '../src/workbench/artifacts.ts'
import { fileAssetSchema, operationSchema } from '../src/workbench/model.ts'
import type { AnalysisContext } from '../src/workbench/providers.ts'
import { inspectToolbox } from '../src/toolbox.ts'
import { runProcess } from '../src/workbench/process.ts'
import { canObserve } from '../src/workbench/roles.ts'

vi.mock('../src/toolbox.ts', () => ({ inspectToolbox: vi.fn() }))
vi.mock('../src/workbench/process.ts', async original => ({ ...await original<typeof import('../src/workbench/process.ts')>(), runProcess: vi.fn() }))
const roots: string[] = []
afterEach(async () => { vi.resetAllMocks(); await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-capture-')); roots.push(root)
  const artifacts = new ArtifactStore(root, 100000)
  const artifact = await artifacts.put(Buffer.from('d4c3b2a1020004000000000000000000ffff000069000000', 'hex'), 'application/octet-stream')
  const context: AnalysisContext = { artifacts, signal: new AbortController().signal, durationMs: 1000, maxOutputBytes: 10000,
    asset: fileAssetSchema.parse({ id: 'file', engagementId: 'project', label: 'capture', artifact, format: 'other', identity: 'measured' }),
    environment: { id: 'local', kind: 'local', cwd: root, label: 'Host', tools: [] } }
  const request = operationSchema.parse({ provider: 'packet-capture', operation: 'summary', assetId: 'file', environmentId: 'local', impact: 'observe', parameters: { protocol: 'wifi' } })
  const provider = new PacketCaptureProvider(new Context(), { maxPackets: 10, maxDecodeBytes: 65536, graceMs: 10 })
  vi.mocked(inspectToolbox).mockResolvedValue({ environmentId: 'local', kind: 'local', runtime: 'ready', detail: '', checkedAt: 1, workdir: root,
    tools: ['python', 'tshark'].map(id => ({ id, category: 'utility', status: 'available', command: join(root, id), version: '1', location: '', source: 'Fixture', detail: '', installUrl: '', invocation: 'shell' })) })
  return { root, artifacts, context, request, provider, artifact }
}
it('admits fixed file operations and rejects live arguments, scripts and nonlocal environments', async () => {
  const { provider, context, request } = await fixture()
  expect(provider.resolve({ ...request, parameters: { protocol: 'ble', maxPackets: 100 } }, context).parameters).toMatchObject({ maxPackets: 10 })
  expect(() => provider.resolve({ ...request, parameters: { protocol: 'wifi', interface: 'wlan0' } }, context)).toThrow()
  expect(() => provider.resolve({ ...request, operation: 'capture' }, context)).toThrow()
  expect(() => provider.resolve(request, { ...context, environment: { ...context.environment, kind: 'docker' } })).toThrow('local')
  expect(canObserve('reviewer', 'packet-capture', 'summary')).toBe(false)
  expect(canObserve('researcher', 'packet-capture', 'summary')).toBe(false)
  expect(canObserve('web-analyst', 'packet-capture', 'packets')).toBe(true)
})
it('retains decoder identity and bounds while removing the private run directory', async () => {
  const { provider, context, request, artifact, root } = await fixture()
  vi.mocked(runProcess).mockImplementation(async (_ctx, _env, _id, argv) => {
    await writeFile(argv[argv.indexOf('--output') + 1]!, JSON.stringify({ inputSha256: artifact.sha256,
      incomplete: true, toolVersion: 'TShark fixture', warnings: ['Input frame limit'], records: [{ kind: 'capture', matchedFrames: 1 }] }))
    expect(argv).not.toContain('-i')
    expect(argv[argv.indexOf('--max-packets') + 1]).toBe('10')
    return { stdout: '', stderr: '', exitCode: 0, signal: null, timedOut: false, cancelled: false, truncated: false }
  })
  expect(await provider.run(provider.resolve(request, context), context)).toMatchObject({ incomplete: true, method: 'static', toolVersion: 'TShark fixture' })
  expect(await readdir(join(root, 'runs'))).toEqual([])
})
it('cleans up cancellation and rejects output for a different input', async () => {
  const { provider, context, request, root } = await fixture()
  vi.mocked(runProcess).mockResolvedValue({ stdout: '', stderr: 'cancelled', exitCode: 1, signal: null, timedOut: false, cancelled: true, truncated: false })
  await expect(provider.run(request, context)).rejects.toThrow('cancelled')
  expect(await readdir(join(root, 'runs'))).toEqual([])
  vi.mocked(runProcess).mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, signal: null, timedOut: false, cancelled: false, truncated: true })
  await expect(provider.run(request, context)).rejects.toThrow('output exceeded')
  expect(await readdir(join(root, 'runs'))).toEqual([])
  vi.mocked(runProcess).mockImplementation(async (_ctx, _env, _id, argv) => {
    await writeFile(argv[argv.indexOf('--output') + 1]!, JSON.stringify({ inputSha256: 'wrong', incomplete: false, toolVersion: '1', warnings: [], records: [] }))
    return { stdout: '', stderr: '', exitCode: 0, signal: null, timedOut: false, cancelled: false, truncated: false }
  })
  await expect(provider.run(request, context)).rejects.toThrow('identity')
  expect(await readdir(join(root, 'runs'))).toEqual([])
})
