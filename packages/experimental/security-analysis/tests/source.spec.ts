/** Immutable directory admission, member integrity, and bounded source queries. @module */
import { mkdtemp, mkdir, rm, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, onTestFinished } from 'vitest'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { ArtifactStore } from '../src/workbench/artifacts.ts'
import { importSource, SourceProvider, sourceManifestSchema } from '../src/workbench/source.ts'
import { sourceAssetSchema } from '../src/workbench/model.ts'
import type { AnalysisContext } from '../src/workbench/providers.ts'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-source-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const source = join(root, 'source')
  await mkdir(source)
  await writeFile(join(source, 'main.py'), 'name = "测试"\nprint(name)\n')
  await writeFile(join(source, 'binary.dat'), Buffer.from([0, 255]))
  const store = new ArtifactStore(join(root, 'store'), 65536)
  const artifact = await importSource(store, source, [root], { entries: 10, bytes: 65536 })
  const context: AnalysisContext = {
    asset: sourceAssetSchema.parse({ kind: 'source', id: 'source', engagementId: 'project', label: 'Source', artifact, identity: 'measured' }),
    environment: { id: 'local', kind: 'local', label: 'Fixture', cwd: root, tools: [] },
    artifacts: store, signal: new AbortController().signal, durationMs: 1000, maxOutputBytes: 4096,
  }
  const provider = new SourceProvider()
  const run = (operation: string, parameters: Record<string, JsonValue>) => provider.run(provider.resolve({
    provider: 'source', operation, assetId: context.asset.id, environmentId: 'local', impact: 'observe', parameters,
  }, context), context)
  return { root, source, store, artifact, context, provider, run }
}
describe('immutable source', () => {
  it('retains measured lines when the live source changes and exposes continuation', async () => {
    const { source, run } = await fixture()
    await writeFile(join(source, 'main.py'), 'changed')
    const result = await run('read', { path: 'main.py', startLine: 1, limit: 1 })
    expect(JSON.parse(Buffer.from(result.bytes).toString())).toMatchObject({
      items: [{ path: 'main.py', sha256: expect.stringMatching(/^[a-f0-9]{64}$/) as unknown, line: 1, text: 'name = "测试"' }],
      nextLine: 2, hasMore: true,
    })
    expect(result).toMatchObject({ incomplete: true, method: 'static' })
  })
  it('searches literal text with original file hashes and line numbers', async () => {
    const { run } = await fixture()
    const result = await run('search', { query: 'print(' })
    expect((JSON.parse(Buffer.from(result.bytes).toString()) as { items: unknown }).items).toEqual([
      { path: 'main.py', sha256: expect.any(String) as unknown, line: 2, text: 'print(name)' },
    ])
    expect(result.incomplete).toBe(false)
  })
  it('rejects unapproved roots and entry or byte overflow', async () => {
    const { store, source, root } = await fixture()
    await expect(importSource(store, source, [join(root, 'store')], { entries: 10, bytes: 65536 })).rejects.toThrow(/outside/)
    await expect(importSource(store, source, [root], { entries: 1, bytes: 65536 })).rejects.toThrow(/entry limit/)
    await expect(importSource(store, source, [root], { entries: 10, bytes: 1 })).rejects.toThrow(/byte limit/)
  })
  it('rejects traversal, absent paths, and binary reads', async () => {
    const { run } = await fixture()
    expect(() => run('read', { path: '../main.py' })).toThrow(/relative source/)
    await expect(run('read', { path: 'absent' })).rejects.toThrow(/absent/)
    await expect(run('read', { path: 'binary.dat' })).rejects.toThrow(/UTF-8/)
  })
  it('verifies stored member hashes before returning source', async () => {
    const { store, artifact, root, run } = await fixture()
    const manifest = sourceManifestSchema.parse(JSON.parse((await store.read(artifact)).toString()))
    const member = manifest.files.find(file => file.path === 'main.py')!
    await writeFile(join(root, 'store', 'artifacts', member.artifact.sha256), 'tampered')
    await expect(run('read', { path: 'main.py' })).rejects.toThrow(/mismatch/)
  })
  it('records linked directories as exclusions without traversing them', async () => {
    const { store, source, root } = await fixture()
    const outside = join(root, 'outside')
    await mkdir(outside)
    await writeFile(join(outside, 'private'), 'not admitted')
    await symlink(outside, join(source, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
    const artifact = await importSource(store, source, [root], { entries: 10, bytes: 65536 })
    const manifest = sourceManifestSchema.parse(JSON.parse((await store.read(artifact)).toString()))
    expect(manifest.excluded).toEqual([{ path: 'linked', reason: expect.any(String) as unknown }])
    expect(manifest.files.some(file => file.path.includes('private'))).toBe(false)
  })
  it('rejects duplicate and escaping manifest members', async () => {
    const { store, artifact } = await fixture()
    const manifest = sourceManifestSchema.parse(JSON.parse((await store.read(artifact)).toString()))
    expect(() => sourceManifestSchema.parse({ ...manifest, files: [...manifest.files, manifest.files[0]] })).toThrow(/Duplicate/)
    expect(() => sourceManifestSchema.parse({ ...manifest, files: [{ ...manifest.files[0], path: '/etc/passwd' }] })).toThrow()
  })
})
