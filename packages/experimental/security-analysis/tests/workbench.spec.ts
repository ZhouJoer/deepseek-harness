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
import { ArtifactStore } from '../src/workbench/artifacts.ts'
import { SecurityController } from '../src/workbench/controller.ts'
import type { SecurityCommand } from '../src/workbench/controller.ts'
import { findingHash } from '../src/workbench/assessment.ts'
import { refineKnowledge, refinementSchema } from '../src/workbench/knowledge.ts'
import { SecuritySearchIndex } from '../src/workbench/search.ts'

async function harness() {
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
  })
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
    await controller.bindChild('parent', 'child', [assetId], 'reconnaissance')
    expect(controller.binding('child')?.role).toBe('reconnaissance')
    await expect(send({ kind: 'stop' }, false, 'child')).rejects.toThrow(/role/)
    await expect(send({ kind: 'approve', planId: 'unknown' })).rejects.toThrow(/operator/)
    await expect(controller.bindChild('child', 'grandchild', [assetId], 'reviewer')).rejects.toThrow(/Nested/)
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
    const rejected = expect(observation).resolves.toMatchObject({ kind: 'evidence', value: { incomplete: true, failure: 'cancelled' } })
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
  await controller.bindChild('parent', 'reviewer', [assetId], 'reviewer')
  const review = async (verdict: 'confirmed' | 'refuted' | 'inconclusive') => {
    const view = await controller.review('reviewer', { findingId: finding.value.id, findingHash: findingHash(finding.value), verdict,
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
  expect((await artifacts.read(report.value.markdown)).toString()).toContain(verdict)
  expect(JSON.parse((await artifacts.read(report.value.json)).toString())).toMatchObject({ revision: report.value.revision })
})
it('invalidates reviews when claim content changes and rejects forged review authors', async () => {
  const { controller, send, review, finding } = await reviewedFixture()
  const reviewId = await review('confirmed')
  await expect(controller.review('parent', { findingId: finding.id, findingHash: findingHash(finding), verdict: 'confirmed', supportingEvidenceIds: finding.evidenceIds, opposingEvidenceIds: [], explanation: 'self review', uncertainty: '' })).rejects.toThrow(/reviewer/)
  await send({ kind: 'revise-finding', findingId: finding.id, title: 'Changed claim', explanation: finding.explanation, conditions: finding.conditions, evidenceIds: finding.evidenceIds })
  await expect(send({ kind: 'conclude', reviewId })).rejects.toThrow(/changed/)
})
it.each([{ incomplete: true, phase: 'validation' as const }, { incomplete: false, phase: 'recon' as const }])('rejects a conclusive review without complete validation observations: %j', async ({ incomplete, phase }) => {
  const { send, review } = await reviewedFixture(incomplete, phase)
  await expect(send({ kind: 'conclude', reviewId: await review('confirmed') })).rejects.toThrow(/complete|validation/)
})
it('rejects foreign evidence and requires operator ownership to register a Web target', async () => {
  const { controller, send, finding } = await reviewedFixture()
  await expect(controller.review('reviewer', { findingId: finding.id, findingHash: findingHash(finding), verdict: 'confirmed', supportingEvidenceIds: ['foreign'], opposingEvidenceIds: [], explanation: 'Foreign reference', uncertainty: '' })).rejects.toThrow(/another asset/)
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
  const generate = vi.fn(async (_prompt: string) => JSON.stringify({ entries: [{ sourceIds: source.map(item => item.value.id), entry }] }))
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
    entry: { ...entry, ...(kind === 'category' ? { category: 'retrospective' } : {}), ...(kind === 'extra-field' ? { reasoning: 'private trace' } : {}), ...(kind === 'oversized' ? { summary: 'x'.repeat(401) } : {}) } }] }
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
  response.resolve(JSON.stringify({ entries: [{ sourceIds: [source[0]!.value.id], entry }] }))
  await rejected
  expect(controller.view('parent').records.filter(item => item.kind === 'knowledge')).toHaveLength(2)
})

it('requires a new review after a shared lesson changes', async () => {
  const { send, journal, controller } = await harness()
  await send({ kind: 'remember', entry })
  const source = journal.view().records.filter(item => item.kind === 'knowledge')
  await send({ kind: 'publish', knowledgeId: source[0]!.value.id }, true)
  expect(controller.sharedKnowledge()).toHaveLength(1)
  await refineKnowledge(journal, controller.binding('parent')!.engagementId, async () => JSON.stringify({ entries: [{ sourceIds: [source[0]!.value.id], entry: { ...entry, summary: 'Check length before each read.' } }] }), limits, new AbortController().signal)
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
    return JSON.stringify({ entries: [{ sourceIds: [source[0]!.value.id], entry }] })
  }, limits, abort.signal)).rejects.toThrow('cancelled')
  expect(journal.view().records.filter(item => item.kind === 'knowledge')).toEqual(source)
  expect(() => refinementSchema.parse({ entries: [], evidence: [] })).toThrow()
})

it('persists scoped child summaries and keeps legacy file assets readable on reopen', async () => {
  const { controller, journal, ctx, assetId } = await harness()
  await controller.bindChild('parent', 'source-reviewer', [assetId], 'reviewer')
  const report = { summary: 'No complete validation evidence.', evidenceIds: [], uncertainty: 'Offline pending', nextSteps: ['Run an approved plan'] }
  await controller.saveChildReport('source-reviewer', report)
  await expect(controller.saveChildReport('source-reviewer', { ...report, evidenceIds: ['foreign'] })).rejects.toThrow(/foreign/)
  expect(controller.view('parent').records.filter(item => item.kind === 'binding').map(item => item.value.report)).toContainEqual(report)
  const records = journal.view()
  await journal.close()
  const reopened = await openSecurityJournal(ctx)
  try {
    expect(reopened.view()).toEqual(records)
    expect(reopened.view().records.find(item => item.kind === 'asset')?.value).toMatchObject({ id: assetId, format: 'pe' })
  } finally { await reopened.close() }
})
