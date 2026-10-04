// @vitest-environment jsdom
/** Main-chat progress follows live binding changes and retains intervention controls. @module */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as common } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkbenchView } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import { recordSchema } from '@deepseek-ai/dsh-experimental-security-analysis/src/workbench/model.ts'
import { ConversationProgress, ConversationProgressEntry } from '../src/client/ConversationProgress.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)
const project = (id: string): WorkbenchView => ({ revision: 1, records: [recordSchema.parse({ kind: 'engagement', value: {
  id, title: id, objective: 'Review owned code', environmentIds: ['local'], stopped: false, maxAttempts: 3,
} })] })

it('replaces the loading message with a retryable error when the Host stream is unavailable', async () => {
  render(<ConversationProgress sessionId={SessionId('session')} t={makeTranslate(en, common)}
    openChild={vi.fn()}
    subscribeReset={() => () => {}} openDashboard={() => {}}
    followSessionView={vi.fn(() => { throw new Error('Remote method unavailable') })}
    followActivity={async function* () {}} activityDetails={async () => ({ items: [], next: null, through: 0 })} />)
  expect((await screen.findByRole('alert')).textContent).toContain('Remote method unavailable')
  expect(screen.queryByText(en.dashboardLoading)).toBeNull()
  expect(screen.getByRole('button', { name: en.dashboardRetry })).toBeTruthy()
})

