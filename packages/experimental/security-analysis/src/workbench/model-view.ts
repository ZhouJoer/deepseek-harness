/** Bounded project projections for logged model results. @module */
import assert from 'node:assert/strict'
import { z } from 'zod'
import { findingHash } from './assessment.ts'
import type { SecurityRecord, WorkbenchView } from './model.ts'

/** Page selector within the caller's already scoped records. */
export interface RecordQuery {
  kind?: string
  offset: number
}
interface RecordSummary {
  kind: SecurityRecord['kind']
  value: {
    id: string
    title?: string
    label?: string
    status?: string
    findingHash?: string
    assetId?: string
    provider?: string
    operation?: string
    sourcePath?: string
    startLine?: number
    limit?: number
    incomplete?: boolean
    hasDetails: true
  }
}
/** A bounded page retains the revision used by mutation commands. */
export interface RecordPage {
  revision: number
  records: RecordSummary[]
  total: number
  nextOffset: number | null
  hasMore: boolean
}
interface RecordDetailPage {
  revision: number
  kind: string
  recordId: string
  offset: number
  nextOffset: number
  hasMore: boolean
  text: string
}
/** Page records without copying raw source into every coordination request.
 * @param view - project-scoped durable records.
 * @param query - record kind and continuation position.
 * @param maxBytes - budget for the serialized page.
 * @returns identities and metadata, with an explicit continuation.
 */
export function modelPage(view: WorkbenchView, query: RecordQuery, maxBytes: number): RecordPage {
  const records = view.records.filter(item => query.kind === undefined || item.kind === query.kind)
  const result: RecordPage = { revision: view.revision, records: [], total: records.length, nextOffset: null, hasMore: false }
  for (let index = query.offset; index < records.length; index++) {
    const item = records[index]
    assert(item, 'Page index must address an existing record')
    const projected: RecordPage['records'][number] = { kind: item.kind, value: {
      id: recordId(item), hasDetails: true,
      ...('title' in item.value ? { title: item.value.title.slice(0, 120) } : {}),
      ...('label' in item.value ? { label: item.value.label.slice(0, 120) } : {}),
      ...('status' in item.value ? { status: item.value.status } : {}),
      ...(item.kind === 'finding' ? { findingHash: findingHash(item.value) } : {}),
      ...(item.kind === 'evidence' ? {
        assetId: item.value.assetId, provider: item.value.provider,
        operation: item.value.operation, incomplete: item.value.incomplete,
        ...(item.value.provider === 'source' && typeof item.value.request.path === 'string'
          ? { sourcePath: item.value.request.path } : {}),
        ...(item.value.provider === 'source' && typeof item.value.request.startLine === 'number'
          ? { startLine: item.value.request.startLine } : {}),
        ...(item.value.provider === 'source' && typeof item.value.request.limit === 'number'
          ? { limit: item.value.request.limit } : {}),
      } : {}),
    } }
    result.records.push(projected)
    result.hasMore = index + 1 < records.length
    result.nextOffset = result.hasMore ? index + 1 : null
    if (Buffer.byteLength(JSON.stringify(result)) > maxBytes) {
      result.records.pop()
      if (!result.records.length) throw new Error('One project record exceeds the output budget')
      result.hasMore = true
      result.nextOffset = index
      break
    }
  }
  return result
}

/** Read one exact, revision-bound record in UTF-8 byte pages.
 * @param view - scoped records.
 * @param kind - tagged record kind.
 * @param id - durable record identity.
 * @param offset - UTF-8 byte offset supplied by a previous page.
 * @param expectedRevision - revision returned by the first page.
 * @param maxBytes - complete serialized response budget.
 * @returns a continuation page or throws for stale or invalid offsets.
 */
