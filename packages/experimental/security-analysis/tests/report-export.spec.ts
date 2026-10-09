/** ZIP exports retain complete immutable observations without importing a material backup. @module */
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fromBuffer, type Entry } from 'yauzl'
import { expect, it, onTestFinished, vi } from 'vitest'
import { ArtifactStore } from '../src/workbench/artifacts.ts'
import { recordSchema, reportSchema } from '../src/workbench/model.ts'
import { reportExportResponse } from '../src/workbench/report-export.ts'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evidence-export-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const store = new ArtifactStore(root, 4 * 1024 * 1024)
  const source = await store.put(Buffer.from('private imported source'), 'text/plain')
  const binary = Buffer.alloc(1024 * 1024 + 7, 0xff)
  const observation = await store.put(binary, 'application/octet-stream')
  const records = [
    recordSchema.parse({ kind: 'engagement', value: { id: 'project', title: 'Owned material', objective: 'Read source', environmentIds: [], maxAttempts: 3, stopped: false } }),
    recordSchema.parse({ kind: 'asset', value: { id: 'asset', engagementId: 'project', label: 'Source', format: 'other', identity: 'measured', artifact: source } }),
    ...['first', 'same-bytes'].map(id => recordSchema.parse({ kind: 'evidence', value: { id, engagementId: 'project', assetId: 'asset', title: 'Raw observation',
      summary: 'Partial output', artifact: observation, provider: 'native', operation: 'python', toolVersion: 'fixture', request: {},
      source: { sessionId: 'collector', callId: id }, incomplete: true, failure: 'Interrupted', createdAt: 1 } })),
  ]
  const report = reportSchema.parse({ id: 'report', engagementId: 'project', revision: 4, createdAt: 1,
    markdown: await store.put(Buffer.from('# Report'), 'text/markdown'),
    json: await store.put(Buffer.from(JSON.stringify({ revision: 4, records })), 'application/json') })
  return { root, store, report, observation, source, binary, records }
}
function unzip(bytes: Buffer): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) =>{  fromBuffer(bytes, { lazyEntries: true }, (error, zip) => {
    if (error || !zip) { reject(error ?? new Error('ZIP reader did not open the archive')); return }
    const result = new Map<string, Buffer>()
    zip.on('error', reject)
    zip.on('end', () => { resolve(result) })
    zip.on('entry', (entry: Entry) => { zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) { zip.close(); reject(error ?? new Error('ZIP member is unavailable')); return }
      const chunks: Buffer[] = []
      stream.on('data', (chunk: Buffer) => { chunks.push(chunk) })
      stream.on('error', (error) => { zip.close(); reject(error) })
      stream.on('end', () => { result.set(entry.fileName, Buffer.concat(chunks)); zip.readEntry() })
    }) })
    zip.readEntry()
  }) })
}
it('exports long binary observations once and verifies every payload with an independent ZIP reader', async () => {
  const { store, report, observation, source, binary } = await fixture()
  const released = vi.fn()
  const response = await reportExportResponse(store, report, 4 * 1024 * 1024, new Request('http://localhost/export'), released)
  const files = await unzip(Buffer.from(await response.arrayBuffer()))
  expect(released).toHaveBeenCalledOnce()
  expect(files.get(`artifacts/${observation.sha256}`)).toEqual(binary)
  expect(files.has(`artifacts/${source.sha256}`)).toBe(false)
  const manifest = JSON.parse(files.get('manifest.json')!.toString()) as { revision: number; excluded: { id: string }[]; references: { path: string }[] }
  expect(manifest.revision).toBe(4)
  expect(manifest.excluded).toMatchObject([{ id: 'asset' }])
  expect(manifest.references.filter(item => item.path === `artifacts/${observation.sha256}`)).toHaveLength(2)
  for (const line of files.get('SHA256SUMS')!.toString().trim().split('\n')) {
    const [hash, path] = line.split('  ')
    expect(createHash('sha256').update(files.get(path!)!).digest('hex')).toBe(hash)
  }
})
it('rejects size overflow and mismatched snapshots before starting an archive', async () => {
  const { store, report } = await fixture()
  await expect(reportExportResponse(store, report, 1, new Request('http://localhost/export'), () => {})).rejects.toThrow('exportMaxBytes')
  await expect(reportExportResponse(store, { ...report, engagementId: 'another-project' }, 4e6,
    new Request('http://localhost/export'), () => {})).rejects.toThrow('snapshot')
  await expect(reportExportResponse(store, { ...report, revision: 5 }, 4e6,
    new Request('http://localhost/export'), () => {})).rejects.toThrow('snapshot')
})
it('includes only scripts referenced by observations and enforces the complete uncompressed size', async () => {
  const { store, report, records } = await fixture()
  const script = await store.put(Buffer.from('print("owned fixture")'), 'text/x-python')
  records.push(recordSchema.parse({ kind: 'plan', value: { id: 'plan', engagementId: 'project', checkId: 'check',
    hypothesis: 'Inspect fixture', expectedObservation: 'Fixture output', impact: 'Local observation', cleanup: 'No files',
    operation: { provider: 'native', operation: 'python', assetId: 'asset', environmentId: 'local', impact: 'observe', parameters: {}, script },
    durationMs: 100, hash: 'a'.repeat(64), environmentHash: 'b'.repeat(64), status: 'revoked' } }))
  records.find(item => item.kind === 'evidence')!.value.planId = 'plan'
  report.json = await store.put(Buffer.from(JSON.stringify({ revision: 4, records })), 'application/json')
  const response = await reportExportResponse(store, report, 4e6, new Request('http://localhost/export'), () => {})
  const files = await unzip(Buffer.from(await response.arrayBuffer()))
  expect(files.get(`artifacts/${script.sha256}`)?.toString()).toBe('print("owned fixture")')
  const length = [...files.values()].reduce((total, bytes) => total + bytes.length, 0)
  await expect(reportExportResponse(store, report, length - 1, new Request('http://localhost/export'), () => {})).rejects.toThrow('exportMaxBytes')
  const head = await reportExportResponse(store, report, length, new Request('http://localhost/export', { method: 'HEAD' }), () => {})
  expect(head.ok).toBe(true)
})
it('rejects missing plan references and aborts an unconsumed download', async () => {
  const { store, report, records } = await fixture()
  const abort = new AbortController(), released = vi.fn()
  const response = await reportExportResponse(store, report, 4e6, new Request('http://localhost/export', { signal: abort.signal }), released)
  abort.abort(new Error('Browser disconnected'))
  await expect(response.arrayBuffer()).rejects.toThrow('Browser disconnected')
  expect(released).toHaveBeenCalledOnce()
  records.find(item => item.kind === 'evidence')!.value.planId = 'missing'
  report.json = await store.put(Buffer.from(JSON.stringify({ revision: 4, records })), 'application/json')
  await expect(reportExportResponse(store, report, 4e6, new Request('http://localhost/export'), () => {})).rejects.toThrow('missing or incompatible plan')
})
it('fails the download when raw evidence is damaged instead of closing a partial ZIP', async () => {
  const { root, store, report, observation } = await fixture()
  await writeFile(join(root, 'artifacts', observation.sha256), 'damaged')
  const released = vi.fn()
  const response = await reportExportResponse(store, report, 4e6, new Request('http://localhost/export'), released)
  await expect(response.arrayBuffer()).rejects.toThrow('identity mismatch')
  expect(released).toHaveBeenCalledOnce()
})
it('releases HEAD preflights and cancelled slow consumers', async () => {
  const { store, report } = await fixture()
  const released = vi.fn()
  const head = await reportExportResponse(store, report, 4e6, new Request('http://localhost/export', { method: 'HEAD' }), released)
  expect(head.body).toBeNull()
  expect(released).toHaveBeenCalledOnce()
  const response = await reportExportResponse(store, report, 4e6, new Request('http://localhost/export'), released)
  await response.body!.cancel()
  expect(released).toHaveBeenCalledTimes(2)
})
