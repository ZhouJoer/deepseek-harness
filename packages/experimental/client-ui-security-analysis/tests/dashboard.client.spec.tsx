// @vitest-environment jsdom
/** Dashboard navigation does not create analysis state until an explicit action. @module */
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as common } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { recordSchema } from '@deepseek-ai/dsh-experimental-security-analysis/src/workbench/model.ts'
import type { WorkbenchView } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import { Dashboard } from '../src/client/Dashboard.tsx'
import { en } from '../src/client/locales.ts'
import type {} from '../src/client/index.ts'

afterEach(cleanup)
const project = (id: string, stopped = false) => recordSchema.parse({ kind: 'engagement', value: {
  id, title: id, objective: 'Review owned code', environmentIds: ['local'], stopped, maxAttempts: 3,
} })
const alpha = project('Alpha')
const beta = project('Beta', true)
const evidence = recordSchema.parse({ kind: 'evidence', value: { id: 'e1', engagementId: 'Alpha', assetId: 'a1',
  title: 'Authorization check', summary: 'A recorded observation', artifact: { sha256: 'a'.repeat(64), size: 4, mediaType: 'text/plain' },
  provider: 'source', operation: 'read', toolVersion: '1', request: {}, source: { sessionId: 's1', callId: 'c1' },
  incomplete: false, method: 'static', createdAt: 1 } })
function harness(extra: object = {}) {
  const release = vi.fn()
  const api = {
    projects: vi.fn(async () => JSON.stringify([alpha.value, beta.value])),
    project: vi.fn(async (id: string): Promise<WorkbenchView> => ({ revision: 1, records: id === 'Alpha' ? [alpha, evidence] : [beta] })),
    followActivity: async function* (id: string, signal: AbortSignal) {
      yield { type: 'snapshot' as const, briefs: [], cursor: 0, view: { revision: 1, records: id === 'Alpha' ? [alpha, evidence] : [beta] }, usage: [] }
      if (!signal.aborted) await new Promise<void>((resolve) =>{  signal.addEventListener('abort', () =>{  resolve() }, { once: true }) })
    },
    activityDetails: vi.fn(async () => ({ items: [], next: null, through: 0 })),
    projectArtifact: vi.fn(async () => JSON.stringify({ text: 'Owned evidence', size: 14, truncated: false })),
    report: vi.fn(async () => '# Report'), findSession: vi.fn(async () => 's1'),
    createSession: vi.fn(async () => 'new'), associateSession: vi.fn(async () => {}), resumeProject: vi.fn(async () => {}),
    stopProject: vi.fn(async () => {}), createWorkspace: vi.fn(async () => 'workspace'),
    retainSession: vi.fn((id: string) => ({ sessionId: id, ready: Promise.resolve(), release })),
    subscribeReset: () => () => {}, manageProject: vi.fn(async () => '[]'), laboratory: vi.fn(),
    t: makeTranslate(en, common), useWorkspaces: (select: (state: object) => unknown) => select({ items: [{ workspaceId: 'workspace', path: '/owned', title: 'Owned' }] }),
    SessionProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
    renderSlot: () => <textarea aria-label="Assistant draft" defaultValue="" />,
    ...extra,
  }
  // The fixture supplies only framework seats consumed by this component.
  return { api, release, props: api as unknown as Parameters<typeof Dashboard>[0] }
}
it('filters tasks and reads history without creating or binding a Session', async () => {
  const { api, props } = harness()
  render(<Dashboard {...props} />)
  await screen.findByRole('button', { name: /Alpha/ })
  fireEvent.change(screen.getByLabelText('Task status'), { target: { value: 'stopped' } })
  expect(screen.queryByRole('button', { name: /Alpha/ })).toBeNull()
  fireEvent.change(screen.getByLabelText('Task status'), { target: { value: 'all' } })
  fireEvent.change(screen.getByLabelText('Search tasks or objectives'), { target: { value: 'alpha' } })
  expect(screen.queryByRole('button', { name: /Beta/ })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: /Alpha/ }))
  await screen.findByRole('heading', { name: 'Alpha' })
  expect(api.createSession).not.toHaveBeenCalled()
  expect(api.associateSession).not.toHaveBeenCalled()
  expect(api.retainSession).not.toHaveBeenCalled()
})
it('returns from evidence detail without losing the evidence filter', async () => {
  const { api, props } = harness()
  render(<Dashboard {...props} />)
  fireEvent.click(await screen.findByRole('button', { name: /Alpha/ }))
  await screen.findByRole('heading', { name: 'Alpha' })
  fireEvent.click(screen.getByRole('button', { name: 'Evidence' }))
  fireEvent.change(screen.getByLabelText('Search evidence titles or summaries'), { target: { value: 'Authorization' } })
  fireEvent.click(screen.getByRole('button', { name: /Authorization check/ }))
  await screen.findByText('Owned evidence')
  expect(api.projectArtifact).toHaveBeenCalledWith('Alpha', 'a'.repeat(64))
  fireEvent.click(screen.getByRole('button', { name: '← Back to evidence' }))
  expect((screen.getByLabelText<HTMLInputElement>('Search evidence titles or summaries')).value).toBe('Authorization')
})
it('retains the assistant and its draft when collapsed, and releases it on task navigation', async () => {
  const { api, props, release } = harness()
  const mounted = render(<Dashboard {...props} />)
  fireEvent.click(await screen.findByRole('button', { name: /Alpha/ }))
  await screen.findByRole('heading', { name: 'Alpha' })
  fireEvent.click(screen.getByRole('button', { name: 'Analysis assistant' }))
  fireEvent.change(await screen.findByLabelText('Assistant draft'), { target: { value: 'Keep this draft' } })
  fireEvent.click(screen.getByRole('button', { name: 'Hide assistant' }))
  expect(release).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Analysis assistant' }))
  expect((await screen.findByLabelText<HTMLTextAreaElement>('Assistant draft')).value).toBe('Keep this draft')
  expect(api.retainSession).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: '← Back to tasks' }))
  await waitFor(() =>{  expect(release).toHaveBeenCalledTimes(1) })
  mounted.unmount()
  expect(release).toHaveBeenCalledTimes(1)
})
it('requires an explicit continue action before creating a missing historical Session', async () => {
  const { api, props } = harness({ findSession: vi.fn(async () => undefined) })
  render(<Dashboard {...props} />)
  fireEvent.click(await screen.findByRole('button', { name: /Alpha/ }))
  await screen.findByRole('heading', { name: 'Alpha' })
  fireEvent.click(screen.getByRole('button', { name: 'Analysis assistant' }))
  await screen.findByText(/No recoverable analysis session/)
  expect(api.createSession).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Continue analysis' }))
  await waitFor(() =>{  expect(api.associateSession).toHaveBeenCalledWith('new', 'Alpha') })
  expect(api.resumeProject).not.toHaveBeenCalled()
})
it('opens the stopped assistant without implicitly resuming its task', async () => {
  const { api, props } = harness()
  render(<Dashboard {...props} />)
  fireEvent.click(await screen.findByRole('button', { name: /Beta/ }))
  await screen.findByRole('heading', { name: 'Beta' })
  fireEvent.click(screen.getByRole('button', { name: 'Analysis assistant' }))
  await screen.findByLabelText('Assistant draft')
  expect(api.resumeProject).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Resume task' }))
  await waitFor(() =>{  expect(api.resumeProject).toHaveBeenCalledWith('s1') })
})

