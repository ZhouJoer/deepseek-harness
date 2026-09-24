// @vitest-environment jsdom
/** Security tool cards reveal concise judgments before raw details. */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { SecurityToolRow } from '../src/client/SecurityToolRow.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
it('shows a short static result while keeping its raw record collapsed', () => {
  const block: ToolResultNode = { kind: 'tool-result', seq: 1, time: 1, callId: 'static',
    call: { name: 'security_static', argsRaw: '{}' }, callTime: 0, isError: false, subCalls: [],
    content: [{ type: 'text', text: JSON.stringify({ summary: '发现可控长度进入拷贝', evidenceId: 'private-id',
      details: 'raw'.repeat(200) }) }] }
  const props = { block, callId: 'static', toolName: 'security_static', openFile: vi.fn(), loadImage: vi.fn(),
    t: makeTranslate(zh) } as unknown as Parameters<typeof SecurityToolRow>[0]
  const view = render(<SecurityToolRow {...props} />)
  expect(view.getByText('静态分析')).toBeTruthy()
  expect(view.getByText('发现可控长度进入拷贝')).toBeTruthy()
  const raw = view.getByText(/private-id/u)
  expect(raw.closest('details')?.open).toBe(false)
  fireEvent.click(view.getByText('技术详情'))
  expect(raw.closest('details')?.open).toBe(true)
})
