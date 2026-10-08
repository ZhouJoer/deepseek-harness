// @vitest-environment jsdom
/** Native analysis preparation and sending keep independent retry state. @module */
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as common } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { recordSchema } from '@deepseek-ai/dsh-experimental-security-analysis/src/workbench/model.ts'
import type { WorkbenchView } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import { DashboardSession } from '../src/client/DashboardSession.tsx'
import type { WorkbenchActions } from '../src/client/Workbench.tsx'
import { en } from '../src/client/locales.ts'
import { workbenchConfiguration } from './configuration-fixture.client.ts'
import type {} from '../src/client/index.ts'
afterEach(cleanup)
const prepared: WorkbenchView = { revision: 1, records: [recordSchema.parse({ kind: 'engagement',
  value: { id: 'task', title: 'Review', objective: 'Inspect code', environmentIds: ['local'], stopped: false, maxAttempts: 3 } })] }
function harness(extra: object = {}) {
  const api = {
    sessionId: 'session', creating: true, assistantOpen: false, advancedOpen: false,
    t: makeTranslate(en, common), changed: vi.fn(), started: vi.fn(),
    useSession: (select: (value: object) => unknown) => select({ running: false, blank: true, promptAttempted: false }),
    useConversation: (select: (value: object) => unknown) => select({ activeTargets: new Set() }),
    configuration: vi.fn(async () => workbenchConfiguration()),
    configureWorkspace: vi.fn(async () => workbenchConfiguration()),
    load: vi.fn(async () => ({ revision: 0, records: [] })),
    importMaterials: vi.fn<WorkbenchActions['importMaterials']>(async () => prepared), sendAnalysis: vi.fn(async () => {}), renderFactorySlot: () => null,
    ...extra,
  }
  // Unused framework seats and advanced actions do not participate in this creation fixture.
  return { api, props: api as Parameters<typeof DashboardSession>[0] }
}
it('retries sending without recreating a prepared task or importing its materials again', async () => {
  const send = vi.fn().mockRejectedValueOnce(new Error('Connection lost')).mockResolvedValue(undefined)
  const { api, props } = harness({ sendAnalysis: send })
  render(<DashboardSession {...props} />)
  fireEvent.change(screen.getByLabelText('What would you like to analyze?'), { target: { value: 'Inspect code' } })
  await waitFor(() => { expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Start analysis' }).disabled).toBe(false) })
  fireEvent.click(screen.getByRole('button', { name: 'Start analysis' }))
  await screen.findByText('Connection lost')
  fireEvent.click(screen.getByRole('button', { name: 'Retry sending' }))
  await waitFor(() => { expect(api.started).toHaveBeenCalledWith('task') })
  expect(api.importMaterials).toHaveBeenCalledTimes(1)
  expect(send).toHaveBeenCalledTimes(2)
})
it('does not send after the creation view leaves while material preparation is pending', async () => {
  const pending = Promise.withResolvers<WorkbenchView>()
  const { api, props } = harness({ importMaterials: vi.fn(() => pending.promise) })
  const mounted = render(<DashboardSession {...props} />)
  fireEvent.change(screen.getByLabelText('What would you like to analyze?'), { target: { value: 'Inspect code' } })
  await waitFor(() => { expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Start analysis' }).disabled).toBe(false) })
  fireEvent.click(screen.getByRole('button', { name: 'Start analysis' }))
  await waitFor(() => { expect(api.importMaterials).toHaveBeenCalledTimes(1) })
  mounted.unmount()
  await act(async () => { pending.resolve(prepared); await pending.promise })
  expect(api.sendAnalysis).not.toHaveBeenCalled()
})

it('requires a saved attempt limit before creating an analysis', async () => {
  const configuration = workbenchConfiguration({ workspace: {
    cwd: '/workspace', revision: 0, configured: false, environmentIds: ['local'],
  } })
  const configureWorkspace = vi.fn<WorkbenchActions['configureWorkspace']>()
    .mockRejectedValueOnce(new Error('Settings conflict'))
    .mockResolvedValue(workbenchConfiguration({ workspace: {
      cwd: '/workspace', revision: 1, configured: true, environmentIds: ['local'], maxAttempts: 6,
    } }))
  const { api, props } = harness({ configuration: vi.fn(async () => configuration), configureWorkspace })
  render(<DashboardSession {...props} />)
  await screen.findByText(en.missingAttemptLimit)
  const start = screen.getByRole<HTMLButtonElement>('button', { name: 'Start analysis' })
  expect(start.disabled).toBe(true)
  fireEvent.click(start)
  expect(api.importMaterials).not.toHaveBeenCalled()
  expect(api.sendAnalysis).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('Attempt limit per check'), { target: { value: '6' } })
  fireEvent.click(screen.getByRole('button', { name: en.saveWorkspaceResources }))
  await screen.findByText('Error: Settings conflict')
  expect(screen.getByLabelText<HTMLInputElement>('Attempt limit per check').value).toBe('6')
  expect(start.disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: en.saveWorkspaceResources }))
  await waitFor(() => { expect(screen.queryByText(en.missingAttemptLimit)).toBeNull() })
  expect(JSON.parse(configureWorkspace.mock.calls[0]![1])).toEqual({
    expectedRevision: 0, environmentIds: ['local'], maxAttempts: 6,
  })
  fireEvent.change(screen.getByLabelText('What would you like to analyze?'), { target: { value: 'Inspect code' } })
  fireEvent.click(start)
  await waitFor(() => { expect(api.started).toHaveBeenCalledWith('task') })
  expect(JSON.parse(api.importMaterials.mock.calls[0]![1])).toMatchObject({ resources: { maxAttempts: 6 } })
})

it('does not create an analysis without a workspace', async () => {
  const { api, props } = harness({ configuration: vi.fn(async () => workbenchConfiguration({ workspace: null })) })
  render(<DashboardSession {...props} />)
  await screen.findByText(en.missingAnalysisWorkspace)
  const start = screen.getByRole<HTMLButtonElement>('button', { name: 'Start analysis' })
  expect(start.disabled).toBe(true)
  fireEvent.click(start)
  expect(api.importMaterials).not.toHaveBeenCalled()
  expect(api.sendAnalysis).not.toHaveBeenCalled()
})
