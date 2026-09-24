/** Serialized single-record commits over storage-domain; projections rebuild on open. @module */
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
    records: z.array(recordSchema).min(1),
  })
  .strict()
/** One opened journal owns a serialized command queue. */
export interface SecurityJournal {
  /** @returns the current committed snapshot. */
  view(): WorkbenchView
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
  let revision = 0
  let chain = Promise.resolve()
  let closing: Promise<void> | undefined
  const apply = (items: SecurityRecord[]) => {
    for (const item of items) {
      const key = item.kind === 'binding' ? item.value.sessionId : item.value.id
      records.set(item.kind + ':' + key, item)
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
  } catch (error) {
    await domain.close()
    throw error
  }
  const view = (): WorkbenchView => ({ revision, records: structuredClone([...records.values()]) })
  const fingerprintOf = (input: unknown) => createHash('sha256').update(JSON.stringify(input)).digest('hex')
  return {
    view,
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
        return view()
      })
      chain = pending.then(
        () => {},
        () => {},
      )
      return pending
    },
    close() {
      closing ??= chain.then(() => domain.close())
      return closing
    },
  }
}
