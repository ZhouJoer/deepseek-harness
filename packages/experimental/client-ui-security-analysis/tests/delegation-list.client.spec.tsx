// @vitest-environment jsdom
/** Child reports remain distinct from coordinator decisions and finding verdicts. @module */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { SecurityDelegation, WorkbenchView } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import { recordSchema } from '@deepseek-ai/dsh-experimental-security-analysis/src/workbench/model.ts'
import { DelegationList } from '../src/client/DelegationList.tsx'
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)
function delegation(overrides: Partial<SecurityDelegation> = {}): SecurityDelegation {
  const record = recordSchema.parse({ kind: 'delegation', value: {
    id: 'task', engagementId: 'project', assetId: 'firmware', checkpointId: 'parser', parentSessionId: 'parent',
    callId: 'delegate-call', role: 'reverse-analyst', task: 'assessment', question: 'Does the parser validate the length?',
    criterion: 'Read the complete function and cite contrary evidence.', reason: 'The parser can be inspected independently.',
    createdAt: 1, status: 'running', child: { parentSessionId: 'parent', childSessionId: 'child', mode: 'one-shot' },
    ...overrides,
  } })
  if (record.kind !== 'delegation') throw new Error('Expected child task')
  return record.value
}
const empty: WorkbenchView = { revision: 1, records: [] }
const report = { summary: 'The complete parser checks the remaining length.', evidenceIds: ['source-evidence'],
  uncertainty: 'Runtime behavior remains untested.', nextSteps: ['Inspect the caller.'] }

it('shows a returned report awaiting a decision and opens its durable one-shot address', () => {
  const item = delegation({ status: 'completed', report })
  const openChild = vi.fn()
  render(<DelegationList items={[item]} view={empty} openChild={openChild} t={makeTranslate(en)} />)
  expect(screen.getByText('Report returned')).toBeTruthy()
  expect(screen.getByText('Awaiting coordinator decision')).toBeTruthy()
  expect(screen.queryByText('Confirmed')).toBeNull()
  expect(screen.getByText(report.summary)).toBeTruthy()
  const details = screen.getByText(item.criterion).closest('details')
  expect(details?.open).toBe(false)
  fireEvent.click(screen.getByText('Inspect assignment and evidence'))
  expect(details?.open).toBe(true)
  expect(screen.getByText(report.uncertainty)).toBeTruthy()
  expect(screen.getByText('source-evidence')).toBeTruthy()
  expect(screen.getByText('Inspect the caller.')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Open child conversation' }))
  expect(openChild).toHaveBeenCalledExactlyOnceWith(item.child)
})

it.each([
  ['accepted', 'Coordinator accepted report'], ['needs-more', 'Coordinator requested more work'], ['rejected', 'Coordinator rejected report'],
] as const)('keeps execution completion separate from a %s decision', (decision, label) => {
  const item = delegation({ status: 'completed', report })
  const props = { items: [item], view: empty, openChild: vi.fn(), t: makeTranslate(en) }
  const mounted = render(<DelegationList {...props} />)
  mounted.rerender(<DelegationList {...props} items={[delegation({ status: 'completed', report,
    disposition: { decision, reason: 'The caller still needs inspection.', sessionId: item.parentSessionId, createdAt: 3 } })]} />)
  expect(screen.getByText('Report returned')).toBeTruthy()
  expect(screen.getByText(label)).toBeTruthy()
  expect(screen.getByText('The caller still needs inspection.')).toBeTruthy()
  expect(screen.queryByText('Awaiting coordinator decision')).toBeNull()
  expect(screen.queryByRole('button', { name: /accept|approve/i })).toBeNull()
})

it.each([
  ['pending', 'Awaiting start'], ['running', 'Running'], ['failed', 'Failed'],
  ['cancelled', 'Cancelled'], ['interrupted', 'Interrupted'],
] as const)('shows %s without inventing a report or child conversation', (status, label) => {
  const item = delegation({ status, child: undefined, reason: undefined, detail: 'No report was returned.' })
  render(<DelegationList items={[item]} view={empty} openChild={vi.fn()} t={makeTranslate(en)} />)
  expect(screen.getByText(label)).toBeTruthy()
  expect(screen.getByText('No report was returned.')).toBeTruthy()
  expect(screen.getByText('Not recorded')).toBeTruthy()
  expect(screen.queryByRole('button')).toBeNull()
  expect(screen.queryByText('Awaiting coordinator decision')).toBeNull()
})

it('shows an empty record list without claiming that no agents worked', () => {
  render(<DelegationList items={[]} view={empty} openChild={vi.fn()} t={makeTranslate(zh)} />)
  expect(screen.getByText('本方向暂无已记录的子任务')).toBeTruthy()
})

it('shows scoped evidence context and preserves the limitation of a timed-out child', () => {
  const evidence = recordSchema.parse({ kind: 'evidence', value: {
    id: 'source-evidence', engagementId: 'project', assetId: 'firmware', title: 'Parser source', summary: 'The comparison precedes the copy.',
    artifact: { sha256: 'a'.repeat(64), size: 10, mediaType: 'text/plain' }, provider: 'source', operation: 'read',
    toolVersion: 'fixture', request: {}, source: { sessionId: 'child', callId: 'read' }, incomplete: false, createdAt: 1,
  } })
  const item = delegation({ status: 'cancelled', timedOut: true })
  const returned = delegation({ status: 'completed', report })
  const props = { view: { revision: 2, records: [evidence] }, openChild: vi.fn(), t: makeTranslate(en) }
  const mounted = render(<DelegationList {...props} items={[item]} />)
  expect(screen.getByText('Child task reached its time limit')).toBeTruthy()
  mounted.rerender(<DelegationList {...props} items={[returned]} />)
  fireEvent.click(screen.getByText('Inspect assignment and evidence'))
  expect(screen.getByText(/Parser source/)).toBeTruthy()
  expect(screen.getByText('The comparison precedes the copy.')).toBeTruthy()
  expect(within(screen.getByRole('region', { name: 'Child tasks' })).getAllByRole('article')).toHaveLength(1)
})
