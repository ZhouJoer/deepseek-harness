// @vitest-environment jsdom
/** Operator gestures, authoritative state and stale-session isolation. @module */
import { afterEach, it, expect, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SecurityCommand, WorkbenchView } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import { recordSchema } from '@deepseek-ai/dsh-experimental-security-analysis/src/workbench/model.ts'
import { Workbench, type WorkbenchActions, type WorkbenchProps } from '../src/client/Workbench.tsx'
import { Projects } from '../src/client/Projects.tsx'
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)
const project = recordSchema.parse({ kind: 'engagement', value: { id: 'project', title: 'Owned lab', objective: 'Review the sample', environmentIds: ['local'], stopped: false, maxAttempts: 3 } })
const view: WorkbenchView = { revision: 8, records: [project] }
function actions(overrides: Partial<WorkbenchActions> = {}) {
  return {
    observe: vi.fn(async () => view),
    subscribeReset: () => () => {},
    refine: vi.fn(async () => view), load: vi.fn(async () => view), command: vi.fn(async () => view),
    configuration: vi.fn(async () => JSON.stringify({ environments: [{ id: 'local', label: 'Lab', tools: [], kind: 'local' }], providers: [] })),
    configureWorkspace: vi.fn(async () => '{}'),
    environment: vi.fn(async () => '{}'), execute: vi.fn(async () => view), search: vi.fn(async () => ({ revision: 8, records: [] })),
    artifact: vi.fn(async () => '{}'), report: vi.fn(async () => '# Target security\n\n## Key risk\n- Password exposure'), ...overrides,
  }
}
function props(api: WorkbenchActions, sessionId = 'parent', running = false): WorkbenchProps {
  return { ...api, sessionId: sessionId as SessionId, t: makeTranslate(zh, commonZh),
    useSession: (select: (snapshot: { running: boolean }) => unknown) => select({ running }),
  } as unknown as WorkbenchProps
}
it('clears checks and findings after leaving, then exposes project creation', async () => {
  const check = recordSchema.parse({ kind: 'check', value: { id: 'check', engagementId: 'project', assetId: 'sample',
    title: 'Old check', phase: 'recon', criterion: 'Inspect sample', dependencies: [], evidenceIds: [],
    status: 'planned', attempts: 0, rationale: '' } })
  const finding = recordSchema.parse({ kind: 'finding', value: { id: 'finding', engagementId: 'project', assetId: 'sample',
    title: 'Old finding', explanation: 'Prior analysis', status: 'suspected', evidenceIds: ['evidence'],
    conditions: 'Prior sample', review: '' } })
  const prior = { revision: 8, records: [project, check, finding] }
  const empty = { revision: 9, records: [] }
  const api = actions({
    load: vi.fn(async () => prior),
    command: vi.fn<WorkbenchActions['command']>(async (_id, input) =>
      (JSON.parse(input) as SecurityCommand).action.kind === 'leave' ? empty : prior),
    configuration: vi.fn(async () => JSON.stringify({ projects: [{ id: 'project', title: 'Owned lab' }],
      environments: [{ id: 'local', label: 'Lab', kind: 'local', tools: [] }], providers: [] })),
  })
  render(<Workbench {...props(api)} />)
  fireEvent.click(screen.getByRole('button', { name: '安全分析' }))
  await screen.findByRole('heading', { name: 'Review the sample' })
  expect(screen.getByText('手动设置与项目切换').closest('details')?.open).toBe(false)
  fireEvent.click(screen.getByText('高级详情'))
  fireEvent.click(screen.getByRole('button', { name: '检查' }))
  expect(screen.getByText('Old check')).toBeDefined()
  fireEvent.click(screen.getByRole('button', { name: '退出当前项目' }))
  await screen.findByRole('heading', { name: '直接在对话中描述你的任务' })
  expect(screen.getByText('已退出项目的对话需在手动设置中创建或选择项目，也可新建对话布置任务。')).toBeDefined()
  fireEvent.click(screen.getByText('手动设置与项目切换'))
  expect(screen.getByRole('button', { name: '创建项目' })).toBeDefined()
  fireEvent.click(screen.getByRole('button', { name: '检查' }))
  expect(screen.queryByText('Old check')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '发现' }))
  expect(screen.queryByText('Old finding')).toBeNull()
  expect((JSON.parse(vi.mocked(api.command).mock.calls[0]![1]) as SecurityCommand).action).toEqual({ kind: 'leave' })
})

