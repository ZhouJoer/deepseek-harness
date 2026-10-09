// @vitest-environment jsdom
/** Technical identifiers remain available through explicit disclosure and copying. @module */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { TechnicalDetails } from '../src/client/TechnicalDetails.tsx'
import { en, zh } from '../src/client/locales.ts'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

it('keeps metadata collapsed and copies complete JSON after opening it', async () => {
  const writeText = vi.fn(async () => {})
  vi.stubGlobal('navigator', { clipboard: { writeText } })
  const value = { id: 'evidence-id', sha256: 'a'.repeat(64), source: { sessionId: 'session', callId: 'call' } }
  render(<TechnicalDetails t={makeTranslate(en)} value={value} />)
  const summary = screen.getByText('Technical details')
  const details = summary.closest('details')!
  expect(details.open).toBe(false)
  fireEvent.click(summary)
  fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
  await waitFor(() => { expect(writeText).toHaveBeenCalledExactlyOnceWith(JSON.stringify(value, null, 2)) })
  expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy()
})

it('accepts an owner-specific disclosure label with localized copy actions', () => {
  render(<TechnicalDetails t={makeTranslate(zh)} value={{ id: 'plan' }} summary={zh.planTechnicalDetails} />)
  fireEvent.click(screen.getByText(zh.planTechnicalDetails))
  expect(screen.getByRole('button', { name: zh.markdownCopy })).toBeTruthy()
})
