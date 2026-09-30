/** Serialized project commits with recoverable permanent deletion over storage-domain. @module */
import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { recordSchema, type SecurityRecord, type WorkbenchView } from './model.ts'

const commitSchema = z
  .object({
    revision: z.number().int().positive(),
    operationId: z.string().min(1),
    fingerprint: z.string(),
    records: z.array(recordSchema),
    purge: z.object({ projectId: z.string().min(1),
      artifacts: z.array(z.string().regex(/^[a-f0-9]{64}$/u)), pending: z.boolean() }).strict().optional(),
  })
  .strict()
/** One opened journal owns a serialized command queue. */
export interface SecurityJournal {
  /** @returns the current committed snapshot. */
  view(): WorkbenchView
  /** Subscribe to successful project commits; the returned disposer removes the listener. */
  subscribe(project: string, listener: () => void): () => void
  /** Subscribe to committed selection changes for one Session; disposal removes the listener. */
  subscribeSelection(session: string, listener: () => void): () => void
  /** Return a completed identical command without invoking its producer. */
  replay(operationId: string, input: unknown): WorkbenchView | undefined
  /**
   * Commit one command atomically as one domain record.
   * @param operationId - caller's stable retry identity.
   * @param expectedRevision - revision observed before issuing the command.
   * @param input - complete command used to detect changed retries.
   * @param produce - validate against the latest snapshot and produce changed records.
   * @returns the committed snapshot; exact retries do not execute produce again.
   */
  commit(
    operationId: string,
    expectedRevision: number | undefined,
    input: unknown,
    produce: (view: WorkbenchView) => Promise<SecurityRecord[]> | SecurityRecord[],
  ): Promise<WorkbenchView>
  /** Permanently remove an archived project and scrub its historical records.
   * @param operationId - stable deletion retry identity.
   * @param expectedRevision - revision displayed at confirmation.
   * @param projectId - archived project to remove.
   * @param plan - collect unshared artifact digests before deleting any content.
   * @returns snapshot after durable deletion; cleanup digests remain until acknowledged. */
  purge(operationId: string, expectedRevision: number, projectId: string,
    plan: (removed: SecurityRecord[], retained: SecurityRecord[]) => Promise<string[]>): Promise<WorkbenchView>
  /** @returns durable deletions still requiring file and activity cleanup. */
  pendingPurges(): { projectId: string; artifacts: string[] }[]
  /** Acknowledge completed file and activity cleanup.
   * @param projectId - deleted project.
   * @returns completion after cleanup metadata is cleared. */
  finishPurge(projectId: string): Promise<void>
  /** @returns completion after accepted commands settle and storage closes. */
  close(): Promise<void>
}
/**
 * Open the security journal; another host must not share its storage root.
 * @param ctx - context providing storage-domain.
 * @returns the opened journal with reconstructed state.
 */