it('renders saved Markdown reports from the report read API in both project views', async () => {
  const artifact = { sha256: 'a'.repeat(64), size: 20, mediaType: 'text/markdown' }
  const saved = recordSchema.parse({ kind: 'report', value: { id: 'brief', engagementId: 'project', revision: 8,
    markdown: artifact, json: { ...artifact, mediaType: 'application/json' }, createdAt: 1 } })
  const projectView = { ...view, records: [project, saved] }
  const report = vi.fn(async () => '# Target security\n\n## Key risk\n- Password exposure')
  const api = actions({ load: vi.fn(async () => projectView), report })
  const workbench = render(<Workbench {...props(api)} />)
  fireEvent.click(screen.getByRole('button', { name: '安全分析' }))
  await screen.findByRole('heading', { name: 'Review the sample' })
  fireEvent.click(screen.getByRole('button', { name: '报告' }))
  fireEvent.click(screen.getByRole('button', { name: 'Markdown 报告' }))
  await screen.findByRole('heading', { name: 'Target security' })
  expect(report).toHaveBeenCalledWith('project', 'brief', 'markdown')
  expect(api.artifact).not.toHaveBeenCalled()
  workbench.unmount()

  const projectProps = { projects: async () => JSON.stringify([{ id: 'project', title: 'Owned lab' }]),
    project: async () => projectView, laboratory: async () => projectView, report,
    subscribeReset: () => () => {}, t: makeTranslate(zh, commonZh) } as unknown as Parameters<typeof Projects>[0]
  render(<Projects {...projectProps} />)
  await screen.findByRole('option', { name: 'Owned lab' })
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'project' } })
  fireEvent.click(screen.getByRole('button', { name: '报告' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Markdown 报告' }))
  await screen.findByRole('heading', { name: 'Target security' })
})

it('keeps authoritative project state when an evidence search returns no matches', async () => {
  const api = actions()
  render(<Workbench {...props(api)} />)
  fireEvent.click(screen.getByRole('button', { name: '安全分析' }))
  await screen.findByRole('heading', { name: 'Review the sample' })
  fireEvent.click(screen.getByRole('button', { name: '证据' }))
  fireEvent.change(screen.getByLabelText('关键词'), { target: { value: 'absent' } })
  fireEvent.click(screen.getByRole('button', { name: '搜索' }))
  await waitFor(() =>{  expect(api.search).toHaveBeenCalledWith('parent', 'absent', false) })
  fireEvent.click(screen.getByRole('button', { name: '停止项目' }))
  await waitFor(() =>{  expect(api.command).toHaveBeenCalled() })
  const call = vi.mocked(api.command).mock.calls[0]
  expect(JSON.parse(call?.[1] ?? '{}')).toMatchObject({ expectedRevision: 8, action: { kind: 'stop' } })
})
it('does not reveal an old project when its request completes after changing Sessions', async () => {
  let release!: (value: WorkbenchView) => void
  const pending = new Promise<WorkbenchView>((resolve) => { release = resolve })
  const api = actions({ load: vi.fn(() => pending) })
  const rendered = render(<Workbench {...props(api)} />)
  fireEvent.click(screen.getByRole('button', { name: '安全分析' }))
  rendered.rerender(<Workbench {...props(api, 'other')} />)
  release(view)
  await waitFor(() =>{  expect(screen.queryByRole('dialog')).toBeNull() })
  expect(screen.queryByText('Review the sample')).toBeNull()
})
it('submits explicit approval for the displayed plan identity', async () => {
  const plan = recordSchema.parse({ kind: 'plan', value: { id: 'plan', engagementId: 'project', checkId: 'check', hypothesis: 'Check bounds', expectedObservation: 'A bounded observation', impact: 'Existing process instrumentation', cleanup: 'Unload and detach', durationMs: 100,
    operation: { provider: 'frida', operation: 'modules', environmentId: 'local', assetId: 'sample', parameters: {}, impact: 'observe' }, hash: 'a'.repeat(64), environmentHash: 'b'.repeat(64), status: 'draft' } })
  const api = actions({ load: vi.fn(async () => ({ ...view, records: [project, plan] })) })
  render(<Workbench {...props(api)} />)
  fireEvent.click(screen.getByRole('button', { name: '安全分析' }))
  await screen.findByRole('heading', { name: 'Review the sample' })
  fireEvent.click(screen.getByRole('button', { name: '发现' }))
  expect(screen.getByText('a'.repeat(64))).toBeDefined()
  fireEvent.click(screen.getByRole('button', { name: '批准此版本' }))
  await waitFor(() =>{  expect(api.command).toHaveBeenCalled() })
  expect(JSON.parse(vi.mocked(api.command).mock.calls[0]?.[1] ?? '{}')).toMatchObject({ expectedRevision: 8, action: { kind: 'approve', planId: 'plan' } })
})

it('reuses the configured local image through an explicit operator gesture', async () => {
  const laboratory = vi.fn(async () => view)
  const projectProps = { projects: async () => JSON.stringify([{ id: 'project', title: 'Owned lab' }]), project: async () => view,
    laboratory, report: async () => '', subscribeReset: () => () => {}, t: makeTranslate(zh, commonZh) } as unknown as Parameters<typeof Projects>[0]
  render(<Projects {...projectProps} />)
  await screen.findByRole('option', { name: 'Owned lab' })
  await waitFor(() => { expect(screen.getByRole('combobox').hasAttribute('disabled')).toBe(false) })
  fireEvent.change(screen.getByRole('combobox'), { target: { value: 'project' } })
  fireEvent.click(screen.getByRole('button', { name: '工具箱与靶场' }))
  await waitFor(() => { expect(screen.getByRole('button', { name: '复用本地 Kali 镜像' }).hasAttribute('disabled')).toBe(false) })
  expect(laboratory).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '复用本地 Kali 镜像' }))
  await waitFor(() => { expect(laboratory).toHaveBeenCalledWith('project', 'reuse', '') })
})

