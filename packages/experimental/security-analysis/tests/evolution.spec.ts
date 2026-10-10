/** Independent storage, evidence validation and coding-AI receipt behavior. @module */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { expect, it, onTestFinished } from 'vitest'
import { evolutionInputSchema, evolutionRunSchema, type EvolutionInput } from '../src/evolution-model.ts'
import { EvolutionStore } from '../src/evolution-store.ts'
import { evolutionExcerpt, evolutionPrompt, evolutionRequest, selectEvolutionInput } from '../src/evolution.ts'

async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evolution-'))
  const ctx = new Context()
  await ctx.plugin(Storage)
  const backend = new JsonStorageBackend(root)
  ctx.storage.backend.register('test', backend)
  const facility = new DomainFacility(ctx, { backend: 'test' })
  ctx.storage.mount('domain', facility); ctx.provide('storageDomain', facility)
  let store = await EvolutionStore.open(ctx)
  onTestFinished(async () => {
    await store.close(); await facility.closeAll(); await backend.close(); await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })
  return { store, reopen: async () => { await store.close(); store = await EvolutionStore.open(ctx); return store } }
}
function input(projectId = 'alpha'): EvolutionInput {
  return evolutionInputSchema.parse({ projectId, objective: 'Inspect the owned fixture', version: 'fixture-version', gaps: [], candidates: [],
    sources: [{ id: projectId + ':1', projectId, sessionId: 'session-' + projectId, seq: 1, kind: 'tool/call',
      excerpt: 'Repeated script manually parses the same packet format.', truncated: false, recordedAt: 1 }] })
}
const suggestion = (project = 'alpha') => ({ title: 'Packet parser', component: 'security scripts', conditions: 'Repeated packet analysis',
  problem: 'Each task rewrites the parser', change: 'Add a reusable packet parser with structured output',
  acceptance: ['Two tasks use the parser without copying parsing code'], uncertainty: 'Inspect existing scripts first', sourceIds: [project + ':1'] })
async function running(store: EvolutionStore, data = input(), id = 'run-alpha') {
  const run = evolutionRunSchema.parse({ id, projectId: data.projectId, status: 'running', manual: true,
    createdAt: 1, updatedAt: 1, input: data, sessionId: 'synthesis-' + id, detail: '', proposalIds: [] })
  await store.update((state) => { state.runs.push(run); state.sessionPurposes.push(run.sessionId!) })
  return run.id
}

it('accepts no suggestions without manufacturing work', async () => {
  const { store } = await harness()
  const id = await running(store)
  await store.complete(id, input(), '{"suggestions":[]}', 5)
  expect(store.view().runs[0]?.status).toBe('completed')
  expect(store.view().proposals).toEqual([])
})

it('rejects invented source and merge identities without publishing partial results', async () => {
  const { store } = await harness()
  const id = await running(store)
  await expect(store.complete(id, input(), JSON.stringify({ suggestions: [suggestion(), { ...suggestion(), sourceIds: ['foreign'] }] }), 5)).rejects.toThrow('outside this analysis')
  await expect(store.complete(id, input(), JSON.stringify({ suggestions: [{ ...suggestion(), existingId: 'invented' }] }), 5)).rejects.toThrow('unavailable merge candidate')
  expect(store.view().proposals).toEqual([])
  expect(store.view().runs[0]?.status).toBe('running')
})

it('merges cross-task evidence once and preserves operator verification', async () => {
  const { store } = await harness()
  await store.complete(await running(store), input(), JSON.stringify({ suggestions: [suggestion()] }), 5)
  const proposal = store.view().proposals[0]!
  await store.command({ operationId: 'verify', expectedRevision: store.view().revision, action: { kind: 'status', proposalId: proposal.id, status: 'verified' } })
  const beta = input('beta')
  beta.candidates = [{ id: proposal.id, title: proposal.title, component: proposal.component,
    conditions: proposal.conditions, problem: proposal.problem, change: proposal.change }]
  await store.complete(await running(store, beta, 'run-beta'), beta, JSON.stringify({ suggestions: [{ ...suggestion('beta'), existingId: proposal.id }] }), 5)
  await store.complete(await running(store, beta, 'run-beta-again'), beta, JSON.stringify({ suggestions: [{ ...suggestion('beta'), existingId: proposal.id }] }), 5)
  expect(store.view().proposals).toHaveLength(1)
  expect(store.view().proposals[0]).toMatchObject({ status: 'verified', needsReview: true })
  expect(store.view().proposals[0]?.occurrences).toHaveLength(2)
})

it('imports receipts as claims, rejects stale writes and replays identical operations', async () => {
  const { store } = await harness()
  await store.complete(await running(store), input(), JSON.stringify({ suggestions: [suggestion()] }), 5)
  const proposal = store.view().proposals[0]!
  const request = { operationId: 'receipt', expectedRevision: store.view().revision, action: { kind: 'receipt', receipt: {
    version: 1, proposalId: proposal.id, proposalRevision: proposal.revision, summary: 'Added parser', references: ['commit-ref'],
    tests: [{ command: 'test parser', result: 'passed' }], remaining: [],
  } } }
  const saved = await store.command(request)
  expect(saved.proposals[0]?.status).toBe('modified')
  expect(await store.command(request)).toEqual(saved)
  await expect(store.command({ ...request, operationId: 'stale' })).rejects.toThrow('refresh')
  await expect(store.command({ ...request, expectedRevision: saved.revision })).rejects.toThrow('reused')
  expect(JSON.parse(store.export(proposal.id, 131072).receipt)).toMatchObject({ proposalId: proposal.id, summary: '' })
  expect(store.export(proposal.id, 131072).markdown).toContain('AGENTS.md')
  expect(store.export(proposal.id, 131072).markdown).toContain('Repeated script')
})