it('shows newly linked task activity in the sidebar without extra conversation controls', async () => {
  const next = Promise.withResolvers<WorkbenchView>()
  let selectionSignal: AbortSignal | undefined
  let activitySignal: AbortSignal | undefined
  const api = {
    openChild: vi.fn(),
    t: makeTranslate(en, common), sessionId: SessionId('session'), subscribeReset: () => () => {},
    followSessionView: async function* (_id: SessionId, signal: AbortSignal) {
      selectionSignal = signal
      yield { revision: 0, records: [] }
      const abort = () => { next.resolve({ revision: 0, records: [] }) }
      signal.addEventListener('abort', abort, { once: true })
      try { yield await next.promise; await new Promise<void>((resolve) => { signal.addEventListener('abort', () => { resolve() }, { once: true }) }) }
      finally { signal.removeEventListener('abort', abort) }
    },
    followActivity: async function* (id: string, signal: AbortSignal) {
      activitySignal = signal
      yield { type: 'snapshot' as const, cursor: 1, briefs: [], view: project(id), usage: [
        { checkpointId: '', tool: 'source', verified: true, total: 1, running: 1, completed: 0, failed: 0, cancelled: 0, unknown: 0, incomplete: 0 },
      ] }
      await new Promise<void>((resolve) => { signal.addEventListener('abort', () => { resolve() }, { once: true }) })
    },
    activityDetails: vi.fn(async () => ({ items: [], next: null, through: 1 })),
    stopProject: vi.fn(async () => {}), resumeProject: vi.fn(async () => {}), openDashboard: vi.fn(),
  }
  const mounted = render(<ConversationProgress {...api} />)
  await screen.findByText(en.activityNoProject)
  await act(async () => { next.resolve(project('Alpha')) })
  expect((await screen.findByRole('group', { name: 'source ×1' })).textContent).toContain('Running 1')
  expect(screen.queryByRole('button', { name: 'Stop task' })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Correct direction' })).toBeNull()
  expect(activitySignal?.aborted).toBe(false)
  mounted.unmount()
  expect(selectionSignal?.aborted).toBe(true)
  expect(activitySignal?.aborted).toBe(true)
})

it('keeps the chat entry compact and shows a live count before the sidebar opens', async () => {
  const openProgress = vi.fn()
  const signals: AbortSignal[] = []
  const mounted = render(<ConversationProgressEntry sessionId={SessionId('session')} t={makeTranslate(en, common)}
    subscribeReset={() => () => {}} openProgress={openProgress} openDashboard={() => {}}
    followSessionView={async function* (_id, signal) {
      signals.push(signal); yield project('Alpha')
      await new Promise<void>((resolve) => { signal.addEventListener('abort', () => { resolve() }, { once: true }) })
    }} followActivity={async function* (_id, signal) {
      signals.push(signal)
      yield { type: 'snapshot', cursor: 1, briefs: [], view: project('Alpha'), usage: [
        { checkpointId: '', tool: 'radare2', verified: false, total: 37, running: 1, completed: 35, failed: 1, cancelled: 0, unknown: 0, incomplete: 0 },
      ] }
      await new Promise<void>((resolve) => { signal.addEventListener('abort', () => { resolve() }, { once: true }) })
    }} />)
  const entry = screen.getByTitle('Tools & progress')
  await waitFor(() => { expect(entry.textContent).toContain('37') })
  expect(screen.getByRole('img', { name: 'Running' })).toBeTruthy()
  fireEvent.click(entry)
  expect(openProgress).toHaveBeenCalledOnce()
  expect(screen.queryByRole('region')).toBeNull()
  expect(screen.queryByText('Alpha')).toBeNull()
  mounted.unmount()
  expect(signals.every(signal => signal.aborted)).toBe(true)
})

it('reconnects the selection stream and switches to the newly selected project', async () => {
  const resets = new Set<() => void>()
  let calls = 0
  const signals: AbortSignal[] = []
  const followed: string[] = []
  const props = {
    openChild: vi.fn(),
    sessionId: SessionId('session'), t: makeTranslate(en, common),
    subscribeReset: (listener: () => void) => { resets.add(listener); return () => { resets.delete(listener) } },
    followSessionView: async function* (_id: SessionId, signal: AbortSignal) {
      signals.push(signal)
      yield { ...project(++calls === 1 ? 'Alpha' : 'Beta'), revision: calls }
      await new Promise<void>((resolve) => { signal.addEventListener('abort', () => { resolve() }, { once: true }) })
    },
    followActivity: async function* (id: string, signal: AbortSignal) {
      followed.push(id)
      yield { type: 'snapshot' as const, cursor: 0, briefs: [], usage: [], view: project(id) }
      await new Promise<void>((resolve) => { signal.addEventListener('abort', () => { resolve() }, { once: true }) })
    },
    activityDetails: async () => ({ items: [], next: null, through: 0 }),
    stopProject: vi.fn(), resumeProject: vi.fn(), openDashboard: vi.fn(),
  }
  const mounted = render(<ConversationProgress {...props} />)
  await screen.findByText('Alpha')
  await act(async () => { for (const reset of resets) reset() })
  await screen.findByText('Beta')
  expect(signals[0]?.aborted).toBe(true)
  expect(followed).toContain('Beta')
  expect(screen.queryByText('Alpha')).toBeNull()
  mounted.unmount()
  expect(signals.every(signal => signal.aborted)).toBe(true)
})

it('keeps the running indicator visible for a child without counting it as a tool invocation', async () => {
  const view = project('Alpha')
  view.records.push(recordSchema.parse({ kind: 'delegation', value: {
    id: 'child-task', engagementId: 'Alpha', assetId: 'sample', checkpointId: '', parentSessionId: 'session',
    callId: 'delegate', role: 'researcher', task: 'assessment', question: 'Check the documentation',
    criterion: 'Return evidence references', createdAt: 1, status: 'running',
  } }))
  render(<ConversationProgressEntry sessionId={SessionId('session')} t={makeTranslate(en, common)}
    subscribeReset={() => () => {}} openProgress={vi.fn()} openDashboard={vi.fn()}
    followSessionView={async function* (_id, signal) {
      yield view
      if (!signal.aborted) await new Promise<void>((resolve) => { signal.addEventListener('abort', () => { resolve() }, { once: true }) })
    }} followActivity={async function* (_id, signal) {
      yield { type: 'snapshot', cursor: 0, briefs: [], usage: [], view }
      if (!signal.aborted) await new Promise<void>((resolve) => { signal.addEventListener('abort', () => { resolve() }, { once: true }) })
    }} />)
  await screen.findByRole('img', { name: 'Running' })
  await waitFor(() => { expect(screen.getByTitle('Tools & progress').textContent).toContain('0') })
})
