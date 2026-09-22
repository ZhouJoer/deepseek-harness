/** Offline execution pins dependencies and settles owned-container cleanup. @module */
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, mkdir, rm, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, vi, onTestFinished } from 'vitest'
import { OfflineProvider } from '../src/offline-provider.ts'
import { ArtifactStore } from '../src/workbench/artifacts.ts'
import { importSource } from '../src/workbench/source.ts'
import { sourceAssetSchema, operationSchema } from '../src/workbench/model.ts'
import { runProcess } from '../src/workbench/process.ts'
import type { AnalysisContext } from '../src/workbench/providers.ts'

vi.mock('../src/workbench/process.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/workbench/process.ts')>(), runProcess: vi.fn(),
}))
const completed = { stdout: 'passed', stderr: '', exitCode: 0, signal: null, timedOut: false, cancelled: false, truncated: false }
const imageId = 'sha256:' + 'a'.repeat(64)
async function fixture() {
  vi.mocked(runProcess).mockReset()
  const root = await mkdtemp(join(tmpdir(), 'dsh-offline-'))
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) })
  const source = join(root, 'source')
  await mkdir(source)
  await writeFile(join(source, 'module.py'), 'VALUE = 1\n')
  const artifacts = new ArtifactStore(join(root, 'store'), 65536)
  const artifact = await importSource(artifacts, source, [root], { entries: 5, bytes: 4096 })
  const script = await artifacts.put(Buffer.from('print("passed")'), 'text/x-python')
  const context: AnalysisContext = { asset: sourceAssetSchema.parse({ kind: 'source', id: 'asset', engagementId: 'project', label: 'Fixture', artifact, identity: 'measured' }),
    environment: { id: 'local', kind: 'local', label: 'Local', cwd: root, tools: [] },
    artifacts, signal: new AbortController().signal, durationMs: 1000, maxOutputBytes: 4096 }
  const provider = new OfflineProvider(ctx, { image: 'owned:1', memoryMb: 512, cpus: 1, pids: 64, temporaryMb: 64, graceMs: 100 })
  const request = operationSchema.parse({ provider: 'offline', operation: 'python', assetId: 'asset', environmentId: 'local', impact: 'observe', parameters: {}, script })
  vi.mocked(runProcess).mockResolvedValueOnce({ ...completed, stdout: imageId })
  const resolved = await provider.prepare(request, context)
  return { root, provider, context, resolved }
}
describe('offline provider', () => {
  it('pins the installed image and confines approved scripts to immutable inputs', async () => {
    const { root, provider, context, resolved } = await fixture()
    vi.mocked(runProcess).mockResolvedValue(completed)
    const result = await provider.run(resolved, context)
    expect(resolved.parameters.imageId).toBe(imageId)
    const argv = vi.mocked(runProcess).mock.calls[1]![3]
    expect(argv).toEqual(expect.arrayContaining(['--network=none', '--read-only', '--cap-drop=ALL', '--user', '65534:65534', '--pull=never', imageId]))
    expect(argv).not.toContain('--privileged')
    expect(result).toMatchObject({ method: 'simulation', incomplete: false, cleanup: 'Owned offline container removed' })
    const cleanup = vi.mocked(runProcess).mock.calls[2]!
    expect(cleanup[3]).toEqual(['rm', '--force', argv[argv.indexOf('--name') + 1]])
    expect(await readdir(join(root, 'store', 'runs'))).toEqual([])
  })
  it('retains timed-out output and removes only its owned container with a fresh signal', async () => {
    const { provider, context, resolved } = await fixture()
    vi.mocked(runProcess).mockResolvedValueOnce({ ...completed, stdout: 'partial', timedOut: true, exitCode: null }).mockResolvedValueOnce(completed)
    const result = await provider.run(resolved, context)
    expect(result).toMatchObject({ incomplete: true, failure: expect.any(String) as unknown, cleanup: 'Owned offline container removed' })
    expect((JSON.parse(Buffer.from(result.bytes).toString()) as { stdout: string }).stdout).toBe('partial')
    expect(vi.mocked(runProcess).mock.calls[2]![4].signal).not.toBe(context.signal)
  })
  it('retains the analysis result when the cleanup subprocess cannot start', async () => {
    const { provider, context, resolved } = await fixture()
    vi.mocked(runProcess).mockResolvedValueOnce(completed).mockRejectedValueOnce(new Error('Docker unavailable'))
    const result = await provider.run(resolved, context)
    expect(result).toMatchObject({ incomplete: true, cleanup: expect.stringContaining('Docker unavailable') as unknown })
    expect((JSON.parse(Buffer.from(result.bytes).toString()) as { stdout: string }).stdout).toBe('passed')
  })
  it('marks output loss and nonzero exits incomplete', async () => {
    const { provider, context, resolved } = await fixture()
    vi.mocked(runProcess).mockResolvedValueOnce({ ...completed, truncated: true, exitCode: 1, stderr: 'assertion failed' }).mockResolvedValueOnce(completed)
    expect(await provider.run(resolved, context)).toMatchObject({ incomplete: true, failure: 'assertion failed' })
  })
  it('bounds escaped raw output while retaining ordinary JSON test results', async () => {
    const { provider, context, resolved } = await fixture()
    vi.mocked(runProcess).mockResolvedValueOnce({ ...completed, stdout: '\\'.repeat(4096) }).mockResolvedValueOnce(completed)
    const result = await provider.run(resolved, context)
    expect(result.bytes.byteLength).toBeLessThanOrEqual(context.maxOutputBytes)
    expect(result.incomplete).toBe(true)
    expect((JSON.parse(Buffer.from(result.bytes).toString()) as { truncated: boolean }).truncated).toBe(true)
  })

})
