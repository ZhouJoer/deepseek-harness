// @vitest-environment jsdom
/** Operator gestures, authoritative state and stale-session isolation. @module */
import { afterEach, it, expect, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkbenchView } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import { recordSchema } from '@deepseek-ai/dsh-experimental-security-analysis/src/workbench/model.ts'
import { Workbench, type WorkbenchActions, type WorkbenchProps } from '../src/client/Workbench.tsx'
import { Projects } from '../src/client/Projects.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)
const project = recordSchema.parse({ kind: 'engagement', value: { id: 'project', title: 'Owned lab', objective: 'Review the sample', environmentIds: ['local'], stopped: false, maxAttempts: 3 } })
const view: WorkbenchView = { revision: 8, records: [project] }
function actions(overrides: Partial<WorkbenchActions> = {}) {
  return {
    observe: vi.fn(async () => view),
    subscribeReset: () => () => {},
    refine: vi.fn(async () => view), load: vi.fn(async () => view), command: vi.fn(async () => view),
    configuration: vi.fn(async () => JSON.stringify({ environments: [{ id: 'local', label: 'Lab', tools: [], kind: 'local' }], providers: [] })),
    environment: vi.fn(async () => '{}'), execute: vi.fn(async () => view), search: vi.fn(async () => ({ revision: 8, records: [] })),
    artifact: vi.fn(async () => '{}'), report: vi.fn(async () => '# Target security\n\n## Key risk\n- Password exposure'), ...overrides,
  }
}
function props(api: WorkbenchActions, sessionId = 'parent'): WorkbenchProps {
  return { ...api, sessionId: sessionId as SessionId, t: makeTranslate(zh, commonZh) } as unknown as WorkbenchProps
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
    command: vi.fn(async (_id, input) => JSON.parse(input).action.kind === 'leave' ? empty : prior),
    configuration: vi.fn(async () => JSON.stringify({ projects: [{ id: 'project', title: 'Owned lab' }],
      environments: [{ id: 'local', label: 'Lab', kind: 'local', tools: [] }], providers: [] })),
  })
  render(<Workbench {...props(api)} />)
  fireEvent.click(screen.getByRole('button', { name: '安全分析' }))
  await screen.findByText('Review the sample')
  expect(screen.getByRole('button', { name: '新建项目' })).toBeDefined()
  fireEvent.click(screen.getByRole('button', { name: '检查' }))
  expect(screen.getByText('Old check')).toBeDefined()
  fireEvent.click(screen.getByRole('button', { name: '退出当前项目' }))
  await screen.findByRole('button', { name: '创建项目' })
  fireEvent.click(screen.getByRole('button', { name: '检查' }))
  expect(screen.queryByText('Old check')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '发现与验证' }))
  expect(screen.queryByText('Old finding')).toBeNull()
  expect(JSON.parse(vi.mocked(api.command).mock.calls[0]![1]).action).toEqual({ kind: 'leave' })
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
  await screen.findByText('Review the sample')
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
  await screen.findByText('Review the sample')
  fireEvent.click(screen.getByRole('button', { name: '资料' }))
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
  await screen.findByText('Review the sample')
  fireEvent.click(screen.getByRole('button', { name: '发现与验证' }))
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
  await screen.findByText('Review the sample')
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
  await screen.findByText('Review the sample')
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
  await screen.findByText('Review the sample')
  fireEvent.click(screen.getByRole('button', { name: '资产' }))
  fireEvent.change(screen.getByLabelText('运行环境'), { target: { value: 'local' } })
  fireEvent.change(screen.getByLabelText('快照中的相对文件路径'), { target: { value: 'app.py' } })
  fireEvent.change(screen.getByLabelText('起始行号'), { target: { value: '9' } })
  fireEvent.click(screen.getByRole('button', { name: '按行读取' }))
  await screen.findByText('静态观察')
  expect(JSON.parse(vi.mocked(api.observe).mock.calls[0]![1])).toMatchObject({
    provider: 'source', operation: 'read', assetId: 'source', parameters: { path: 'app.py', startLine: 9 } })
})