export async function openSecurityJournal(ctx: Context): Promise<SecurityJournal> {
  const domain = await ctx.storageDomain.open(
    defineDomain({
      name: 'security_workbench',
      version: 1,
      tables: { commits: domainTable(commitSchema) },
    }),
  )
  const table = domain.table('commits')
  const records = new Map<string, SecurityRecord>()
  const operations = new Map<string, string>()
  const listeners = new Map<string, Set<() => void>>()
  const selections = new Map<string, Set<() => void>>()
  let revision = 0
  let chain = Promise.resolve()
  let closing: Promise<void> | undefined
  const apply = (items: SecurityRecord[]) => {
    for (const item of items) {
      const key = item.kind === 'binding' ? item.value.sessionId : item.value.id
      records.set(item.kind + ':' + key, item)
    }
  }
  const projectOf = (item: SecurityRecord) => item.kind === 'engagement' ? item.value.id : item.value.engagementId
  const scrub = async () => {
    const deleted = new Set([...table.entries()].flatMap(([, commit]) => commit.purge ? [commit.purge.projectId] : []))
    for (const [key, item] of records) if (deleted.has(projectOf(item))) records.delete(key)
    for (const [key, commit] of table.entries()) {
      const kept = commit.records.filter(item => !deleted.has(projectOf(item)))
      if (kept.length !== commit.records.length) await table.put(key, { ...commit, records: kept })
    }
  }
  try {
    const commits = [...table.entries()].sort((a, b) => a[1].revision - b[1].revision)
    for (const [key, commit] of commits) {
      if (commit.revision !== revision + 1 || key !== String(commit.revision) || operations.has(commit.operationId)) {
        throw new Error('Invalid security journal sequence or duplicate operation')
      }
      revision = commit.revision
      operations.set(commit.operationId, commit.fingerprint)
      apply(commit.records)
    }
    await scrub()
  } catch (error) {
    await domain.close()
    throw error
  }
  const view = (): WorkbenchView => ({ revision, records: structuredClone([...records.values()]) })
  const fingerprintOf = (input: unknown) => createHash('sha256').update(JSON.stringify(input)).digest('hex')
  return {
    view,
    subscribe(project, listener) {
      const group = listeners.get(project) ?? new Set<() => void>()
      group.add(listener); listeners.set(project, group)
      return () => { group.delete(listener); if (!group.size) listeners.delete(project) }
    },
    subscribeSelection(session, listener) {
      const group = selections.get(session) ?? new Set<() => void>()
      group.add(listener); selections.set(session, group)
      return () => { group.delete(listener); if (!group.size) selections.delete(session) }
    },
    replay(operationId, input) {
      const previous = operations.get(operationId)
      if (previous === undefined) return undefined
      if (previous !== fingerprintOf(input)) throw new Error('operationId was already used for different input')
      return view()
    },
    commit(operationId, expectedRevision, input, produce) {
      if (closing !== undefined) return Promise.reject(new Error('Security journal is closing'))
      const fingerprint = fingerprintOf(input)
      const pending = chain.then(async () => {
        if (!operationId.trim()) throw new Error('operationId is required')
        const previous = operations.get(operationId)
        if (previous !== undefined) {
          if (previous !== fingerprint) throw new Error('operationId was already used for different input')
          return view()
        }
        if (expectedRevision !== undefined && revision !== expectedRevision)
          throw new Error('Security state changed; reload before retrying')
        const changed = z
          .array(recordSchema)
          .min(1)
          .parse(await produce(view()))
        const commit = commitSchema.parse({ revision: revision + 1, operationId, fingerprint, records: changed })
        await table.put(String(commit.revision), commit)
        revision = commit.revision
        operations.set(operationId, fingerprint)
        apply(changed)
        for (const item of changed) {
          if (item.kind !== 'binding') continue
          for (const listener of selections.get(item.value.sessionId) ?? []) {
            try { listener() } catch (error) { ctx.logger.warn('Security selection subscriber failed: %s', String(error)) }
          }
        }
        for (const project of new Set(changed.map(item => item.kind === 'engagement' ? item.value.id : item.value.engagementId))) {
          for (const listener of listeners.get(project) ?? []) {
            try { listener() } catch (error) { ctx.logger.warn('Security project subscriber failed: %s', String(error)) }
          }
        }
        return view()
      })
      chain = pending.then(
        () => {},
        () => {},
      )
      return pending
    },
    purge(operationId, expectedRevision, projectId, plan) {
      if (closing !== undefined) return Promise.reject(new Error('Security journal is closing'))
      const fingerprint = fingerprintOf({ projectId, purge: true })
      const pending = chain.then(async () => {
        if (!operationId.trim()) throw new Error('operationId is required')
        const previous = operations.get(operationId)
        if (previous !== undefined) {
          if (previous !== fingerprint) throw new Error('operationId was already used for different input')
          await scrub()
          return view()
        }
        if (revision !== expectedRevision) throw new Error('Security state changed; reload before retrying')
        const project = records.get('engagement:' + projectId)
        if (project?.kind !== 'engagement') throw new Error('Unknown project')
        if (!project.value.archived) throw new Error('Delete the task before permanently deleting it')
        if ([...records.values()].some(item => item.kind === 'laboratory' && item.value.engagementId === projectId && item.value.state !== 'stopped'))
          throw new Error('Stop or reset owned laboratories before permanently deleting the task')
        const history = [...table.entries()].flatMap(([, commit]) => commit.records)
        const artifacts = await plan(history.filter(item => projectOf(item) === projectId),
          history.filter(item => projectOf(item) !== projectId))
        const commit = commitSchema.parse({ revision: revision + 1, operationId, fingerprint, records: [],
          purge: { projectId, artifacts, pending: true } })
        await table.put(String(commit.revision), commit)
        revision = commit.revision; operations.set(operationId, fingerprint)
        const sessions = [...records.values()].filter(item => item.kind === 'binding' && item.value.engagementId === projectId)
        await scrub()
        for (const item of sessions) if (item.kind === 'binding') for (const listener of selections.get(item.value.sessionId) ?? []) {
          try { listener() } catch (error) { ctx.logger.warn('Security selection subscriber failed: %s', String(error)) }
        }
        for (const listener of listeners.get(projectId) ?? []) {
          try { listener() } catch (error) { ctx.logger.warn('Security project subscriber failed: %s', String(error)) }
        }
        return view()
      })
      chain = pending.then(() => {}, () => {})
      return pending
    },
    pendingPurges() {
      return [...table.entries()].flatMap(([, commit]) => commit.purge?.pending
        ? [{ projectId: commit.purge.projectId, artifacts: [...commit.purge.artifacts] }] : [])
    },
    finishPurge(projectId) {
      if (closing !== undefined) return Promise.reject(new Error('Security journal is closing'))
      const pending = chain.then(async () => {
        for (const [key, commit] of table.entries()) if (commit.purge?.projectId === projectId && commit.purge.pending)
          await table.put(key, { ...commit, purge: { projectId, artifacts: [], pending: false } })
      })
      chain = pending.then(() => {}, () => {})
      return pending
    },
    close() {
      listeners.clear()
      selections.clear()
      closing ??= chain.then(() => domain.close())
      return closing
    },
  }
}
