/** Model pages preserve durable identities without repeating source bodies. @module */
import { expect, it } from 'vitest'
import { modelPage, commandReceipt } from '../src/workbench/model-view.ts'
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
    ids.push(...page.records.map(item => item.kind === 'binding' ? item.value.sessionId : item.value.id))
    if (!page.hasMore) break
    expect(page.nextOffset).toBeGreaterThan(offset)
    offset = page.nextOffset!
  } while (true)
  expect(ids).toEqual(view.records.map(item => item.kind === 'binding' ? item.value.sessionId : item.value.id))
  expect(modelPage(view, { kind: 'finding', offset: 0 }, 2048).records).toEqual([])
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
