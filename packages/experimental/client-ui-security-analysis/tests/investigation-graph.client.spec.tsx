// @vitest-environment jsdom
/** Keyboard-readable graph details resolve evidence without exposing technical identifiers. @module */
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as common } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { InvestigationGraph } from '../src/client/InvestigationGraph.tsx'
import { en } from '../src/client/locales.ts'
import { investigationFixture } from './investigation-fixture.client.ts'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('opens a finding and its original observation in two selections without changing the project', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  const read = vi.fn(async () => JSON.stringify({ text: 'invoice.owner is never compared', truncated: true }))
  const view = investigationFixture()
  render(<InvestigationGraph view={view} project="project" t={makeTranslate(en, common)} projectArtifact={read}
    activity={{ usage: [], briefs: [], connected: true, error: '', retry: vi.fn() }} openChild={vi.fn()} openPlans={vi.fn()} />)
  expect(read).not.toHaveBeenCalled()
  const finding = screen.getAllByRole('button').find(button => button.textContent?.startsWith('Finding'))!
  fireEvent.click(finding)
  const detail = screen.getByRole('complementary', { name: 'Investigation details' })
  expect(detail.textContent).toContain('Runtime reachability unverified')
  expect(detail.textContent).toContain('Related record unavailable')
  fireEvent.click(within(detail).getByRole('button', { name: /Handler source/ }))
  await screen.findByText('invoice.owner is never compared')
  expect(read).toHaveBeenCalledTimes(1)
  expect(read).toHaveBeenCalledWith('project', 'a'.repeat(64))
  expect(within(detail).getByText('Static observation', { exact: false })).toBeTruthy()
  expect(within(detail).getByText('Technical details').closest('details')?.open).toBe(false)
})

it('retains the selected record through updates and discards a late preview after switching observations', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  const pending = Promise.withResolvers<string>()
  const props = { view: investigationFixture(), project: 'project', t: makeTranslate(en, common), projectArtifact: vi.fn(() => pending.promise),
    activity: { usage: [], briefs: [], connected: true, error: '', retry: vi.fn() }, openChild: vi.fn(), openPlans: vi.fn() }
  const mounted = render(<InvestigationGraph {...props} />)
  fireEvent.click(screen.getByRole('button', { name: /Partial response/ }))
  fireEvent.click(screen.getByRole('button', { name: /Check.*Check ownership/ }))
  mounted.rerender(<InvestigationGraph {...props} view={{ ...props.view, revision: 6 }} />)
  const detail = screen.getByRole('complementary')
  expect(within(detail).getByRole('heading', { name: 'Check ownership' })).toBeTruthy()
  pending.resolve(JSON.stringify({ text: 'Late old preview', truncated: false }))
  await Promise.resolve()
  expect(within(detail).queryByText('Late old preview')).toBeNull()
})

it('keeps an explicitly focused observation visible and explains a binary preview', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  render(<InvestigationGraph view={investigationFixture()} project="project" t={makeTranslate(en, common)}
    projectArtifact={async () => JSON.stringify({ text: '', truncated: false, binary: true })}
    activity={{ usage: [], briefs: [], connected: true, error: '', retry: vi.fn() }} openChild={vi.fn()} openPlans={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: /Finding.*Missing ownership check/ }))
  const detail = screen.getByRole('complementary')
  fireEvent.click(within(detail).getByRole('button', { name: /Handler source/ }))
  await screen.findByText(en.graphBinary)
  fireEvent.click(within(detail).getByRole('button', { name: en.graphFocus }))
  expect(screen.getByRole('button', { name: /^Observation.*Handler source/ })).toBeTruthy()
  fireEvent.keyDown(detail, { key: 'Escape' })
  expect(screen.queryByRole('complementary')).toBeNull()
})
