// @vitest-environment jsdom
/** User-owned analysis intake, submission retry and explicit environment choice. @module */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { AnalysisStart, type AnalysisStartProps } from '../src/client/AnalysisStart.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
function setup(local = true) {
  const prepare = vi.fn<AnalysisStartProps['prepare']>(async () => {})
  const send = vi.fn(async (_objective: string) => {})
  const started = vi.fn()
  render(<AnalysisStart t={makeTranslate(zh, commonZh)} disabled={false}
    environments={[{ id: 'container', label: 'Container', kind: 'docker' },
      ...(local ? [{ id: 'host', label: 'Host', kind: 'local' }] : [])]}
    limits={{ bytes: 1024, entries: 10 }} prepare={prepare} send={send} started={started} />)
  return { prepare, send, started }
}
it('stages selected material and uses the local environment without a task name or workspace form', async () => {
  const api = setup()
  fireEvent.click(screen.getByRole('button', { name: zh.pasteText }))
  fireEvent.change(screen.getByLabelText(zh.materialText), { target: { value: 'print(42)' } })
  fireEvent.click(screen.getByRole('button', { name: zh.addText }))
  await screen.findByText(zh.pastedMaterial, { exact: false })
  expect(api.prepare).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText(zh.analysisRequest), { target: { value: 'Explain this code' } })
  fireEvent.click(screen.getByRole('button', { name: zh.startAnalysis }))
  await waitFor(() => { expect(api.started).toHaveBeenCalledOnce() })
  expect(api.prepare.mock.calls[0]?.[0]).toMatchObject({ material: { kind: 'text', name: 'notes.txt', text: 'print(42)' },
    title: zh.pastedMaterial, objective: 'Explain this code', environmentId: 'host' })
  expect(api.send).toHaveBeenCalledWith('Explain this code')
})
it('retries failed submission without creating another task or importing material twice', async () => {
  const api = setup()
  api.send.mockRejectedValueOnce(new Error('Connection unavailable'))
  fireEvent.change(screen.getByLabelText(zh.analysisRequest), { target: { value: 'Analyze the supplied program' } })
  fireEvent.click(screen.getByRole('button', { name: zh.startAnalysis }))
  await screen.findByRole('alert')
  expect(api.started).not.toHaveBeenCalled()
  expect(screen.getByLabelText(zh.analysisRequest).hasAttribute('disabled')).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: zh.retryAnalysis }))
  await waitFor(() => { expect(api.started).toHaveBeenCalledOnce() })
  expect(api.prepare).toHaveBeenCalledOnce()
  expect(api.send).toHaveBeenCalledTimes(2)
})
it('requires an explicit nonlocal choice and never submits after an import failure', async () => {
  const api = setup(false)
  fireEvent.change(screen.getByLabelText(zh.analysisRequest), { target: { value: 'Inspect sample' } })
  expect(screen.getByRole('button', { name: zh.startAnalysis }).hasAttribute('disabled')).toBe(true)
  fireEvent.click(screen.getByText(zh.analysisOptions))
  fireEvent.change(screen.getByLabelText(zh.environment), { target: { value: 'container' } })
  api.prepare.mockRejectedValueOnce(new Error('Material exceeds limit'))
  fireEvent.click(screen.getByRole('button', { name: zh.startAnalysis }))
  await screen.findByRole('alert')
  expect(api.send).not.toHaveBeenCalled()
  expect(api.started).not.toHaveBeenCalled()
})
