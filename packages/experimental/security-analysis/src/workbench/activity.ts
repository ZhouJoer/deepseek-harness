/** Durable execution observations, independent of project command revisions. @module */
import type { Context } from '@deepseek-ai/cordis'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { brandString, type Branded } from '@deepseek-ai/dsh-brand'
import { z } from 'zod'
import type { WorkbenchView } from './model.ts'

/** Identifies an observed invocation rather than an analyst claim. */
export type SecurityActivityId = Branded<'SecurityActivity'>
const activitySchema = z.object({
  id: z.string().transform(brandString<SecurityActivityId>),
  projectId: z.string(), sessionId: z.string(), callId: z.string(), checkpointId: z.string(),
  tools: z.array(z.string()).min(1), verified: z.boolean(),
  status: z.enum(['running', 'completed', 'failed', 'cancelled', 'unknown']),
  incomplete: z.boolean(), parameters: z.string(), detail: z.string(), evidenceIds: z.array(z.string()),
  startedAt: z.number(), finishedAt: z.number().optional(), cursor: z.number().int().nonnegative(),
  startCursor: z.number().int().positive(),
}).strict()
/** One actual provider request or Shell invocation; named Shell tools remain unverified. */
export type SecurityActivity = z.infer<typeof activitySchema>
const briefSchema = z.object({
  projectId: z.string(), checkpointId: z.string(), text: z.string().max(300), next: z.string().max(300).default(''), updatedAt: z.number(),
}).strict()
/** Latest visible coordinator response for one direction; it never establishes a finding. */
export type SecurityActivityBrief = z.infer<typeof briefSchema>
/** Counts refer to invocation records, not findings or tool installation checks. */
export interface SecurityToolUsage {
  checkpointId: string
  tool: string
  verified: boolean
  total: number
  running: number
  completed: number
  failed: number
  cancelled: number
  unknown: number
  incomplete: number
}
/** Bounded details selected from the activity cursor visible to a client. */
export interface SecurityActivityPage {
  items: SecurityActivity[]
  next: number | null
  through: number
}
/** A subscription starts with a snapshot; subsequent frames replace only the changed projection. */
export type SecurityActivityFrame =
  | { type: 'snapshot'; cursor: number; view: WorkbenchView; usage: SecurityToolUsage[]; briefs: SecurityActivityBrief[] }
  | { type: 'activity'; cursor: number; usage: SecurityToolUsage[]; briefs: SecurityActivityBrief[] }
  | { type: 'project'; view: WorkbenchView }

/** Serialized activity persistence; committed changes wake project-scoped followers. */
export class SecurityActivityStore {
  private readonly records = new Map<string, SecurityActivity>()
  private readonly briefs = new Map<string, SecurityActivityBrief>()
  private readonly listeners = new Set<(project: string) => void>()
  private chain = Promise.resolve()
  private closing = false
  private cursor = 0
  private constructor(
    private readonly save: (id: string, value: SecurityActivity) => Promise<void>,
    private readonly release: () => Promise<void>,
    private readonly saveBrief: (id: string, value: SecurityActivityBrief) => Promise<void>,
    private readonly removeInvocation: (id: string) => Promise<boolean>,
    private readonly removeBrief: (id: string) => Promise<boolean>,
  ) {}

  /** Open persisted observations and mark unfinished work as unknown without replaying it.
   * @param ctx - domain storage owner.
   * @returns recovered activity store.
   */
  static async open(ctx: Context): Promise<SecurityActivityStore> {
    const domain = await ctx.storageDomain.open(defineDomain({ name: 'security_activity', version: 1,
      tables: { invocations: domainTable(activitySchema), briefs: domainTable(briefSchema) } }))
    const table = domain.table('invocations')
    const store = new SecurityActivityStore(async (id, value) => { await table.put(id, value) }, () => domain.close(),
      async (id, value) => { await domain.table('briefs').put(id, value) }, id => table.delete(id), id => domain.table('briefs').delete(id))
    try {
      for (const [id, value] of domain.table('briefs').entries()) store.briefs.set(id, value)
      for (const [id, value] of table.entries()) {
        store.records.set(id, value)
        store.cursor = Math.max(store.cursor, value.cursor)
      }
      for (const value of store.records.values()) {
        if (value.status === 'running') await store.finish(value.id, {
          status: 'unknown', incomplete: true, detail: 'Host restarted before execution settled',
        })
      }
      return store
    } catch (error) { await domain.close(); throw error }
  }

