// @vitest-environment jsdom
/** Installation discovery does not require a selected project. @module */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { ToolboxDirectory } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import { Toolbox } from '../src/client/Toolbox.tsx'
import { zh } from '../src/client/locales.ts'
afterEach(cleanup)
it('shows installed tools, missing dependencies and manual installation references', async () => {
  const data: ToolboxDirectory = { environments: [{ id: 'local', label: 'Local', kind: 'local' }], inventory: {
    environmentId: 'local', kind: 'local', runtime: 'ready', detail: '', checkedAt: 0, workdir: '/workspace', tools: [
      { id: 'r2ghidra', category: 'reverse', status: 'available', command: 'radare2', version: '6.2', location: '/plugins/core', source: 'PATH',
        detail: '', dependency: 'radare2', invocation: 'plugin', installUrl: 'https://github.com/radareorg/r2ghidra' },
      { id: 'r2pipe', category: 'reverse', status: 'missing', command: 'python', version: '', location: '', source: 'PATH', detail: '',
        dependency: 'python', invocation: 'python', installUrl: 'https://github.com/radareorg/radare2-r2pipe' },
    ],
  } }
  const toolboxInventory = vi.fn(async () => data)
  render(<Toolbox toolboxInventory={toolboxInventory}
    toolboxConfiguration={async () => ({ editable: false, revision: '', tools: [] })}
    configureTool={async () => { throw new Error('Not configured in this fixture') }}
    toolboxFiles={async () => { throw new Error('Not configured in this fixture') }} t={makeTranslate(zh, commonZh)} />)
  expect(await screen.findByText('r2ghidra · 可用')).toBeTruthy()
  expect(screen.getByText('r2pipe · 未找到')).toBeTruthy()
  expect(screen.getAllByRole('link', { name: '手动安装说明' })).toHaveLength(2)
  await waitFor(() => { expect(screen.getByRole('button', { name: '刷新' }).hasAttribute('disabled')).toBe(false) })
  fireEvent.click(screen.getByRole('button', { name: '刷新' }))
  await waitFor(() => { expect(toolboxInventory).toHaveBeenCalledTimes(2) })
})