it('renders the latest saved Markdown report without opening a Session', async () => {
  const artifact = { sha256: 'b'.repeat(64), size: 4, mediaType: 'text/markdown' }
  const saved = recordSchema.parse({ kind: 'report', value: { id: 'r1', engagementId: 'Alpha', revision: 4,
    markdown: artifact, json: { ...artifact, mediaType: 'application/json' }, createdAt: 1 } })
  const { api, props } = harness({ project: vi.fn(async () => ({ revision: 4, records: [alpha, saved] })) })
  render(<Dashboard {...props} />)
  fireEvent.click(await screen.findByRole('button', { name: /Alpha/ }))
  await screen.findByRole('heading', { name: 'Alpha' })
  fireEvent.click(screen.getByRole('button', { name: 'Reports' }))
  await screen.findByRole('heading', { name: 'Report' })
  expect(api.report).toHaveBeenCalledWith('Alpha', 'r1', 'markdown')
  expect(api.createSession).not.toHaveBeenCalled()
})
it('ignores a delayed historical read after changing tasks', async () => {
  const delayed = Promise.withResolvers<WorkbenchView>()
  const { props } = harness({ project: vi.fn((id: string) => id === 'Alpha' ? delayed.promise : Promise.resolve({ revision: 2, records: [beta] })) })
  render(<Dashboard {...props} />)
  fireEvent.click(await screen.findByRole('button', { name: /Alpha/ }))
  fireEvent.click(screen.getByRole('button', { name: '← Back to tasks' }))
  fireEvent.click(await screen.findByRole('button', { name: /Beta/ }))
  await screen.findByRole('heading', { name: 'Beta' })
  await act(async () => { delayed.resolve({ revision: 1, records: [alpha] }); await delayed.promise })
  expect(screen.queryByRole('heading', { name: 'Alpha' })).toBeNull()
})

it('retries a failed evidence read when its project revision has not changed', async () => {
  const read = vi.fn().mockRejectedValueOnce(new Error('Read interrupted'))
    .mockResolvedValue(JSON.stringify({ text: 'Recovered evidence', size: 18, truncated: false }))
  const { props } = harness({ projectArtifact: read })
  render(<Dashboard {...props} />)
  fireEvent.click(await screen.findByRole('button', { name: /Alpha/ }))
  await screen.findByRole('heading', { name: 'Alpha' })
  fireEvent.click(screen.getByRole('button', { name: 'Evidence' }))
  fireEvent.click(screen.getByRole('button', { name: /Authorization check/ }))
  await screen.findByText('Read failed. Refresh to try again.')
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
  await screen.findByText('Recovered evidence')
  expect(read).toHaveBeenCalledTimes(2)
})
