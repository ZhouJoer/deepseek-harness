/** Project-scoped HTTP history and bounded reads over existing immutable artifacts. @module */
import { z } from 'zod'
import { brandString } from '@deepseek-ai/dsh-brand'
import { httpEvidenceSchema, type HttpHistoryPage, type HttpExchangePage } from './http-model.ts'
import type { WorkbenchView, AssetId } from './workbench/model.ts'
import type { ArtifactStore } from './workbench/artifacts.ts'

/** Validated history filters; pagination uses a fixed evidence timestamp cutoff. */
export const httpHistoryQuerySchema = z.object({ assetId: z.string().optional(),
  evidenceId: z.string().optional(), method: z.string().optional(),

  query: z.string().optional(), status: z.number().int().optional(), offset: z.number().int().nonnegative().default(0),
  through: z.number().nonnegative().optional() }).strict()
/** Read metadata without opening response bodies.
 * @param view - caller-scoped project records.
 * @param query - validated selection and offset.
 * @param limit - maximum rows.
 * @returns history rows linked to their existing evidence. */
export function httpHistory(view: WorkbenchView, query: z.infer<typeof httpHistoryQuerySchema>, limit: number): HttpHistoryPage {
  const through = query.through ?? Date.now()
  const items = view.records.flatMap(record => record.kind !== 'evidence' || !record.value.http ? [] :
    record.value.http.exchanges.map(item => ({ ...item, evidenceId: record.value.id,
      assetId: brandString<AssetId>(record.value.assetId), createdAt: record.value.createdAt })))
    .filter(item => (!query.evidenceId || item.evidenceId === query.evidenceId) &&
      (!query.assetId || item.assetId === query.assetId) && (!query.method ||
      item.method === query.method) &&
      (!query.query || (item.path + ' ' + item.label).toLowerCase().includes(query.query.toLowerCase())) &&
      (query.status === undefined || item.status === query.status) && item.createdAt <= through)
    .sort((a, b) => b.createdAt - a.createdAt || a.evidenceId.localeCompare(b.evidenceId))
  const end = Math.min(items.length, query.offset + limit)
  return { items: items.slice(query.offset, end), next: end < items.length ? end : null, through }
}
/** Read a complete validated artifact, then return one UTF-8-safe field window.
 * @param view - caller-scoped project records.
 * @param artifacts - digest-verifying artifact owner.
 * @param evidenceId - saved HTTP evidence.
 * @param stepId - stable step within the evidence.
 * @param part - request template, redacted response headers or redacted body.
 * @param offset - byte position from a previous page.
 * @param limit - complete serialized result budget.
 * @returns a bounded page and its continuation. */
export async function httpExchange(view: WorkbenchView, artifacts: ArtifactStore, evidenceId: string, stepId: string,
  part: 'request' | 'headers' | 'body', offset: number, limit: number): Promise<HttpExchangePage> {
  const record = view.records.find(item => item.kind === 'evidence' && item.value.id === evidenceId)
  if (record?.kind !== 'evidence' || !record.value.http) throw new Error('HTTP evidence is outside the selected scope')
  const artifact = httpEvidenceSchema.parse(JSON.parse((await artifacts.read(record.value.artifact)).toString('utf8')))
  const summaries = artifact.exchanges.map(({ request: _request,
    headers: _headers, body: _body, bodyOmitted: _omitted, ...summary }) =>
    summary)
  if (JSON.stringify(summaries) !== JSON.stringify(record.value.http.exchanges)) throw new Error('HTTP evidence summary does not match its saved artifact')
  const exchange = artifact.exchanges.find(item => item.stepId === stepId)
  if (!exchange) throw new Error('HTTP step is unavailable')
  const bytes = Buffer.from(part === 'body' ? exchange.body : JSON.stringify(part === 'request' ? exchange.request : exchange.headers, null, 2))
  if (!Number.isInteger(offset) || offset < 0 || offset > bytes.length) throw new Error('HTTP field offset is outside the saved content')
  let end = Math.min(bytes.length, offset + limit)
  const decoder = new TextDecoder('utf-8', { fatal: true })
  while (end >= offset) {
    let text: string
    try { text = decoder.decode(bytes.subarray(offset, end)) } catch (_error) { end--; continue }
    const page: HttpExchangePage = { stepId: exchange.stepId, part, text, offset, totalBytes: bytes.length,
      next: end < bytes.length ? end : null, incomplete: exchange.incomplete, bodyOmitted: exchange.bodyOmitted }
    if (Buffer.byteLength(JSON.stringify(page)) <= limit && (end > offset || end === bytes.length)) return page
    end--
  }
  throw new Error('HTTP field metadata exceeds the output limit')
}
