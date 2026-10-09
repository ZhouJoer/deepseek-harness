// @vitest-environment jsdom
/** Dashboard navigation does not create analysis state until an explicit action. @module */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as common } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { engagementSchema, recordSchema } from '@deepseek-ai/dsh-experimental-security-analysis/src/workbench/model.ts'
import type { WorkbenchView } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import { Dashboard } from '../src/client/Dashboard.tsx'
import { deviceActions } from './device-fixture.client.ts'
import { en } from '../src/client/locales.ts'
import type {} from '../src/client/index.ts'

// jsdom has no CSS transform matrix; actual graph geometry is covered in the browser scenario.
beforeEach(() => { vi.stubGlobal('DOMMatrixReadOnly', class { m22 = 1 }) })
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const project = (id: string, stopped = false) => ({ kind: 'engagement' as const, value: engagementSchema.parse({
  id, title: id, objective: 'Review owned code', environmentIds: ['local'], stopped, maxAttempts: 3,
}) })
const alpha = project('Alpha')
const beta = project('Beta', true)
const evidence = recordSchema.parse({ kind: 'evidence', value: { id: 'e1', engagementId: 'Alpha', assetId: 'a1',
  title: 'Authorization check', summary: 'A recorded observation', artifact: { sha256: 'a'.repeat(64), size: 4, mediaType: 'text/plain' },
  provider: 'source', operation: 'read', toolVersion: '1', request: {}, source: { sessionId: 's1', callId: 'c1' },
  incomplete: false, method: 'static', createdAt: 1 } })
