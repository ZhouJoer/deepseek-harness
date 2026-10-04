// @vitest-environment jsdom
/** Security tool cards reveal concise judgments before raw details. */
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { SecurityToolRow } from '../src/client/SecurityToolRow.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
it.each(['preparing', 'start'] as const)('shows the running state during %s without reading result content', (phase) => {
  const props = { phase, block: { phase, callId: 'pending', name: 'security_static' },
    callId: 'pending', toolName: 'security_static', t: makeTranslate(zh),
  } as Parameters<typeof SecurityToolRow>[0]
  const view = render(<SecurityToolRow {...props} />)
  expect(view.getByText(zh.toolRunning)).toBeTruthy()
  expect(view.queryByText('技术详情')).toBeNull()
})
it('shows a short static result while keeping its raw record collapsed', () => {
  const block: ToolResultNode = { kind: 'tool-result', seq: 1, time: 1, callId: 'static',
    call: { name: 'security_static', argsRaw: '{}' }, callTime: 0, isError: false, subCalls: [],
    content: [{ type: 'text', text: JSON.stringify({ summary: '发现可控长度进入拷贝', evidenceId: 'private-id',
      details: 'raw'.repeat(200) }) }] }
  const props = { phase: 'result', block, callId: 'static', toolName: 'security_static', openFile: vi.fn(), loadImage: vi.fn(),
    t: makeTranslate(zh) } as Parameters<typeof SecurityToolRow>[0]
  const view = render(<SecurityToolRow {...props} />)
  expect(view.getByText('静态分析')).toBeTruthy()
  expect(view.getByText('发现可控长度进入拷贝')).toBeTruthy()
  const raw = view.getByText(/private-id/u)
  expect(raw.closest('details')?.open).toBe(false)
  fireEvent.click(view.getByText('技术详情'))
  expect(raw.closest('details')?.open).toBe(true)
})

it.each([false, true])('distinguishes dispatch from completion and preserves dispatch errors (error=%s)', (isError) => {
  const block: ToolResultNode = { kind: 'tool-result', seq: 1, time: 1, callId: 'delegate',
    call: { name: 'security_delegate', argsRaw: '{}' }, callTime: 0, isError, subCalls: [],
    content: [{ type: 'text', text: JSON.stringify(isError ? { error: 'Capacity reached' } : { jobId: 'job' }) }] }
  const props = { phase: 'result', block, callId: 'delegate', toolName: 'security_delegate', openFile: vi.fn(), loadImage: vi.fn(),
    t: makeTranslate(zh) } as Parameters<typeof SecurityToolRow>[0]
  const view = render(<SecurityToolRow {...props} />)
  expect(view.getByText(isError ? zh.toolFailed : zh.toolDispatched)).toBeTruthy()
  expect(view.queryByText(zh.toolDone)).toBeNull()
})
