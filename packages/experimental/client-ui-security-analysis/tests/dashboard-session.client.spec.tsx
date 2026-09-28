// @vitest-environment jsdom
/** Native analysis preparation and sending keep independent retry state. @module */
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as common } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { recordSchema } from '@deepseek-ai/dsh-experimental-security-analysis/src/workbench/model.ts'
import type { WorkbenchView } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import { DashboardSession } from '../src/client/DashboardSession.tsx'
import { en } from '../src/client/locales.ts'
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
    configuration: vi.fn(async () => JSON.stringify({ environments: [{ id: 'local', label: 'Local', kind: 'local' }] })),
    load: vi.fn(async () => ({ revision: 0, records: [] })),
    importMaterials: vi.fn(async () => prepared), sendAnalysis: vi.fn(async () => {}), renderFactorySlot: () => null,
    ...extra,
  }
  // Unused framework seats and advanced actions do not participate in this creation fixture.
  return { api, props: api as unknown as Parameters<typeof DashboardSession>[0] }
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
