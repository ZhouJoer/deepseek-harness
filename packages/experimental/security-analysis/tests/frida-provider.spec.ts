/** Frida success responses retain measured versions and release protocol files. @module */
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { FridaProvider } from '../src/frida-provider.ts'
import { ArtifactStore } from '../src/workbench/artifacts.ts'
import { fileAssetSchema, operationSchema } from '../src/workbench/model.ts'
import { runProcess } from '../src/workbench/process.ts'
import type { AnalysisContext } from '../src/workbench/providers.ts'

vi.mock('../src/workbench/process.ts', async original => ({
  ...await original<typeof import('../src/workbench/process.ts')>(), runProcess: vi.fn(),
}))
const roots: string[] = []
afterEach(async () => {
  vi.resetAllMocks()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })))
})

it.each(['17.4.0', '', undefined])('requires the helper to report a nonempty Frida version: %s', async (version) => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-frida-protocol-'))
  roots.push(root)
  const artifacts = new ArtifactStore(root, 65536)
  const artifact = await artifacts.put(Buffer.from('fixture'), 'application/octet-stream')
  const context: AnalysisContext = { artifacts, signal: new AbortController().signal, durationMs: 1000, maxOutputBytes: 65536,
    asset: fileAssetSchema.parse({ id: 'sample', engagementId: 'project', label: 'Fixture', artifact, format: 'other', identity: 'measured' }),
    environment: { id: 'local', kind: 'local', cwd: root, label: 'Host', tools: [] } }
  const request = operationSchema.parse({ provider: 'frida', operation: 'processes', assetId: 'sample',
    environmentId: 'local', impact: 'observe', parameters: {} })
  vi.mocked(runProcess).mockResolvedValue({ stdout: JSON.stringify({ identity: [], messages: [], incomplete: false,
    cleanup: 'unloaded-detached', ...(version === undefined ? {} : { version }) }), stderr: '', exitCode: 0,
  signal: null, timedOut: false, cancelled: false, truncated: false })
  const provider = new FridaProvider(new Context(), 100)
  const pending = provider.run(provider.resolve(request, context), context)
  if (version) await expect(pending).resolves.toMatchObject({ toolVersion: version })
  else await expect(pending).rejects.toThrow()
  expect(await readdir(join(root, 'runs'))).toEqual([])
})