export function recordDetail(view: WorkbenchView, kind: string, id: string, offset: number,
  expectedRevision: number, maxBytes: number): RecordDetailPage {
  if (view.revision !== expectedRevision) throw new Error('Project revision changed during detail read')
  const record = view.records.find(item => item.kind === kind && recordId(item) === id)
  if (!record) throw new Error('Record is outside the session scope')
  const bytes = Buffer.from(JSON.stringify(record))
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > bytes.length) throw new Error('Invalid detail offset')
  const decoder = new TextDecoder('utf-8', { fatal: true })
  const page = (end: number) => {
    const text = decoder.decode(bytes.subarray(offset, end))
    return { revision: view.revision, kind, recordId: id, offset, nextOffset: end,
      hasMore: end < bytes.length, text }
  }
  let end = Math.min(bytes.length, offset + maxBytes)
  while (end > offset) {
    try {
      const result = page(end)
      if (Buffer.byteLength(JSON.stringify(result)) <= maxBytes) return result
    } catch (error) {
      if (!(error instanceof TypeError)) throw error
    }
    end--
  }
  if (offset === bytes.length) return page(offset)
  throw new Error('One detail character exceeds the output budget')
}

/** Original source lines selected from one stored implementation observation. */
export interface SourceEvidencePage {
  evidenceId: string
  path: string
  startLine: number
  nextLine: number
  hasMore: boolean
  incomplete: boolean
  lines: { line: number; text: string }[]
}
/** Select source lines without making a reviewer page through unrelated JSON bytes.
 * @param bytes - saved source observation artifact.
 * @param evidenceId - scoped observation identity.
 * @param path - source member named by the saved request.
 * @param incomplete - whether the original observation was cut short.
 * @param startLine - first source line requested.
 * @param lineCount - maximum source lines requested.
 * @param maxBytes - complete JSON response budget.
 * @returns bounded original lines and continuation position.
 */
export function sourceEvidenceLines(bytes: Buffer, evidenceId: string, path: string, incomplete: boolean,
  startLine: number, lineCount: number, maxBytes: number): SourceEvidencePage {
  if (!Number.isSafeInteger(startLine) || startLine < 1 || !Number.isSafeInteger(lineCount) || lineCount < 1 ||
    !Number.isSafeInteger(startLine + lineCount)) throw new Error('Select a valid positive source line range')
  const source = z.looseObject({ operation: z.literal('read'), items: z.array(z.looseObject({
    path: z.string(), line: z.number().int().positive(), text: z.string(),
  })) }).parse(JSON.parse(bytes.toString('utf8')))
  if (source.items.some(item => item.path !== path)) throw new Error('Source observation path changed')
  const page: SourceEvidencePage = { evidenceId, path, startLine, nextLine: startLine,
    hasMore: false, incomplete, lines: [] }
  for (const item of source.items) {
    if (item.line < startLine || item.line >= startLine + lineCount) continue
    page.lines.push({ line: item.line, text: item.text })
    page.nextLine = item.line + 1
    page.hasMore = source.items.some(other => other.line >= page.nextLine)
    if (Buffer.byteLength(JSON.stringify(page)) > maxBytes) {
      page.lines.pop()
      if (!page.lines.length) throw new Error('One source line exceeds the output budget')
      page.nextLine = item.line
      page.hasMore = true
      break
    }
  }
  if (!page.lines.length) page.hasMore = source.items.some(item => item.line >= startLine)
  return page
}
/** Bounded mutation acknowledgement; remaining records are available through scope pages. */
export interface CommandReceipt {
  revision: number
  committed: boolean
  changed: { kind: SecurityRecord['kind']; id: string }[]
  totalChanged: number
  hasMore: boolean
}
/** Return changed record identities after a committed mutation.
 * @param before - caller-scoped state before the command.
 * @param after - committed state.
 * @param maxBytes - serialized receipt budget, excluding tool framing.
 * @returns a compact acknowledgement; full records remain available through scope pages.
 */
export function commandReceipt(before: WorkbenchView, after: WorkbenchView, maxBytes: number): CommandReceipt {
  const previous = new Map(before.records.map(item => [item.kind + ':' + recordId(item), JSON.stringify(item)]))
  const changed = after.records.filter(item => previous.get(item.kind + ':' + recordId(item)) !== JSON.stringify(item))
    .map(item => ({ kind: item.kind, id: recordId(item) }))
  const receipt = { revision: after.revision, committed: true, changed, totalChanged: changed.length, hasMore: false }
  while (Buffer.byteLength(JSON.stringify(receipt)) > maxBytes && receipt.changed.length) {
    receipt.changed.pop()
    receipt.hasMore = true
  }
  return receipt
}

function recordId(item: SecurityRecord): string {
  return item.kind === 'binding' ? item.value.sessionId : item.value.id
}
