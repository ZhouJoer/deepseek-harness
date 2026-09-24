/** Persist operator-selected resources for future tasks in one workspace. @module */
import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { workspaceKey } from './task-bootstrap.ts'

const selectionSchema = z.object({
  environmentIds: z.array(z.string().trim().min(1)).refine(ids => new Set(ids).size === ids.length, 'Environment IDs must be unique'),
  maxAttempts: z.number().int().positive(),
}).strict()
const recordSchema = selectionSchema.extend({ revision: z.number().int().positive() }).strict()
const updateSchema = selectionSchema.extend({ expectedRevision: z.number().int().nonnegative() }).strict()
const workspaceIntakeDomain = defineDomain({
  name: 'security_workspace_intake', version: 1,
  tables: { workspaces: domainTable(recordSchema) },
})

/** An empty environment selection explicitly disables intake for this workspace. */
export type WorkspaceIntakeRecord = z.infer<typeof recordSchema>
/** User-authored resource selection with the revision shown by the configuration UI. */
export type WorkspaceIntakeUpdate = z.infer<typeof updateSchema>

/** Resource selections are independent of existing project permissions and import roots. */
export interface WorkspaceIntakeStore {
  /** @param cwd - absolute Session workspace directory. @returns detached saved selection, or absence when never configured. */
  get(cwd: string): WorkspaceIntakeRecord | undefined
  /**
   * Persist a selection after validating the wire input and configured resources.
   * @param cwd - absolute Session workspace directory resolved by the Host.
   * @param input - resource IDs, attempt limit, and observed revision; first writes use revision zero.
   * @returns detached committed selection with its new revision.
   */
  set(cwd: string, input: unknown): Promise<WorkspaceIntakeRecord>
  /** @returns completion after accepted writes drain and the domain closes; new writes reject immediately. */
  close(): Promise<void>
}

function keyOf(cwd: string): string {
  if (!isAbsolute(cwd)) throw new Error('Workspace resource configuration requires an absolute cwd')
  return workspaceKey(cwd)
}

/**
 * Open durable workspace resource selections without changing project or file access.
 * @param ctx - Host context providing storageDomain.
 * @param configuredEnvironmentIds - deployment resource identities accepted by configuration writes.
 * @returns store owned and closed by the caller.
 */
export async function openWorkspaceIntake(ctx: Context, configuredEnvironmentIds: readonly string[]): Promise<WorkspaceIntakeStore> {
  const domain = await ctx.storageDomain.open(workspaceIntakeDomain)
  const table = domain.table('workspaces')
  let writes = Promise.resolve()
  let closing: Promise<void> | undefined
  return {
    get(cwd) {
      return structuredClone(table.get(keyOf(cwd)))
    },
    async set(cwd, input) {
      if (closing !== undefined) throw new Error('Workspace resource configuration is closing')
      const key = keyOf(cwd)
      const update = updateSchema.parse(input)
      for (const id of update.environmentIds)
        if (!configuredEnvironmentIds.includes(id)) throw new Error('Unknown workspace environment: ' + id)
      const pending = writes.then(async () => {
        const current = table.get(key)
        if ((current?.revision ?? 0) !== update.expectedRevision)
          throw new Error('Workspace resource configuration changed; reload before saving')
        const record = recordSchema.parse({ environmentIds: update.environmentIds,
          maxAttempts: update.maxAttempts, revision: update.expectedRevision + 1 })
        await table.put(key, record)
        return structuredClone(record)
      })
      writes = pending.then(() => {}, () => {})
      return pending
    },
    close() {
      closing ??= writes.then(() => domain.close())
      return closing
    },
  }
}
