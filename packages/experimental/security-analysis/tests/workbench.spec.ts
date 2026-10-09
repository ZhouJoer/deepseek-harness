/** Real storage and provider effects for project authority and execution recovery. @module */
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { describe, it, expect, onTestFinished, vi } from 'vitest'
import { openSecurityJournal } from '../src/workbench/journal.ts'
import { sourceManifestSchema } from '../src/workbench/source.ts'
import { ArtifactStore } from '../src/workbench/artifacts.ts'
import { SecurityController } from '../src/workbench/controller.ts'
import { BinaryProvider } from '../src/workbench/binary.ts'
import type { SecurityCommand } from '../src/workbench/controller.ts'
import type { AnalysisOperation } from '../src/workbench/model.ts'
import { findingHash } from '../src/workbench/assessment.ts'
import { bindDelegatedChild } from './delegation-fixture.ts'
import { refineKnowledge, refinementSchema } from '../src/workbench/knowledge.ts'
import { SecuritySearchIndex } from '../src/workbench/search.ts'

async function harness(generateReport?: (prompt: string, signal: AbortSignal) => Promise<string>) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-security-workbench-'))
  const ctx = new Context()
  const backend = new JsonStorageBackend(root)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('test', backend)
  const facility = new DomainFacility(ctx, { backend: 'test' })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  const journal = await openSecurityJournal(ctx)
  const artifacts = new ArtifactStore(root, 65536)
  const controller = new SecurityController(journal, artifacts, {
    importRoots: [root],
    environments: [{ id: 'local', kind: 'local', label: 'Lab', cwd: root, tools: [] }],
    maxDurationMs: 1000,
    maxOutputBytes: 32768,
    approvalTtlMs: 60000,
    maxArtifactBytes: 65536,
    maxDerivedAssets: 10,
    reportLimits: { inputBytes: 32768, maxChars: 1200, maxFindings: 5, maxLessons: 3, outputBytes: 16384 },
  }, generateReport ?? (async (prompt) => {
    const data = JSON.parse(prompt.split('\nData: ')[1]!) as { findings: { index: number; status: string }[] }
    return JSON.stringify({ assessment: 'Only recorded implementation paths were assessed.',
      findings: data.findings.filter(item => item.status !== 'refuted').map(item => ({ index: item.index, mechanism: 'Target behavior requires review',
        conditions: 'Owned sample', impact: 'Potential security impact', location: 'sample', fix: 'Check the implementation' })),
      excludedIndices: data.findings.filter(item => item.status === 'refuted').map(item => item.index),
      lessons: [], uncovered: ['Other paths remain unexamined.'] })
  }))
  onTestFinished(async () => {
    await controller.dispose()
    await facility.closeAll()
    await backend.close()
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })
  const send = (action: SecurityCommand['action'], operator = false, session = 'parent') =>
    controller.command(
      session,
      { operationId: randomUUID(), expectedRevision: journal.view().revision, action },
      operator,
    )
  await send(
    { kind: 'create', title: 'Lab', objective: 'Inspect an owned sample', environmentIds: ['local'], maxAttempts: 3 },
    true,
  )
  const path = join(root, 'sample.exe')
  await writeFile(path, Buffer.from('MZ owned fixture'))
  await send({ kind: 'import', path, label: 'sample' })
  const sample = controller.view('parent').records.find(item => item.kind === 'asset')!
  if (sample.kind !== 'asset') throw new Error('Fixture failed to import')
  return { root, ctx, journal, controller, artifacts, send, assetId: sample.value.id }
}

