// @vitest-environment jsdom
/** Real-time research briefs stay concise and isolate subscription generations. @module */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as common } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import type { SecurityActivityFrame, WorkbenchView } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import { recordSchema } from '@deepseek-ai/dsh-experimental-security-analysis/src/workbench/model.ts'
import { ActivityPanel } from '../src/client/ActivityPanel.tsx'
import { en } from '../src/client/locales.ts'
import { investigationFixture } from './investigation-fixture.client.ts'

afterEach(cleanup)
it('uses the current finding instead of a checkpoint historical confirmation', () => {
  render(<ActivityPanel project="project" view={investigationFixture()} changed={vi.fn()} openChild={vi.fn()}
    followActivity={async function* () {}} activityDetails={async () => ({ items: [], next: null, through: 0 })}
    subscribeReset={() => () => {}} t={makeTranslate(en, common)} />)
  const direction = screen.getByRole('heading', { name: 'Inspect authorization' }).closest('article')!
  expect(within(direction).getByText('Suspected')).toBeTruthy()
  expect(within(direction).queryByText('Confirmed')).toBeNull()
  expect(within(direction).queryByText('Old title')).toBeNull()
})
const checkpoint = (id: string, phase: string, title: string) => recordSchema.parse({ kind: 'checkpoint', value: {
  id, engagementId: 'project', phase, title, reason: 'A new caller needs inspection', summary: 'Only an observation',
  next: 'Read the caller', evidenceIds: [], findings: [], createdAt: 1, updatedAt: 1,
} })
it('updates counts during a turn without adding a stage and preserves a return to reconnaissance', async () => {
  const view: WorkbenchView = { revision: 1, records: [checkpoint('first', 'recon', 'Entry inventory'),
    checkpoint('second', 'assessment', 'Access checks'), checkpoint('third', 'recon', 'Supplemental reconnaissance')] }
  let deliver: (frame: SecurityActivityFrame) => void = () => { throw new Error('Subscription not ready') }
  const changed = vi.fn()
  const followActivity = async function* (_project: string, signal: AbortSignal) {
    yield { type: 'snapshot' as const, briefs: [], view, cursor: 0, usage: [] }
    while (!signal.aborted) {
      const pending = Promise.withResolvers<SecurityActivityFrame | undefined>()
      deliver = (frame) =>{  pending.resolve(frame) }
      const abort = () =>{  pending.resolve(undefined) }
      signal.addEventListener('abort', abort, { once: true })
      const frame = await pending.promise
      signal.removeEventListener('abort', abort)
      if (frame) yield frame
    }
  }
  const details = vi.fn(async () => ({ items: [], next: null, through: 1 }))
  render(<ActivityPanel project="project" view={view} changed={changed} followActivity={followActivity}
    openChild={vi.fn()}
    activityDetails={details} subscribeReset={() => () => {}} t={makeTranslate(en, common)} />)
  await screen.findByText('Live updates')
  const usage = { checkpointId: 'third', tool: 'ghidra', verified: true, total: 1, running: 1,
    completed: 0, failed: 0, cancelled: 0, unknown: 0, incomplete: 0 }
  await act(async () => { deliver({ type: 'activity', briefs: [], cursor: 1, usage: [usage] }) })
  expect(screen.getByRole('group', { name: 'ghidra ×1' }).textContent).toContain('Running 1')
  await act(async () => { deliver({ type: 'activity', briefs: [], cursor: 2, usage: [{ ...usage, running: 0, failed: 1 }] }) })
  expect(screen.getByRole('group', { name: 'ghidra ×1' }).textContent).toContain('Failed 1')
  expect(screen.getAllByRole('heading', { level: 4 })).toHaveLength(3)
  expect(screen.getAllByText('Analysis summary')).toHaveLength(3)
  fireEvent.click(screen.getAllByText('Inspect calls and evidence')[2]!)
  await waitFor(() =>{  expect(details).toHaveBeenCalledWith('project', 'third', 0, undefined) })
  expect(changed).toHaveBeenCalledTimes(1)
})