it('separates concise knowledge cards from legacy text and evidence', async () => {
  const note = recordSchema.parse({ kind: 'knowledge', value: { id: 'note', engagementId: 'project', title: 'Bounds', content: 'old reasoning', conditions: 'parsers', tags: [], evidenceIds: ['raw-evidence'], published: false,
    entry: { category: 'experience', title: 'Bounds', summary: 'Validate lengths.', conditions: 'Binary parsers', actions: ['Check bytes'], pitfalls: [], tags: ['parsing'] } } })
  const legacy = recordSchema.parse({ kind: 'knowledge', value: { id: 'legacy', engagementId: 'project', title: 'Unrefined', content: 'private chain of thought', conditions: 'parsers', tags: [], evidenceIds: [], published: false } })
  const api = actions({ load: vi.fn(async () => ({ revision: 8, records: [project, note, legacy] })) })
  render(<Workbench {...props(api)} />)
  fireEvent.click(screen.getByRole('button', { name: '安全分析' }))
  await screen.findByRole('heading', { name: 'Review the sample' })
  fireEvent.click(screen.getByText('高级详情'))
  fireEvent.click(screen.getByRole('button', { name: '复盘与经验' }))
  fireEvent.click(screen.getByRole('button', { name: /经验 1/ }))
  expect(screen.getByText('Validate lengths.')).toBeDefined()
  expect(screen.queryByText('private chain of thought')).toBeNull()
  expect(screen.queryByText('old reasoning')).toBeNull()
  expect(screen.queryByText('raw-evidence')).toBeNull()
  expect(screen.getByText('查看适用条件与建议').closest('details')?.open).toBe(false)
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'absent' } })
  expect(screen.queryByText('Validate lengths.')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '立即整理' }))
  await waitFor(() =>{  expect(api.refine).toHaveBeenCalledWith('parent') })
})

