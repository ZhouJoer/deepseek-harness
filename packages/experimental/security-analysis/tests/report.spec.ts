/** Reader-facing report budgets and finding accounting. @module */
import { expect, it } from 'vitest'
import { reportPrompt, renderReport } from '../src/workbench/report.ts'
import { engagementSchema, evidenceSchema, fileAssetSchema, findingSchema, reviewSchema, sourceAssetSchema, type SecurityRecord } from '../src/workbench/model.ts'
import { findingHash } from '../src/workbench/assessment.ts'

const limits = { inputBytes: 32768, maxChars: 1200, maxFindings: 1, maxLessons: 1, outputBytes: 16384 }
function fixture(): SecurityRecord[] {
  const project = { kind: 'engagement' as const, value: engagementSchema.parse({ id: 'project', title: '目标安全简报',
    objective: 'Assess owned code and binary', environmentIds: [], stopped: false, maxAttempts: 3 }) }
  const asset = { kind: 'asset' as const, value: fileAssetSchema.parse({ id: 'binary', engagementId: 'project', label: 'webui_httpd',
    format: 'elf', identity: 'measured', artifact: { sha256: 'a'.repeat(64), size: 100, mediaType: 'application/octet-stream' } }) }
  const finding = (id: string, title: string, status: 'confirmed' | 'suspected'): SecurityRecord => ({ kind: 'finding',
    value: findingSchema.parse({ id, engagementId: 'project', assetId: 'binary', title,
      explanation: 'Input reaches an unchecked copy.', conditions: 'Attacker controls length', status,
      evidenceIds: ['evidence'], review: '' }) })
  return [project, asset, finding('one', '解析长度越界', 'confirmed'), finding('two', '输出超限导致资源耗尽', 'suspected')]
}
function answer(findings = [0, 1], excludedIndices: number[] = []) {
  return JSON.stringify({ assessment: '二进制发现一处已确认风险；源码和 Web 未检查。',
    findings: findings.map(index => ({ index, mechanism: '未校验长度', conditions: '可控输入', impact: '越界访问',
      location: 'parse_request', fix: '读取前校验实际剩余字节' })), excludedIndices,
    lessons: ['遇到可变长度字段，应沿输入到拷贝位置核对实际边界。'], uncovered: ['源码与 Web 未检查。'] })
}

it.each(['json', ''])('accepts a single %s code fence around an otherwise valid report', (language) => {
  const response = ' \r\n```' + language + '\r\n' + answer() + '\r\n```\r\n '
  expect(renderReport(fixture(), response, limits)).toEqual(renderReport(fixture(), answer(), limits))
})

it.each([
  ['leading prose', 'Here is the report:\n```json\n' + answer() + '\n```'],
  ['trailing prose', '```json\n' + answer() + '\n```\nReport complete.'],
  ['multiple blocks', '```json\n' + answer() + '\n```\n```json\n{}\n```'],
  ['another language', '```javascript\n' + answer() + '\n```'],
  ['an unclosed fence', '```json\n' + answer()],
  ['invalid JSON', '```json\n{"assessment":}\n```'],
])('rejects report output containing %s', (_case, response) => {
  expect(() => renderReport(fixture(), response, limits)).toThrow()
})

it('retains schema, finding accounting and complete response byte limits for fenced reports', () => {
  const records = fixture()
  expect(() => renderReport(records, '```json\n{}\n```', limits)).toThrow(/assessment/u)
  expect(() => renderReport(records, '```json\n' + answer([1], []) + '\n```', limits)).toThrow(/every finding/u)
  const response = '```json\n' + answer() + '\n```'
  expect(() => renderReport(records, response, { ...limits, outputBytes: Buffer.byteLength(answer()) })).toThrow(/byte budget/u)
})
it('produces a short brief and a complete appendix without audit identifiers', () => {
  const records = fixture()
  const prompt = reportPrompt(records, limits)
  expect(prompt).toContain('解析长度越界')
  expect(prompt).toContain('输出超限导致资源耗尽')
  expect(prompt).not.toContain('Evidence index')
  const result = renderReport(records, answer(), limits)
  expect(Array.from(result.markdown).length).toBeLessThanOrEqual(1200)
  expect(result.markdown).toContain('解析长度越界')
  expect(result.markdown).toContain('另有 1 条')
  expect(result.findingsMarkdown).toContain('输出超限导致资源耗尽')
  expect(result.markdown + (result.findingsMarkdown ?? '')).not.toMatch(/evidence|aaaa[a-f0-9]{60}|Execution and cleanup/u)
})

it('reports imported source coverage without evidence identities or raw observations', () => {
  const records = fixture().filter(item => item.kind !== 'finding')
  records.push({ kind: 'asset', value: sourceAssetSchema.parse({ kind: 'source', id: 'source', engagementId: 'project',
    label: 'Tufty source', artifact: { sha256: 'b'.repeat(64), size: 50, mediaType: 'application/json' }, identity: 'measured' }) })
  records.push({ kind: 'evidence', value: evidenceSchema.parse({ id: 'private-observation', engagementId: 'project',
    assetId: 'source', title: 'Source page', summary: 'raw observation must stay out',
    artifact: { sha256: 'c'.repeat(64), size: 50, mediaType: 'application/json' }, provider: 'source',
    operation: 'read', toolVersion: 'fixture', request: { path: 'apps/wifi_setup/transport.py' },
    source: { sessionId: 'session', callId: 'call' }, incomplete: false, method: 'static',
    observationKind: 'implementation', createdAt: 1 }) })
  const prompt = reportPrompt(records, limits)
  const data = JSON.parse(prompt.split('\nData: ')[1]!) as { coverage: unknown[] }
  expect(data.coverage).toContainEqual({ assetLabel: 'Tufty source', sourceFilesRead: 1,
    completeImplementationObservations: 1, inventoryObservations: 0, incompleteObservations: 0 })
  expect(prompt).toContain('never claim an imported asset was not provided')
  expect(prompt).not.toContain('private-observation')
  expect(prompt).not.toContain('raw observation must stay out')
})

