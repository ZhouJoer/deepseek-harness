/** Portable report snapshots and verified observation bytes streamed as a ZIP. @module */
import { createHash } from 'node:crypto'
import { Zip, ZipPassThrough } from 'fflate'
import { z } from 'zod'
import { recordSchema, type Artifact, type SecurityRecord } from './model.ts'
import type { ArtifactStore } from './artifacts.ts'

type Report = Extract<SecurityRecord, { kind: 'report' }>['value']
interface Entry { path: string; artifact: Artifact; bytes?: Uint8Array }
const snapshotSchema = z.object({ revision: z.number().int().nonnegative(), records: z.array(recordSchema) }).strict()
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

/** Prepare an immutable report download; unavailable bytes fail the stream.
 * @param store - verified immutable artifact reader.
 * @param report - report selected from the authenticated project.
 * @param maxBytes - total uncompressed bytes including manifest and checksums.
 * @param request - HTTP method and cancellation owned by the download.
 * @param released - releases the owner's read registration after all reads stop.
 * @returns HEAD metadata or a ZIP response with consumer-driven backpressure.
 */
export async function reportExportResponse(store: ArtifactStore, report: Report, maxBytes: number,
  request: Request, released: () => void): Promise<Response> {
  request.signal.throwIfAborted()
  if (report.json.size > maxBytes) throw new Error('Evidence archive exceeds exportMaxBytes')
  const bytes = await store.read(report.json)
  request.signal.throwIfAborted()
  const snapshot = snapshotSchema.parse(JSON.parse(bytes.toString('utf8')))
  if (snapshot.revision !== report.revision || !snapshot.records.some(item => item.kind === 'engagement' && item.value.id === report.engagementId)
    || snapshot.records.some(item => (item.kind === 'engagement' ? item.value.id : item.value.engagementId) !== report.engagementId))
    throw new Error('Report snapshot does not match the selected project revision')
  const entries = new Map<string, Entry>()
  const references: { kind: string; id: string; path: string }[] = []
  const add = (artifact: Artifact, path: string, kind: string, id: string, content?: Uint8Array) => {
    const previous = entries.get(artifact.sha256)
    if (previous && previous.artifact.size !== artifact.size) throw new Error('Conflicting artifact lengths in report snapshot')
    if (!previous) entries.set(artifact.sha256, { artifact, path, ...(content ? { bytes: content } : {}) })
    references.push({ kind, id, path: previous?.path ?? path })
  }
  add(report.json, 'snapshot.json', 'report-snapshot', report.id, bytes)
  add(report.markdown, 'report.md', 'report', report.id)
  if (report.findingsMarkdown) add(report.findingsMarkdown, 'findings.md', 'findings-appendix', report.id)
  for (const record of snapshot.records) {
    if (record.kind !== 'evidence') continue
    add(record.value.artifact, `artifacts/${record.value.artifact.sha256}`, 'evidence', record.value.id)
    if (record.value.planId) {
      const plan = snapshot.records.find(item => item.kind === 'plan' && item.value.id === record.value.planId)
      if (plan?.kind !== 'plan' || plan.value.operation.assetId !== record.value.assetId)
        throw new Error('Observation references a missing or incompatible plan')
      if (plan.value.operation.script) add(plan.value.operation.script, `artifacts/${plan.value.operation.script.sha256}`, 'plan-script', plan.value.id)
    }
  }
  const manifest = Buffer.from(JSON.stringify({ formatVersion: 1, projectId: report.engagementId, reportId: report.id,
    revision: report.revision,
    files: [...entries.values()].map(entry => ({ path: entry.path, ...entry.artifact })), references,
    excluded: snapshot.records.flatMap(item => (item.kind === 'asset' || item.kind === 'legacy') && 'artifact' in item.value && !entries.has(item.value.artifact.sha256)
      ? [{ kind: item.kind, id: item.value.id, artifact: item.value.artifact, reason: 'input-material-not-included' }] : []),
  }, null, 2) + '\n')
  const checksums = Buffer.from([...entries.values()].map(entry => `${entry.artifact.sha256}  ${entry.path}`)
    .concat(`${digest(manifest)}  manifest.json`).join('\n') + '\n')
  const total = [...entries.values()].reduce((sum, entry) => sum + entry.artifact.size, manifest.length + checksums.length)
  if (!Number.isSafeInteger(total) || total > maxBytes) throw new Error('Evidence archive exceeds exportMaxBytes')
  const headers = { 'content-type': 'application/zip', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff',
    'content-disposition': `attachment; filename="dsh-security-${report.id.replace(/[^a-zA-Z0-9_-]/gu, '-')}.zip"` }
  if (request.method === 'HEAD') { released(); return new Response(null, { headers }) }
  const abort = new AbortController()
  const signal = AbortSignal.any([request.signal, abort.signal])
  let wake: (() => void) | undefined
  let producer: Promise<void> | undefined
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const zip = new Zip((error, chunk, final) => {
        if (error) { abort.abort(error); controller.error(error); return }
        if (chunk.length) controller.enqueue(chunk)
        if (final) controller.close()
      })
      const capacity = async () => {
        while ((controller.desiredSize ?? 0) <= 0) {
          signal.throwIfAborted()
          const ready = Promise.withResolvers<void>()
          wake = ready.resolve
          const interrupted = () =>{  ready.reject(signal.reason) }
          signal.addEventListener('abort', interrupted, { once: true })
          try { signal.throwIfAborted(); await ready.promise }
          finally { signal.removeEventListener('abort', interrupted); wake = undefined }
        }
        signal.throwIfAborted()
      }
      const push = async (path: string, content: Uint8Array) => {
        const entry = new ZipPassThrough(path)
        zip.add(entry)
        let offset = 0
        do {
          await capacity()
          const end = Math.min(offset + 65536, content.length)
          entry.push(content.subarray(offset, end), end === content.length)
          offset = end
        } while (offset < content.length)
      }
      producer = (async () => {
        try {
          for (const entry of entries.values()) {
            signal.throwIfAborted()
            await push(entry.path, entry.bytes ?? await store.read(entry.artifact))
          }
          await push('manifest.json', manifest)
          await push('SHA256SUMS', checksums)
          signal.throwIfAborted()
          zip.end()
        } catch (error) { zip.terminate(); controller.error(error) }
        finally { released() }
      })()
    },
    pull() { wake?.() },
    async cancel(reason) { abort.abort(reason ?? new Error('Evidence download cancelled')); await producer },
  }, { highWaterMark: 65536, size: chunk => chunk.byteLength })
  return new Response(body, { headers })
}
