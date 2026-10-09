// @vitest-environment jsdom
import { workbenchConfiguration } from './configuration-fixture.client.ts'
/** Operator gestures, authoritative state and stale-session isolation. @module */
import { afterEach, it, expect, vi, onTestFinished } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SecurityCommand, WorkbenchView, WorkbenchConfiguration } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import { recordSchema } from '@deepseek-ai/dsh-experimental-security-analysis/src/workbench/model.ts'
import { Workbench, type WorkbenchActions, type WorkbenchProps } from '../src/client/Workbench.tsx'
import type {} from '../src/client/index.ts'
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)
const project = recordSchema.parse({ kind: 'engagement', value: { id: 'project', title: 'Owned lab', objective: 'Review the sample', environmentIds: ['local'], stopped: false, maxAttempts: 3 } })
const view: WorkbenchView = { revision: 8, records: [project] }
function actions(overrides: Partial<WorkbenchActions> = {}) {
  return {
    toolCatalog: vi.fn(async () => ({ editable: false, revision: '', tools: [], packs: [], collections: [] })),
    toolPreferences: vi.fn(async () => ({ toolIds: [], collectionIds: [], tags: [] })),
    followActivity: async function* (_id: string, signal: AbortSignal) {
      if (!signal.aborted) await new Promise<void>((resolve) =>{  signal.addEventListener('abort', () =>{  resolve() }, { once: true }) })
    },
    activityDetails: vi.fn(async () => ({ items: [], next: null, through: 0 })), openChild: vi.fn(),
    sendAnalysis: vi.fn(async () => {}),
    manageProject: vi.fn(async () => '[]'),
    importMaterials: vi.fn(async () => view),
    observe: vi.fn(async () => view),
    subscribeReset: () => () => {},
    refine: vi.fn(async () => view), load: vi.fn(async () => view), command: vi.fn(async () => view),
    configuration: vi.fn(async () => workbenchConfiguration({ environments: [{ id: 'local', label: 'Lab', tools: [], kind: 'local' }], providers: [] })),
    configureWorkspace: vi.fn(async () => workbenchConfiguration()),
    environment: vi.fn(async () => '{}'), execute: vi.fn(async () => view), search: vi.fn(async () => ({ revision: 8, records: [] })),
    artifact: vi.fn(async () => '{}'), report: vi.fn(async () => '# Target security\n\n## Key risk\n- Password exposure'), ...overrides,
  }
}
function props(api: WorkbenchActions, sessionId = 'parent', running = false): WorkbenchProps {
  return { ...api, sessionId: sessionId as SessionId, t: makeTranslate(zh, commonZh),
    useSession: (select: (snapshot: { running: boolean }) => unknown) => select({ running }),
  } as WorkbenchProps
}
it('focuses a blocked check without submitting and reports a removed target', async () => {
  const scroll = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollIntoView')
  Object.defineProperty(Element.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  onTestFinished(() => {
    if (scroll) Object.defineProperty(Element.prototype, 'scrollIntoView', scroll)
    else Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
  })
  const check = recordSchema.parse({ kind: 'check', value: { id: 'blocked', engagementId: 'project', assetId: 'sample',
    title: 'Inspect ownership', phase: 'assessment', criterion: 'Read caller', dependencies: [], evidenceIds: [],
    status: 'blocked', attempts: 1, rationale: 'Caller unavailable' } })
  const api = actions({ load: vi.fn(async () => ({ revision: 9, records: [project, check] })) })
  const ui = render(<Workbench {...props(api)} autoOpen initialTab="checks" focusCheckId="blocked" />)
  const title = await screen.findByText('Inspect ownership')
  await waitFor(() =>{  expect(document.activeElement).toBe(title.closest('article')) })
  expect(api.command).not.toHaveBeenCalled()
  ui.rerender(<Workbench {...props(api)} autoOpen initialTab="checks" focusCheckId="missing" />)
  expect(screen.getByText(zh.coverageCheckUnavailable)).toBeDefined()
})
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
    configuration: vi.fn(async () => workbenchConfiguration({ projects: [{ id: 'project', title: 'Owned lab' }],
      environments: [{ id: 'local', label: 'Lab', kind: 'local', tools: [] }], providers: [] })),
  })
  render(<Workbench {...props(api)} />)
  fireEvent.click(screen.getByRole('button', { name: '安全分析' }))
  await screen.findByRole('heading', { name: 'Review the sample' })
  expect(screen.getByText('高级设置与历史任务').closest('details')?.open).toBe(false)
  fireEvent.click(screen.getByText('高级详情'))
  fireEvent.click(screen.getByRole('button', { name: '检查' }))
  expect(screen.getByText('Old check')).toBeDefined()
  fireEvent.click(screen.getByRole('button', { name: '退出当前分析任务' }))
  await screen.findByRole('heading', { name: '新建分析' })
  expect(screen.getByText('退出后可直接新建分析，或在此选择历史任务继续。')).toBeDefined()
  fireEvent.click(screen.getByText('高级设置与历史任务'))
  expect(screen.getByRole('button', { name: '创建分析任务' })).toBeDefined()
  fireEvent.click(screen.getByRole('button', { name: '检查' }))
  expect(screen.queryByText('Old check')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '发现' }))
  expect(screen.queryByText('Old finding')).toBeNull()
  expect((JSON.parse(vi.mocked(api.command).mock.calls[0]![1]) as SecurityCommand).action).toEqual({ kind: 'leave' })
})

