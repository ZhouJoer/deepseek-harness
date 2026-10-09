// @vitest-environment jsdom
/** Coverage stays revision-bound; report preparation follows the current selection. @module */
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as common } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { deriveProjectCoverage } from '@deepseek-ai/dsh-experimental-security-analysis/src/workbench/coverage.ts'
import { CoveragePanel } from '../src/client/CoveragePanel.tsx'
import { ReportExportButton } from '../src/client/ReportExportButton.tsx'
import { en } from '../src/client/locales.ts'
import { investigationFixture } from './investigation-fixture.client.ts'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
const t = makeTranslate(en, common)

it('hides outdated coverage and opens the explicitly selected blocked check', () => {
  const view = investigationFixture()
  const coverage = deriveProjectCoverage(view.records, view.revision)
  const openCheck = vi.fn(), openEvidence = vi.fn()
  const props = { coverage, evidence: view.records.filter(item => item.kind === 'evidence'),
    revision: view.revision + 1, disabled: false, openCheck, openEvidence, t }
  const ui = render(<CoveragePanel {...props} />)
  expect(screen.queryByText('Check ownership')).toBeNull()
  ui.rerender(<CoveragePanel {...props} revision={view.revision} />)
  fireEvent.click(screen.getByRole('button', { name: en.coverageResolve }))
  expect(openCheck).toHaveBeenCalledWith('verify')
  expect(screen.queryByText(/100%/)).toBeNull()
  expect(screen.getByRole('heading', { name: 'Invoice service' })).toBeDefined()
  fireEvent.click(screen.getByRole('checkbox'))
  expect(screen.queryByText('Read handler')).toBeNull()
  expect(screen.getByText('Check ownership')).toBeDefined()
})

it('cancels preparation on report changes and downloads only the current selection', async () => {
  const stale = Promise.withResolvers<Response>()
  const fetcher = vi.fn<typeof fetch>().mockImplementationOnce(() => stale.promise).mockResolvedValue(new Response(null))
  vi.stubGlobal('fetch', fetcher)
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  const notify = vi.fn()
  const ui = render(<ReportExportButton projectId="project" reportId="old" notify={notify} t={t} />)
  fireEvent.click(screen.getByRole('button'))
  const signal = fetcher.mock.calls[0]?.[1]?.signal
  ui.rerender(<ReportExportButton projectId="project" reportId="new" notify={notify} t={t} />)
  expect(signal?.aborted).toBe(true)
  await act(async () => { stale.resolve(new Response(null)); await stale.promise })
  expect(click).not.toHaveBeenCalled()
  await act(async () => { fireEvent.click(screen.getByRole('button')) })
  expect(fetcher.mock.calls[1]?.[0]).toContain('reportId=new')
  expect(click).toHaveBeenCalledOnce()
  expect(notify).toHaveBeenCalledWith(en.exportStarted)
})

it('reports unavailable evidence without starting a ZIP download', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 413 })))
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  const notify = vi.fn()
  render(<ReportExportButton projectId="project" reportId="report" notify={notify} t={t} />)
  await act(async () => { fireEvent.click(screen.getByRole('button')) })
  expect(click).not.toHaveBeenCalled()
  expect(notify).toHaveBeenCalledWith(en.exportFailed)
})
