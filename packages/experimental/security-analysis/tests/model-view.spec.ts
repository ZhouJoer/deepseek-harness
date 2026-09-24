/** Model pages preserve durable identities without repeating source bodies. @module */
import { expect, it } from 'vitest'
import { modelPage, recordDetail, commandReceipt, sourceEvidenceLines } from '../src/workbench/model-view.ts'
import { evidenceSchema, type WorkbenchView } from '../src/workbench/model.ts'
function fixture(): WorkbenchView {
  return { revision: 7, records: Array.from({ length: 20 }, (_, index) => ({ kind: 'evidence' as const,
    value: evidenceSchema.parse({ id: 'e' + String(index), engagementId: 'project', assetId: 'source', title: 'read',
      summary: 'x'.repeat(10000), artifact: { sha256: 'a'.repeat(64), size: 10000, mediaType: 'text/plain' },
      provider: 'source', operation: 'read', toolVersion: 'fixture', request: {}, source: { sessionId: 'owner', callId: 'c' + String(index) },
      incomplete: false, createdAt: 1 }) })) }
}
it('paginates large evidence projects within the byte budget without losing identities', () => {
  const view = fixture()
  const ids: string[] = []
  let offset = 0
  do {
    const page = modelPage(view, { offset }, 2048)
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(2048)
    expect(page.revision).toBe(7)
    ids.push(...page.records.map(item => item.value.id))
    if (!page.hasMore) break
    expect(page.nextOffset).toBeGreaterThan(offset)
    offset = page.nextOffset!
  } while (true)
  expect(ids).toEqual(view.records.map(item => item.kind === 'binding' ? item.value.sessionId : item.value.id))
  expect(modelPage(view, { kind: 'finding', offset: 0 }, 2048).records).toEqual([])
})
it('lists source evidence by file and read range without loading record details', () => {
  const view = fixture()
  const evidence = view.records[0]
  if (evidence?.kind !== 'evidence') throw new Error('Missing evidence')
  evidence.value.request = { path: 'apps/wifi_setup/transport.py', startLine: 101, limit: 50 }
  evidence.value.incomplete = true
  const page = modelPage(view, { kind: 'evidence', offset: 0 }, 2048)
  expect(page.records[0]?.value).toMatchObject({
    id: evidence.value.id, assetId: 'source', provider: 'source', operation: 'read',
    sourcePath: 'apps/wifi_setup/transport.py', startLine: 101, limit: 50, incomplete: true,
  })
  expect(JSON.stringify(page)).not.toContain(evidence.value.summary)
})
it('acknowledges committed mutations without including unrelated evidence', () => {
  const before = fixture()
  const after = { revision: 8, records: before.records.slice(0, 19) }
  after.records.push({ ...before.records[19]!, value: { ...before.records[19]!.value, id: 'new' } } as typeof before.records[number])
  expect(commandReceipt(before, after, 2048)).toEqual({ revision: 8, committed: true, changed: [{ kind: 'evidence', id: 'new' }], totalChanged: 1, hasMore: false })
  expect(commandReceipt(after, after, 2048).changed).toEqual([])
})

it('bounds successful mutation receipts when many records change', () => {
  const result = commandReceipt({ revision: 0, records: [] }, fixture(), 256)
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(256)
  expect(result).toMatchObject({ committed: true, revision: 7, totalChanged: 20, hasMore: true })
  expect(result.changed.length).toBeGreaterThan(0)
})

it('reads a long record in exact revision-bound UTF-8 pages', () => {
  const view = fixture()
  const record = view.records[0]!
  if (record.kind !== 'evidence') throw new Error('Missing evidence')
  record.value.summary = '中文😀"\\'.repeat(2000)
  let offset = 0
  let text = ''
  do {
    const page = recordDetail(view, 'evidence', record.value.id, offset, 7, 512)
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(512)
    text += page.text
    if (!page.hasMore) break
    expect(page.nextOffset).toBeGreaterThan(offset)
    offset = page.nextOffset
  } while (true)
  expect(JSON.parse(text)).toEqual(record)
  expect(() => recordDetail({ ...view, revision: 8 }, 'evidence', record.value.id, offset, 7, 512)).toThrow(/revision/)
  expect(() => recordDetail(view, 'evidence', 'other', 0, 7, 512)).toThrow(/scope/)
})

it('selects original source lines under the complete JSON response budget', () => {
  const items = Array.from({ length: 100 }, (_, index) => ({
    path: 'wifi_setup.html', line: index + 1, text: '中文😀"\\ line ' + String(index + 1),
  }))
  const bytes = Buffer.from(JSON.stringify({ operation: 'read', items }))
  const collected: number[] = []
  let startLine = 40
  do {
    const page = sourceEvidenceLines(bytes, 'e1', 'wifi_setup.html', false, startLine, 51 - startLine, 300)
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(300)
    expect(page.lines.length).toBeGreaterThan(0)
    collected.push(...page.lines.map(item => item.line))
    if (!page.hasMore || page.nextLine >= 51) break
    expect(page.nextLine).toBeGreaterThan(startLine)
    startLine = page.nextLine
  } while (true)
  expect(collected).toEqual(Array.from({ length: 11 }, (_, index) => index + 40))
  expect(() => sourceEvidenceLines(bytes, 'e1', 'other.html', false, 40, 1, 300)).toThrow(/path/)
  expect(() => sourceEvidenceLines(bytes, 'e1', 'wifi_setup.html', false, 40, 1, 100)).toThrow(/budget/)
})