describe('security workbench', () => {
  it('consumes single-execution approval once across concurrent starts and durable retries', async () => {
    const { controller, send, assetId, journal } = await harness()
    let requests = 0
    const entered = Promise.withResolvers<undefined>(); const release = Promise.withResolvers<undefined>()
    controller.providers.register({ id: 'single', operations: ['request'], resolve: value => ({ ...value, approvalUse: 'single-execution' }),
      run: async () => { requests++; entered.resolve(undefined); await release.promise; return { bytes: Buffer.from('observed'), mediaType: 'text/plain', summary: 'one request', incomplete: false, toolVersion: 'fixture' } } })
    onTestFinished(() => { release.resolve(undefined) })
    await send({ kind: 'check', check: { assetId, title: 'One approved request', phase: 'validation', criterion: 'One response', dependencies: [], evidenceIds: [] } })
    const check = controller.view('parent').records.find(item => item.kind === 'check')!
    const operation: AnalysisOperation = { provider: 'single', operation: 'request', assetId, environmentId: 'local', impact: 'observe', parameters: {} }
    await send({ kind: 'plan', checkId: check.value.id, operation, hypothesis: 'One request', expectedObservation: 'One response', impact: 'Read', cleanup: 'None', durationMs: 1000 })
    const plan = controller.view('parent').records.find(item => item.kind === 'plan')!
    await send({ kind: 'approve', planId: plan.value.id }, true)
    const executionId = randomUUID(); const revision = journal.view().revision
    const first = controller.execute('parent', plan.value.id, executionId, revision, 'call-one', new AbortController().signal)
    await entered.promise
    await controller.execute('parent', plan.value.id, executionId, journal.view().revision, 'retry', new AbortController().signal)
    await expect(controller.execute('parent', plan.value.id, randomUUID(), revision, 'concurrent', new AbortController().signal)).rejects.toThrow()
    release.resolve(undefined); await first
    await controller.execute('parent', plan.value.id, executionId, journal.view().revision, 'durable-retry', new AbortController().signal)
    await expect(controller.execute('parent', plan.value.id, randomUUID(), journal.view().revision, 'replay', new AbortController().signal)).rejects.toThrow('already been used')
    expect(requests).toBe(1)
  })
  it('lets an operator reconcile stopped checks without resuming the project', async () => {
    const { controller, send, assetId, journal } = await harness()
    await send({ kind: 'check', check: { assetId, title: 'Read caller', phase: 'assessment', criterion: 'Read the caller', dependencies: [], evidenceIds: [] } })
    const check = controller.view('parent').records.find(item => item.kind === 'check')!
    await journal.commit(randomUUID(), undefined, {}, () => [{ kind: 'check', value: { ...check.value, status: 'blocked', rationale: 'Caller unavailable' } }])
    await send({ kind: 'stop' })
    const action = { kind: 'reconcile' as const, checkId: check.value.id, rationale: 'Confirmed no process remains' }
    await expect(send(action)).rejects.toThrow('stopped')
    const result = await send(action, true)
    expect(result.records.find(item => item.kind === 'check')?.value).toMatchObject({ status: 'planned' })
    expect(result.records.find(item => item.kind === 'engagement')?.value).toMatchObject({ stopped: true })
    expect(result.records.some(item => item.kind === 'execution')).toBe(false)
  })
  it.each(['purge', 'dispose'] as const)('waits for export reads before %s releases artifacts', async (action) => {
    const { controller, send, assetId, artifacts, journal } = await harness()
    const projectId = controller.binding('parent')!.engagementId
    await controller.captureAnalysis('parent', assetId, ['export-observation'], Buffer.alloc(64000, 120), new AbortController().signal)
    await send({ kind: 'report' })
    const report = controller.view('parent').records.find(item => item.kind === 'report')!
    if (report.kind !== 'report') throw new Error('Missing report')
    if (action === 'purge') await controller.manageProject(projectId, { operationId: randomUUID(), expectedRevision: journal.view().revision, action: { kind: 'archive' } })
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const read = artifacts.read.bind(artifacts)
    const reading = vi.spyOn(artifacts, 'read').mockImplementationOnce(async (artifact) => {
      entered.resolve(undefined); await release.promise; return read(artifact)
    })
    const exporting = controller.exportReport(projectId, report.value.id, 1e6, new Request('http://localhost/export'))
    const rejected = expect(exporting).rejects.toThrow(action === 'purge' ? 'permanently deleted' : 'disposed')
    await entered.promise
    let finished = false
    const cleanup = (action === 'purge'
      ? controller.manageProject(projectId, { operationId: randomUUID(), expectedRevision: journal.view().revision, action: { kind: 'purge' } })
      : controller.dispose()).then(() => { finished = true })
    try {
      await expect(controller.exportReport(projectId, report.value.id, 1e6, new Request('http://localhost/export'))).rejects.toThrow('cleanup')
      expect(finished).toBe(false)
    } finally { release.resolve(undefined); await rejected; await cleanup; reading.mockRestore() }
    expect(finished).toBe(true)
  })
  it('admits explicit check inputs and rejects missing, foreign, damaged and changed references', async () => {
    const { controller, send, assetId, artifacts, root } = await harness()
    await send({ kind: 'check', check: { assetId, title: 'Read implementation', phase: 'assessment',
      criterion: 'Locate input handling', dependencies: [], evidenceIds: [] } })
    const check = controller.view('parent').records.find(item => item.kind === 'check')!
    if (check.kind !== 'check') throw new Error('Missing check')
    const evidence = await controller.captureAnalysis('parent', assetId, ['input-call'], Buffer.from('partial observation'), new AbortController().signal)
    if (evidence.kind !== 'evidence') throw new Error('Missing evidence')
    const input = { assetId, role: 'reverse-analyst' as const, task: 'assessment' as const,
      question: 'Read input handling', criterion: 'Return locations', checkId: check.value.id, inputEvidenceIds: [evidence.value.id] }
    const assignment = await controller.admitDelegation('parent', 'linked-call', input)
    expect(assignment).toMatchObject({ checkId: check.value.id, inputEvidenceIds: [evidence.value.id] })
    expect((await controller.admitDelegation('parent', 'linked-call', input)).id).toBe(assignment.id)
    await expect(controller.admitDelegation('parent', 'linked-call', { ...input, inputEvidenceIds: [] })).rejects.toThrow('different input')
    await expect(controller.admitDelegation('parent', 'missing-check', { ...input, checkId: 'missing' })).rejects.toThrow('check is missing')
    await expect(controller.admitDelegation('parent', 'missing-input', { ...input, inputEvidenceIds: ['missing'] })).rejects.toThrow('input evidence')
    await send({ kind: 'import', path: join(root, 'sample.exe'), label: 'another asset' })
    const other = controller.view('parent').records.filter(item => item.kind === 'asset').at(-1)!
    await expect(controller.admitDelegation('parent', 'foreign-check', { ...input, assetId: other.value.id })).rejects.toThrow('check is missing')
    const { checkId: _checkId, ...directInput } = input
    await expect(controller.admitDelegation('parent', 'foreign-input', { ...directInput, assetId: other.value.id })).rejects.toThrow('input evidence')
    await writeFile(join(root, 'artifacts', evidence.value.artifact.sha256), 'damaged')
    await expect(controller.admitDelegation('parent', 'damaged-input', input)).rejects.toThrow('identity mismatch')
    if ('artifact' in other.value) expect(await artifacts.read(other.value.artifact)).toBeDefined()
  })
  it('checks delegation dependencies twice and keeps independent work available', async () => {
    const { controller, send, assetId } = await harness()
    const add = async (title: string, dependencies: string[]) => {
      await send({ kind: 'check', check: { assetId, title, phase: 'assessment', criterion: title, dependencies, evidenceIds: [] } })
      return controller.view('parent').records.filter(item => item.kind === 'check').at(-1)!.value.id
    }
    const upstream = await add('Read the parser', [])
    const dependent = await add('Inspect callers', [upstream])
    const independent = await add('Inspect exports', [])
    const input = { assetId, role: 'reverse-analyst' as const, task: 'assessment' as const, question: 'Inspect implementation', criterion: 'Return evidence' }
    await expect(controller.admitDelegation('parent', 'blocked-dependency', { ...input, checkId: dependent })).rejects.toThrow('depend')
    const other = await controller.admitDelegation('parent', 'independent', { ...input, checkId: independent })
    await controller.bindDelegationChild(other.id, 'independent-child')
    const evidence = await controller.captureAnalysis('parent', assetId, ['source-call'], Buffer.from('source observation'), new AbortController().signal)
    if (evidence.kind !== 'evidence') throw new Error('Missing evidence')
    await send({ kind: 'finish', checkId: upstream, evidenceIds: [evidence.value.id], rationale: 'Read implementation' })
    const pending = await controller.admitDelegation('parent', 'dependent', { ...input, checkId: dependent })
    await expect(send({ kind: 'reopen', checkId: upstream, rationale: 'Check another input' })).rejects.toThrow('Cancel linked delegations')
    await send({ kind: 'finish', checkId: dependent, evidenceIds: [evidence.value.id], rationale: 'Coordinator resolved the question' })
    await expect(controller.bindDelegationChild(pending.id, 'late-child')).rejects.toThrow('planned check')
    await controller.settleDelegation(pending.id, { status: 'cancelled', detail: 'Coordinator finished the check' })
    await send({ kind: 'reopen', checkId: upstream, rationale: 'Check another input' })
    expect(controller.delegationForCall('parent', 'dependent')?.status).toBe('cancelled')
    expect(controller.delegationForCall('parent', 'independent')?.status).toBe('running')
    expect(controller.view('parent').records.filter(item => item.kind === 'check').filter(item => [upstream, dependent].includes(item.value.id))
      .every(item => item.value.status === 'planned')).toBe(true)
  })
  it('rejects external-container provider preparation, observations and execution before reading Host artifacts', async () => {
    const { controller, send, assetId, journal } = await harness()
    const resolve = vi.fn((request: AnalysisOperation) => request)
    const run = vi.fn(async () => ({ bytes: Buffer.from('wrong environment'), mediaType: 'text/plain',
      summary: 'Unverified file', incomplete: false, toolVersion: 'fixture' }))
    controller.providers.register({ id: 'ghidra', operations: ['functions'], resolve, run })
    const operation = { provider: 'ghidra', operation: 'functions', assetId, environmentId: 'local',
      parameters: {}, impact: 'observe' as const }
    await send({ kind: 'check', check: { assetId, title: 'Inspect functions', phase: 'validation',
      criterion: 'Verify file identity', dependencies: [], evidenceIds: [] } })
    const check = controller.view('parent').records.find(item => item.kind === 'check')!
    if (check.kind !== 'check') throw new Error('Missing fixture check')
    const action = { kind: 'plan' as const, checkId: check.value.id, operation, hypothesis: 'Inspect the selected binary',
      expectedObservation: 'Measured functions', impact: 'Read only', cleanup: 'No persistent target effects', durationMs: 100 }
    await send(action)
    const plan = controller.view('parent').records.find(item => item.kind === 'plan')!
    if (plan.kind !== 'plan') throw new Error('Missing fixture plan')
    await send({ kind: 'approve', planId: plan.value.id }, true)
    resolve.mockClear()
    const environment = controller.options.environments[0]!
    environment.kind = 'docker'
    environment.externalContainer = { name: 'external-analysis', workdir: '/analysis' }
    const signal = new AbortController().signal
    await expect(controller.observe('parent', operation, 'external-observation', signal)).rejects.toThrow('managed file access')
    await expect(send(action)).rejects.toThrow('managed file access')
    await expect(controller.execute('parent', plan.value.id, 'external-execution', journal.view().revision,
      'external-execute', signal)).rejects.toThrow('managed file access')
    expect(resolve).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
    expect(controller.view('parent').records.some(item => item.kind === 'evidence' || item.kind === 'execution')).toBe(false)
  })
  it('notifies coordinator cancellation after durable stop and before waiting for delegated cleanup', async () => {
    const { controller } = await harness()
    const project = controller.binding('parent')!.engagementId
    const abort = new AbortController()
    const cleanup = Promise.withResolvers<undefined>()
    const release = controller.trackDelegation(project, abort, cleanup.promise)
    const onStopped = vi.fn(() => {
      expect(controller.projects().find(item => item.id === project)?.stopped).toBe(true)
    })
    const stopping = controller.command('parent', { operationId: 'stop-order', expectedRevision: 0,
      action: { kind: 'stop' } }, true, new AbortController().signal, onStopped)
    try {
      await vi.waitFor(() => { expect(abort.signal.aborted).toBe(true) })
      expect(onStopped).toHaveBeenCalledExactlyOnceWith(project)
    } finally { cleanup.resolve(undefined); release(); await stopping }
  })
  it('merges a research direction across turns and preserves supplemental reconnaissance and delegated ownership', async () => {
    const { controller, send, assetId } = await harness()
    const checkpoint = { kind: 'checkpoint' as const, phase: 'recon' as const, title: 'Entry inventory',
      reason: 'Establish entry points', summary: 'Inventory is incomplete', next: 'Read another entry', evidenceIds: [], findingIds: [] }
    await send(checkpoint)
    const id = controller.checkpointId('parent')
    await send({ ...checkpoint, summary: 'One entry identified' })
    expect(controller.checkpointId('parent')).toBe(id)
    await send({ ...checkpoint, id, summary: 'Two entry points identified' })
    expect(controller.view('parent').records.filter(item => item.kind === 'checkpoint')).toHaveLength(1)
    await bindDelegatedChild(controller, 'parent', 'child', assetId, 'reverse-analyst')
    await send({ ...checkpoint, phase: 'assessment', title: 'Access checks', reason: 'Inspect the discovered entry' })
    await send({ ...checkpoint, title: 'Supplemental reconnaissance', reason: 'Assessment found another caller' })
    expect(controller.checkpointId('child')).toBe(id)
    const steps = controller.view('parent').records.filter(item => item.kind === 'checkpoint')
    expect(steps.map(item => item.value.phase)).toEqual(['recon', 'assessment', 'recon'])
    expect(steps[0]?.value.summary).toBe('Two entry points identified')
    await expect(send({ ...checkpoint, id })).rejects.toThrow('current research direction')
    await expect(send({ ...checkpoint, evidenceIds: ['foreign'] })).rejects.toThrow('foreign')
    await expect(send(checkpoint, false, 'child')).rejects.toThrow('role')
  })
  it('stores auxiliary script evidence idempotently and rejects foreign assets and stopped projects', async () => {
    const { controller, assetId, send, artifacts } = await harness()
    const bytes = Buffer.from('[{"call":"python analysis.py","result":"observed"}]')
    const signal = new AbortController().signal
    const first = await controller.captureAnalysis('parent', assetId, ['script-call'], bytes, signal)
    expect(await controller.captureAnalysis('parent', assetId, ['script-call'], bytes, signal)).toEqual(first)
    if (first.kind !== 'evidence') throw new Error('Evidence required')
    expect(first.value).toMatchObject({ provider: 'session-tool', incomplete: true, source: { sessionId: 'parent', callId: 'script-call' } })
    expect(first.value.method).toBeUndefined()
    expect(first.value.planId).toBeUndefined()
    expect(await artifacts.read(first.value.artifact)).toEqual(bytes)
    await expect(controller.captureAnalysis('parent', 'foreign', ['script-call'], bytes, signal)).rejects.toThrow('scope')
    const assignment = await bindDelegatedChild(controller, 'parent', 'reviewer', assetId, 'reviewer')
    await expect(controller.captureAnalysis('reviewer', assetId, ['call'], bytes, signal)).rejects.toThrow('role')
    await controller.settleDelegation(assignment.id, { status: 'completed', report: {
      summary: 'Script log reviewed', evidenceIds: [first.value.id],
      uncertainty: 'No complete implementation evidence', nextSteps: ['Inspect the implementation'] } })
    await send({ kind: 'finding', finding: { assetId, title: 'Script hypothesis', explanation: 'Script observation requires confirmation',
      conditions: 'Unverified input conditions', evidenceIds: [first.value.id], status: 'suspected', review: '' } })
    const finding = controller.view('parent').records.find(item => item.kind === 'finding')!
    if (finding.kind !== 'finding') throw new Error('Finding required')
    const review = { findingId: finding.value.id, findingHash: findingHash(finding.value), basis: 'static' as const,
      supportingEvidenceIds: [first.value.id], opposingEvidenceIds: [], explanation: 'The log alone cannot establish implementation behavior',
      uncertainty: 'Implementation coverage missing' }
    const proposed = await controller.review('reviewer', { ...review, verdict: 'confirmed' })
    const confirmation = proposed.records.find(item => item.kind === 'review')!
    if (confirmation.kind !== 'review') throw new Error('Review required')
    await expect(send({ kind: 'conclude', reviewId: confirmation.value.id })).rejects.toThrow()
    const reviewed = await controller.review('reviewer', { ...review, verdict: 'inconclusive' })
    const assessment = reviewed.records.findLast(item => item.kind === 'review')!
    if (assessment.kind !== 'review') throw new Error('Review required')
    await send({ kind: 'conclude', reviewId: assessment.value.id })
    await send({ kind: 'report' })
    expect(controller.view('parent').records.some(item => item.kind === 'report')).toBe(true)
    await send({ kind: 'stop' }, true)
    await expect(controller.captureAnalysis('parent', assetId, ['next'], bytes, signal)).rejects.toThrow('stopped')
  })
  it('removes projects reversibly, detaches their sessions and preserves their assets', async () => {
    const { controller, journal, send } = await harness()
    const id = controller.binding('parent')!.engagementId
    const manage = (action: unknown) => controller.manageProject(id,
      { operationId: randomUUID(), expectedRevision: journal.view().revision, action })
    await manage({ kind: 'rename', title: 'Short name' })
    expect(controller.projects()[0]!.title).toBe('Short name')
    await manage({ kind: 'archive' })
    expect(controller.projects()).toEqual([])
    expect(controller.projects(true)[0]).toMatchObject({ archived: true, stopped: true })
    expect(controller.binding('parent')).toBeUndefined()
    expect(controller.projectView(id).records.some(item => item.kind === 'asset')).toBe(true)
    await expect(send({ kind: 'select', engagementId: id }, true)).rejects.toThrow(/removed|archived/i)
    await manage({ kind: 'restore' })
    expect(controller.projects()[0]).toMatchObject({ archived: false, stopped: true })
    await send({ kind: 'select', engagementId: id }, true)
    expect(controller.binding('parent')?.engagementId).toBe(id)
  })

  it('permanently erases task history and unshared content while retaining shared samples', async () => {
    const { controller, journal, artifacts, send, assetId, root, ctx } = await harness()
    const id = controller.binding('parent')!.engagementId
    const sample = controller.view('parent').records.find(item => item.kind === 'asset')!
    if (sample.kind !== 'asset' || !('artifact' in sample.value)) throw new Error('Expected file asset')
    const shared = sample.value.artifact
    const evidence = await controller.captureAnalysis('parent', assetId, ['original'], Buffer.from('private observation'), new AbortController().signal)
    if (evidence.kind !== 'evidence') throw new Error('Expected evidence')
    await send({ kind: 'create', title: 'Other task', objective: 'Keep shared sample', environmentIds: ['local'], maxAttempts: 3 }, true, 'other')
    await send({ kind: 'import', path: join(root, 'sample.exe'), label: 'shared' }, false, 'other')
    const manage = (action: unknown) => controller.manageProject(id,
      { operationId: randomUUID(), expectedRevision: journal.view().revision, action })
    await expect(manage({ kind: 'purge' })).rejects.toThrow(/Delete the task/)
    await manage({ kind: 'archive' })
    await expect(controller.manageProject('unknown', { operationId: randomUUID(), expectedRevision: journal.view().revision,
      action: { kind: 'purge' } })).rejects.toThrow(/Unknown project/)
    await expect(controller.manageProject(id, { operationId: randomUUID(), expectedRevision: 0,
      action: { kind: 'purge' } })).rejects.toThrow(/state changed/)
    const request = { operationId: randomUUID(), expectedRevision: journal.view().revision, action: { kind: 'purge' } }
    await controller.manageProject(id, request)
    await controller.manageProject(id, request)
    const stored = await readFile(join(root, 'security_workbench.json'), 'utf8')
    expect(stored).not.toContain('private observation')
    expect(stored).not.toContain('"title":"Lab"')
    expect(controller.projects(true).map(item => item.title)).toEqual(['Other task'])
    expect(controller.binding('parent')).toBeUndefined()
    expect(() => controller.projectView(id)).toThrow(/Unknown/)
    await expect(artifacts.read(evidence.value.artifact)).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await artifacts.read(shared)).toString()).toBe('MZ owned fixture')
    expect(await readFile(join(root, 'sample.exe'), 'utf8')).toBe('MZ owned fixture')
    await expect(manage({ kind: 'restore' })).rejects.toThrow(/Unknown/)
    await journal.close()
    const reopened = await openSecurityJournal(ctx)
    try {
      expect(reopened.view().records.some(item => item.kind === 'engagement' ? item.value.id === id : item.value.engagementId === id)).toBe(false)
      expect(reopened.pendingPurges()).toEqual([])
    } finally { await reopened.close() }
  })
  it('resumes pending permanent cleanup after reopening without restoring deleted records', async () => {
    const { controller, journal, artifacts, ctx, assetId, root } = await harness()
    const id = controller.binding('parent')!.engagementId
    const sample = controller.view('parent').records.find(item => item.kind === 'asset')!
    if (sample.kind !== 'asset' || !('artifact' in sample.value)) throw new Error('Expected file asset')
    const artifact = sample.value.artifact
    await controller.manageProject(id, { operationId: randomUUID(), expectedRevision: journal.view().revision, action: { kind: 'archive' } })
    const remove = vi.spyOn(artifacts, 'remove').mockRejectedValueOnce(new Error('Cleanup interrupted'))
    await expect(controller.manageProject(id, { operationId: randomUUID(), expectedRevision: journal.view().revision, action: { kind: 'purge' } })).rejects.toThrow('Cleanup interrupted')
    expect(journal.pendingPurges()).toHaveLength(1)
    expect(journal.view().records.some(item => item.kind === 'asset' && item.value.id === assetId)).toBe(false)
    remove.mockRestore()
    await journal.close()
    const reopened = await openSecurityJournal(ctx)
    try {
      const recoveredStore = new ArtifactStore(root, 65536)
      const recovered = new SecurityController(reopened, recoveredStore, controller.options)
      await recovered.recover()
      expect(recovered.projects(true)).toEqual([])
      expect(reopened.pendingPurges()).toEqual([])
      await expect(recoveredStore.read(artifact)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally { await reopened.close() }
  })
  it('keeps a pending cleanup artifact that another task imported before restart', async () => {
    const { controller, journal, artifacts, ctx, root, send } = await harness()
    const id = controller.binding('parent')!.engagementId
    const sample = controller.view('parent').records.find(item => item.kind === 'asset')!
    if (sample.kind !== 'asset' || !('artifact' in sample.value)) throw new Error('Expected file asset')
    const shared = sample.value.artifact
    await controller.manageProject(id, { operationId: randomUUID(), expectedRevision: journal.view().revision, action: { kind: 'archive' } })
    const remove = vi.spyOn(artifacts, 'remove').mockRejectedValueOnce(new Error('Cleanup interrupted'))
    await expect(controller.manageProject(id, { operationId: randomUUID(), expectedRevision: journal.view().revision, action: { kind: 'purge' } })).rejects.toThrow('Cleanup interrupted')
    remove.mockRestore()
    await send({ kind: 'create', title: 'New owner', objective: 'Reuse sample', environmentIds: ['local'], maxAttempts: 3 }, true, 'new-owner')
    await send({ kind: 'import', path: join(root, 'sample.exe'), label: 'Reused' }, false, 'new-owner')
    await journal.close()
    const reopened = await openSecurityJournal(ctx)
    try {
      const store = new ArtifactStore(root, 65536)
      const recovered = new SecurityController(reopened, store, controller.options)
      await recovered.recover()
      expect((await store.read(shared)).toString()).toBe('MZ owned fixture')
      expect(reopened.pendingPurges()).toEqual([])
    } finally { await reopened.close() }
  })
  it('waits for evidence publication before measuring unshared content', async () => {
    const { controller, journal, artifacts, send, assetId } = await harness()
    const id = controller.binding('parent')!.engagementId
    const bytes = Buffer.from('shared evidence in flight')
    const signal = new AbortController().signal
    const original = await controller.captureAnalysis('parent', assetId, ['original'], bytes, signal)
    if (original.kind !== 'evidence') throw new Error('Expected evidence')
    await send({ kind: 'create', title: 'Other task', objective: 'Keep evidence', environmentIds: ['local'], maxAttempts: 3 }, true, 'other')
    await send({ kind: 'import', path: join(controller.options.importRoots[0]!, 'sample.exe'), label: 'shared' }, false, 'other')
    const otherAsset = controller.view('other').records.find(item => item.kind === 'asset')!
    if (otherAsset.kind !== 'asset') throw new Error('Expected asset')
    await controller.manageProject(id, { operationId: randomUUID(), expectedRevision: journal.view().revision, action: { kind: 'archive' } })
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const put = artifacts.put.bind(artifacts)
    vi.spyOn(artifacts, 'put').mockImplementationOnce(async (...args) => {
      const artifact = await put(...args)
      entered.resolve(undefined)
      await release.promise
      return artifact
    })
    const publishing = controller.captureAnalysis('other', otherAsset.value.id, ['in-flight'], bytes, signal)
    await entered.promise
    const purge = vi.spyOn(journal, 'purge')
    const deleting = controller.manageProject(id, { operationId: randomUUID(), expectedRevision: journal.view().revision + 1, action: { kind: 'purge' } })
    try { expect(purge).not.toHaveBeenCalled() }
    finally { release.resolve(undefined) }
    const evidence = await publishing
    await deleting
    if (evidence.kind !== 'evidence') throw new Error('Expected evidence')
    expect(await artifacts.read(evidence.value.artifact)).toEqual(bytes)
    expect(controller.projects(true).map(item => item.title)).toEqual(['Other task'])
  })
  it('publishes later evidence only after permanent content cleanup settles', async () => {
    const { controller, journal, artifacts, send, assetId } = await harness()
    const id = controller.binding('parent')!.engagementId
    const bytes = Buffer.from('recreated after cleanup')
    const signal = new AbortController().signal
    const original = await controller.captureAnalysis('parent', assetId, ['original'], bytes, signal)
    if (original.kind !== 'evidence') throw new Error('Expected evidence')
    await send({ kind: 'create', title: 'Other task', objective: 'Keep evidence', environmentIds: ['local'], maxAttempts: 3 }, true, 'other')
    await send({ kind: 'import', path: join(controller.options.importRoots[0]!, 'sample.exe'), label: 'shared' }, false, 'other')
    const otherAsset = controller.view('other').records.find(item => item.kind === 'asset')!
    if (otherAsset.kind !== 'asset') throw new Error('Expected asset')
    await controller.manageProject(id, { operationId: randomUUID(), expectedRevision: journal.view().revision, action: { kind: 'archive' } })
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const remove = artifacts.remove.bind(artifacts)
    vi.spyOn(artifacts, 'remove').mockImplementationOnce(async (hash) => {
      entered.resolve(undefined)
      await release.promise
      await remove(hash)
    })
    const deleting = controller.manageProject(id, { operationId: randomUUID(), expectedRevision: journal.view().revision, action: { kind: 'purge' } })
    await entered.promise
    const put = vi.spyOn(artifacts, 'put')
    const publishing = controller.captureAnalysis('other', otherAsset.value.id, ['after-cleanup'], bytes, signal)
    try { expect(put).not.toHaveBeenCalled() }
    finally { release.resolve(undefined) }
    await deleting
    const evidence = await publishing
    if (evidence.kind !== 'evidence') throw new Error('Expected evidence')
    expect(await artifacts.read(evidence.value.artifact)).toEqual(bytes)
  })
  it('removes source members and the stored manifest while preserving the original input', async () => {
    const { controller, journal, artifacts } = await harness()
    const id = controller.binding('parent')!.engagementId
    const imported = await controller.importMaterials('parent', { operationId: randomUUID(), expectedRevision: journal.view().revision,
      material: { kind: 'text', name: 'owned.ts', text: 'export const owned = true\n' } })
    const source = imported.records.find(item => item.kind === 'asset' && 'kind' in item.value && item.value.kind === 'source')!
    if (source.kind !== 'asset' || !('kind' in source.value) || source.value.kind !== 'source') throw new Error('Expected source')
    const manifest = sourceManifestSchema.parse(JSON.parse((await artifacts.read(source.value.artifact)).toString('utf8')))
    await controller.manageProject(id, { operationId: randomUUID(), expectedRevision: journal.view().revision, action: { kind: 'archive' } })
    await controller.manageProject(id, { operationId: randomUUID(), expectedRevision: journal.view().revision, action: { kind: 'purge' } })
    await expect(artifacts.read(source.value.artifact)).rejects.toMatchObject({ code: 'ENOENT' })
    for (const file of manifest.files) await expect(artifacts.read(file.artifact)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('imports pasted text into a new task without losing whitespace and rejects oversized input atomically', async () => {
    const { controller, journal, artifacts } = await harness()
    const task = { title: 'Notes', objective: 'Inspect notes', environmentIds: ['local'], maxAttempts: 3 }
    const input = (text: string) => ({ operationId: randomUUID(), expectedRevision: journal.view().revision,
      material: { kind: 'text', name: 'notes.txt', text }, task })
    await expect(controller.importMaterials('new-task', input('x'.repeat(65537)))).rejects.toThrow(/byte limit/)
    expect(controller.binding('new-task')).toBeUndefined()
    const text = '  中文代码\n  return input;\n'
    const view = await controller.importMaterials('new-task', input(text))
    const asset = view.records.find(item => item.kind === 'asset')!
    if (asset.kind !== 'asset' || !('kind' in asset.value) || asset.value.kind !== 'source') throw new Error('Expected source asset')
    const manifest = sourceManifestSchema.parse(JSON.parse((await artifacts.read(asset.value.artifact)).toString()))
    expect((await artifacts.read(manifest.files[0]!.artifact)).toString()).toBe(text)
  })

  it('limits an operator path grant to that import while model imports retain configured roots', async () => {
    const { controller, journal, send } = await harness()
    const external = await mkdtemp(join(tmpdir(), 'dsh-selected-material-'))
    onTestFinished(() => rm(external, { recursive: true, force: true }))
    const path = join(external, 'code.txt')
    await writeFile(path, 'const owned = true')
    await expect(send({ kind: 'import-source', label: 'outside', path })).rejects.toThrow(/outside/)
    const view = await controller.importMaterials('parent', { operationId: randomUUID(), expectedRevision: journal.view().revision,
      material: { kind: 'path', path: external } })
    expect(view.records.filter(item => item.kind === 'asset')).toHaveLength(2)
    await expect(send({ kind: 'import-source', label: 'outside', path })).rejects.toThrow(/outside/)
    await expect(controller.importMaterials('parent', { operationId: randomUUID(), expectedRevision: journal.view().revision,
      material: { kind: 'files', directory: true, files: [{ name: '../escape.js', base64: 'eA==' }] } })).rejects.toThrow()
  })


  it('initializes simultaneous tasks independently without a shared revision conflict', async () => {
    const { controller, journal } = await harness()
    const action = { kind: 'create' as const, title: 'Task', objective: 'Inspect the source', environmentIds: ['local'], maxAttempts: 3 }
    const signal = new AbortController().signal
    await Promise.all([
      controller.admitTask('first-task', 'intake-first', action, signal),
      controller.admitTask('second-task', 'intake-second', action, signal),
    ])
    const first = controller.binding('first-task')
    const second = controller.binding('second-task')
    expect(first?.role).toBe('coordinator')
    expect(second?.role).toBe('coordinator')
    expect(first?.engagementId).not.toBe(second?.engagementId)
    expect(journal.view().records.filter(item => item.kind === 'engagement')).toHaveLength(3)
    const revision = journal.view().revision
    await controller.admitTask('first-task', 'intake-first', action, signal)
    expect(journal.view().revision).toBe(revision)
  })

  it('keeps the first project when two admitted messages target the same Session', async () => {
    const { controller, journal } = await harness()
    const action = { kind: 'create' as const, title: 'First task', objective: 'Inspect the source', environmentIds: ['local'], maxAttempts: 3 }
    const signal = new AbortController().signal
    await Promise.all([
      controller.admitTask('new-task', 'intake-first', action, signal),
      controller.admitTask('new-task', 'intake-second', { ...action, title: 'Second task' }, signal),
    ])
    expect(journal.view().records.filter(item => item.kind === 'engagement')).toHaveLength(2)
    expect(controller.view('new-task').records.find(item => item.kind === 'engagement')?.value)
      .toMatchObject({ title: 'First task' })
  })

  it('preserves a leave operation committed before a queued task admission', async () => {
    const { controller, journal, send } = await harness()
    const action = { kind: 'create' as const, title: 'New task', objective: 'Inspect the source', environmentIds: ['local'], maxAttempts: 3 }
    await Promise.all([
      send({ kind: 'leave' }, true),
      controller.admitTask('parent', 'intake-after-leave', action, new AbortController().signal),
    ])
    expect(controller.binding('parent')).toBeUndefined()
    expect(controller.view('parent').records).toEqual([])
    expect(journal.view().records.find(item => item.kind === 'binding' && item.value.sessionId === 'parent')?.value)
      .toMatchObject({ active: false })
    expect(journal.view().records.filter(item => item.kind === 'engagement')).toHaveLength(1)
  })

  it('cancels an intake waiting behind another journal commit without creating a project', async () => {
    const { controller, journal } = await harness()
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const blocker = journal.commit('hold-intake', undefined, { test: 'hold-intake' }, async (view) => {
      entered.resolve(undefined)
      await release.promise
      return view.records.filter(item => item.kind === 'binding' && item.value.sessionId === 'parent')
    })
    onTestFinished(async () => { release.resolve(undefined); await blocker })
    await entered.promise
    const abort = new AbortController()
    const action = { kind: 'create' as const, title: 'Cancelled task', objective: 'Inspect the source', environmentIds: ['local'], maxAttempts: 3 }
    const pending = controller.admitTask('cancelled-task', 'intake-cancelled', action, abort.signal)
    const rejected = expect(pending).rejects.toThrow('Task cancelled')
    abort.abort(new Error('Task cancelled'))
    release.resolve(undefined)
    await blocker
    await rejected
    expect(controller.binding('cancelled-task')).toBeUndefined()
    expect(journal.view().records.filter(item => item.kind === 'engagement')).toHaveLength(1)
    await expect(controller.admitTask('cancelled-task', 'intake-aborted', action, abort.signal)).rejects.toThrow('Task cancelled')
  })

  it('rejects task resources absent from the deployment', async () => {
    const { controller } = await harness()
    await expect(controller.admitTask('new-task', 'intake-unavailable', {
      kind: 'create', title: 'Task', objective: 'Inspect the source', environmentIds: ['unknown'], maxAttempts: 3,
    }, new AbortController().signal)).rejects.toThrow('Unknown environment')
    expect(controller.binding('new-task')).toBeUndefined()
  })

  it('leaves a project without deleting its records and can select it again', async () => {
    const { controller, send, journal } = await harness()
    const original = controller.binding('parent')?.engagementId
    expect(original).toBeDefined()
    await expect(send({ kind: 'leave' })).rejects.toThrow(/operator/)
    await send({ kind: 'leave' }, true)
    expect(controller.binding('parent')).toBeUndefined()
    expect(controller.view('parent').records).toEqual([])
    expect(journal.view().records.some(item => item.kind === 'engagement' && item.value.id === original)).toBe(true)
    await expect(send({ kind: 'stop' })).rejects.toThrow(/Select a security project/)
    await send({ kind: 'select', engagementId: original! }, true)
    expect(controller.view('parent').records.some(item => item.kind === 'asset')).toBe(true)
  })

  it('returns the committed evidence for exact static retries and rejects changed retries', async () => {
    const { controller, assetId } = await harness()
    const run = vi.fn(async () => ({ bytes: Buffer.from('result'), mediaType: 'text/plain', summary: 'result', incomplete: false, toolVersion: 'fixture' }))
    controller.providers.register({ id: 'ghidra', operations: ['functions'], resolve: request => request, run })
    const request = { provider: 'ghidra', operation: 'functions', assetId, environmentId: 'local', parameters: {}, impact: 'observe' as const }
    const signal = new AbortController().signal
    const first = await controller.observe('parent', request, 'retry', signal)
    expect(await controller.observe('parent', request, 'retry', signal)).toEqual(first)
    expect(controller.view('parent').records).toContainEqual(first)
    expect(run).toHaveBeenCalledTimes(1)
    await expect(controller.observe('parent', { ...request, parameters: { offset: 1 } }, 'retry', signal)).rejects.toThrow(/different|changed/i)
  })

  it('allows independent source reads while joining identical pending observations', async () => {
    const { controller, assetId } = await harness()
    let release!: () => void
    const hold = new Promise<void>((resolve) => { release = resolve })
    let ready!: () => void
    const both = new Promise<void>((resolve) => { ready = resolve })
    let entered = 0
    const run = vi.fn(async () => {
      if (++entered === 2) ready()
      await hold
      return { bytes: Buffer.from('read'), mediaType: 'text/plain', summary: 'read', incomplete: false, toolVersion: 'fixture' }
    })
    controller.providers.register({ id: 'source', resourceKey: () => null, operations: ['read'], resolve: request => request, run })
    const request = { provider: 'source', operation: 'read', assetId, environmentId: 'local', parameters: {}, impact: 'observe' as const }
    const signal = new AbortController().signal
    const first = controller.observe('parent', request, 'a', signal)
    const retry = controller.observe('parent', request, 'a', signal)
    const other = controller.observe('parent', request, 'b', signal)
    await both
    release()
    const [a, again, b] = await Promise.all([first, retry, other])
    expect(a).toEqual(again)
    expect(a).not.toEqual(b)
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('measures imported bytes and rejects foreign paths and corrupt artifacts', async () => {
    const { artifacts, controller, root } = await harness()
    const record = controller.view('parent').records.find(item => item.kind === 'asset')!
    if (record.kind !== 'asset' || !('artifact' in record.value)) throw new Error('Missing sample')
    expect(record.value.identity).toBe('measured')
    expect((await artifacts.read(record.value.artifact)).toString()).toBe('MZ owned fixture')
    await expect(artifacts.import(join(root, 'sample.exe'), [join(root, 'artifacts')])).rejects.toThrow(/outside/)
    await writeFile(join(root, 'artifacts', record.value.artifact.sha256), 'changed')
    await expect(artifacts.read(record.value.artifact)).rejects.toThrow(/mismatch/)
  })

  it('commits once for exact retries and rejects stale or changed commands', async () => {
    const { controller, journal, root } = await harness()
    const command = { operationId: 'stop-once', expectedRevision: journal.view().revision, action: { kind: 'stop' } }
    const first = await controller.command('parent', command)
    expect((await controller.command('parent', command)).revision).toBe(first.revision)
    await expect(controller.command('parent', { ...command, action: { kind: 'resume' } }, true)).rejects.toThrow(
      /different input/,
    )
    await expect(
      controller.command('parent', { ...command, operationId: 'another', action: { kind: 'resume' } }, true),
    ).rejects.toThrow(/changed/)
    const saved = JSON.parse(await readFile(join(root, 'security_workbench.json'), 'utf8')) as { tables: { commits: unknown } }
    expect(saved.tables.commits).toBeDefined()
  })

  it('requires an operator for approval and narrows child authority independently of ancestry', async () => {
    const { controller, send, assetId } = await harness()
    await bindDelegatedChild(controller, 'parent', 'child', assetId, 'reconnaissance')
    expect(controller.binding('child')?.role).toBe('reconnaissance')
    await expect(send({ kind: 'stop' }, false, 'child')).rejects.toThrow(/role/)
    await expect(send({ kind: 'approve', planId: 'unknown' })).rejects.toThrow(/operator/)
    await expect(bindDelegatedChild(controller, 'child', 'grandchild', assetId, 'reviewer')).rejects.toThrow('Coordinator role required')
    expect(controller.view('unbound').records).toEqual([])
  })

  it('does not complete checks without evidence or execute unapproved plans', async () => {
    const { controller, send, assetId, journal } = await harness()
    const run = vi.fn(async () => ({
      bytes: Buffer.from('observed'),
      mediaType: 'text/plain',
      summary: 'Observed fixture',
      incomplete: false,
      toolVersion: 'fixture',
    }))
    controller.providers.register({ id: 'fixture', operations: ['inspect'], resolve: request => request, run })
    await send({
      kind: 'check',
      check: {
        assetId,
        title: 'Inspect',
        phase: 'recon',
        criterion: 'Record the observation',
        dependencies: [],
        evidenceIds: [],
      },
    })
    const check = controller.view('parent').records.find(item => item.kind === 'check')!
    if (check.kind !== 'check') throw new Error('Missing check')
    await expect(send({ kind: 'finish', checkId: check.value.id, evidenceIds: [], rationale: 'done' })).rejects.toThrow(
      /evidence/,
    )
    await send({
      kind: 'plan',
      checkId: check.value.id,
      operation: {
        provider: 'fixture',
        operation: 'inspect',
        environmentId: 'local',
        assetId,
        parameters: {},
        impact: 'observe',
      },
      hypothesis: 'Observe the sample',
      expectedObservation: 'fixture',
      impact: 'Read only',
      cleanup: 'none',
      durationMs: 100,
    })
    const plan = controller.view('parent').records.find(item => item.kind === 'plan')!
    if (plan.kind !== 'plan') throw new Error('Missing plan')
    await expect(
      controller.execute('parent', plan.value.id, 'run', journal.view().revision, 'call', new AbortController().signal),
    ).rejects.toThrow(/approved/)
    expect(run).not.toHaveBeenCalled()
    await send({ kind: 'approve', planId: plan.value.id }, true)
    const env = controller.options.environments[0]!
    const oldCwd = env.cwd
    env.cwd = oldCwd + '-changed'
    await expect(controller.execute('parent', plan.value.id, 'changed-env', journal.view().revision, 'call', new AbortController().signal)).rejects.toThrow(/configuration changed/)
    env.cwd = oldCwd
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 120000)
    try {
      await expect(controller.execute('parent', plan.value.id, 'expired', journal.view().revision, 'call', new AbortController().signal)).rejects.toThrow(/approved/)
      expect(run).not.toHaveBeenCalled()
    } finally {
      clock.mockRestore()
    }
    await controller.execute(
      'parent',
      plan.value.id,
      'run',
      journal.view().revision,
      'call',
      new AbortController().signal,
    )
    await controller.execute(
      'parent',
      plan.value.id,
      'run',
      journal.view().revision,
      'call',
      new AbortController().signal,
    )
    expect(run).toHaveBeenCalledTimes(1)
    const evidence = controller.view('parent').records.find(item => item.kind === 'evidence')
    expect(evidence).toMatchObject({ value: { incomplete: false, summary: 'Observed fixture' } })
    if (evidence?.kind !== 'evidence') throw new Error('Missing evidence')
    await send({ kind: 'finish', checkId: check.value.id, evidenceIds: [evidence.value.id], rationale: 'Observed fixture' })
    await send({ kind: 'check', check: { assetId, title: 'Review entry points', phase: 'surface', criterion: 'Document entry points', dependencies: [check.value.id], evidenceIds: [] } })
    const downstream = controller.view('parent').records.find(item => item.kind === 'check' && item.value.phase === 'surface')!
    if (downstream.kind !== 'check') throw new Error('Missing downstream check')
    await send({ kind: 'finish', checkId: downstream.value.id, evidenceIds: [evidence.value.id], rationale: 'Review fixture' })
    await send({ kind: 'reopen', checkId: check.value.id, rationale: 'New evidence requires another inventory' })
    expect(controller.view('parent').records.filter(item => item.kind === 'check').every(item => item.value.status === 'planned')).toBe(true)
    expect(controller.view('parent').records.find(item => item.kind === 'plan')).toMatchObject({ value: { status: 'revoked' } })

  })

  it.each(['throw', 'failure', 'cancelled', 'cancelled-before-commit', 'incomplete'] as const)('retains %s static observations without replaying their provider', async (outcome) => {
    const { controller, artifacts, assetId } = await harness()
    const abort = new AbortController()
    const bytes = Buffer.from('partial original observations')
    if (outcome === 'cancelled-before-commit') {
      const put = artifacts.put.bind(artifacts)
      vi.spyOn(artifacts, 'put').mockImplementationOnce(async (...args) => {
        const artifact = await put(...args)
        abort.abort(new Error('Collection cancelled before commit'))
        return artifact
      })
    }
    const run = vi.fn(async () => {
      if (outcome === 'throw') throw new Error('Provider rejected collection')
      if (outcome === 'cancelled') abort.abort(new Error('Collection cancelled'))
      return { bytes, mediaType: 'text/plain', summary: 'Partial observations', incomplete: true,
        toolVersion: 'fixture', ...(outcome === 'failure' ? { failure: 'Provider failed after collection' } : {}) }
    })
    controller.providers.register({ id: 'ghidra', operations: ['functions'], resolve: request => request, run })
    const operation: AnalysisOperation = { provider: 'ghidra', operation: 'functions', environmentId: 'local',
      assetId, parameters: {}, impact: 'observe' }
    const collect = () => controller.observe('parent', operation, 'failed-static', abort.signal)
    for (let attempt = 0; attempt < 2; attempt++) {
      if (outcome === 'incomplete') await expect(collect()).resolves.toMatchObject({ kind: 'evidence', value: { incomplete: true } })
      else await expect(collect()).rejects.toThrow(/Provider|cancelled/)
    }
    expect(run).toHaveBeenCalledTimes(1)
    const evidence = controller.view('parent').records.filter(item => item.kind === 'evidence')
    expect(evidence).toHaveLength(1)
    expect(await artifacts.read(evidence[0]!.value.artifact)).toEqual(outcome === 'throw'
      ? Buffer.from('Provider rejected collection') : bytes)
    expect(evidence[0]!.value.failure === undefined).toBe(outcome === 'incomplete')
    await expect(controller.manageEnvironment('local', async () => 'released')).resolves.toBe('released')
  })

  it.each(['throw', 'failure', 'cancelled', 'cancelled-before-commit', 'incomplete'] as const)('retains %s execution output and replays its settled status', async (outcome) => {
    const { controller, artifacts, send, assetId, journal } = await harness()
    const abort = new AbortController()
    const bytes = Buffer.from('original validation output')
    if (outcome === 'cancelled-before-commit') {
      const put = artifacts.put.bind(artifacts)
      vi.spyOn(artifacts, 'put').mockImplementationOnce(async (...args) => {
        const artifact = await put(...args)
        abort.abort(new Error('Validation cancelled before commit'))
        return artifact
      })
    }
    const run = vi.fn(async () => {
      if (outcome === 'throw') throw new Error('Provider rejected validation')
      if (outcome === 'cancelled') abort.abort(new Error('Validation cancelled'))
      return { bytes, mediaType: 'text/plain', summary: 'Partial validation', incomplete: true,
        toolVersion: 'fixture', ...(outcome === 'failure' ? { failure: 'Provider failed after validation' } : {}) }
    })
    controller.providers.register({ id: 'fixture', operations: ['inspect'], resolve: request => request, run })
    await send({ kind: 'check', check: { assetId, title: 'Inspect', phase: 'validation', criterion: 'Record observations', dependencies: [], evidenceIds: [] } })
    const check = controller.view('parent').records.find(item => item.kind === 'check')!
    if (check.kind !== 'check') throw new Error('Expected check')
    await send({ kind: 'plan', checkId: check.value.id, operation: { provider: 'fixture', operation: 'inspect',
      environmentId: 'local', assetId, parameters: {}, impact: 'observe' }, hypothesis: 'Inspect target',
    expectedObservation: 'Bounded observations', impact: 'Read only', cleanup: 'None', durationMs: 100 })
    const plan = controller.view('parent').records.find(item => item.kind === 'plan')!
    if (plan.kind !== 'plan') throw new Error('Expected plan')
    await send({ kind: 'approve', planId: plan.value.id }, true)
    const execute = () => controller.execute('parent', plan.value.id, 'failed-execution', journal.view().revision, 'validation', abort.signal)
    for (let attempt = 0; attempt < 2; attempt++) {
      if (outcome === 'incomplete') await expect(execute()).resolves.toHaveProperty('records')
      else await expect(execute()).rejects.toThrow(/Provider|cancelled/)
    }
    expect(run).toHaveBeenCalledTimes(1)
    const evidence = controller.view('parent').records.filter(item => item.kind === 'evidence')
    expect(evidence).toHaveLength(1)
    expect(await artifacts.read(evidence[0]!.value.artifact)).toEqual(outcome === 'throw'
      ? Buffer.from('Provider rejected validation') : bytes)
    expect(controller.view('parent').records.find(item => item.kind === 'execution')).toMatchObject({
      value: { status: outcome === 'incomplete' ? 'completed' : outcome.startsWith('cancelled') ? 'interrupted' : 'failed' },
    })
    await expect(controller.manageEnvironment('local', async () => 'released')).resolves.toBe('released')
  })

  it('rebuilds Chinese and identifier search from committed records', async () => {
    const { root, journal, send } = await harness()
    await send({
      kind: 'remember', entry: { ...entry, title: '边界 检查 parse_packet', summary: '检查长度参数', conditions: 'Owned fixture', tags: ['native'] },
    })
    const index = new SecuritySearchIndex(join(root, 'search.sqlite'))
    onTestFinished(() => {
      index.close()
    })
    index.rebuild(journal.view().records)
    const project = journal.view().records.find(item => item.kind === 'engagement')!
    if (project.kind !== 'engagement') throw new Error('Missing project')
    expect(index.search(project.value.id, '边界', 10)).toHaveLength(1)
    expect(index.search(project.value.id, 'parse_packet', 10)).toHaveLength(1)
    expect(index.search('foreign', '边界', 10)).toEqual([])
  })
  it('rebuilds a corrupt derived index without changing committed evidence', async () => {
    const { root, journal, send } = await harness()
    await send({ kind: 'remember', entry: { ...entry, title: '恢复 索引', summary: 'retained evidence' } })
    const before = journal.view()
    const path = join(root, 'search.sqlite')
    await writeFile(path, 'invalid sqlite bytes')
    const index = new SecuritySearchIndex(path)
    try {
      index.rebuild(before.records)
      const project = before.records.find(item => item.kind === 'engagement')!
      expect(index.search(project.value.id, '恢复', 10)).toHaveLength(1)
      expect(journal.view()).toEqual(before)
    } finally {
      index.close()
    }
  })

  it('publishes concurrent identical artifacts without partial reads', async () => {
    const { artifacts } = await harness()
    const bytes = Buffer.alloc(32768, 17)
    const results = await Promise.all(Array.from({ length: 8 }, () => artifacts.put(bytes, 'application/octet-stream')))
    expect(new Set(results.map(item => item.sha256)).size).toBe(1)
    expect(await artifacts.read(results[0]!)).toEqual(bytes)
  })

  it('waits for static observation cleanup when a project is stopped', async () => {
    const { controller, assetId, send } = await harness()
    let entered!: () => void
    const began = new Promise<void>((resolve) => {
      entered = resolve
    })
    let release!: () => void
    const cleanup = new Promise<void>((resolve) => {
      release = resolve
    })
    let cancelled!: () => void
    const aborted = new Promise<void>((resolve) => {
      cancelled = resolve
    })
    controller.providers.register({
      id: 'ghidra',
      operations: ['functions'],
      resolve: request => request,
      run: async (_request, context) => {
        entered()
        await new Promise<void>((resolve) => {
          context.signal.addEventListener(
            'abort',
            () => {
              cancelled()
              resolve()
            },
            { once: true },
          )
        })
        await cleanup
        throw new Error('cancelled')
      },
    })
    const observation = controller.observe(
      'parent',
      {
        provider: 'ghidra',
        operation: 'functions',
        environmentId: 'local',
        assetId,
        parameters: {},
        impact: 'observe',
      },
      'static',
      new AbortController().signal,
    )
    const rejected = expect(observation).rejects.toThrow('cancelled')
    await began
    const stopping = send({ kind: 'stop' })
    await aborted
    let settled = false
    void stopping.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)
    release()
    await stopping
    await rejected
    expect(controller.view('parent').records.find(item => item.kind === 'evidence')).toMatchObject({
      value: { incomplete: true, failure: 'cancelled' },
    })
    await expect(
      controller.observe(
        'parent',
        {
          provider: 'ghidra',
          operation: 'functions',
          environmentId: 'local',
          assetId,
          parameters: {},
          impact: 'observe',
        },
        'another',
        new AbortController().signal,
      ),
    ).rejects.toThrow('stopped')
  })

  it('marks unsettled executions interrupted without replaying external actions', async () => {
    const { controller, journal, send, assetId } = await harness()
    await send({
      kind: 'check',
      check: {
        assetId,
        title: 'Interrupted',
        phase: 'recon',
        criterion: 'Observe target',
        dependencies: [],
        evidenceIds: [],
      },
    })
    const check = journal.view().records.find(item => item.kind === 'check')!
    if (check.kind !== 'check') throw new Error('Missing check')
    await journal.commit('crashed-start', journal.view().revision, {}, () => [
      { kind: 'check', value: { ...check.value, status: 'running' } },
      {
        kind: 'execution',
        value: {
          id: 'run',
          engagementId: check.value.engagementId,
          assetId,
          planId: 'plan',
          status: 'running',
          detail: '',
        },
      },
    ])
    await controller.recover()
    expect(journal.view().records.find(item => item.kind === 'execution')).toMatchObject({
      value: { status: 'interrupted' },
    })
    expect(journal.view().records.find(item => item.kind === 'check')).toMatchObject({
      value: { status: 'interrupted' },
    })
    await send({ kind: 'reconcile', checkId: check.value.id, rationale: 'Verified the process and script are absent' })
    expect(journal.view().records.find(item => item.kind === 'check')).toMatchObject({ value: { status: 'planned' } })
  })
})

async function reviewedFixture(incomplete = false, phase: 'validation' | 'recon' = 'validation') {
  const fixture = await harness()
  const { controller, send, assetId, journal } = fixture
  controller.providers.register({ id: 'web-fixture', operations: ['request'], resolve: request => request,
    run: async () => ({ bytes: Buffer.from('HTTP fixture observation'), mediaType: 'text/plain', summary: 'Observed response', incomplete, toolVersion: 'fixture' }) })
  await send({ kind: 'check', check: { assetId, title: 'Controlled validation', phase, criterion: 'Compare response', dependencies: [], evidenceIds: [] } })
  const check = controller.view('parent').records.find(item => item.kind === 'check')!
  if (check.kind !== 'check') throw new Error('Missing check')
  await send({ kind: 'plan', checkId: check.value.id, operation: { provider: 'web-fixture', operation: 'request', environmentId: 'local', assetId, parameters: {}, impact: 'observe' },
    hypothesis: 'Endpoint exposes fixture', expectedObservation: 'Fixture response', impact: 'Read only', cleanup: 'Connection closed', durationMs: 100 })
  const plan = controller.view('parent').records.find(item => item.kind === 'plan')!
  if (plan.kind !== 'plan') throw new Error('Missing plan')
  await send({ kind: 'approve', planId: plan.value.id }, true)
  await controller.execute('parent', plan.value.id, randomUUID(), journal.view().revision, 'review-fixture', new AbortController().signal)
  const evidence = controller.view('parent').records.find(item => item.kind === 'evidence')!
  if (evidence.kind !== 'evidence') throw new Error('Missing evidence')
  await send({ kind: 'finding', finding: { assetId, title: 'Fixture claim', explanation: 'Response content', conditions: 'Owned fixture', evidenceIds: [evidence.value.id], status: 'suspected', review: '' } })
  const finding = controller.view('parent').records.find(item => item.kind === 'finding')!
  if (finding.kind !== 'finding') throw new Error('Missing finding')
  await bindDelegatedChild(controller, 'parent', 'reviewer', assetId, 'reviewer')
  const review = async (verdict: 'confirmed' | 'refuted' | 'inconclusive') => {
    const view = await controller.review('reviewer', { findingId: finding.value.id, findingHash: findingHash(finding.value), basis: 'runtime', verdict,
      supportingEvidenceIds: verdict === 'confirmed' ? [evidence.value.id] : [], opposingEvidenceIds: verdict === 'refuted' ? [evidence.value.id] : [],
      explanation: 'Independent assessment of stored response', uncertainty: verdict === 'inconclusive' ? 'Insufficient coverage' : '' })
    const record = view.records.findLast(item => item.kind === 'review')!
    if (record.kind !== 'review') throw new Error('Missing review')
    return record.value.id
  }
  return { ...fixture, evidence: evidence.value, finding: finding.value, review }
}

it.each(['confirmed', 'refuted', 'inconclusive'] as const)('derives %s from an independent version-bound review and exports it', async (verdict) => {
  const { controller, send, review, artifacts } = await reviewedFixture()
  await send({ kind: 'conclude', reviewId: await review(verdict) })
  await send({ kind: 'report' })
  const projectId = controller.projects()[0]!.id
  const view = controller.projectView(projectId)
  expect(view.records.some(item => item.kind === 'binding')).toBe(false)
  expect(view.records.find(item => item.kind === 'finding')?.value).toMatchObject({ status: verdict })
  const report = view.records.find(item => item.kind === 'report')!
  if (report.kind !== 'report') throw new Error('Missing report')
  expect((await artifacts.read(report.value.markdown)).toString()).toContain(
    verdict === 'confirmed' ? '已确认' : verdict === 'inconclusive' ? '未定' : '当前没有可确认的目标风险',
  )
  expect(JSON.parse((await artifacts.read(report.value.json)).toString())).toMatchObject({ revision: report.value.revision })
})
it('generates a report outside the journal queue and rejects stale analysis', async () => {
  const entered = Promise.withResolvers<undefined>()
  const output = Promise.withResolvers<string>()
  const generate = vi.fn(async () => { entered.resolve(undefined); return output.promise })
  const { controller, journal, send } = await harness(generate)
  const command = { operationId: 'report-pending', expectedRevision: journal.view().revision, action: { kind: 'report' } }
  const first = controller.command('parent', command)
  const second = controller.command('parent', command)
  await entered.promise
  await send({ kind: 'remember', entry })
  output.resolve(JSON.stringify({ assessment: 'Binary safety has not been assessed.', findings: [], excludedIndices: [],
    lessons: [], uncovered: ['No implementation paths were examined.'] }))
  await expect(first).rejects.toThrow(/changed/)
  await expect(second).rejects.toThrow(/changed/)
  expect(generate).toHaveBeenCalledTimes(1)
  expect(controller.view('parent').records.some(item => item.kind === 'report')).toBe(false)
})

it('replays a completed report without another model request', async () => {
  const generate = vi.fn(async () => JSON.stringify({ assessment: 'Binary safety has not been assessed.', findings: [],
    excludedIndices: [], lessons: [], uncovered: ['Only file identity is known.'] }))
  const { controller, journal } = await harness(generate)
  const command = { operationId: 'report-once', expectedRevision: journal.view().revision, action: { kind: 'report' } }
  await controller.command('parent', command)
  await controller.command('parent', command)
  expect(generate).toHaveBeenCalledTimes(1)
  expect(controller.view('parent').records.filter(item => item.kind === 'report')).toHaveLength(1)
})
it('does not publish a report after its request is cancelled', async () => {
  const entered = Promise.withResolvers<undefined>()
  const output = Promise.withResolvers<string>()
  const generate = vi.fn(async () => { entered.resolve(undefined); return output.promise })
  const { controller, journal } = await harness(generate)
  const abort = new AbortController()
  const pending = controller.command('parent', { operationId: 'report-cancelled',
    expectedRevision: journal.view().revision, action: { kind: 'report' } }, false, abort.signal)
  await entered.promise
  abort.abort(new Error('Cancelled'))
  output.resolve(JSON.stringify({ assessment: 'Unknown safety.', findings: [], excludedIndices: [],
    lessons: [], uncovered: ['No implementation was inspected.'] }))
  await expect(pending).rejects.toThrow('Cancelled')
  expect(controller.view('parent').records.some(item => item.kind === 'report')).toBe(false)
})
it.each([{ operation: 'hex', accepted: true }, { operation: 'strings', accepted: false }] as const)(
  'requires implementation evidence for a static conclusion from $operation', async ({ operation, accepted }) => {
    const { controller, send, assetId } = await harness()
    controller.providers.register(new BinaryProvider())
    const observed = await controller.observe('parent', { provider: 'binary', operation, assetId,
      environmentId: 'local', parameters: {}, impact: 'observe' }, 'static-' + operation, new AbortController().signal)
    if (observed.kind !== 'evidence') throw new Error('Missing observation')
    await send({ kind: 'finding', finding: { assetId, title: 'Unchecked parser length',
      explanation: 'A controlled length may reach a copy.', conditions: 'Attacker supplies length',
      evidenceIds: [observed.value.id], status: 'suspected', review: '' } })
    const finding = controller.view('parent').records.find(item => item.kind === 'finding')
    if (finding?.kind !== 'finding') throw new Error('Missing finding')
    await bindDelegatedChild(controller, 'parent', 'static-reviewer', assetId, 'reviewer')
    const reviewed = await controller.review('static-reviewer', { findingId: finding.value.id,
      findingHash: findingHash(finding.value), basis: 'static', verdict: 'confirmed',
      supportingEvidenceIds: [observed.value.id], opposingEvidenceIds: [],
      explanation: 'The input length controls the copy without a remaining-size check.', uncertainty: '' })
    const review = reviewed.records.find(item => item.kind === 'review')
    if (review?.kind !== 'review') throw new Error('Missing review')
    const conclusion = send({ kind: 'conclude', reviewId: review.value.id })
    if (accepted) {
      await conclusion
      expect(controller.view('parent').records.find(item => item.kind === 'finding')?.value.status).toBe('confirmed')
    } else await expect(conclusion).rejects.toThrow(/implementation evidence/)
  })

it('excludes pure workbench notes without hiding them from durable history', async () => {
  const { send, journal, controller } = await harness()
  await send({ kind: 'remember', entry: { ...entry, title: 'Tool JSON issue', summary: 'Fix JSON braces in tool calls.' } })
  const source = journal.view().records.find(item => item.kind === 'knowledge')
  if (source?.kind !== 'knowledge') throw new Error('Missing knowledge')
  await refineKnowledge(journal, controller.binding('parent')!.engagementId,
    async () => JSON.stringify({ entries: [], excludedSourceIds: [source.value.id] }), limits, new AbortController().signal)
  expect(controller.view('parent').records.some(item => item.kind === 'knowledge')).toBe(false)
  expect(controller.sharedKnowledge()).toHaveLength(0)
  expect(journal.view().records.find(item => item.kind === 'knowledge')?.value).toMatchObject({ excluded: true })
})
it('invalidates reviews when claim content changes and rejects forged review authors', async () => {
  const { controller, send, review, finding } = await reviewedFixture()
  const reviewId = await review('confirmed')
  await expect(controller.review('parent', { findingId: finding.id, findingHash: findingHash(finding), basis: 'runtime', verdict: 'confirmed', supportingEvidenceIds: finding.evidenceIds, opposingEvidenceIds: [], explanation: 'self review', uncertainty: '' })).rejects.toThrow(/reviewer/)
  await send({ kind: 'revise-finding', findingId: finding.id, title: 'Changed claim', explanation: finding.explanation, conditions: finding.conditions, evidenceIds: finding.evidenceIds })
  await expect(send({ kind: 'conclude', reviewId })).rejects.toThrow(/changed/)
})
it.each([{ incomplete: true, phase: 'validation' as const }, { incomplete: false, phase: 'recon' as const }])('rejects a conclusive review without complete validation observations: %j', async ({ incomplete, phase }) => {
  const { send, review } = await reviewedFixture(incomplete, phase)
  await expect(send({ kind: 'conclude', reviewId: await review('confirmed') })).rejects.toThrow(/complete|validation/)
})
it('rejects foreign evidence and requires operator ownership to register a Web target', async () => {
  const { controller, send, finding } = await reviewedFixture()
  await expect(controller.review('reviewer', { findingId: finding.id, findingHash: findingHash(finding), basis: 'runtime', verdict: 'confirmed', supportingEvidenceIds: ['foreign'], opposingEvidenceIds: [], explanation: 'Foreign reference', uncertainty: '' })).rejects.toThrow(/another asset/)
  await expect(send({ kind: 'web-target', environmentId: 'local', label: 'Web', pathPrefix: '/' })).rejects.toThrow(/operator/)
  await expect(send({ kind: 'web-target', environmentId: 'local', label: 'Web', pathPrefix: '/' }, true)).rejects.toThrow(/laboratory/)
})

const entry = { category: 'experience' as const, title: 'Check bounds', summary: 'Validate lengths before reading.', conditions: 'Binary parsers', actions: ['Check available bytes'], pitfalls: ['Do not trust declared lengths'], tags: ['parsing'] }
const limits = { maxInputBytes: 32768, maxOutputBytes: 16384 }

it('consolidates duplicate legacy notes atomically and reconstructs structured results after reopen', async () => {
  const { journal, controller, ctx } = await harness()
  await journal.commit('legacy-notes', undefined, {}, () => [
    { kind: 'knowledge', value: { id: 'legacy-a', engagementId: controller.binding('parent')!.engagementId, title: 'Bounds', content: 'Check lengths. Evidence: internal-log', conditions: 'Binary parsers', tags: [], evidenceIds: [], published: false } },
    { kind: 'knowledge', value: { id: 'legacy-b', engagementId: controller.binding('parent')!.engagementId, title: 'Validate sizes', content: 'Check available bytes.', conditions: 'Binary parsers', tags: [], evidenceIds: [], published: false } },
  ])
  const source = journal.view().records.filter(item => item.kind === 'knowledge')
  const project = controller.binding('parent')!.engagementId
  const generate = vi.fn(async (_prompt: string) => JSON.stringify({
    entries: [{ sourceIds: source.map(item => item.value.id), entry }], excludedSourceIds: [],
  }))
  await refineKnowledge(journal, project, generate, limits, new AbortController().signal)
  expect(generate.mock.calls[0]?.[0]).not.toContain('evidenceIds')
  const visible = controller.view('parent').records.filter(item => item.kind === 'knowledge')
  expect(visible).toHaveLength(1)
  expect(visible[0]?.value).toMatchObject({ entry, content: entry.summary, evidenceIds: [], published: false })
  await refineKnowledge(journal, project, generate, limits, new AbortController().signal)
  expect(generate).toHaveBeenCalledTimes(1)
  const before = journal.view()
  await journal.close()
  const reopened = await openSecurityJournal(ctx)
  try { expect(reopened.view()).toEqual(before) } finally { await reopened.close() }
})

it.each(['foreign', 'missing', 'repeated', 'category', 'extra-field', 'oversized'])('preserves notes when refinement output is %s', async (kind) => {
  const { send, journal, controller } = await harness()
  await send({ kind: 'remember', entry })
  const source = journal.view().records.filter(item => item.kind === 'knowledge')
  const id = source[0]!.value.id
  const result = { entries: [{ sourceIds: kind === 'foreign' ? ['foreign'] : kind === 'missing' ? [] : kind === 'repeated' ? [id, id] : [id],
    entry: { ...entry, ...(kind === 'category' ? { category: 'retrospective' } : {}), ...(kind === 'extra-field' ? { reasoning: 'private trace' } : {}), ...(kind === 'oversized' ? { summary: 'x'.repeat(401) } : {}) } }], excludedSourceIds: [] }
  await expect(refineKnowledge(journal, controller.binding('parent')!.engagementId, async () => JSON.stringify(result), limits, new AbortController().signal)).rejects.toThrow()
  expect(journal.view().records.filter(item => item.kind === 'knowledge')).toEqual(source)
  expect(journal.view().records.find(item => item.kind === 'knowledge-maintenance')?.value).toMatchObject({ status: 'failed' })
})

it('rejects concurrent edits and retains the newly saved note', async () => {
  const { send, journal, controller } = await harness()
  await send({ kind: 'remember', entry })
  const source = journal.view().records.filter(item => item.kind === 'knowledge')
  const entered = Promise.withResolvers<undefined>()
  const response = Promise.withResolvers<string>()
  const pending = refineKnowledge(journal, controller.binding('parent')!.engagementId, () => { entered.resolve(undefined); return response.promise }, limits, new AbortController().signal)
  const rejected = expect(pending).rejects.toThrow(/changed/)
  await entered.promise
  await send({ kind: 'remember', entry: { ...entry, title: 'New note' } })
  response.resolve(JSON.stringify({ entries: [{ sourceIds: [source[0]!.value.id], entry }], excludedSourceIds: [] }))
  await rejected
  expect(controller.view('parent').records.filter(item => item.kind === 'knowledge')).toHaveLength(2)
})

it('requires a new review after a shared lesson changes', async () => {
  const { send, journal, controller } = await harness()
  await send({ kind: 'remember', entry })
  const source = journal.view().records.filter(item => item.kind === 'knowledge')
  await send({ kind: 'publish', knowledgeId: source[0]!.value.id }, true)
  expect(controller.sharedKnowledge()).toHaveLength(1)
  await refineKnowledge(journal, controller.binding('parent')!.engagementId, async () => JSON.stringify({ entries: [{ sourceIds: [source[0]!.value.id], entry: { ...entry, summary: 'Check length before each read.' } }], excludedSourceIds: [] }), limits, new AbortController().signal)
  expect(controller.sharedKnowledge()).toHaveLength(0)
})

it('bounds framed input before dispatch and does not commit an aborted result', async () => {
  const { send, journal, controller } = await harness()
  await send({ kind: 'remember', entry })
  const source = journal.view().records.filter(item => item.kind === 'knowledge')
  const project = controller.binding('parent')!.engagementId
  const generate = vi.fn(async () => '')
  await expect(refineKnowledge(journal, project, generate,
    { ...limits, maxInputBytes: 1 }, new AbortController().signal)).rejects.toThrow(/input exceeds/)
  expect(generate).not.toHaveBeenCalled()
  const abort = new AbortController()
  await expect(refineKnowledge(journal, project, async () => {
    abort.abort(new Error('cancelled'))
    return JSON.stringify({ entries: [{ sourceIds: [source[0]!.value.id], entry }], excludedSourceIds: [] })
  }, limits, abort.signal)).rejects.toThrow('cancelled')
  expect(journal.view().records.filter(item => item.kind === 'knowledge')).toEqual(source)
  expect(() => refinementSchema.parse({ entries: [], evidence: [] })).toThrow()
})

it('keeps historical child summaries and file assets readable on reopen', async () => {
  const { controller, journal, ctx, assetId } = await harness()
  await bindDelegatedChild(controller, 'parent', 'source-reviewer', assetId, 'reviewer')
  const report = { summary: 'No complete validation evidence.', evidenceIds: [], uncertainty: 'Offline pending', nextSteps: ['Run an approved plan'] }
  const binding = controller.binding('source-reviewer')!
  await journal.commit(randomUUID(), undefined, { historicalReport: report }, () => [
    { kind: 'binding', value: { ...binding, report } },
  ])
  expect(controller.view('parent').records.filter(item => item.kind === 'binding').map(item => item.value.report)).toContainEqual(report)
  const records = journal.view()
  await journal.close()
  const reopened = await openSecurityJournal(ctx)
  try {
    expect(reopened.view()).toEqual(records)
    expect(reopened.view().records.find(item => item.kind === 'asset')?.value).toMatchObject({ id: assetId, format: 'pe' })
  } finally { await reopened.close() }
})

it('retains assignment scope across parent project changes and records coordinator disposition separately from findings', async () => {
  const { controller, send, assetId, journal } = await harness()
  const originalProject = controller.binding('parent')!.engagementId
  await send({ kind: 'checkpoint', phase: 'assessment', title: 'Length handling', reason: 'Inspect a plausible path',
    summary: '', next: 'Read the parser', evidenceIds: [], findingIds: [] })
  const checkpointId = controller.checkpointId('parent')
  const input = { assetId, role: 'reverse-analyst' as const, task: 'assessment' as const,
    question: 'Does the parser check the declared length?', criterion: 'Identify validation or the missing check', reason: 'Inspect an independent parser' }
  const assignment = await controller.admitDelegation('parent', 'parser-call', input)
  expect(await controller.admitDelegation('parent', 'parser-call', input)).toEqual(assignment)
  await expect(controller.admitDelegation('parent', 'parser-call', { ...input, question: 'Another question' })).rejects.toThrow('different input')
  await expect(send({ kind: 'delegation-disposition', delegationId: assignment.id, decision: 'accepted', reason: 'Still running' })).rejects.toThrow('settle')
  await expect(controller.admitDelegation('parent', 'early-retry', { ...input, retryOf: assignment.id })).rejects.toThrow('settle')
  await send({ kind: 'create', title: 'Other task', objective: 'Inspect other data', environmentIds: ['local'], maxAttempts: 1 }, true)
  await controller.bindDelegationChild(assignment.id, 'parser-child')
  expect(controller.binding('parser-child')).toMatchObject({ engagementId: originalProject, checkpointId, role: 'reverse-analyst', assetIds: [assetId] })
  const report = { summary: 'The parser needs a closer read.', evidenceIds: [], uncertainty: 'Caller conditions unknown', nextSteps: ['Read caller'] }
  await controller.settleDelegation(assignment.id, { status: 'completed', report })
  expect(controller.view('parent').records.some(item => item.kind === 'delegation')).toBe(false)
  await expect(send({ kind: 'delegation-disposition', delegationId: assignment.id, decision: 'accepted', reason: 'Outside scope' })).rejects.toThrow('foreign')
  await send({ kind: 'select', engagementId: originalProject }, true)
  await expect(send({ kind: 'delegation-disposition', delegationId: assignment.id, decision: 'accepted', reason: 'Child cannot accept' }, false, 'parser-child')).rejects.toThrow('role')
  await send({ kind: 'delegation-disposition', delegationId: assignment.id, decision: 'needs-more', reason: 'Caller conditions are unresolved' })
  const retry = await controller.admitDelegation('parent', 'caller-call', { ...input, question: 'Who supplies the length?', retryOf: assignment.id })
  expect(retry.id).not.toBe(assignment.id)
  expect(retry.retryOf).toBe(assignment.id)
  await send({ kind: 'delegation-disposition', delegationId: assignment.id, decision: 'accepted', reason: 'Use the limitation in planning' })
  expect(journal.view().records.filter(item => item.kind === 'delegation').map(item => item.value)).toMatchObject([
    { id: assignment.id, status: 'completed', report, disposition: { decision: 'accepted' } },
    { id: retry.id, status: 'pending' },
  ])
  expect(controller.view('parent').records.some(item => item.kind === 'finding' || item.kind === 'review')).toBe(false)
  expect(controller.binding('parser-child')?.report).toBeUndefined()
})

it('rejects foreign evidence and keeps failed and interrupted assignments available after reopening', async () => {
  const { controller, send, assetId, journal, ctx } = await harness()
  const input = { assetId, role: 'reconnaissance' as const, task: 'inventory' as const, question: 'List entry points', criterion: 'Return observed names' }
  const failed = await controller.admitDelegation('parent', 'failed-call', input)
  await controller.bindDelegationChild(failed.id, 'failed-child')
  await expect(controller.settleDelegation(failed.id, { status: 'completed', report: {
    summary: 'Foreign observation', evidenceIds: ['outside'], uncertainty: '', nextSteps: [],
  } })).rejects.toThrow('foreign')
  await controller.settleDelegation(failed.id, { status: 'failed', detail: 'Provider cleanup failed' })
  await expect(send({ kind: 'delegation-disposition', delegationId: failed.id, decision: 'accepted', reason: 'Invalid acceptance' })).rejects.toThrow('completed structured report')
  await send({ kind: 'delegation-disposition', delegationId: failed.id, decision: 'rejected', reason: 'No usable result' })
  const pending = await controller.admitDelegation('parent', 'pending-call', input)
  const running = await controller.admitDelegation('parent', 'running-call', input)
  await controller.bindDelegationChild(running.id, 'running-child')
  await controller.recover()
  expect(controller.delegationForCall('parent', 'pending-call')).toMatchObject({ id: pending.id, status: 'interrupted' })
  expect(controller.delegationForCall('parent', 'running-call')).toMatchObject({ id: running.id, status: 'interrupted', child: { childSessionId: 'running-child' } })
  expect(controller.delegationForCall('parent', 'failed-call')).toMatchObject({ status: 'failed', disposition: { decision: 'rejected' } })
  const saved = journal.view()
  await journal.close()
  const reopened = await openSecurityJournal(ctx)
  try { expect(reopened.view()).toEqual(saved) } finally { await reopened.close() }
})
