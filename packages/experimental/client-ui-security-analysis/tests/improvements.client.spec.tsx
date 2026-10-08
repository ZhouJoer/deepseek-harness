// @vitest-environment jsdom
/** Operator progress, implementation claims and independently cancellable observation. @module */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as common } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { evolutionProposalSchema } from '@deepseek-ai/dsh-experimental-security-analysis/src/evolution-model.ts'
import type { EvolutionView } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import { Improvements, type ImprovementActions } from '../src/client/Improvements.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)
const t = makeTranslate(en, common)
const suggestion = evolutionProposalSchema.parse({ id: 'suggestion', revision: 1, status: 'open', title: 'Reusable parser',
  component: 'analysis scripts', conditions: 'Packet analysis', problem: 'Repeated parser implementation', change: 'Add a parser tool',
  acceptance: ['Two tasks reuse the tool'], uncertainty: 'Source inspection required', occurrences: [{ projectId: 'alpha', runId: 'run', version: 'fixture',
    source: { id: 'source', projectId: 'alpha', sessionId: 'session', seq: 1, kind: 'tool/call', excerpt: 'Manual parsing', truncated: false, recordedAt: 1 } }],
  receipts: [], needsReview: false, createdAt: 1, updatedAt: 1 })
function harness() {
  const view: EvolutionView = { revision: 2, proposals: [suggestion], runs: [] }
  let aborted = false
  const update = vi.fn(async (_input: string) => view)
  const api: ImprovementActions = {
    analyzeImprovements: vi.fn(async () => view), updateImprovement: update,
    exportImprovement: vi.fn(async () => ({ markdown: '# Coding task', proposal: '{}', receipt: '{}' })),
    notifyImprovement: vi.fn(), followImprovements: async function* (signal) {
      yield view
      if (!signal.aborted) await new Promise<void>((resolve) =>{  signal.addEventListener('abort', () => { aborted = true; resolve() }, { once: true }) })
    },
  }
  return { api, update, aborted: () => aborted }
}
it('browses evidence and submits an implementation receipt without verifying it', async () => {
  const { api, update } = harness()
  const rendered = render(<Improvements {...api} t={t} projectId="alpha" />)
  fireEvent.click(await screen.findByRole('button', { name: /Reusable parser/ }))
  expect(screen.getByText('Manual parsing')).toBeTruthy()
  fireEvent.change(screen.getByLabelText('Change summary'), { target: { value: 'Added shared parser' } })
  fireEvent.change(screen.getByLabelText('Test command'), { target: { value: 'test parser' } })
  fireEvent.change(screen.getByLabelText('Test result'), { target: { value: 'passed' } })
  fireEvent.submit(screen.getByRole('button', { name: 'Save implementation result' }).closest('form')!)
  await waitFor(() => { expect(update).toHaveBeenCalledTimes(1) })
  expect(JSON.parse(update.mock.calls[0]![0])).toMatchObject({ expectedRevision: 2, action: { kind: 'receipt', receipt: {
    proposalId: 'suggestion', summary: 'Added shared parser', tests: [{ command: 'test parser', result: 'passed' }],
  } } })
  expect(JSON.parse(update.mock.calls[0]![0])).toMatchObject({ action: { kind: 'receipt' } })
  rendered.unmount()
})
it('filters suggestions, requires an explicit verification action and releases its stream', async () => {
  const { api, update, aborted } = harness()
  const rendered = render(<Improvements {...api} t={t} />)
  fireEvent.click(await screen.findByRole('button', { name: /Reusable parser/ }))
  fireEvent.click(screen.getByRole('button', { name: 'Confirm verified' }))
  await waitFor(() => { expect(update).toHaveBeenCalledTimes(1) })
  expect(JSON.parse(update.mock.calls[0]![0])).toMatchObject({ action: { kind: 'status', proposalId: 'suggestion', status: 'verified' } })
  fireEvent.change(screen.getByLabelText('Improvement status'), { target: { value: 'ignored' } })
  expect(screen.getByText('No matching improvement suggestions')).toBeTruthy()
  rendered.unmount()
  expect(aborted()).toBe(true)
})
it('requests idle-time analysis without creating a source Agent', async () => {
  const { api } = harness()
  render(<Improvements {...api} t={t} projectId="alpha" />)
  await screen.findByRole('button', { name: /Reusable parser/ })
  fireEvent.click(screen.getByRole('button', { name: 'Find improvements now' }))
  await waitFor(() => { expect(api.analyzeImprovements).toHaveBeenCalledOnce() })
  expect(api.notifyImprovement).toHaveBeenCalledWith('Analysis queued')
})