it('saves retrospective fields without evidence or reasoning fields', async () => {
  const api = actions()
  render(<Workbench {...props(api)} />)
  fireEvent.click(screen.getByRole('button', { name: '安全分析' }))
  await screen.findByRole('heading', { name: 'Review the sample' })
  fireEvent.click(screen.getByText('高级详情'))
  fireEvent.click(screen.getByRole('button', { name: '复盘与经验' }))
  fireEvent.click(screen.getByRole('button', { name: '新增记录' }))
  for (const [label, value] of [['名称', 'Parser review'], ['结果摘要', 'Found a length check gap'], ['适用条件', 'Binary parser'], ['改进措施', 'Check bytes'], ['遇到的问题', 'Trusted input sizes']])
    fireEvent.change(screen.getByLabelText(label!), { target: { value } })
  fireEvent.click(screen.getByRole('button', { name: '保存记录' }))
  await waitFor(() =>{  expect(api.command).toHaveBeenCalled() })
  expect((JSON.parse(vi.mocked(api.command).mock.calls[0]![1]) as { action: unknown }).action).toEqual({ kind: 'remember', entry: {
    category: 'retrospective', title: 'Parser review', summary: 'Found a length check gap', conditions: 'Binary parser', actions: ['Check bytes'], pitfalls: ['Trusted input sizes'], tags: [],
  } })
})

it('reads an immutable source location and shows its observation method', async () => {
  const asset = recordSchema.parse({ kind: 'asset', value: { kind: 'source', id: 'source', engagementId: 'project', label: 'Sources',
    artifact: { sha256: 'a'.repeat(64), size: 100, mediaType: 'application/json' }, identity: 'measured' } })
  const evidence = recordSchema.parse({ kind: 'evidence', value: { id: 'observation', engagementId: 'project', assetId: 'source',
    title: 'Read lines', summary: 'Saved source lines', provider: 'source', operation: 'read', toolVersion: 'source v1',
    request: { path: 'app.py', startLine: 9 }, source: { sessionId: 'parent', callId: 'read' },
    artifact: { sha256: 'b'.repeat(64), size: 100, mediaType: 'application/json' }, method: 'static', incomplete: false, createdAt: 1 } })
  const api = actions({ load: vi.fn(async () => ({ ...view, records: [project, asset] })),
    observe: vi.fn(async () => ({ revision: 9, records: [project, asset, evidence] })) })
  render(<Workbench {...props(api)} />)
  fireEvent.click(screen.getByRole('button', { name: '安全分析' }))
  await screen.findByRole('heading', { name: 'Review the sample' })
  fireEvent.click(screen.getByText('高级详情'))
  fireEvent.click(screen.getByRole('button', { name: '资产' }))
  fireEvent.change(screen.getByLabelText('运行环境'), { target: { value: 'local' } })
  fireEvent.change(screen.getByLabelText('快照中的相对文件路径'), { target: { value: 'app.py' } })
  fireEvent.change(screen.getByLabelText('起始行号'), { target: { value: '9' } })
  fireEvent.click(screen.getByRole('button', { name: '按行读取' }))
  await screen.findByText('静态观察')
  expect(JSON.parse(vi.mocked(api.observe).mock.calls[0]![1])).toMatchObject({
    provider: 'source', operation: 'read', assetId: 'source', parameters: { path: 'app.py', startLine: 9 } })
})

