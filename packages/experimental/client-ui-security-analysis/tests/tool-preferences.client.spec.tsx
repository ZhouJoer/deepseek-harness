// @vitest-environment jsdom
/** Explicit preferences apply only to the addressed active session. @module */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { ToolPreferences as Preferences } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ToolPreferences } from '../src/client/ToolPreferences.tsx'
import { builtinToolPack } from '../../security-analysis/src/builtin-tools.ts'
import { zh } from '../src/client/locales.ts'
afterEach(cleanup)
it('opens without a probe, applies a soft collection preference and restores automatic discovery', async () => {
  const action = vi.fn(async (_id: SessionId, input?: string) => input
    ? JSON.parse(input) as Preferences : { toolIds: [], collectionIds: [], tags: [] })
  render(<ToolPreferences sessionId={SessionId('preference-session')} t={makeTranslate(zh, commonZh)} toolPreferences={action}
    toolCatalog={async () => ({ editable: false, revision: '', packs: [builtinToolPack], tools: builtinToolPack.tools, collections: builtinToolPack.collections })} />)
  const details = screen.getByText('本次会话工具偏好').closest('details')!
  fireEvent(details, new Event('toggle'))
  details.open = true
  fireEvent(details, new Event('toggle'))
  const firmware = await screen.findByRole('checkbox', { name: 'Firmware and native binaries' })
  fireEvent.click(firmware)
  fireEvent.click(screen.getByRole('button', { name: '应用到本次会话' }))
  await screen.findByText('已应用，将在下一次模型请求中生效。')
  expect(action).toHaveBeenLastCalledWith('preference-session', JSON.stringify({ toolIds: [], collectionIds: ['firmware'], tags: [] }))
  fireEvent.click(screen.getByRole('button', { name: '恢复自动发现' }))
  await waitFor(() => { expect(action).toHaveBeenLastCalledWith('preference-session', JSON.stringify({ toolIds: [], collectionIds: [], tags: [] })) })
})