  /** Save a completed turn's visible summary without creating a direction or changing approval revisions.
   * @param input - coordinator output and direction captured at turn completion.
   * @returns completion after persistence and notification.
   */
  updateBrief(input: SecurityActivityBrief): Promise<void> {
    return this.enqueue(async () => {
      const value = briefSchema.parse(input)
      const id = JSON.stringify([value.projectId, value.checkpointId])
      await this.saveBrief(id, value)
      this.briefs.set(id, value)
      for (const listener of this.listeners) listener(value.projectId)
    })
  }

  private projectBriefs(project: string): SecurityActivityBrief[] {
    return structuredClone([...this.briefs.values()].filter(value => value.projectId === project))
  }

  /** Wait for accepted execution settlements before reporting cancellation complete.
   * @returns completion after the current write queue drains.
   */
  async flush(): Promise<void> { await this.chain }
  /** Observe committed invocation and summary changes.
   * @param listener - receives the owning project after persistence.
   * @returns unsubscribe callback. */
  subscribe(listener: (project: string) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  /** Permanently remove a deleted task's observations and summaries.
   * @param projectId - project already removed from the authority journal.
   * @returns completion after serialized durable cleanup. */
  removeProject(projectId: string): Promise<void> {
    return this.enqueue(async () => {
      for (const [id, value] of this.records) if (value.projectId === projectId) {
        await this.removeInvocation(id); this.records.delete(id)
      }
      for (const [id, value] of this.briefs) if (value.projectId === projectId) {
        await this.removeBrief(id); this.briefs.delete(id)
      }
      for (const listener of this.listeners) listener(projectId)
    })
  }

  /** Check whether the dispatcher already observed this request.
   * @param sessionId - owning Session.
   * @param callId - stable tool-call identity.
   * @returns whether an invocation is already persisted.
   */
  has(sessionId: string, callId: string): boolean { return this.records.has(JSON.stringify([sessionId, callId])) }

  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(new Error('Security activity is closing'))
    const pending = this.chain.then(run)
    this.chain = pending.then(() => {}, () => {})
    return pending
  }
  private async commit(value: SecurityActivity): Promise<void> {
    const saved = activitySchema.parse({ ...value, cursor: this.cursor + 1 })
    await this.save(saved.id, saved)
    this.cursor = saved.cursor
    this.records.set(saved.id, saved)
    for (const listener of this.listeners) listener(saved.projectId)
  }

  /** Record the first start for a stable invocation identity.
   * @param input - Host-observed ownership and requested tool identities.
   * @returns persisted record; retries keep their original stage and count.
   */
  start(input: Pick<SecurityActivity, 'projectId' | 'sessionId' | 'callId' | 'checkpointId' | 'tools' | 'verified' | 'parameters'>): Promise<SecurityActivity> {
    return this.enqueue(async () => {
      const id = brandString<SecurityActivityId>(JSON.stringify([input.sessionId, input.callId]))
      const previous = this.records.get(id)
      if (previous) {
        if (previous.projectId !== input.projectId || previous.parameters !== input.parameters)
          throw new Error('Activity invocation identity was reused for a different request')
        return structuredClone(previous)
      }
      const value: SecurityActivity = { ...input, id, status: 'running', incomplete: false,
        detail: '', evidenceIds: [], startedAt: Date.now(), cursor: 0, startCursor: this.cursor + 1 }
      await this.commit(value)
      return structuredClone({ ...value, cursor: this.cursor })
    })
  }

  /** Settle an invocation once; cancellation and incomplete output stay independent.
   * @param id - recorded invocation.
   * @param result - observed terminal facts and optional saved evidence references.
   * @returns completion after persistence and notification.
   */
  finish(id: SecurityActivityId, result: Pick<SecurityActivity, 'status' | 'incomplete' | 'detail'> & { evidenceIds?: string[] }): Promise<void> {
    return this.enqueue(async () => {
      const previous = this.records.get(id)
      if (!previous) throw new Error('Unknown security activity')
      if (previous.status !== 'running') return
      await this.commit({ ...previous, ...result, finishedAt: Date.now() })
    })
  }

  /** Associate a Session's initial unclassified calls with its first saved research direction.
   * @param projectId - project owning the committed checkpoint.
   * @param sessionId - coordinator that saved the checkpoint.
   * @param checkpointId - first checkpoint in that project.
   * @returns completion after associations are persisted; existing directions are preserved.
   */
  assignInitialDirection(projectId: string, sessionId: string, checkpointId: string): Promise<void> {
    return this.enqueue(async () => {
      for (const value of this.records.values()) {
        if (value.projectId === projectId && value.sessionId === sessionId && !value.checkpointId) {
          await this.commit({ ...value, checkpointId })
        }
      }
    })
  }