it('starts from conversation guidance and keeps manual project setup available on demand', async () => {
  const api = actions({ load: vi.fn(async () => ({ revision: 0, records: [] })) })
  render(<Workbench {...props(api)} />)
  fireEvent.click(screen.getByRole('button', { name: '安全分析' }))
  await screen.findByRole('heading', { name: '直接在对话中描述你的任务' })
  expect(screen.getByText('首次使用需将工作区关联到可用环境。未配置自动关联时，可展开手动设置创建项目。')).toBeDefined()
  const setup = screen.getByText('手动设置与项目切换').closest('details')!
  expect(setup.open).toBe(false)
  expect(screen.getByText('高级详情').closest('details')?.open).toBe(false)
  expect(screen.queryByText('生成四阶段检查计划')).toBeNull()
  fireEvent.click(screen.getByText('手动设置与项目切换'))
  expect(setup.open).toBe(true)
  fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'Manual task' } })
  fireEvent.change(screen.getByLabelText('分析目标'), { target: { value: 'Review supplied source' } })
  fireEvent.change(screen.getByLabelText('运行环境'), { target: { value: 'local' } })
  fireEvent.click(screen.getByRole('button', { name: '创建项目' }))
  await waitFor(() => { expect(api.command).toHaveBeenCalled() })
  expect((JSON.parse(vi.mocked(api.command).mock.calls[0]![1]) as SecurityCommand).action).toEqual({
    kind: 'create', title: 'Manual task', objective: 'Review supplied source', environmentIds: ['local'], maxAttempts: 3,
  })
})

it('summarizes saved findings, evidence and blocked validation before advanced controls', async () => {
  const finding = recordSchema.parse({ kind: 'finding', value: { id: 'finding', engagementId: 'project', assetId: 'sample',
    title: 'Missing object authorization', explanation: 'The supplied handler omits an ownership check.',
    status: 'suspected', evidenceIds: ['evidence'], conditions: 'Authenticated requests', review: '' } })
  const check = recordSchema.parse({ kind: 'check', value: { id: 'check', engagementId: 'project', assetId: 'sample',
    title: 'Verify behavior on the device', phase: 'validation', criterion: 'Compare permitted and denied requests',
    dependencies: [], evidenceIds: [], status: 'blocked', attempts: 1, rationale: 'The test device is offline.' } })
  const evidence = recordSchema.parse({ kind: 'evidence', value: { id: 'evidence', engagementId: 'project', assetId: 'sample',
    title: 'Handler source', summary: 'Saved implementation', provider: 'source', operation: 'read', toolVersion: 'source v1',
    request: {}, source: { sessionId: 'parent', callId: 'read' },
    artifact: { sha256: 'a'.repeat(64), size: 20, mediaType: 'text/plain' }, method: 'static', incomplete: false, createdAt: 1 } })
  const api = actions({ load: vi.fn(async () => ({ ...view, records: [project, finding, check, evidence] })) })
  render(<Workbench {...props(api)} />)
  fireEvent.click(screen.getByRole('button', { name: '安全分析' }))
  await screen.findByRole('heading', { name: 'Review the sample' })
  expect(screen.getByText('Missing object authorization')).toBeDefined()
  expect(screen.getByText('The test device is offline.')).toBeDefined()
  expect(screen.getByText('已确认发现').closest('article')?.textContent).toContain('0')
  expect(screen.getByText('待验证发现').closest('article')?.textContent).toContain('1')
  expect(screen.getByText('证据记录').closest('article')?.textContent).toContain('1')
  expect(screen.getByText('验证受阻').closest('article')?.textContent).toContain('1')
  expect(screen.getByText('高级详情').closest('details')?.open).toBe(false)
  expect(screen.queryByText('侦察')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '生成此修订的报告' }))
  await waitFor(() => { expect(api.command).toHaveBeenCalled() })
  expect(JSON.parse(vi.mocked(api.command).mock.calls[0]![1])).toMatchObject({ expectedRevision: 8, action: { kind: 'report' } })
})