it('uses one separator when model fields already end with punctuation', () => {
  const response = JSON.parse(answer()) as {
    findings: { mechanism: string; conditions: string; impact: string; location: string; fix: string }[]
  }
  for (const finding of response.findings) {
    finding.mechanism += '。'
    finding.conditions += '。'
    finding.impact += '。'
    finding.location += '。'
    finding.fix += '。'
  }
  const markdown = renderReport(fixture(), JSON.stringify(response), limits).markdown
  expect(markdown).not.toMatch(/。；|。。/u)
})

it('requires a disposition for every finding and preserves confirmed risks', () => {
  const records = fixture()
  expect(() => renderReport(records, answer([1], []), limits)).toThrow(/every finding/)
  expect(() => renderReport(records, answer([1], [0]), limits)).toThrow(/confirmed/)
  expect(() => renderReport(records, answer([0, 0], []), limits)).toThrow(/every finding/)
})

it('separates requested conditions from accepted review facts and ignores unaccepted or stale reviews', () => {
  const records = fixture()
  const finding = records.find(item => item.kind === 'finding')
  if (finding?.kind !== 'finding') throw new Error('Finding missing')
  finding.value.review = 'accepted'
  const base = { engagementId: 'project', assetId: 'binary', findingId: finding.value.id,
    findingHash: findingHash(finding.value), reviewerSessionId: 'reviewer', verdict: 'confirmed' as const,
    supportingEvidenceIds: ['evidence'], opposingEvidenceIds: [], uncertainty: '', createdAt: 1 }
  records.push({ kind: 'review', value: reviewSchema.parse({ ...base, id: 'accepted', basis: 'static',
    explanation: 'Relevant branch checks no remaining bytes.' }) })
  records.push({ kind: 'review', value: reviewSchema.parse({ ...base, id: 'later', basis: 'runtime',
    explanation: 'Unaccepted and unrelated later assessment.' }) })
  const project = records.find(item => item.kind === 'engagement')
  if (project?.kind !== 'engagement') throw new Error('Project missing')
  project.value.objective = '仅静态检查此文件。没有独立复核时保持待复核状态。'
  const prompt = reportPrompt(records, limits)
  const data = JSON.parse(prompt.split('\nData: ')[1]!) as { project: unknown; findings: unknown[] }
  expect(data.project).toEqual({ title: '目标安全简报', requestedObjective: project.value.objective })
  expect(data.findings[0]).toMatchObject({ status: 'confirmed', review: {
    accepted: true, verdict: 'confirmed', basis: 'static', explanation: 'Relevant branch checks no remaining bytes.', uncertainty: '',
  } })
  expect(data.findings[1]).toMatchObject({ status: 'suspected', review: null })
  expect(prompt).not.toContain('Unaccepted and unrelated later assessment.')
  expect(prompt).toMatchSnapshot('accepted static review with a conditional user request')
  const output = renderReport(records, answer(), limits).markdown
  expect(output).toContain('已确认，静态分析')
  expect(output).not.toContain('运行验证')
  finding.value.explanation = 'The material claim changed after review.'
  finding.value.status = 'suspected'
  const changed = JSON.parse(reportPrompt(records, limits).split('\nData: ')[1]!) as { findings: unknown[] }
  expect(changed.findings[0]).toMatchObject({ status: 'suspected', review: null })
})

it('rejects model-written finding status instead of replacing committed conclusions', () => {
  const records = fixture()
  const before = JSON.stringify(records)
  const response = JSON.parse(answer()) as { findings: Record<string, unknown>[] }
  response.findings[0]!.status = 'suspected'
  expect(() => renderReport(records, JSON.stringify(response), limits)).toThrow(/status/u)
  expect(JSON.stringify(records)).toBe(before)
})
it('states missing coverage when there are no findings', () => {
  const records = fixture().filter(item => item.kind !== 'finding')
  expect(reportPrompt(records, limits)).toContain('lessons and uncovered are arrays of strings')
  expect(() => renderReport(records, JSON.stringify({ assessment: '尚不能判断', findings: [],
    excludedIndices: [], lessons: [], uncovered: '源码未检查' }), limits)).toThrow(/uncovered/u)
  const result = renderReport(records, JSON.stringify({ assessment: '仅识别了 ELF 文件，尚不能判断其安全性。',
    findings: [], excludedIndices: [], lessons: [], uncovered: ['函数级分析和 Web 路径未检查。'] }), limits)
  expect(result.markdown).toContain('尚不能判断')
  expect(result.markdown).toContain('这不表示目标安全')
})

it('treats the character budget as a writing target while enforcing input and output bytes', () => {
  expect(() => reportPrompt(fixture(), { ...limits, inputBytes: 10 })).toThrow(/input exceeds/)
  expect(renderReport(fixture(), answer(), { ...limits, maxChars: 80 }).markdown).toContain('解析长度越界')
  expect(() => renderReport(fixture(), answer(), { ...limits, outputBytes: 10 })).toThrow(/byte budget/)
})