it('renders saved Markdown reports from the report read API', async () => {
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
  fireEvent.click(screen.getByRole('button', { name: '停止分析任务' }))
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
it('opens pending plans directly and requires approval before execution', async () => {
  const plan = recordSchema.parse({ kind: 'plan', value: { id: 'plan', engagementId: 'project', checkId: 'check', hypothesis: 'Check bounds', expectedObservation: 'A bounded observation', impact: 'Existing process instrumentation', cleanup: 'Unload and detach', durationMs: 100,
    operation: { provider: 'frida', operation: 'modules', environmentId: 'local', assetId: 'sample', parameters: {}, impact: 'observe' }, hash: 'a'.repeat(64), environmentHash: 'b'.repeat(64), status: 'draft' } })
  const approved = recordSchema.parse({ ...plan, value: { ...plan.value, status: 'approved' } })
  const api = actions({ load: vi.fn(async () => ({ ...view, records: [project, plan] })),
    command: vi.fn(async () => ({ revision: 9, records: [project, approved] })) })
  render(<Workbench {...props(api)} autoOpen initialTab="planApprovals" />)
  await screen.findByText('a'.repeat(64))
  expect(screen.getByRole<HTMLButtonElement>('button', { name: zh.execute }).disabled).toBe(true)
  expect(api.command).not.toHaveBeenCalled()
  expect(api.execute).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '批准此版本' }))
  await waitFor(() =>{  expect(api.command).toHaveBeenCalled() })
  expect(JSON.parse(vi.mocked(api.command).mock.calls[0]?.[1] ?? '{}')).toMatchObject({ expectedRevision: 8, action: { kind: 'approve', planId: 'plan' } })
  await waitFor(() => { expect(screen.getByRole<HTMLButtonElement>('button', { name: zh.execute }).disabled).toBe(false) })
  fireEvent.click(screen.getByRole('button', { name: zh.execute }))
  await waitFor(() => { expect(api.execute).toHaveBeenCalledWith('parent', 'plan', expect.any(String), 9) })
})