it('returns from task setup to the existing conversation without creating a project', async () => {
  const api = actions({ load: vi.fn(async () => ({ revision: 0, records: [] })) })
  render(<Workbench {...props(api)} />)
  fireEvent.click(screen.getByRole('button', { name: '安全分析' }))
  await screen.findByRole('heading', { name: '直接在对话中描述你的任务' })
  fireEvent.click(screen.getByRole('button', { name: '返回对话' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(api.command).not.toHaveBeenCalled()
})

it('saves workspace environment choices and can disable intake without changing an existing project', async () => {
  const configuration = {
    workspace: { cwd: '/workspace', revision: 0, environmentIds: [] as string[], maxAttempts: 5, configured: false },
    environments: [{ id: 'local', label: 'Lab', kind: 'local', tools: [] }], providers: [],
  }
  const api = actions({
    load: vi.fn(async () => ({ revision: 0, records: [] })),
    configuration: vi.fn(async () => JSON.stringify(configuration)),
    configureWorkspace: vi.fn<WorkbenchActions['configureWorkspace']>(async (_session, input) => {
      const request = JSON.parse(input) as { expectedRevision: number; environmentIds: string[]; maxAttempts: number }
      return JSON.stringify({ ...configuration, workspace: { ...configuration.workspace, configured: true,
        revision: request.expectedRevision + 1, environmentIds: request.environmentIds, maxAttempts: request.maxAttempts } })
    }),
  })
  render(<Workbench {...props(api)} />)
  fireEvent.click(screen.getByRole('button', { name: '安全分析' }))
  await screen.findByRole('checkbox', { name: 'Lab' })
  fireEvent.click(screen.getByRole('checkbox', { name: 'Lab' }))
  fireEvent.click(screen.getByRole('button', { name: '保存工作区配置' }))
  await screen.findByText('调整可用环境')
  expect(JSON.parse(vi.mocked(api.configureWorkspace).mock.calls[0]![1]))
    .toEqual({ expectedRevision: 0, environmentIds: ['local'], maxAttempts: 5 })
  expect(vi.mocked(api.configureWorkspace).mock.calls[0]![0]).toBe('parent')
  expect(api.command).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('调整可用环境'))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Lab' }))
  fireEvent.click(screen.getByRole('button', { name: '保存工作区配置' }))
  await screen.findByText('已停用此工作区的自动任务创建。')
  expect(JSON.parse(vi.mocked(api.configureWorkspace).mock.calls[1]![1]))
    .toEqual({ expectedRevision: 1, environmentIds: [], maxAttempts: 5 })
})

it('requires an explicit attempt limit when no deployment default is configured', async () => {
  const api = actions({
    load: vi.fn(async () => ({ revision: 0, records: [] })),
    configuration: vi.fn(async () => JSON.stringify({
      workspace: { cwd: '/workspace', revision: 0, environmentIds: [], configured: false },
      environments: [{ id: 'local', label: 'Lab', kind: 'local', tools: [] }], providers: [],
    })),
  })
  render(<Workbench {...props(api)} />)
  fireEvent.click(screen.getByRole('button', { name: '安全分析' }))
  const save = await screen.findByRole('button', { name: '保存工作区配置' })
  expect(save.hasAttribute('disabled')).toBe(true)
  fireEvent.click(screen.getByRole('checkbox', { name: 'Lab' }))
  expect(save.hasAttribute('disabled')).toBe(true)
  fireEvent.click(screen.getByText('执行限制'))
  fireEvent.change(screen.getByLabelText('每项检查的尝试上限'), { target: { value: '4' } })
  expect(save.hasAttribute('disabled')).toBe(false)
})

it('ignores a saved workspace response after switching conversations', async () => {
  let release!: (value: string) => void
  const saved = new Promise<string>((resolve) => { release = resolve })
  const api = actions({
    load: vi.fn(async () => ({ revision: 0, records: [] })),
    configuration: vi.fn<WorkbenchActions['configuration']>(async session => JSON.stringify({
      workspace: { cwd: '/' + session, revision: 0, environmentIds: [], maxAttempts: 3, configured: false },
      environments: [{ id: session, label: session, kind: 'local', tools: [] }], providers: [],
    })),
    configureWorkspace: vi.fn(() => saved),
  })
  const rendered = render(<Workbench {...props(api)} />)
  fireEvent.click(screen.getByRole('button', { name: '安全分析' }))
  fireEvent.click(await screen.findByRole('checkbox', { name: 'parent' }))
  fireEvent.click(screen.getByRole('button', { name: '保存工作区配置' }))
  rendered.rerender(<Workbench {...props(api, 'other')} />)
  release(JSON.stringify({
    workspace: { cwd: '/parent', revision: 1, environmentIds: ['parent'], maxAttempts: 3, configured: true },
    environments: [{ id: 'parent', label: 'parent', kind: 'local', tools: [] }], providers: [],
  }))
  fireEvent.click(screen.getByRole('button', { name: '安全分析' }))
  await screen.findByRole('checkbox', { name: 'other' })
  expect(screen.queryByRole('checkbox', { name: 'parent' })).toBeNull()
  expect(screen.queryByText('调整可用环境')).toBeNull()
})

it('refreshes an open task once when its conversation finishes and keeps manual refresh available', async () => {
  const finding = recordSchema.parse({ kind: 'finding', value: { id: 'finding', engagementId: 'project', assetId: 'sample',
    title: 'Result saved during the turn', explanation: 'New implementation evidence',
    status: 'suspected', evidenceIds: ['evidence'], conditions: 'Supplied sample', review: '' } })
  const load = vi.fn<WorkbenchActions['load']>()
    .mockResolvedValueOnce(view)
    .mockResolvedValue({ revision: 9, records: [project, finding] })
  const api = actions({ load })
  const rendered = render(<Workbench {...props(api, 'parent', true)} />)
  fireEvent.click(screen.getByRole('button', { name: '安全分析' }))
  await screen.findByRole('heading', { name: 'Review the sample' })
  expect(load).toHaveBeenCalledTimes(1)
  expect(screen.queryByText('Result saved during the turn')).toBeNull()
  rendered.rerender(<Workbench {...props(api, 'parent', false)} />)
  await screen.findByText('Result saved during the turn')
  expect(load).toHaveBeenCalledTimes(2)
  rendered.rerender(<Workbench {...props(api, 'parent', false)} />)
  expect(load).toHaveBeenCalledTimes(2)
  fireEvent.click(screen.getByRole('button', { name: '刷新' }))
  await waitFor(() => { expect(load).toHaveBeenCalledTimes(3) })
})

it('does not refresh a closed panel or mistake a conversation switch for a finished turn', async () => {
  const api = actions()
  const rendered = render(<Workbench {...props(api, 'parent', true)} />)
  rendered.rerender(<Workbench {...props(api, 'parent', false)} />)
  expect(api.load).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '安全分析' }))
  await screen.findByRole('heading', { name: 'Review the sample' })
  expect(api.load).toHaveBeenCalledTimes(1)
  rendered.rerender(<Workbench {...props(api, 'parent', true)} />)
  rendered.rerender(<Workbench {...props(api, 'other', false)} />)
  await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
  expect(api.load).toHaveBeenCalledTimes(1)
})