it('combines reference counts without verification badges and explains unsaved evidence', async () => {
  const view: WorkbenchView = { revision: 1, records: [checkpoint('first', 'recon', 'Entry inventory')] }
  const usage = { checkpointId: 'first', tool: 'radare2', verified: true, total: 1, running: 0,
    completed: 1, failed: 0, cancelled: 0, unknown: 0, incomplete: 0 }
  const followActivity = async function* () {
    yield { type: 'snapshot' as const, briefs: [], view, cursor: 1, usage: [usage,
      { ...usage, verified: false, total: 2, completed: 1, failed: 1 }] }
  }
  render(<ActivityPanel project="project" view={view} changed={() => {}} followActivity={followActivity}
    openChild={vi.fn()}
    activityDetails={async () => ({ items: [], next: null, through: 1 })}
    subscribeReset={() => () => {}} t={makeTranslate(en, common)} />)
  const card = await screen.findByRole('group', { name: 'radare2 ×3' })
  expect(card.textContent).toContain('Completed 2')
  expect(card.textContent).toContain('Failed 1')
  expect(screen.queryByText('Unverified')).toBeNull()
  expect(screen.queryByText('Observed call')).toBeNull()
  expect(screen.getByText(/Tool names and counts are for reference/)).toBeTruthy()
  fireEvent.click(screen.getByText('Inspect calls and evidence'))
  expect(screen.getByText(/No saved evidence linked to this stage/)).toBeTruthy()
})

it('aborts an old project stream and ignores its late frames', async () => {
  const waits: { signal: AbortSignal; done: ReturnType<typeof Promise.withResolvers<SecurityActivityFrame>> }[] = []
  const followActivity = async function* (_project: string, signal: AbortSignal) {
    const done = Promise.withResolvers<SecurityActivityFrame>()
    waits.push({ signal, done })
    yield await done.promise
  }
  const props = { view: { revision: 0, records: [] }, changed: vi.fn(), followActivity,
    openChild: vi.fn(),
    activityDetails: vi.fn(async () => ({ items: [], next: null, through: 0 })),
    subscribeReset: () => () => {}, t: makeTranslate(en, common) }
  const mounted = render(<ActivityPanel {...props} project="first" />)
  await waitFor(() =>{  expect(waits).toHaveLength(1) })
  mounted.rerender(<ActivityPanel {...props} project="second" />)
  await waitFor(() =>{  expect(waits).toHaveLength(2) })
  expect(waits[0]!.signal.aborted).toBe(true)
  await act(async () => {
    waits[0]!.done.resolve({ type: 'snapshot', briefs: [], cursor: 1, usage: [], view: { revision: 99, records: [] } })
    waits[1]!.done.resolve({ type: 'snapshot', briefs: [], cursor: 2, usage: [], view: { revision: 2, records: [] } })
  })
  expect(props.changed).toHaveBeenCalledExactlyOnceWith({ revision: 2, records: [] })
})

it('keeps question-scoped child work in its captured direction and sorts it by dispatch time', async () => {
  const child = (id: string, checkpointId: string, createdAt: number) => recordSchema.parse({ kind: 'delegation', value: {
    id, engagementId: 'project', assetId: 'sample', checkpointId, parentSessionId: 'parent', callId: id,
    role: 'researcher', task: 'assessment', question: id, criterion: 'Cite the assigned evidence', createdAt, status: 'pending',
  } })
  const view: WorkbenchView = { revision: 1, records: [checkpoint('first', 'recon', 'Entry inventory'),
    checkpoint('second', 'assessment', 'Access checks'), child('Later parser question', 'first', 2),
    child('Initial parser question', 'first', 1), child('Caller question', 'second', 3), child('Unclassified question', '', 0)] }
  render(<ActivityPanel project="project" view={view} changed={vi.fn()} openChild={vi.fn()}
    followActivity={async function* () {}} activityDetails={async () => ({ items: [], next: null, through: 0 })}
    subscribeReset={() => () => {}} t={makeTranslate(en, common)} />)
  const first = screen.getByRole('heading', { name: 'Entry inventory' }).closest('article')!
  const second = screen.getByRole('heading', { name: 'Access checks' }).closest('article')!
  expect(within(first).getAllByRole('article').map(row => row.getAttribute('aria-label')))
    .toEqual(['Initial parser question', 'Later parser question'])
  expect(within(second).getByRole('article', { name: 'Caller question' })).toBeTruthy()
  expect(within(first).queryByText('Caller question')).toBeNull()
  expect(screen.getByRole('heading', { name: 'Unclassified records' }).closest('article')?.textContent).toContain('Unclassified question')
  await waitFor(() => { expect(screen.getByText('Disconnected')).toBeTruthy() })
})