  /** Attach saved auxiliary evidence to every recorded call it contains.
   * @param projectId - evidence project.
   * @param sessionId - Session supplying the recorded calls.
   * @param callIds - calls contained in the saved evidence.
   * @param evidenceId - committed evidence identity.
   * @returns completion after persisted links; retries do not duplicate references.
   */
  attachEvidence(projectId: string, sessionId: string, callIds: readonly string[], evidenceId: string): Promise<void> {
    return this.enqueue(async () => {
      for (const callId of callIds) {
        const value = this.records.get(JSON.stringify([sessionId, callId]))
        if (value?.projectId === projectId && !value.evidenceIds.includes(evidenceId)) {
          await this.commit({ ...value, evidenceIds: [...value.evidenceIds, evidenceId] })
        }
      }
    })
  }

  /** Aggregate only this project's observed invocations.
   * @param project - selected project.
   * @returns separate counts for verified requests and unverified tool references.
   */
  usage(project: string): SecurityToolUsage[] {
    const groups = new Map<string, SecurityToolUsage>()
    for (const row of this.records.values()) {
      if (row.projectId !== project) continue
      for (const tool of row.tools) {
        const key = JSON.stringify([row.checkpointId, tool, row.verified])
        const group = groups.get(key) ?? { checkpointId: row.checkpointId, tool, verified: row.verified,
          total: 0, running: 0, completed: 0, failed: 0, cancelled: 0, unknown: 0, incomplete: 0 }
        group.total++; group[row.status]++
        if (row.incomplete) group.incomplete++
        groups.set(key, group)
      }
    }
    return [...groups.values()]
  }

  /** Read bounded details, retaining the client's first-page cutoff across pagination.
   * @param project - authorized project.
   * @param checkpointId - selected research direction, or empty for unclassified work.
   * @param offset - nonnegative page offset.
   * @param limit - validated deployment page size.
   * @param through - first-page cursor; omitted to capture the current cursor.
   * @returns page and next offset, with no records from other projects.
   */
  page(project: string, checkpointId: string, offset: number, limit: number, through = this.cursor): SecurityActivityPage {
    const selected = [...this.records.values()].filter(row => row.projectId === project && row.checkpointId === checkpointId
      && row.startCursor <= through)
    selected.sort((a, b) => b.startCursor - a.startCursor)
    return { items: structuredClone(selected.slice(offset, offset + limit)), through,
      next: offset + limit < selected.length ? offset + limit : null }
  }

  /** Subscribe without losing changes between initial observation and listener registration.
   * @param project - authorized project.
   * @param view - current committed project projection.
   * @param subscribeProject - committed project-change subscription.
   * @param signal - connection lifetime.
   * @returns initial snapshot and coalesced projection updates.
   */
  async *follow(project: string, view: () => WorkbenchView, subscribeProject: (listener: () => void) => () => void,
    signal: AbortSignal): AsyncGenerator<SecurityActivityFrame, void> {
    signal.throwIfAborted()
    const dirty = { activity: false, project: false }
    let wake = () => {}
    const activityChanged = (id: string) => { if (this.closing || id === project) { dirty.activity = true; wake() } }
    this.listeners.add(activityChanged)
    const off = subscribeProject(() => { dirty.project = true; wake() })
    const aborted = () =>{  wake() }
    signal.addEventListener('abort', aborted, { once: true })
    try {
      yield { type: 'snapshot', cursor: this.cursor, view: view(), usage: this.usage(project), briefs: this.projectBriefs(project) }
      while (!signal.aborted && !this.closing) {
        const pending = Promise.withResolvers<void>()
        wake = () =>{  pending.resolve() }
        if (dirty.activity) {
          dirty.activity = false
          yield { type: 'activity', cursor: this.cursor, usage: this.usage(project), briefs: this.projectBriefs(project) }
        }
        else if (dirty.project) { dirty.project = false; yield { type: 'project', view: view() } }
        else await pending.promise
      }
    } finally { this.listeners.delete(activityChanged); off(); signal.removeEventListener('abort', aborted) }
  }

  /** Close followers before waiting for accepted writes and releasing storage.
   * @returns completion after storage closes.
   */
  async close(): Promise<void> {
    this.closing = true
    for (const listener of this.listeners) listener('')
    this.listeners.clear()
    await this.chain
    await this.release()
  }
}