function harness(extra: object = {}) {
  const release = vi.fn()
  const api = {
    ...deviceActions,
    followProjects: async function* (signal: AbortSignal) {
      yield [alpha, beta].map(item => ({ project: item.value, runningAgentCount: 0, runningInvocationCount: 0, pendingPlanIds: [], interruptedCheckIds: [], blockedCheckIds: [], next: '', state: item.value.stopped ? 'stopped' as const : 'idle' as const }))
      if (!signal.aborted) await new Promise<void>((resolve) =>{  signal.addEventListener('abort', () =>{  resolve() }, { once: true }) })
    },
    observe: vi.fn(async (_id: string, _input: string) => ({ revision: 2, records: [alpha, evidence] })),
    projects: vi.fn(async () => JSON.stringify([alpha.value, beta.value])),
    project: vi.fn(async (id: string): Promise<WorkbenchView> => ({ revision: 1, records: id === 'Alpha' ? [alpha, evidence] : [beta] })),
    followActivity: async function* (id: string, signal: AbortSignal) {
      yield { type: 'snapshot' as const, briefs: [], cursor: 0, view: { revision: 1, records: id === 'Alpha' ? [alpha, evidence] : [beta] }, usage: [] }
      if (!signal.aborted) await new Promise<void>((resolve) =>{  signal.addEventListener('abort', () =>{  resolve() }, { once: true }) })
    },
    activityDetails: vi.fn(async () => ({ items: [], next: null, through: 0 })), openChild: vi.fn(),
    projectArtifact: vi.fn(async () => JSON.stringify({ text: 'Owned evidence', size: 14, truncated: false })),
    report: vi.fn(async () => '# Report'), findSession: vi.fn(async () => 's1'),
    createSession: vi.fn(async () => 'new'), associateSession: vi.fn(async () => {}), resumeProject: vi.fn(async () => {}),
    stopProject: vi.fn(async () => {}), createWorkspace: vi.fn(async () => 'workspace'),
    retainSession: vi.fn((id: string) => ({ sessionId: id, ready: Promise.resolve(), release })),
    subscribeReset: () => () => {}, manageProject: vi.fn(async (_projectId: string, _input: string) => '[]'), laboratory: vi.fn(),
    t: makeTranslate(en, common), useWorkspaces: (select: (state: object) => unknown) => select({ items: [{ workspaceId: 'workspace', path: '/owned', title: 'Owned' }] }),
    SessionProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
    renderSlot: () => <textarea aria-label="Assistant draft" defaultValue="" />,
    ...extra,
  }
  // The fixture supplies only framework seats consumed by this component.
  return { api, release, props: api as Parameters<typeof Dashboard>[0] }
}
it('reuses a configured laboratory image only after an explicit project action', async () => {
  const laboratory = vi.fn(async () => ({ revision: 2, records: [alpha] }))
  const { api, props } = harness({ laboratory })
  render(<Dashboard {...props} />)
  fireEvent.click((await screen.findByText('Alpha')).closest('button')!)
  fireEvent.click(await screen.findByRole('button', { name: en.laboratories }))
  expect(laboratory).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: en.reuseToolbox }))
  await waitFor(() => { expect(laboratory).toHaveBeenCalledWith('Alpha', 'reuse', '') })
  expect(api.createSession).not.toHaveBeenCalled()
})
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
it('shares one activity subscription across graph and timeline navigation', async () => {
  const { props } = harness()
  const followActivity = vi.fn(props.followActivity)
  render(<Dashboard {...props} followActivity={followActivity} />)
  fireEvent.click(await screen.findByRole('button', { name: /Alpha/ }))
  await screen.findByRole('heading', { name: 'Alpha' })
  const navigation = screen.getByRole('navigation', { name: 'Task detail navigation' })
  fireEvent.click(within(navigation).getByRole('button', { name: 'Tools & progress' }))
  fireEvent.click(within(navigation).getByRole('button', { name: 'Investigation' }))
  expect(followActivity).toHaveBeenCalledTimes(1)
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
it('resizes and expands the assistant without discarding its draft', async () => {
  const { props } = harness()
  render(<Dashboard {...props} />)
  fireEvent.click(await screen.findByRole('button', { name: /Alpha/ }))
  fireEvent.click(await screen.findByRole('button', { name: en.dashboardAssistant }))
  const draft = await screen.findByLabelText<HTMLTextAreaElement>('Assistant draft')
  fireEvent.change(draft, { target: { value: 'Retained while resizing' } })
  const separator = screen.getByRole('separator', { name: en.resizeAssistant })
  fireEvent.keyDown(separator, { key: 'ArrowLeft' })
  expect(separator.getAttribute('aria-valuenow')).toBe('45')
  fireEvent.keyDown(separator, { key: 'ArrowRight' })
  expect(separator.getAttribute('aria-valuenow')).toBe('40')
  fireEvent.click(screen.getByRole('button', { name: en.expandAssistant }))
  expect(screen.getByRole('complementary').style.width).toBe('100%')
  fireEvent.click(screen.getByRole('button', { name: en.restoreAssistant }))
  expect(screen.getByRole('complementary').style.width).toBe('40%')
  expect(draft.value).toBe('Retained while resizing')
})
it('opens plan approvals directly on the existing coordinator Session', async () => {
  const renderSlot = vi.fn(() => <div />)
  const plan = recordSchema.parse({ kind: 'plan', value: { id: 'plan', engagementId: 'Alpha', checkId: 'check',
    hypothesis: 'Inspect modules', expectedObservation: 'Module list', impact: 'Observe process', cleanup: 'Detach', durationMs: 100,
    operation: { provider: 'frida', operation: 'modules', environmentId: 'local', assetId: 'sample', parameters: {}, impact: 'observe' },
    hash: 'a'.repeat(64), environmentHash: 'b'.repeat(64), status: 'draft' } })
  const { api, props } = harness({ renderSlot, project: async () => ({ revision: 2, records: [alpha, plan] }) })
  render(<Dashboard {...props} />)
  fireEvent.click(await screen.findByRole('button', { name: /Alpha/ }))
  await screen.findByText(en.pendingPlanHint, { exact: false })
  fireEvent.click(screen.getByRole('button', { name: en.planApprovals }))
  await waitFor(() => { expect(renderSlot).toHaveBeenCalledWith('security.workbench.session', expect.objectContaining({
    advancedOpen: true, reviewOpen: true, assistantOpen: false,
  })) })
  expect(api.createSession).not.toHaveBeenCalled()
  expect(api.associateSession).not.toHaveBeenCalled()
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
it('confirms deletion, waits for the exit animation and supports undo', async () => {
  const saved = [{ ...alpha.value, archived: true, stopped: true }, beta.value]
  const { api, props } = harness({ manageProject: vi.fn().mockResolvedValueOnce(JSON.stringify(saved))
    .mockResolvedValueOnce(JSON.stringify([alpha.value, beta.value])) })
  render(<Dashboard {...props} />)
  const row = (await screen.findByRole('button', { name: /Alpha/ })).closest('article')!
  fireEvent.click(within(row).getByRole('button', { name: 'Delete task' }))
  expect(api.manageProject).not.toHaveBeenCalled()
  fireEvent.click(within(row).getByRole('button', { name: 'Cancel' }))
  expect(within(row).getByRole('button', { name: 'Delete task' })).toBe(document.activeElement)
  fireEvent.click(within(row).getByRole('button', { name: 'Delete task' }))
  fireEvent.click(within(row).getByRole('button', { name: 'Confirm deletion' }))
  await waitFor(() => { expect(row.getAttribute('data-deleting')).toBe('true') })
  expect(screen.getByRole('button', { name: /Alpha/ })).toBeTruthy()
  fireEvent.animationEnd(row)
  // jsdom lacks AnimationEvent; React registers the WebKit fallback for this environment.
  fireEvent(row, new Event('webkitAnimationEnd', { bubbles: true }))
  expect(screen.queryByRole('button', { name: /Alpha/ })).toBeNull()
  expect(api.createSession).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Undo deletion' }))
  await screen.findByRole('button', { name: /Alpha/ })
  expect((JSON.parse(api.manageProject.mock.calls[1]![1]) as { action: unknown }).action).toEqual({ kind: 'restore' })
})
it('keeps failed deletions visible for retry instead of animating them away', async () => {
  const deletion = Promise.withResolvers<string>()
  const { api, props } = harness({ manageProject: vi.fn(() => deletion.promise) })
  render(<Dashboard {...props} />)
  const row = (await screen.findByRole('button', { name: /Alpha/ })).closest('article')!
  fireEvent.click(within(row).getByRole('button', { name: 'Delete task' }))
  fireEvent.click(within(row).getByRole('button', { name: 'Confirm deletion' }))
  await waitFor(() => { expect(api.manageProject).toHaveBeenCalledTimes(1) })
  expect(within(row).getByRole<HTMLButtonElement>('button', { name: 'Deleting…' }).disabled).toBe(true)
  await act(async () => { deletion.reject(new Error('Deletion failed')); await deletion.promise.catch(() => {}) })
  await screen.findByRole('alert')
  expect(row.getAttribute('data-deleting')).toBe('false')
  expect(within(row).getByRole<HTMLButtonElement>('button', { name: 'Confirm deletion' }).disabled).toBe(false)
})
it('requires a second confirmation for long project names and offers no undo afterward', async () => {
  const archived = { ...alpha.value, title: 'Alpha ' + 'Long project name '.repeat(12), archived: true, stopped: true }
  const { api, props } = harness({ projects: vi.fn(async () => JSON.stringify([archived, beta.value])),
    manageProject: vi.fn(async () => JSON.stringify([beta.value])) })
  render(<Dashboard {...props} />)
  await screen.findByRole('button', { name: /Beta/ })
  fireEvent.click(screen.getByRole('button', { name: 'Deleted tasks' }))
  const row = (await screen.findByRole('button', { name: /Alpha/ })).closest('article')!
  fireEvent.click(within(row).getByRole('button', { name: 'Delete permanently' }))
  const confirm = within(row).getByRole<HTMLButtonElement>('button', { name: 'Confirm permanent deletion' })
  expect(api.manageProject).not.toHaveBeenCalled()
  expect(within(row).queryByRole('textbox')).toBeNull()
  expect(confirm.disabled).toBe(false)
  fireEvent.click(within(row).getByRole('button', { name: 'Cancel' }))
  expect(api.manageProject).not.toHaveBeenCalled()
  fireEvent.click(within(row).getByRole('button', { name: 'Delete permanently' }))
  fireEvent.click(confirm)
  await waitFor(() => { expect(row.getAttribute('data-deleting')).toBe('true') })
  expect((JSON.parse(api.manageProject.mock.calls[0]![1]) as { action: unknown }).action).toEqual({ kind: 'purge' })
  fireEvent.animationEnd(row)
  fireEvent(row, new Event('webkitAnimationEnd', { bubbles: true }))
  expect(screen.queryByRole('button', { name: /Alpha/ })).toBeNull()
  expect(screen.queryByRole('button', { name: 'Undo deletion' })).toBeNull()
  await screen.findByText('Task permanently deleted', { exact: false })
})
it('retries permanent cleanup with the original request after its task records were erased', async () => {
  const archived = { ...alpha.value, archived: true, stopped: true }
  const manageProject = vi.fn(async (_id: string, _input: string) => JSON.stringify([beta.value]))
    .mockRejectedValueOnce(new Error('Cleanup interrupted'))
  const { api, props } = harness({ projects: vi.fn(async () => JSON.stringify([archived, beta.value])), manageProject })
  render(<Dashboard {...props} />)
  await screen.findByRole('button', { name: /Beta/ })
  fireEvent.click(screen.getByRole('button', { name: 'Deleted tasks' }))
  const row = (await screen.findByRole('button', { name: /Alpha/ })).closest('article')!
  fireEvent.click(within(row).getByRole('button', { name: 'Delete permanently' }))
  fireEvent.click(within(row).getByRole('button', { name: 'Confirm permanent deletion' }))
  await screen.findByRole('alert')
  await waitFor(() => { expect(within(row).getByRole<HTMLButtonElement>('button', { name: 'Confirm permanent deletion' }).disabled).toBe(false) })
  api.project.mockRejectedValue(new Error('Unknown project'))
  fireEvent.click(within(row).getByRole('button', { name: 'Confirm permanent deletion' }))
  await waitFor(() => { expect(row.getAttribute('data-deleting')).toBe('true') })
  expect(manageProject.mock.calls[1]).toEqual(manageProject.mock.calls[0])
  expect(api.project).toHaveBeenCalledTimes(1)
})

it('analyzes imported captures from materials and opens the resulting evidence', async () => {
  const asset = recordSchema.parse({ kind: 'asset', value: { id: 'capture', engagementId: 'Alpha', label: 'radio.pcapng',
    artifact: { sha256: 'b'.repeat(64), size: 24, mediaType: 'application/octet-stream' }, format: 'other', identity: 'measured' } })
  const { api, props } = harness({
    project: vi.fn(async () => ({ revision: 1, records: [alpha, asset] })),
    followActivity: async function* () { yield { type: 'snapshot', briefs: [], cursor: 0, view: { revision: 1, records: [alpha, asset] }, usage: [] } },
    deviceDirectory: vi.fn(async () => ({ environments: [{ id: 'local', label: 'Windows', kind: 'local' }],
      inventory: { environmentId: 'local', checkedAt: 0, checks: [], devices: [] } })),
  })
  render(<Dashboard {...props} />)
  fireEvent.click(await screen.findByRole('button', { name: /Alpha/ }))
  fireEvent.click(await screen.findByRole('button', { name: 'Materials' }))
  await screen.findByRole('option', { name: 'Windows' })
  expect(api.observe).not.toHaveBeenCalled()
  const technical = screen.getAllByText('Technical details').find(item => item.closest('details')?.textContent?.includes('b'.repeat(64)))!
  expect(technical.closest('details')?.open).toBe(false)
  fireEvent.change(screen.getByLabelText('Capture protocol'), { target: { value: 'ble' } })
  fireEvent.click(screen.getByRole('button', { name: 'Analyze capture' }))
  await waitFor(() =>{  expect(api.observe).toHaveBeenCalledOnce() })
  expect(JSON.parse(api.observe.mock.calls[0]![1])).toEqual({ provider: 'packet-capture', operation: 'summary',
    assetId: 'capture', environmentId: 'local', parameters: { protocol: 'ble' }, impact: 'observe' })
  expect((await screen.findByRole('button', { name: /^Authorization check/ })).textContent).toContain('A recorded observation')
  expect(api.createSession).not.toHaveBeenCalled()
})