it('recovers interrupted requests and retains synthesis purpose markers after deletion', async () => {
  const { store, reopen } = await harness()
  await running(store)
  await store.update((state) => { state.tasks.push({ projectId: 'alpha', changedAt: 1, sources: [], dropped: 0, requested: false, manual: true, lastInputHash: '' }) })
  const recovered = await reopen()
  expect(recovered.view().runs[0]?.status).toBe('interrupted')
  expect(recovered.snapshot().tasks[0]?.requested).toBe(true)
  await recovered.removeProject('alpha')
  expect(recovered.snapshot()).toMatchObject({ tasks: [], runs: [], proposals: [], sessionPurposes: ['synthesis-run-alpha'] })
  await expect(recovered.complete(evolutionRunSchema.parse({ id: 'late', projectId: 'alpha', status: 'running', manual: true,
    createdAt: 1, updatedAt: 1, detail: '', proposalIds: [] }).id, input(), '{"suggestions":[]}', 5)).rejects.toThrow('no longer active')
})

it('deletes only one task contribution to a shared suggestion', async () => {
  const { store } = await harness()
  await store.complete(await running(store), input(), JSON.stringify({ suggestions: [suggestion()] }), 5)
  await store.complete(await running(store, input('beta'), 'run-beta'), input('beta'), JSON.stringify({ suggestions: [suggestion('beta')] }), 5)
  await store.removeProject('alpha')
  expect(store.view().proposals[0]?.occurrences.map(item => item.projectId)).toEqual(['beta'])
  expect(store.view().runs.every(run => run.projectId === 'beta')).toBe(true)
  await store.removeProject('beta')
  expect(store.view().proposals).toEqual([])
})

it('checks cancellation at publication and bounds multibyte excerpts', async () => {
  const { store } = await harness()
  const id = await running(store)
  await expect(store.complete(id, input(), JSON.stringify({ suggestions: [suggestion()] }), 5, AbortSignal.abort())).rejects.toThrow()
  expect(store.view().proposals).toEqual([])
  expect(evolutionExcerpt('中文🙂tail', 9)).toEqual({ excerpt: '中文', truncated: true })
  expect(evolutionExcerpt('中文', 6)).toEqual({ excerpt: '中文', truncated: false })
})

function selectionBudget(data: EvolutionInput, extra: number) {
  const request = evolutionRequest({ ...data, sources: [], candidates: [] }, 5)
  return { inputBytes: Buffer.byteLength(evolutionPrompt) + Buffer.byteLength(request) + extra, maxSuggestions: 5 }
}

it('retains visible events, project evidence and merge candidates under activity pressure', () => {
  const data = input()
  const source = data.sources[0]!
  data.sources = [source, { ...source, id: 'evidence', kind: 'evidence' },
    ...Array.from({ length: 100 }, (_, index) => ({ ...source, id: `activity-${index}`, kind: 'activity',
      recordedAt: index, excerpt: '活动摘要'.repeat(100) }))]
  data.candidates = evolutionInputSchema.parse({ ...data, candidates: [{ id: 'candidate', title: 'Parser',
    component: 'scripts', conditions: 'Repeated work', problem: 'Manual parsing', change: 'Reuse parser' }] }).candidates
  const original = structuredClone(data)
  const config = selectionBudget(data, 4000)
  const selected = selectEvolutionInput(data, config)
  expect(selected.sources.map(item => item.kind)).toEqual(expect.arrayContaining(['tool/call', 'evidence', 'activity']))
  expect(selected.candidates).toEqual(data.candidates)
  expect(selected.sources.length).toBeLessThan(data.sources.length)
  expect(selected.gaps).toContain(`${data.sources.length - selected.sources.length} observations omitted to fit the complete request`)
  expect(Buffer.byteLength(evolutionPrompt) + Buffer.byteLength(evolutionRequest(selected, config.maxSuggestions)))
    .toBeLessThanOrEqual(config.inputBytes)
  expect(data).toEqual(original)
})

it('skips oversized entries and admits a source before considering merge candidates', () => {
  const data = input()
  const source = data.sources[0]!
  data.sources = [{ ...source, id: 'large', recordedAt: 2, excerpt: 'x'.repeat(20000) }, source]
  data.candidates = evolutionInputSchema.parse({ ...data, candidates: [{ id: 'large-candidate', title: 'Parser', component: 'scripts', conditions: 'large',
    problem: 'x'.repeat(2000), change: 'Use parser' },
  { id: 'small-candidate', title: 'Parser', component: 'scripts', conditions: 'small', problem: 'Repeated work', change: 'Reuse parser' }] }).candidates
  const selected = selectEvolutionInput(data, selectionBudget(data, 1500))
  expect(selected.sources).toEqual([source])
  expect(selected.candidates.map(item => item.id)).toEqual(['small-candidate'])
  expect(selected.gaps).toEqual([...data.gaps, '1 observations omitted to fit the complete request',
    '1 merge candidates omitted to fit the complete request'])
})

it('keeps empty sources and disabled merge discovery empty', () => {
  const data = { ...input(), sources: [], candidates: [] }
  expect(selectEvolutionInput(data, selectionBudget(data, 0))).toEqual(data)
  const available = input()
  expect(selectEvolutionInput(available, selectionBudget(available, 2000)).candidates).toEqual([])
})

it('reports insufficient instructions or observation budgets instead of an empty analysis', () => {
  const data = input()
  expect(() => selectEvolutionInput(data, { inputBytes: 1, maxSuggestions: 5 })).toThrow('instructions, objective and gap notices')
  data.sources[0]!.excerpt = '中文'.repeat(10000)
  expect(() => selectEvolutionInput(data, selectionBudget(data, 1000))).toThrow('cannot fit any observation')
})
