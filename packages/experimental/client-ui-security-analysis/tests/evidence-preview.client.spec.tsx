// @vitest-environment jsdom
/** Source excerpts do not require reading hashes embedded in provider JSON. @module */
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { en as common } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { EvidencePreview } from '../src/client/EvidencePreview.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)
it('shows file lines and keeps the exact saved JSON available inside closed technical details', () => {
  const text = JSON.stringify({ snapshot: 'a'.repeat(64), items: [{ path: 'invoice.js', sha256: 'b'.repeat(64), line: 4, text: 'return invoices.get(id)' }] })
  const rendered = render(<EvidencePreview text={text} provider="source" t={makeTranslate(en, common)} />)
  expect(screen.getByRole('heading', { name: 'invoice.js' })).toBeTruthy()
  expect(screen.getByText('4: return invoices.get(id)')).toBeTruthy()
  const detail = rendered.container.querySelector('details')!
  expect(detail.open).toBe(false)
  expect(detail.textContent).toContain('a'.repeat(64))
  const readable = rendered.container.cloneNode(true) as HTMLElement
  readable.querySelector('details')?.remove()
  expect(readable.textContent).not.toContain('a'.repeat(64))
  expect(readable.textContent).not.toContain('b'.repeat(64))
})

it('keeps clipped structured output folded without discarding it', () => {
  const text = '{"snapshot":"partial'
  const rendered = render(<EvidencePreview text={text} provider="source" t={makeTranslate(en, common)} />)
  expect(rendered.container.querySelector('details')?.open).toBe(false)
  expect(rendered.container.textContent).toContain('partial')
})
