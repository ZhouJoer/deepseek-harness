/** Bounded project projections for logged model results. @module */
import assert from 'node:assert/strict'
import type { SecurityRecord, WorkbenchView } from './model.ts'

/** Page selector within the caller's already scoped records. */
export interface RecordQuery {
  kind?: string
  offset: number
}
/** A bounded page retains the revision used by mutation commands. */
export interface RecordPage extends WorkbenchView {
  total: number
  nextOffset: number | null
  hasMore: boolean
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
    const projected: SecurityRecord = item.kind === 'evidence'
      ? { ...item, value: { ...item.value, summary: 'Read original observations with security_evidence.' } } : item
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