it('lets the operator remove a saved environment that the deployment no longer provides', async () => {
  const configuration = {
    workspace: { cwd: '/workspace', revision: 2, environmentIds: ['retired'], maxAttempts: 3, configured: true },
    environments: [{ id: 'local', label: 'Lab', kind: 'local', tools: [] }], providers: [],
  }
  const api = actions({
    load: vi.fn(async () => ({ revision: 0, records: [] })),
    configuration: vi.fn(async () => JSON.stringify(configuration)),
    configureWorkspace: vi.fn<WorkbenchActions['configureWorkspace']>(async () => JSON.stringify({
      ...configuration, workspace: { ...configuration.workspace, revision: 3, environmentIds: [] },
    })),
  })
  render(<Workbench {...props(api)} />)
  fireEvent.click(screen.getByRole('button', { name: '安全分析' }))
  fireEvent.click(await screen.findByText('调整可用环境'))
  fireEvent.click(screen.getByRole('checkbox', { name: 'retired · 已不可用，取消选择后保存' }))
  expect(screen.queryByRole('checkbox', { name: 'retired · 已不可用，取消选择后保存' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '保存工作区配置' }))
  await screen.findByText('已停用此工作区的自动任务创建。')
  expect(JSON.parse(vi.mocked(api.configureWorkspace).mock.calls[0]![1]))
    .toEqual({ expectedRevision: 2, environmentIds: [], maxAttempts: 3 })
})