it('refreshes a persisted execution failure instead of leaving only the approved status', async () => {
  const plan = recordSchema.parse({ kind: 'plan', value: { id: 'plan', engagementId: 'project', checkId: 'check',
    hypothesis: 'Read imported material', expectedObservation: 'Source text', impact: 'Read only', cleanup: 'Remove container', durationMs: 1000,
    operation: { provider: 'offline', operation: 'python', environmentId: 'local', assetId: 'sample', parameters: {}, impact: 'observe' },
    hash: 'a'.repeat(64), environmentHash: 'b'.repeat(64), status: 'approved' } })
  let current: WorkbenchView = { revision: 8, records: [project, plan] }
  const api = actions({ load: vi.fn(async () => current), execute: vi.fn<WorkbenchActions['execute']>(async (_id, _plan, operationId) => {
    current = { revision: 9, records: [project, plan, recordSchema.parse({ kind: 'execution', value: {
      id: operationId, engagementId: 'project', assetId: 'sample', planId: 'plan', status: 'failed',
      detail: 'FileNotFoundError: /tmp/E:/workspace/check.py',
    } })] }
    throw new Error('FileNotFoundError: /tmp/E:/workspace/check.py')
  }) })
  render(<Workbench {...props(api)} autoOpen initialTab="planApprovals" />)
  fireEvent.click(await screen.findByRole('button', { name: zh.execute }))
  await screen.findByText(zh.planExecutionFailed)
  expect(screen.getByText(zh.planOfflineMissingFile)).toBeDefined()
  expect(screen.getByText(zh.approved)).toBeDefined()
  expect(api.load).toHaveBeenCalledTimes(2)
  expect(screen.queryByText(zh.prepare)).toBeNull()
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

it('reads an immutable source location and keeps partial observation warnings visible', async () => {
  const asset = recordSchema.parse({ kind: 'asset', value: { kind: 'source', id: 'source', engagementId: 'project', label: 'Sources',
    artifact: { sha256: 'a'.repeat(64), size: 100, mediaType: 'application/json' }, identity: 'measured' } })
  const evidence = recordSchema.parse({ kind: 'evidence', value: { id: 'observation', engagementId: 'project', assetId: 'source',
    title: 'Read lines', summary: 'Saved source lines', provider: 'source', operation: 'read', toolVersion: 'source v1',
    request: { path: 'app.py', startLine: 9 }, source: { sessionId: 'parent', callId: 'read' },
    artifact: { sha256: 'b'.repeat(64), size: 100, mediaType: 'application/json' }, method: 'static', incomplete: true,
    failure: 'The read stopped before the final line.', createdAt: 1 } })
  const api = actions({ load: vi.fn(async () => ({ ...view, records: [project, asset] })),
    observe: vi.fn(async () => ({ revision: 9, records: [project, asset, evidence] })) })
  render(<Workbench {...props(api)} />)
  fireEvent.click(screen.getByRole('button', { name: '安全分析' }))
  await screen.findByRole('heading', { name: 'Review the sample' })
  fireEvent.click(screen.getByText('高级详情'))
  fireEvent.click(screen.getByRole('button', { name: '资产' }))
  const assetDetails = within(screen.getByText('Sources', { selector: 'strong' }).closest('article')!).getByText('技术详情').closest('details')!
  expect(assetDetails.open).toBe(false)
  expect(assetDetails.textContent).toContain('a'.repeat(64))
  fireEvent.change(screen.getAllByLabelText('运行环境').at(-1)!, { target: { value: 'local' } })
  fireEvent.change(screen.getByLabelText('快照中的相对文件路径'), { target: { value: 'app.py' } })
  fireEvent.change(screen.getByLabelText('起始行号'), { target: { value: '9' } })
  fireEvent.click(screen.getByRole('button', { name: '按行读取' }))
  await screen.findByText('静态观察')
  expect(screen.getByText('The read stopped before the final line.').closest('details')).toBeNull()
  expect(screen.getByText(zh.incomplete).closest('details')).toBeNull()
  const technicalDetails = within(screen.getByText('Read lines', { selector: 'strong' }).closest('article')!).getByText('技术详情').closest('details')!
  expect(technicalDetails.open).toBe(false)
  expect(technicalDetails.textContent).toContain('source v1')
  expect(technicalDetails.textContent).toContain('b'.repeat(64))
  fireEvent.click(within(technicalDetails).getByText('技术详情'))
  expect(technicalDetails.open).toBe(true)
  expect(JSON.parse(vi.mocked(api.observe).mock.calls[0]![1])).toMatchObject({
    provider: 'source', operation: 'read', assetId: 'source', parameters: { path: 'app.py', startLine: 9 } })
})

it('uses evidence and finding titles in reviews while retaining identifiers in technical details', async () => {
  const observation = recordSchema.parse({ kind: 'evidence', value: { id: 'observation-id', engagementId: 'project', assetId: 'sample',
    title: 'Parser length comparison', summary: 'The comparison precedes the copy.', provider: 'source', operation: 'read',
    toolVersion: 'source v1', request: {}, source: { sessionId: 'review-parent', callId: 'read' },
    artifact: { sha256: 'b'.repeat(64), size: 100, mediaType: 'text/plain' }, incomplete: false, createdAt: 1 } })
  const finding = recordSchema.parse({ kind: 'finding', value: { id: 'finding-id', engagementId: 'project', assetId: 'sample',
    title: 'Parser bounds check', explanation: 'The comparison excludes an oversized copy.', status: 'refuted',
    evidenceIds: ['observation-id'], conditions: 'Supplied source snapshot', review: '' } })
  const review = recordSchema.parse({ kind: 'review', value: { id: 'review-id', engagementId: 'project', assetId: 'sample',
    findingId: 'finding-id', findingHash: 'c'.repeat(64), reviewerSessionId: 'reviewer-session-id', verdict: 'refuted',
    supportingEvidenceIds: ['observation-id'], opposingEvidenceIds: ['missing-observation'],
    explanation: 'The source includes a length check.', uncertainty: 'Runtime behavior remains untested.', createdAt: 2 } })
  const api = actions({ load: vi.fn(async () => ({ ...view, records: [project, observation, finding, review] })) })
  render(<Workbench {...props(api)} />)
  fireEvent.click(screen.getByRole('button', { name: '安全分析' }))
  await screen.findByRole('heading', { name: 'Review the sample' })
  fireEvent.click(screen.getByText('高级详情'))
  fireEvent.click(screen.getByRole('button', { name: zh.reviews }))
  expect(screen.getByText('Parser bounds check')).toBeTruthy()
  expect(screen.getByText(`${zh.supportingEvidence}: Parser length comparison`)).toBeTruthy()
  expect(screen.getByText(`${zh.opposingEvidence}: 相关记录不可读取`)).toBeTruthy()
  expect(screen.getByText('Runtime behavior remains untested.')).toBeTruthy()
  const technicalDetails = screen.getByText('技术详情').closest('details')!
  expect(technicalDetails.open).toBe(false)
  expect(technicalDetails.textContent).toContain('finding-id')
  expect(technicalDetails.textContent).toContain('reviewer-session-id')
  expect(technicalDetails.textContent).toContain('c'.repeat(64))
  fireEvent.click(within(technicalDetails).getByText('技术详情'))
  expect(technicalDetails.open).toBe(true)
})

it('starts from conversation guidance and keeps manual project setup available on demand', async () => {
  const api = actions({ load: vi.fn(async () => ({ revision: 0, records: [] })) })
  render(<Workbench {...props(api)} />)
  fireEvent.click(screen.getByRole('button', { name: '安全分析' }))
  await screen.findByRole('heading', { name: '新建分析' })
  expect(screen.getByText(zh.simpleStartHint)).toBeDefined()
  const setup = screen.getByText('高级设置与历史任务').closest('details')!
  expect(setup.open).toBe(false)
  expect(screen.getByText('高级详情').closest('details')?.open).toBe(false)
  expect(screen.queryByText('生成四阶段检查计划')).toBeNull()
  fireEvent.click(screen.getByText('高级设置与历史任务'))
  expect(setup.open).toBe(true)
  fireEvent.change(screen.getByLabelText('名称'), { target: { value: 'Manual task' } })
  fireEvent.change(screen.getByLabelText('分析目标'), { target: { value: 'Review supplied source' } })
  fireEvent.change(screen.getAllByLabelText('运行环境').at(-1)!, { target: { value: 'local' } })
  fireEvent.click(screen.getByRole('button', { name: '创建分析任务' }))
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
  await screen.findByRole('heading', { name: '新建分析' })
  fireEvent.click(screen.getByRole('button', { name: '返回对话' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(api.command).not.toHaveBeenCalled()
})

it('does not submit an analysis objective after its preparation outlives the selected conversation', async () => {
  let release!: (value: WorkbenchView) => void
  const pending = new Promise<WorkbenchView>((resolve) => { release = resolve })
  const api = actions({ load: vi.fn(async () => ({ revision: 0, records: [] })), importMaterials: vi.fn(() => pending) })
  const rendered = render(<Workbench {...props(api)} />)
  fireEvent.click(screen.getByRole('button', { name: '安全分析' }))
  await screen.findByRole('heading', { name: zh.newAnalysis })
  fireEvent.change(screen.getByLabelText(zh.analysisRequest), { target: { value: 'Inspect this sample' } })
  fireEvent.click(screen.getByRole('button', { name: zh.startAnalysis }))
  expect(api.importMaterials).toHaveBeenCalledOnce()
  rendered.rerender(<Workbench {...props(api, 'other')} />)
  await act(async () => { release(view); await pending })
  expect(api.sendAnalysis).not.toHaveBeenCalled()
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('saves workspace environment choices and can disable intake without changing an existing project', async () => {
  const configuration = {
    ...workbenchConfiguration(),
    workspace: { cwd: '/workspace', revision: 0, environmentIds: [] as string[], maxAttempts: 5, configured: false },
    environments: [{ id: 'local', label: 'Lab', kind: 'local', tools: [] }], providers: [],
  } satisfies WorkbenchConfiguration
  const api = actions({
    load: vi.fn(async () => ({ revision: 0, records: [] })),
    configuration: vi.fn(async () => workbenchConfiguration(configuration)),
    configureWorkspace: vi.fn<WorkbenchActions['configureWorkspace']>(async (_session, input) => {
      const request = JSON.parse(input) as { expectedRevision: number; environmentIds: string[]; maxAttempts: number }
      return workbenchConfiguration({ ...configuration, workspace: { ...configuration.workspace, configured: true,
        revision: request.expectedRevision + 1, environmentIds: request.environmentIds, maxAttempts: request.maxAttempts } })
    }),
  })
  render(<Workbench {...props(api)} />)
  fireEvent.click(screen.getByRole('button', { name: '安全分析' }))
  await screen.findByRole('heading', { name: '新建分析' })
  fireEvent.click(screen.getByText('高级设置与历史任务'))
  fireEvent.click(screen.getByText('调整可用环境'))
  await screen.findByRole('checkbox', { name: 'Lab' })
  fireEvent.click(screen.getByRole('checkbox', { name: 'Lab' }))
  fireEvent.click(screen.getByRole('button', { name: '保存工作区配置' }))
  await screen.findByText('调整可用环境')
  expect(JSON.parse(vi.mocked(api.configureWorkspace).mock.calls[0]![1]))
    .toEqual({ expectedRevision: 0, environmentIds: ['local'], maxAttempts: 5 })
  expect(vi.mocked(api.configureWorkspace).mock.calls[0]![0]).toBe('parent')
  expect(api.command).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('checkbox', { name: 'Lab' }))
  fireEvent.click(screen.getByRole('button', { name: '保存工作区配置' }))
  await screen.findByText('已停用此工作区的自动任务创建。')
  expect(JSON.parse(vi.mocked(api.configureWorkspace).mock.calls[1]![1]))
    .toEqual({ expectedRevision: 1, environmentIds: [], maxAttempts: 5 })
})

it('requires an explicit attempt limit when no deployment default is configured', async () => {
  const api = actions({
    load: vi.fn(async () => ({ revision: 0, records: [] })),
    configuration: vi.fn(async () => workbenchConfiguration({
      workspace: { cwd: '/workspace', revision: 0, environmentIds: [], configured: false },
      environments: [{ id: 'local', label: 'Lab', kind: 'local', tools: [] }], providers: [],
    })),
    configureWorkspace: vi.fn(async () => workbenchConfiguration({ workspace: {
      cwd: '/workspace', revision: 1, environmentIds: ['local'], maxAttempts: 4, configured: true,
    } })),
  })
  render(<Workbench {...props(api)} />)
  fireEvent.click(screen.getByRole('button', { name: '安全分析' }))
  await screen.findByRole('heading', { name: '新建分析' })
  expect(screen.getByText(zh.missingAttemptLimit)).toBeDefined()
  const start = screen.getByRole<HTMLButtonElement>('button', { name: zh.startAnalysis })
  expect(start.disabled).toBe(true)
  fireEvent.click(start)
  expect(api.importMaterials).not.toHaveBeenCalled()
  fireEvent.click(screen.getByText('高级设置与历史任务'))
  fireEvent.click(screen.getByText('调整可用环境'))
  const save = await screen.findByRole('button', { name: '保存工作区配置' })
  expect(save.hasAttribute('disabled')).toBe(true)
  fireEvent.click(screen.getByRole('checkbox', { name: 'Lab' }))
  expect(save.hasAttribute('disabled')).toBe(true)
  fireEvent.click(screen.getByText('执行限制'))
  fireEvent.change(screen.getByLabelText('每项检查的尝试上限'), { target: { value: '4' } })
  expect(save.hasAttribute('disabled')).toBe(false)
  fireEvent.click(save)
  await waitFor(() => { expect(screen.queryByText(zh.missingAttemptLimit)).toBeNull() })
  fireEvent.change(screen.getByLabelText(zh.analysisRequest), { target: { value: 'Inspect the sample' } })
  fireEvent.click(start)
  await waitFor(() => { expect(api.importMaterials).toHaveBeenCalledOnce() })
  expect(JSON.parse(vi.mocked(api.importMaterials).mock.calls[0]![1])).toMatchObject({ resources: { maxAttempts: 4 } })
})

it('uses the configured attempt limit for manual project creation', async () => {
  const api = actions({ load: vi.fn(async () => ({ revision: 0, records: [] })),
    configuration: vi.fn(async () => workbenchConfiguration({ workspace: {
      cwd: '/workspace', revision: 0, environmentIds: ['local'], maxAttempts: 7, configured: true,
    } })),
  })
  render(<Workbench {...props(api)} />)
  fireEvent.click(screen.getByRole('button', { name: zh.title }))
  await screen.findByRole('heading', { name: zh.newAnalysis })
  fireEvent.click(screen.getByText(zh.manualSetup))
  fireEvent.change(screen.getByLabelText(zh.name), { target: { value: 'Manual analysis' } })
  fireEvent.change(screen.getByLabelText(zh.objective), { target: { value: 'Inspect the sample' } })
  fireEvent.change(screen.getAllByLabelText(zh.environment).at(-1)!, { target: { value: 'local' } })
  fireEvent.click(screen.getByRole('button', { name: zh.create }))
  await waitFor(() => { expect(api.command).toHaveBeenCalledOnce() })
  expect(JSON.parse(vi.mocked(api.command).mock.calls[0]![1])).toMatchObject({ action: { kind: 'create', maxAttempts: 7 } })
})

it('ignores a saved workspace response after switching conversations', async () => {
  let release!: (value: WorkbenchConfiguration) => void
  const saved = new Promise<WorkbenchConfiguration>((resolve) => { release = resolve })
  const api = actions({
    load: vi.fn(async () => ({ revision: 0, records: [] })),
    configuration: vi.fn<WorkbenchActions['configuration']>(async session => workbenchConfiguration({
      workspace: { cwd: '/' + session, revision: 0, environmentIds: [], maxAttempts: 3, configured: false },
      environments: [{ id: session, label: session, kind: 'local', tools: [] }], providers: [],
    })),
    configureWorkspace: vi.fn(() => saved),
  })
  const rendered = render(<Workbench {...props(api)} />)
  fireEvent.click(screen.getByRole('button', { name: '安全分析' }))
  await screen.findByRole('heading', { name: '新建分析' })
  fireEvent.click(screen.getByText('高级设置与历史任务'))
  fireEvent.click(screen.getByText('调整可用环境'))
  fireEvent.click(await screen.findByRole('checkbox', { name: 'parent' }))
  fireEvent.click(screen.getByRole('button', { name: '保存工作区配置' }))
  rendered.rerender(<Workbench {...props(api, 'other')} />)
  release(workbenchConfiguration({
    workspace: { cwd: '/parent', revision: 1, environmentIds: ['parent'], maxAttempts: 3, configured: true },
    environments: [{ id: 'parent', label: 'parent', kind: 'local', tools: [] }], providers: [],
  }))
  fireEvent.click(screen.getByRole('button', { name: '安全分析' }))
  await screen.findByRole('heading', { name: '新建分析' })
  fireEvent.click(screen.getByText('高级设置与历史任务'))
  fireEvent.click(screen.getByText('调整可用环境'))
  await screen.findByRole('checkbox', { name: 'other' })
  expect(screen.queryByRole('checkbox', { name: 'parent' })).toBeNull()
  expect(screen.getByText('调整可用环境')).toBeDefined()
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
    ...workbenchConfiguration(),
    workspace: { cwd: '/workspace', revision: 2, environmentIds: ['retired'], maxAttempts: 3, configured: true },
    environments: [{ id: 'local', label: 'Lab', kind: 'local', tools: [] }], providers: [],
  } satisfies WorkbenchConfiguration
  const api = actions({
    load: vi.fn(async () => ({ revision: 0, records: [] })),
    configuration: vi.fn(async () => workbenchConfiguration(configuration)),
    configureWorkspace: vi.fn<WorkbenchActions['configureWorkspace']>(async () => workbenchConfiguration({
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
    ...workbenchConfiguration(),
    workspace: { cwd: '/workspace', revision: 1, environmentIds: ['local'], maxAttempts: 3, configured: true },
    environments: [{ id: 'local', label: 'Lab', kind: 'local', tools: [] }], providers: [],
  } satisfies WorkbenchConfiguration
  let release!: (value: WorkbenchConfiguration) => void
  const saved = new Promise<WorkbenchConfiguration>((resolve) => { release = resolve })
  const save = vi.fn<WorkbenchActions['configureWorkspace']>()
    .mockImplementationOnce(() => saved)
    .mockImplementation(async () => workbenchConfiguration(configuration))
  const load = vi.fn<WorkbenchActions['load']>(async () => ({ revision: 0, records: [] }))
  const api = actions({ load, configuration: vi.fn(async () => workbenchConfiguration(configuration)), configureWorkspace: save })
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
    release(workbenchConfiguration(configuration))
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

it('adds pasted material from the task overview and exposes reversible project removal', async () => {
  const api = actions()
  render(<Workbench {...props(api)} />)
  fireEvent.click(screen.getByRole('button', { name: '安全分析' }))
  await screen.findByRole('heading', { name: 'Review the sample' })
  fireEvent.click(screen.getByRole('button', { name: '粘贴文字' }))
  fireEvent.change(screen.getByLabelText('要分析的文字'), { target: { value: '  const value = 1;\n' } })
  fireEvent.click(screen.getByRole('button', { name: '添加文字' }))
  await waitFor(() =>{  expect(api.importMaterials).toHaveBeenCalledTimes(1) })
  expect((JSON.parse(vi.mocked(api.importMaterials).mock.calls[0]![1]) as { material: unknown }).material).toEqual({ kind: 'text', name: 'notes.txt', text: '  const value = 1;\n' })
  await waitFor(() =>{  expect(screen.getByRole('button', { name: '刷新' }).hasAttribute('disabled')).toBe(false) })
  fireEvent.click(screen.getByText('管理分析任务'))
  fireEvent.change(screen.getByLabelText('分析任务名称'), { target: { value: 'New name' } })
  fireEvent.click(screen.getByRole('button', { name: '保存名称' }))
  await waitFor(() =>{  expect(api.manageProject).toHaveBeenCalledTimes(1) })
  expect((JSON.parse(vi.mocked(api.manageProject).mock.calls[0]![1]) as { action: unknown }).action).toEqual({ kind: 'rename', title: 'New name' })
})

it('opens material intake directly from the composer and sends only after saving the task', async () => {
  const api = actions({ load: vi.fn(async () => ({ revision: 4, records: [] })) })
  render(<Workbench {...props(api)} />)
  expect(screen.queryByRole('dialog')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: zh.startWithMaterials }))
  await screen.findByRole('heading', { name: zh.newAnalysis })
  fireEvent.click(screen.getByRole('button', { name: zh.hostPath }))
  fireEvent.change(screen.getByLabelText(zh.materialPath), { target: { value: 'E:/samples/ctk-1.4.3.apk' } })
  fireEvent.click(screen.getByRole('button', { name: zh.addMaterials }))
  await screen.findByText(/ctk-1.4.3.apk/u)
  fireEvent.change(screen.getByLabelText(zh.analysisRequest), { target: { value: '检查这个 APK 的静态安全问题' } })
  fireEvent.click(screen.getByRole('button', { name: zh.startAnalysis }))
  await waitFor(() => { expect(api.sendAnalysis).toHaveBeenCalledWith('parent', '检查这个 APK 的静态安全问题') })
  expect(JSON.parse(vi.mocked(api.importMaterials).mock.calls[0]![1])).toMatchObject({
    expectedRevision: 4, material: { kind: 'path', path: 'E:/samples/ctk-1.4.3.apk' },
    title: 'ctk-1.4.3.apk', resources: { environmentIds: ['local'] },
  })
  expect(vi.mocked(api.importMaterials).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(api.sendAnalysis).mock.invocationCallOrder[0]!)
  expect(screen.queryByRole('dialog')).toBeNull()
})
