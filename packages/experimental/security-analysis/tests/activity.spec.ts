/** Real storage recovery, stream lifecycle and invocation accounting. @module */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import { JobId } from '@deepseek-ai/dsh-jobs'
import { expect, it, onTestFinished } from 'vitest'
import { SecurityActivityStore } from '../src/workbench/activity.ts'
import { analysisJobOutcome, analysisToolCandidates } from '../src/activity-observer.ts'
import { openSecurityJournal } from '../src/workbench/journal.ts'
import { closingBrief } from '../src/turn-brief.ts'

async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-security-activity-'))
  const ctx = new Context()
  await ctx.plugin(Storage)
  const backend = new JsonStorageBackend(root)
  ctx.storage.backend.register('test', backend)
  const facility = new DomainFacility(ctx, { backend: 'test' })
  ctx.storage.mount('domain', facility)
  ctx.provide('storageDomain', facility)
  let activity = await SecurityActivityStore.open(ctx)
  onTestFinished(async () => {
    await activity.close(); await facility.closeAll(); await backend.close(); await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })
  return { ctx, activity, reopen: async () => {
    await activity.close(); activity = await SecurityActivityStore.open(ctx); return activity
  } }
}
const invocation = (callId: string, projectId = 'project', checkpointId = 'recon') => ({
  projectId, sessionId: 'session', callId, checkpointId, tools: ['ghidra'], verified: true, parameters: '{}',
})

it('keeps closing conclusions and next actions separate from model-declared tools', () => {
  expect(closingBrief('工具：source 999 次\n**结论**：两个入口仍待评估。\n下一步／阻碍：检查调用者。'))
    .toEqual({ text: '两个入口仍待评估。', next: '检查调用者。' })
  expect(closingBrief('Tools: source\nConclusion: Needs review\nNext action / blocker: Read caller'))
    .toEqual({ text: 'Needs review', next: 'Read caller' })
  expect(closingBrief('Unstructured visible note\nMore details')).toEqual({ text: 'Unstructured visible note', next: '' })
})

it('counts retries once and keeps late completions in their original research direction', async () => {
  const { activity, ctx } = await harness()
  const journal = await openSecurityJournal(ctx)
  onTestFinished(() => journal.close())
  const first = await activity.start(invocation('call'))
  await Promise.all(Array.from({ length: 10 }, () => activity.start({ ...invocation('call'), checkpointId: 'assessment' })))
  await activity.start(invocation('child:ptc:1', 'project', 'assessment'))
  await activity.finish(first.id, { status: 'failed', incomplete: true, detail: 'provider failed' })
  await activity.finish(first.id, { status: 'completed', incomplete: false, detail: 'duplicate settlement' })
  expect(activity.usage('project')).toEqual([
    expect.objectContaining({ checkpointId: 'recon', total: 1, failed: 1, incomplete: 1 }),
    expect.objectContaining({ checkpointId: 'assessment', total: 1, running: 1 }),
  ])
  expect(journal.view().revision).toBe(0)
  await expect(activity.start({ ...invocation('call'), projectId: 'foreign' })).rejects.toThrow('identity')
})

it('keeps unverified CLI candidates separate and recovers interrupted work without executing it', async () => {
  const { activity, reopen } = await harness()
  await activity.start({ ...invocation('script'), tools: ['radare2', 'unicorn'], verified: false })
  const recovered = await reopen()
  expect(recovered.usage('project')).toEqual([
    expect.objectContaining({ tool: 'radare2', verified: false, unknown: 1, running: 0 }),
    expect.objectContaining({ tool: 'unicorn', verified: false, unknown: 1, running: 0 }),
  ])
  expect(recovered.page('project', 'recon', 0, 10).items[0]?.detail).toContain('restarted')
  expect(recovered.usage('foreign')).toEqual([])
})

it('paginates at a stable creation cutoff while older calls settle and new calls arrive', async () => {
  const { activity } = await harness()
  const first = await activity.start(invocation('1'))
  await activity.start(invocation('2'))
  const page = activity.page('project', 'recon', 0, 1)
  await activity.start(invocation('3'))
  await activity.start(invocation('foreign', 'other'))
  await activity.finish(first.id, { status: 'cancelled', incomplete: true, detail: 'operator stop' })
  const second = activity.page('project', 'recon', page.next!, 1, page.through)
  expect(page.items.map(item => item.callId)).toEqual(['2'])
  expect(second.items.map(item => item.callId)).toEqual(['1'])
  expect(second.items[0]?.status).toBe('cancelled')
  expect(second.next).toBeNull()
})

it('streams committed starts and results, reconnects with a baseline and closes idle followers', async () => {
  const { activity } = await harness()
  const abort = new AbortController()
  onTestFinished(() =>{  abort.abort() })
  const stream = activity.follow('project', () => ({ revision: 0, records: [] }), () => () => {}, abort.signal)[Symbol.asyncIterator]()
  expect((await stream.next()).value?.type).toBe('snapshot')
  const pending = stream.next()
  await activity.start(invocation('foreign', 'other'))
  const row = await activity.start(invocation('call'))
  expect((await pending).value).toMatchObject({ type: 'activity', usage: [expect.objectContaining({ running: 1 })] })
  await activity.finish(row.id, { status: 'completed', incomplete: false, detail: 'observed' })
  expect((await stream.next()).value).toMatchObject({ type: 'activity', usage: [expect.objectContaining({ completed: 1 })] })
  const closed = stream.next(); abort.abort()
  expect((await closed).done).toBe(true)
  const retry = new AbortController()
  const next = activity.follow('project', () => ({ revision: 0, records: [] }), () => () => {}, retry.signal)[Symbol.asyncIterator]()
  expect((await next.next()).value).toMatchObject({ type: 'snapshot', usage: [expect.objectContaining({ total: 1 })] })
  retry.abort(); await next.return?.()
})

it('does not promote command names or Python imports into confirmed execution', () => {
  expect(analysisToolCandidates('python -c "import unicorn; print(1)"')).toEqual(['unicorn'])
  expect(analysisToolCandidates('echo r2; r2 -q sample')).toEqual(['radare2'])
  expect(analysisToolCandidates('python analysis.py')).toEqual(['script'])
  const job = { id: JobId('pwsh-1'), kind: 'pwsh' as const, label: 'script', status: 'completed' as const,
    detail: 'exit code: 3', startedAt: 1, reported: false }
  expect(analysisJobOutcome(job).status).toBe('failed')
  expect(analysisJobOutcome({ ...job, detail: 'exit code: 0' }).status).toBe('completed')
  expect(analysisJobOutcome({ ...job, detail: 'unobserved' }).status).toBe('unknown')
  expect(analysisJobOutcome({ ...job, status: 'killed' }).status).toBe('cancelled')
})