it('waits for a workspace save before refreshing a completed turn and keeps the saved revision', async () => {
  let configuration = {
    workspace: { cwd: '/workspace', revision: 1, environmentIds: ['local'], maxAttempts: 3, configured: true },
    environments: [{ id: 'local', label: 'Lab', kind: 'local', tools: [] }], providers: [],
  }
  let release!: (value: string) => void
  const saved = new Promise<string>((resolve) => { release = resolve })
  const save = vi.fn<WorkbenchActions['configureWorkspace']>()
    .mockImplementationOnce(() => saved)
    .mockImplementation(async () => JSON.stringify(configuration))
  const load = vi.fn<WorkbenchActions['load']>(async () => ({ revision: 0, records: [] }))
  const api = actions({ load, configuration: vi.fn(async () => JSON.stringify(configuration)), configureWorkspace: save })
  const rendered = render(<Workbench {...props(api, 'parent', true)} />)
  fireEvent.click(screen.getByRole('button', { name: '安全分析' }))
  fireEvent.click(await screen.findByText('调整可用环境'))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Lab' }))
  fireEvent.click(screen.getByRole('button', { name: '保存工作区配置' }))
  rendered.rerender(<Workbench {...props(api, 'parent', false)} />)
  expect(load).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('button', { name: '刷新' }).hasAttribute('disabled')).toBe(true)
  await act(async () => {
    configuration = { ...configuration, workspace: { ...configuration.workspace, revision: 2, environmentIds: [] } }
    release(JSON.stringify(configuration))
    await saved
  })
  await waitFor(() => {
    expect(load).toHaveBeenCalledTimes(2)
    expect(screen.getByRole('button', { name: '保存工作区配置' }).hasAttribute('disabled')).toBe(false)
  })
  expect(screen.getByText('已停用此工作区的自动任务创建。')).toBeDefined()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Lab' }))
  fireEvent.click(screen.getByRole('button', { name: '保存工作区配置' }))
  await waitFor(() => { expect(save).toHaveBeenCalledTimes(2) })
  expect(JSON.parse(save.mock.calls[1]![1]))
    .toEqual({ expectedRevision: 2, environmentIds: ['local'], maxAttempts: 3 })
})


it.each([{ locale: 'zh', dictionary: zh }, { locale: 'en', dictionary: en }])(
  'keeps long objectives and findings available behind compact overview controls in $locale',
  async ({ dictionary }) => {
    const objective = 'Compare the supplied functions and explain the access-control difference. '.repeat(12).trim()
    const explanation = 'The handler accepts an object identifier without checking ownership. '.repeat(40).trim()
    const longProject = recordSchema.parse({ kind: 'engagement', value: {
      id: 'project', title: objective, objective, environmentIds: ['local'], stopped: false, maxAttempts: 3,
    } })
    const finding = recordSchema.parse({ kind: 'finding', value: {
      id: 'finding', engagementId: 'project', assetId: 'sample', title: 'Missing ownership check',
      explanation, status: 'confirmed', evidenceIds: ['evidence'], conditions: 'Authenticated requests', review: '',
    } })
    const api = actions({ load: vi.fn(async () => ({ revision: 8, records: [longProject, finding] })) })
    render(<Workbench {...props(api)} t={makeTranslate(dictionary, commonZh)} />)
    fireEvent.click(screen.getByRole('button', { name: dictionary.title }))
    await screen.findByRole('heading', { name: objective })
    expect(screen.getByTitle(objective).textContent).toContain(objective)
    const details = screen.getByText(dictionary.fullObjective).closest('details')!
    expect(details.open).toBe(false)
    expect(screen.getByText(dictionary.confirmedFindings).closest('article')?.textContent).toContain('1')
    fireEvent.click(screen.getByText(dictionary.fullObjective))
    expect(details.open).toBe(true)
    expect(details.querySelector('p')?.textContent).toBe(objective)
    fireEvent.click(screen.getByRole('button', { name: dictionary.viewFindings }))
    expect(screen.getByText(explanation).textContent).toBe(explanation)
    expect(screen.queryByText(dictionary.fullObjective)).toBeNull()
    expect(api.command).not.toHaveBeenCalled()
  },
)
