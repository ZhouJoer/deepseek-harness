// @vitest-environment jsdom
import { deviceActions } from './device-fixture.client.ts'
/** Installation discovery does not require a selected project. @module */
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { ToolboxDirectory } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import { Toolbox } from '../src/client/Toolbox.tsx'
import { zh } from '../src/client/locales.ts'
import { builtinToolPack } from '../../security-analysis/src/builtin-tools.ts'
afterEach(cleanup)
it('browses overlapping domains without probing or changing session preferences', async () => {
  const data: ToolboxDirectory = { environments: [{ id: 'local', label: 'Local', kind: 'local' }], inventory: {
    environmentId: 'local', kind: 'local', runtime: 'unchecked', detail: '', checkedAt: 0, workdir: '/workspace',
    tools: builtinToolPack.tools.map(tool => ({ id: tool.id, category: tool.category, invocation: tool.invocation,
      status: 'not-checked', command: '', version: '', location: '', source: 'PATH', detail: '', installUrl: '' })),
  } }
  const probe = vi.fn(async () => data)
  render(<Toolbox {...deviceActions} toolboxDirectory={async () => data} toolboxInventory={probe}
    scriptCatalog={async () => []} t={makeTranslate(zh, commonZh)}
    toolCatalog={async () => ({ editable: false, revision: '', tools: builtinToolPack.tools, packs: [builtinToolPack], collections: builtinToolPack.collections })}
    previewToolPack={async () => { throw new Error('Unused') }} importToolPack={async () => { throw new Error('Unused') }} exportToolPack={async () => ''}
    toolboxConfiguration={async () => ({ editable: false, revision: '', tools: [] })}
    configureTool={async () => { throw new Error('Unused') }} toolboxFiles={async () => { throw new Error('Unused') }} />)
  await screen.findByText('tshark · 未检查')
  fireEvent.click(screen.getByRole('button', { name: 'IoT' }))
  expect(screen.getByText('tshark · 未检查')).toBeDefined()
  expect(screen.getByText('radare2 · 未检查')).toBeDefined()
  expect(screen.queryByText('nuclei · 未检查')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Web 工具' }))
  expect(screen.getByText('curl · 未检查')).toBeDefined()
  expect(screen.queryByText('radare2 · 未检查')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '逆向' }))
  expect(screen.getByText('radare2 · 未检查')).toBeDefined()
  fireEvent.click(screen.getByRole('button', { name: '通用工具' }))
  expect(screen.getByText('python · 未检查')).toBeDefined()
  fireEvent.click(screen.getByRole('button', { name: '全部' }))
  fireEvent.change(screen.getByLabelText(zh.toolPurposeSearch), { target: { value: 'unregistered-purpose' } })
  expect(screen.getByText(zh.toolNoMatches)).toBeDefined()
  expect(probe).not.toHaveBeenCalled()
})
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
  render(<Toolbox {...deviceActions} toolboxInventory={toolboxInventory} toolboxDirectory={async () => data}
    scriptCatalog={async () => []}
    toolCatalog={async () => ({ editable: false, revision: '', tools: [], packs: [], collections: [] })}
    previewToolPack={async () => { throw new Error('Unused') }} importToolPack={async () => { throw new Error('Unused') }} exportToolPack={async () => ''}
    toolboxConfiguration={async () => ({ editable: false, revision: '', tools: [] })}
    configureTool={async () => { throw new Error('Not configured in this fixture') }}
    toolboxFiles={async () => { throw new Error('Not configured in this fixture') }} t={makeTranslate(zh, commonZh)} />)
  expect(await screen.findByText('r2ghidra · 可用')).toBeTruthy()
  expect(screen.getByText('r2pipe · 未找到')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: zh.toolDomainReverse }))
  expect(screen.getByText('r2pipe · 未找到')).toBeTruthy()
  expect(screen.getAllByRole('link', { name: '手动安装说明' })).toHaveLength(2)
  await waitFor(() => { expect(screen.getByRole('button', { name: '刷新' }).hasAttribute('disabled')).toBe(false) })
  fireEvent.click(screen.getByRole('button', { name: '刷新' }))
  expect(toolboxInventory).not.toHaveBeenCalled()
  await waitFor(() => { expect(screen.getByRole('button', { name: '检测筛选结果' }).hasAttribute('disabled')).toBe(false) })
  fireEvent.click(screen.getByRole('button', { name: '检测筛选结果' }))
  await waitFor(() => { expect(toolboxInventory).toHaveBeenCalledWith('local', ['r2pipe']) })
})
