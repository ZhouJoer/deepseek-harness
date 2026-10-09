// @vitest-environment jsdom
/** Plan approval and actual execution are distinct operator decisions and outcomes. @module */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as common } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { validationPlanSchema, recordSchema } from '@deepseek-ai/dsh-experimental-security-analysis/src/workbench/model.ts'
import { PlanReview } from '../src/client/PlanReview.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
const plan = validationPlanSchema.parse({ id: 'plan', engagementId: 'project', checkId: 'check',
  hypothesis: '**Inspect the owned fixture**', expectedObservation: 'Recorded output', impact: 'Read only', cleanup: 'Remove container',
  durationMs: 1000, hash: 'a'.repeat(64), environmentHash: 'b'.repeat(64), status: 'approved',
  operation: { provider: 'offline', operation: 'python', environmentId: 'local', assetId: 'sample', parameters: {}, impact: 'observe' },
})
it('shows actual container execution and labels the summary without exposing technical details by default', () => {
  render(<PlanReview t={makeTranslate(zh, common)} plan={plan} view={{ revision: 1, records: [] }}
    environment="Local reverse analysis" busy={false} disabled={false}
    approve={vi.fn()} revoke={vi.fn()} execute={vi.fn()} preview={vi.fn()} />)
  expect(screen.getByText('Inspect the owned fixture').tagName).toBe('STRONG')
  expect(screen.getByText(zh.planOfflineRuntime)).toBeDefined()
  expect(screen.getByText(zh.planOfflineLimits)).toBeDefined()
  const details = screen.getByText(zh.planTechnicalDetails).closest('details')!
  expect(details.open).toBe(false)
  expect(details.contains(screen.getByText('a'.repeat(64)))).toBe(true)
  fireEvent.click(screen.getByText(zh.planTechnicalDetails))
  expect(details.open).toBe(true)
})
it('keeps approval visible while explaining a saved execution failure and its recovery', () => {
  const failure = recordSchema.parse({ kind: 'execution', value: { id: 'execution', engagementId: 'project', assetId: 'sample',
    planId: 'plan', status: 'failed', detail: 'FileNotFoundError: /tmp/E:/workspace/check.py' } })
  render(<PlanReview t={makeTranslate(zh, common)} plan={plan} view={{ revision: 2, records: [failure] }}
    environment="Local reverse analysis" busy={false} disabled={false}
    approve={vi.fn()} revoke={vi.fn()} execute={vi.fn()} preview={vi.fn()} />)
  expect(screen.getByText(zh.approved)).toBeDefined()
  expect(screen.getByRole('alert').textContent).toContain(zh.failed)
  expect(screen.getByRole('alert').textContent).toContain(zh.planOfflineMissingFile)
  expect(screen.getByText(zh.planExecutionDetails).closest('details')?.open).toBe(false)
})
it('shows native permissions, interpreter and working directory before approval', () => {
  const native = validationPlanSchema.parse({ ...plan, status: 'draft', operation: { ...plan.operation,
    provider: 'native', impact: 'target-write', parameters: { platform: 'win32', python: 'C:/Python/python.exe', version: '3.12.1', cwd: 'E:/analysis' } } })
  render(<PlanReview t={makeTranslate(zh, common)} plan={native} view={{ revision: 1, records: [] }}
    environment="Local reverse analysis" busy={false} disabled={false}
    approve={vi.fn()} revoke={vi.fn()} execute={vi.fn()} preview={vi.fn()} />)
  expect(screen.getByText(zh.planNativeRuntime)).toBeDefined()
  expect(screen.getByText(zh.planNativeLimits)).toBeDefined()
  expect(screen.getByText('E:/analysis')).toBeDefined()
  expect(screen.getByText('C:/Python/python.exe (3.12.1)')).toBeDefined()
  expect(screen.queryByText(zh.planOfflineLimits)).toBeNull()
})
