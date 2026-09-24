/** Security command validation and durable project authority. @module */
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  engagementSchema,
  assetSchema,
  fileAssetSchema,
  sourceAssetSchema,
  webAssetSchema,
  reviewSchema,
  reportSchema,
  laboratorySchema,
  type Laboratory,
  checkSchema,
  findingSchema,
  validationPlanSchema,
  evidenceSchema,
  bindingSchema,
  childReportSchema,
  knowledgeEntrySchema,
  operationSchema,
  type AnalysisOperation,
  type Asset,
  type CheckStep,
  type SecurityRecord,
  type Engagement,
  type SessionBinding,
  type WorkbenchView,
} from './model.ts'
import type { SecurityJournal } from './journal.ts'
import { canObserve, type DelegatedRole } from './roles.ts'
import { findingHash } from './assessment.ts'
import { reportPrompt, renderReport, type ReportLimits } from './report.ts'
import { importSource } from './source.ts'
import { materialInputSchema, prepareMaterials } from './materials.ts'
import { apkMembers } from './apk.ts'
import { ArtifactStore } from './artifacts.ts'
import {
  ProviderRegistry,
  type AnalysisProvider,
  type EnvironmentManager,
  type SecurityEnvironment,
} from './providers.ts'

const text = z.string().trim().min(1)
const checkInput = checkSchema.omit({
  id: true,
  engagementId: true,
  status: true,
  attempts: true,
  rationale: true,
  ownerSessionId: true,
})
const actions = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('create'),
      title: text,
      objective: text,
      environmentIds: z.array(text),
      maxAttempts: z.number().int().positive(),
    })
    .strict(),
  z.object({ kind: z.literal('select'), engagementId: text }).strict(),
  z.object({ kind: z.literal('leave') }).strict(),
  z.object({ kind: z.literal('import'), path: text, label: text }).strict(),
  z.object({ kind: z.literal('import-source'), path: text.describe('Absolute source file or directory inside the configured import roots. A selected file imports only that file.'), label: text }).strict(),
  z.object({ kind: z.literal('import-legacy'), path: text, title: text }).strict(),
  z.object({ kind: z.literal('check'), check: checkInput }).strict(),
  z.object({ kind: z.literal('web-target'), environmentId: text, label: text, pathPrefix: text.default('/') }).strict(),
  z.object({ kind: z.literal('revise-finding'), findingId: text, title: text, explanation: text, conditions: text, evidenceIds: z.array(text).min(1) }).strict(),
  z.object({ kind: z.literal('conclude'), reviewId: text }).strict(),
  z.object({ kind: z.literal('report') }).strict(),
  z.object({ kind: z.literal('template'), assetId: text }).strict(),
  z.object({ kind: z.literal('finish'), checkId: text, evidenceIds: z.array(text), rationale: text }).strict(),
  z.object({ kind: z.literal('reopen'), checkId: text, rationale: text }).strict(),
  z.object({ kind: z.literal('reconcile'), checkId: text, rationale: text }).strict(),
  z.object({ kind: z.literal('finding'), finding: findingSchema.omit({ id: true, engagementId: true }) }).strict(),
  z
    .object({
      kind: z.literal('plan'),
      checkId: text,
      operation: operationSchema,
      script: z.string().optional(),
      hypothesis: text,
      expectedObservation: text,
      impact: text,
      cleanup: text,
      durationMs: z.number().int().positive(),
    })
    .strict(),
  z.object({ kind: z.literal('approve'), planId: text }).strict(),
  z.object({ kind: z.literal('revoke'), planId: text }).strict(),
  z.object({ kind: z.literal('stop') }).strict(),
  z.object({ kind: z.literal('resume') }).strict(),
  z.object({ kind: z.literal('publish'), knowledgeId: text }).strict(),
  z.object({ kind: z.literal('remember'), entry: knowledgeEntrySchema }).strict(),
])
/** Structured command shared by model tools and the Web controller. */
export const commandSchema = z
  .object({
    operationId: text,
    expectedRevision: z.number().int().nonnegative(),
    action: actions,
  })
  .strict()
/** Parsed, boundary-validated command. */
export type SecurityCommand = z.infer<typeof commandSchema>
/** Fixed deployment limits and import authority. */
export interface WorkbenchOptions {
  importRoots: string[]
  environments: SecurityEnvironment[]
  maxDurationMs: number
  maxOutputBytes: number
  approvalTtlMs: number
  maxDerivedAssets: number
  maxArtifactBytes: number
  reportLimits?: ReportLimits
}

/** Business owner shared by tools, Remote and provider consumers. */
export class SecurityController {
  /** Registered analysis implementations admitted by domain commands. */
  readonly providers: ProviderRegistry<AnalysisProvider> = new ProviderRegistry<AnalysisProvider>()
  /** Operator environment lifecycle implementations. */
  readonly environments: ProviderRegistry<{ id: string; manager: EnvironmentManager }> = new ProviderRegistry<{
    id: string
    manager: EnvironmentManager
  }>()
  /** Optional Host-owned laboratory implementation. */
  readonly laboratories: ProviderRegistry<{
    id: string
    action(projectId: string, action: string, laboratoryId?: string): Promise<WorkbenchView>
  }> = new ProviderRegistry()
  /** Read persisted laboratory ownership, including interrupted resources.
   * @returns laboratory generations. */
  laboratoriesView(): Laboratory[] {
    return this.journal.view().records.filter(item => item.kind === 'laboratory').map(item => item.value)
  }
  /** Persist Host-measured resources before publishing their environment.
   * @param input - complete owned resource state.
   * @returns committed record. */
  async saveLaboratory(input: Laboratory): Promise<Laboratory> {
    const laboratory = laboratorySchema.parse(input)
    await this.journal.commit(randomUUID(), undefined, { laboratory }, (view) => {
      const project = this.project(view, laboratory.engagementId)
      return [{ kind: 'laboratory', value: laboratory }, { kind: 'engagement', value: {
        ...project, environmentIds: [...new Set([...project.environmentIds, laboratory.environmentId])],
      } }]
    })
    return laboratory
  }
  private environmentHash(environment: SecurityEnvironment): string {
    const { containerId: _container, exchangeRoot: _exchange, ...configuration } = environment
    return createHash('sha256').update(JSON.stringify(configuration)).digest('hex')
  }
  private readonly observations = new Map<string, { fingerprint: string; pending: Promise<SecurityRecord> }>()
  private readonly reports = new Map<string, { fingerprint: string; pending: Promise<WorkbenchView> }>()
  private readonly delegated = new Map<AbortController, { project: string; done: Promise<unknown> }>()
  private readonly active = new Map<
    string,
    { project: string; environment: string; plan: string; controller: AbortController; done: Promise<void> }
  >()
  constructor(
    private readonly journal: SecurityJournal,
    readonly artifacts: ArtifactStore,
    readonly options: WorkbenchOptions,
    private readonly generateReport?: (prompt: string, signal: AbortSignal, sessionId: string) => Promise<string>,
  ) {}
  /**
   * Bind a delegated job to project stop and service teardown.
   * @param project - selected project whose scope the child inherits.
   * @param controller - cancellation owned by the delegated job.
   * @param done - settlement including child disposal.
   * @returns disposer releasing the live registration.
   */
  trackDelegation(project: string, controller: AbortController, done: Promise<unknown>): () => void {
    if (this.project(this.journal.view(), project).stopped) controller.abort(new Error('Project is stopped'))
    this.delegated.set(controller, { project, done })
    return () => { this.delegated.delete(controller) }
  }
  /**
   * Serialize operator environment changes with admitted provider executions.
   * @param environmentId - exact configured execution world.
   * @param run - lifecycle action using the lease cancellation signal and completing before release.
   * @param project - owning project, or empty for operator setup before project creation.
   * @returns the lifecycle result.
   */
  async manageEnvironment<T>(environmentId: string, run: (signal: AbortSignal) => Promise<T>, project: string = ''): Promise<T> {
    if ([...this.active.values()].some(run => run.environment === environmentId)) throw new Error('Environment is already leased by another operation')
    const controller = new AbortController()
    const settled = Promise.withResolvers<undefined>()
    this.active.set(environmentId, { project, environment: environmentId, plan: '', controller, done: settled.promise })
    try {
      return await run(controller.signal)
    } finally {
      this.active.delete(environmentId)
      settled.resolve(undefined)
    }
  }
  /**
   * Resolve the durable role of an exact session.
   * @param sessionId - authenticated session identity.
   * @returns its binding, if selected or delegated.
   */
  binding(sessionId: string): SessionBinding | undefined {
    const record = this.journal
      .view()
      .records.find(item => item.kind === 'binding' && item.value.sessionId === sessionId)
    return record?.kind === 'binding' && record.value.active !== false ? record.value : undefined
  }
  /** Save a validated child summary without treating it as original evidence.
   * @param sessionId - child Session bound by the Host.
   * @param input - structured report returned by the child.
   * @returns completion after the summary is persisted. */
  async saveChildReport(sessionId: string, input: unknown): Promise<void> {
    const report = childReportSchema.parse(input)
    await this.journal.commit(randomUUID(), undefined, { sessionId, report }, (view) => {
      const binding = view.records.find(item => item.kind === 'binding' && item.value.sessionId === sessionId)
      if (binding?.kind !== 'binding' || binding.value.active === false || binding.value.role === 'coordinator') throw new Error('A delegated Session is required')
      for (const id of report.evidenceIds) {
        if (!view.records.some(item => item.kind === 'evidence' && item.value.id === id &&
          item.value.engagementId === binding.value.engagementId && binding.value.assetIds.includes(item.value.assetId)))
          throw new Error('Child report cites unavailable or foreign evidence')
      }
      return [{ kind: 'binding', value: { ...binding.value, report } }]
    })
  }
  /** List projects for operator selection.
   * @param includeArchived - include removed projects for explicit restoration.
   * @returns project labels available to the local operator, never delegated tool callers. */
  projects(includeArchived: boolean = false): Engagement[] {
    return this.journal
      .view()
      .records.filter(item => item.kind === 'engagement').filter(item => includeArchived || !item.value.archived)
      .map(item => item.value)
  }
  /** Rename, remove or restore a project from an authenticated operator gesture.
   * @param projectId - existing project identity.
   * @param input - revision-checked rename, archive or restore request.
   * @returns committed project list, including archived entries for recovery.
   */
  async manageProject(projectId: string, input: unknown): Promise<Engagement[]> {
    const request = z.object({ operationId: text, expectedRevision: z.number().int().nonnegative(),
      action: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('rename'), title: text }).strict(),
        z.object({ kind: z.literal('archive') }).strict(),
        z.object({ kind: z.literal('restore') }).strict(),
      ]),
    }).strict().parse(input)
    await this.journal.commit(request.operationId, request.expectedRevision, { projectId, request }, (view) => {
      const project = this.project(view, projectId)
      if (request.action.kind === 'rename') return [{ kind: 'engagement', value: { ...project, title: request.action.title } }]
      if (request.action.kind === 'restore') return [{ kind: 'engagement', value: { ...project, archived: false } }]
      return [{ kind: 'engagement', value: { ...project, archived: true, stopped: true } },
        ...view.records.filter(item => item.kind === 'binding').filter(item => item.value.engagementId === projectId)
          .map(item => ({ kind: 'binding' as const, value: { ...item.value, active: false } }))]
    })
    if (request.action.kind === 'archive') await this.cancelExecutions(projectId)
    return this.projects(true)
  }

  /** Attach operator-selected materials, creating the first project atomically when needed.
   * @param sessionId - authenticated operator Session, never a delegated child.
   * @param input - revision, material selection and optional initial task fields.
   * @returns the committed Session scope with measured materials.
   */
  async importMaterials(sessionId: string, input: unknown): Promise<WorkbenchView> {
    const request = z.object({ operationId: text, expectedRevision: z.number().int().nonnegative(),
      material: materialInputSchema,
      task: actions.options[0].omit({ kind: true }).optional(),
    }).strict().parse(input)
    await this.journal.commit(request.operationId, request.expectedRevision, { sessionId, material: request }, async (view) => {
      const bound = this.binding(sessionId)
      if (bound && bound.role !== 'coordinator') throw new Error('Coordinator role required')
      const created = bound ? [] : request.task ? this.createRecords(sessionId, { kind: 'create', ...request.task }) : []
      const project = bound ? this.project(view, bound.engagementId) : created.find(item => item.kind === 'engagement')?.value
      if (!project || !('stopped' in project))
        throw new Error('Select a workspace and configure its resources before adding materials')
      if (project.stopped || project.archived) throw new Error('Project is stopped')
      const materials = await prepareMaterials(this.artifacts, request.material,
        { bytes: this.options.maxArtifactBytes, entries: this.options.maxDerivedAssets })
      const assets = materials.map(material => assetSchema.parse({ ...material, id: randomUUID(), engagementId: project.id }))
      const records: SecurityRecord[] = [...created]
      for (const asset of assets) records.push(...await this.importedRecords(asset))
      return records
    })
    return this.view(sessionId)
  }

  private async importedRecords(sample: Asset): Promise<SecurityRecord[]> {
    const samples: Asset[] = [sample]
    if (!('kind' in sample) && sample.format === 'apk') {
      const members = await apkMembers(await this.artifacts.read(sample.artifact),
        this.options.maxArtifactBytes, this.options.maxDerivedAssets)
      for (const member of members) samples.push(fileAssetSchema.parse({ id: randomUUID(), engagementId: sample.engagementId,
        label: member.path, format: member.format, identity: 'measured', parentId: sample.id,
        artifact: await this.artifacts.put(member.bytes, 'application/octet-stream') }))
    }
    return samples.map(value => ({ kind: 'asset', value }))
  }

  private async cancelExecutions(project: string, plan?: string): Promise<void> {
    const cancelled = [...this.active.values(), ...[...this.delegated].map(([controller, job]) => ({ ...job, controller, plan: '' }))]
      .filter(run => run.project === project && (plan === undefined || run.plan === plan))
    for (const run of cancelled) run.controller.abort(new Error('Operator revoked execution'))
    await Promise.allSettled(cancelled.map(run => run.done))
  }
  /**
   * Read only records in the selected project and assigned assets.
   * @param sessionId - authenticated session identity.
   * @returns detached project snapshot.
   */
  view(sessionId: string): WorkbenchView {
    const view = this.journal.view()
    const binding = this.binding(sessionId)
    if (!binding) return { revision: view.revision, records: [] }
    return {
      revision: view.revision,
      records: view.records.filter((item) => {
        if (item.kind === 'knowledge' && (item.value.supersededBy || item.value.excluded)) return false
        const project = item.kind === 'engagement' ? item.value.id : item.value.engagementId
        if (project !== binding.engagementId) return false
        if (item.kind === 'engagement') return true
        if (item.kind === 'binding') return binding.role === 'coordinator' || item.value.sessionId === sessionId
        const asset =
          item.kind === 'asset'
            ? item.value.id
            : 'assetId' in item.value
              ? item.value.assetId
              : item.kind === 'plan'
                ? item.value.operation.assetId
                : undefined
        return binding.role === 'coordinator' || (asset !== undefined && binding.assetIds.includes(asset))
      }),
    }
  }
  /**
   * Initialize a task authorized by a trusted user carrier and Host workspace mapping.
   * @param sessionId - Session receiving the committed user message.
   * @param operationId - stable identity of this message's intake operation.
   * @param action - creation fields resolved by the Host, never a model tool request.
   * @param signal - cancellation checked before admission and inside the serialized commit.
   * @returns current Session scope; existing active or inactive bindings remain unchanged.
   */
  async admitTask(sessionId: string, operationId: string,
    action: Extract<SecurityCommand['action'], { kind: 'create' }>, signal: AbortSignal): Promise<WorkbenchView> {
    signal.throwIfAborted()
    await this.journal.commit(operationId, undefined, { sessionId, intake: action }, (view) => {
      signal.throwIfAborted()
      const binding = view.records.find(item => item.kind === 'binding' && item.value.sessionId === sessionId)
      return binding ? [binding] : this.createRecords(sessionId, action)
    })
    return this.view(sessionId)
  }

  private createRecords(sessionId: string, action: Extract<SecurityCommand['action'], { kind: 'create' }>): SecurityRecord[] {
    if (action.environmentIds.some(id => !this.options.environments.some(env => env.id === id)))
      throw new Error('Unknown environment')
    const project = engagementSchema.parse({
      title: action.title,
      objective: action.objective,
      environmentIds: action.environmentIds,
      maxAttempts: action.maxAttempts,
      id: randomUUID(),
      stopped: false,
    })
    return [
      { kind: 'engagement', value: project },
      {
        kind: 'binding',
        value: bindingSchema.parse({
          sessionId,
          engagementId: project.id,
          role: 'coordinator',
          assetIds: [],
        }),
      },
    ]
  }

  /**
   * Issue a structured command. Only the user-facing carrier sets operator.
   * @param sessionId - authenticated session identity.
   * @param input - untrusted command JSON.
   * @param operator - true only for a user gesture, never model-supplied.
   * @param signal - cancellation of a pending model-generated report.
   * @returns committed project state.
   */
  async command(sessionId: string, input: unknown, operator: boolean = false,
    signal: AbortSignal = new AbortController().signal): Promise<WorkbenchView> {
    const command = commandSchema.parse(input)
    const action = command.action
    const operatorActions = ['create', 'select', 'leave', 'approve', 'publish', 'resume', 'web-target']
    if (operatorActions.includes(action.kind) && !operator) throw new Error('This action requires an operator gesture')
    if (action.kind === 'report') return this.createReport(sessionId, command, operator, signal)
    await this.journal.commit(
      command.operationId,
      action.kind === 'stop' || action.kind === 'revoke' ? undefined : command.expectedRevision,
      { sessionId, operator, action },
      async (view) => {
        if (action.kind === 'create') return this.createRecords(sessionId, action)
        if (action.kind === 'select') {
          if (this.project(view, action.engagementId).archived) throw new Error('Restore the removed project before selecting it')
          return [
            {
              kind: 'binding',
              value: { sessionId, engagementId: action.engagementId, role: 'coordinator', assetIds: [] },
            },
          ]
        }
        if (action.kind === 'leave') {
          const binding = this.requireBinding(view, sessionId)
          if (binding.role !== 'coordinator') throw new Error('Coordinator role required')
          return [{ kind: 'binding', value: { ...binding, active: false } }]
        }
        const binding = this.requireBinding(view, sessionId)
        const project = this.project(view, binding.engagementId)
        if (binding.role !== 'coordinator' && !['finding', 'remember'].includes(action.kind))
          throw new Error('This role cannot change the check plan')
        if (project.stopped && !['resume', 'revoke'].includes(action.kind)) throw new Error('Project is stopped')
        const scoped = (kind: SecurityRecord['kind'], id: string) => {
          const item = view.records.find(item => item.kind === kind && 'id' in item.value && item.value.id === id)
          if (!item || !('engagementId' in item.value) || item.value.engagementId !== project.id)
            throw new Error('Unknown or foreign project record')
          return item
        }
        const asset = (id: string): Asset => {
          const item = scoped('asset', id)
          if (item.kind !== 'asset') throw new Error('Asset required')
          if (binding.role !== 'coordinator' && !binding.assetIds.includes(id))
            throw new Error('Asset is outside delegated scope')
          return item.value
        }
        const evidence = (ids: string[], assetId?: string) => {
          for (const id of ids) {
            const item = scoped('evidence', id)
            if (item.kind !== 'evidence' || (assetId !== undefined && item.value.assetId !== assetId))
              throw new Error('Evidence belongs to another asset')
            asset(item.value.assetId)
          }
        }
        switch (action.kind) {
          case 'web-target': {
            const environment = this.environment(project.id, action.environmentId)
            const target = environment.webTarget
            if (!target) throw new Error('Start a managed laboratory before registering its target')
            if (!action.pathPrefix.startsWith('/') || /[?#\\]/u.test(action.pathPrefix) || decodeURIComponent(action.pathPrefix).includes('..'))
              throw new Error('Select an absolute path prefix without traversal, query or fragment')
            return [{ kind: 'asset', value: webAssetSchema.parse({
              kind: 'web', id: randomUUID(), engagementId: project.id, label: action.label,
              environmentId: environment.id, origin: target.origin, instanceId: target.instanceId,
              pathPrefix: action.pathPrefix,
            }) }]
          }
          case 'revise-finding': {
            const item = scoped('finding', action.findingId)
            if (item.kind !== 'finding') throw new Error('Finding required')
            evidence(action.evidenceIds, item.value.assetId)
            return [{ kind: 'finding', value: { ...item.value, title: action.title, explanation: action.explanation,
              conditions: action.conditions, evidenceIds: action.evidenceIds, status: 'suspected', review: '' } }]
          }
          case 'conclude': {
            const review = scoped('review', action.reviewId)
            if (review.kind !== 'review') throw new Error('Review required')
            const item = scoped('finding', review.value.findingId)
            if (item.kind !== 'finding' || findingHash(item.value) !== review.value.findingHash)
              throw new Error('Finding changed; obtain another independent review')
            if (review.value.verdict !== 'inconclusive') {
              const ids = review.value.verdict === 'confirmed' ? review.value.supportingEvidenceIds : review.value.opposingEvidenceIds
              if (!ids.length) throw new Error('Conclusions require validation evidence')
              for (const id of ids) {
                const observation = scoped('evidence', id)
                if (observation.kind !== 'evidence' || observation.value.incomplete || observation.value.assetId !== item.value.assetId)
                  throw new Error('Conclusions require complete evidence for the finding asset')
              }
              if (review.value.basis === 'static') {
                if (!ids.some((id) => {
                  const observation = scoped('evidence', id)
                  return observation.kind === 'evidence' && observation.value.method === 'static' &&
                    observation.value.observationKind === 'implementation'
                })) throw new Error('Static conclusions require complete implementation evidence')
              } else if (!ids.some((id) => {
                const observation = scoped('evidence', id)
                const plan = observation.kind === 'evidence' && view.records.find(record => record.kind === 'plan' && record.value.id === observation.value.planId)
                if (!plan || plan.kind !== 'plan' || !view.records.some(record => record.kind === 'check' && record.value.id === plan.value.checkId && record.value.phase === 'validation')) return false
                return observation.value.planId && view.records.some(run =>
                  run.kind === 'execution' && run.value.planId === observation.value.planId &&
                  run.value.assetId === item.value.assetId && run.value.status === 'completed')
              })) throw new Error('Conclusions require a completed validation plan')
            }
            return [{ kind: 'finding', value: { ...item.value, status: review.value.verdict, review: review.value.id } }]
          }
          case 'import-legacy': {
            const imported = await this.artifacts.import(action.path, this.options.importRoots)
            const archive = JSON.parse((await this.artifacts.read(imported.artifact)).toString('utf8')) as unknown
            z.object({ tables: z.object({ records: z.record(z.string(), z.json()) }).loose() })
              .loose()
              .parse(archive)
            return [
              {
                kind: 'legacy',
                value: {
                  id: randomUUID(),
                  engagementId: project.id,
                  title: action.title,
                  artifact: imported.artifact,
                  identity: 'operator-declared',
                  importedAt: Date.now(),
                },
              },
            ]
          }
          case 'import-source': {
            const artifact = await importSource(this.artifacts, action.path, operator ? [action.path] : this.options.importRoots,
              { entries: this.options.maxDerivedAssets, bytes: this.options.maxArtifactBytes })
            return [{ kind: 'asset', value: sourceAssetSchema.parse({
              kind: 'source', id: randomUUID(), engagementId: project.id, label: action.label,
              artifact, identity: 'measured',
            }) }]
          }
          case 'import': {
            const measured = await this.artifacts.import(action.path, operator ? [action.path] : this.options.importRoots)
            const sample = fileAssetSchema.parse({
              id: randomUUID(),
              engagementId: project.id,
              label: action.label,
              ...measured,
              identity: 'measured',
            })
            return this.importedRecords(sample)
          }
          case 'template': {
            const selected = asset(action.assetId)
            const web = 'kind' in selected && selected.kind === 'web'
            const stages = [
              [
                'recon',
                web ? 'Inventory the laboratory target' : 'Inventory the sample',
                web ? 'Record the scoped origin, instance, HTTP responses and environment availability' : 'Record identity, architecture, composition, dependencies and environment availability',
              ],
              [
                'surface',
                'Map exposed entry points',
                web ? 'Map observed URLs, methods, parameters and response evidence within the declared scope' : 'Cite exports, parsers, components, IPC and JNI entry points with locations',
              ],
              [
                'assessment',
                'Evaluate weakness hypotheses',
                'Record applicable conditions, supporting and opposing evidence, and references',
              ],
              [
                'validation',
                'Validate and review',
                'Use an approved plan; record observations, reproduction conditions, cleanup and a reviewed conclusion',
              ],
            ] as const
            const records: SecurityRecord[] = []
            let previous: string | undefined
            for (const [phase, title, criterion] of stages) {
              const check = checkSchema.parse({
                id: randomUUID(),
                engagementId: project.id,
                assetId: action.assetId,
                phase,
                title,
                criterion,
                dependencies: previous ? [previous] : [],
                evidenceIds: [],
                status: 'planned',
                attempts: 0,
                rationale: '',
              })
              records.push({ kind: 'check', value: check })
              previous = check.id
            }
            return records
          }
          case 'check': {
            asset(action.check.assetId)
            evidence(action.check.evidenceIds, action.check.assetId)
            for (const id of action.check.dependencies) scoped('check', id)
            return [
              {
                kind: 'check',
                value: checkSchema.parse({
                  ...action.check,
                  id: randomUUID(),
                  engagementId: project.id,
                  status: 'planned',
                  attempts: 0,
                  rationale: '',
                }),
              },
            ]
          }
          case 'reopen': {
            const item = scoped('check', action.checkId)
            if (item.kind !== 'check' || item.value.status !== 'completed') throw new Error('Only completed checks can be reopened')
            const affected = new Set<string>([item.value.id])
            let added = true
            while (added) {
              added = false
              for (const record of view.records) {
                if (record.kind === 'check' && record.value.engagementId === project.id && !affected.has(record.value.id) && record.value.dependencies.some(id => affected.has(id))) {
                  affected.add(record.value.id)
                  added = true
                }
              }
            }
            const records: SecurityRecord[] = []
            for (const record of view.records) {
              if (record.kind === 'check' && affected.has(record.value.id)) {
                if (record.value.status === 'running') throw new Error('Stop dependent checks before reopening')
                records.push({ kind: 'check', value: { ...record.value, status: 'planned', rationale: action.rationale } })
              }
              if (record.kind === 'plan' && affected.has(record.value.checkId) && record.value.status === 'approved') {
                records.push({ kind: 'plan', value: { ...record.value, status: 'revoked', approvedUntil: 0 } })
              }
            }
            return records
          }
          case 'finish':
          case 'reconcile': {
            const item = scoped('check', action.checkId)
            if (item.kind !== 'check') throw new Error('Check required')
            if (action.kind === 'finish') {
              if (item.value.status !== 'planned') throw new Error('Only a reconciled, idle check can be completed')
              if (!action.evidenceIds.length) throw new Error('Completion requires evidence')
              evidence(action.evidenceIds, item.value.assetId)
              this.dependencies(view, item.value)
              return [
                {
                  kind: 'check',
                  value: {
                    ...item.value,
                    evidenceIds: action.evidenceIds,
                    status: 'completed',
                    rationale: action.rationale,
                  },
                },
              ]
            }
            if (item.value.status !== 'interrupted' && item.value.status !== 'blocked')
              throw new Error('Only interrupted or blocked checks need reconciliation')
            return [{ kind: 'check', value: { ...item.value, status: 'planned', rationale: action.rationale } }]
          }
          case 'finding': {
            asset(action.finding.assetId)
            evidence(action.finding.evidenceIds, action.finding.assetId)
            if (action.finding.status === 'confirmed' || action.finding.status === 'refuted')
              throw new Error('Conclusions require an independent review and the conclude command')
            return [
              {
                kind: 'finding',
                value: findingSchema.parse({ ...action.finding, id: randomUUID(), engagementId: project.id }),
              },
            ]
          }
          case 'plan': {
            const item = scoped('check', action.checkId)
            if (item.kind !== 'check' || item.value.assetId !== action.operation.assetId)
              throw new Error('Plan must use the check asset')
            const sample = asset(item.value.assetId)
            const environment = this.environment(project.id, action.operation.environmentId)
            if (action.durationMs > this.options.maxDurationMs)
              throw new Error('Plan duration exceeds deployment limit')
            let operation = action.operation
            if (action.script !== undefined)
              operation = {
                ...operation,
                script: await this.artifacts.put(Buffer.from(action.script), operation.provider === 'offline' && operation.operation === 'python' ? 'text/x-python' : 'text/javascript'),
              }
            const provider = this.providers.get(operation.provider)
            const context = {
              environment,
              asset: sample,
              artifacts: this.artifacts,
              signal: new AbortController().signal,
              durationMs: action.durationMs,
              maxOutputBytes: this.options.maxOutputBytes,
            }
            if (provider.prepare) operation = await provider.prepare(operation, context)
            const resolved = provider.resolve(operation, context)
            if (resolved.impact === 'target-write' && item.value.phase !== 'validation')
              throw new Error('Target changes require a validation check')
            const fields = {
              checkId: item.value.id,
              hypothesis: action.hypothesis,
              expectedObservation: action.expectedObservation,
              impact: action.impact,
              cleanup: action.cleanup,
              operation: resolved,
              durationMs: action.durationMs,
              environmentHash: this.environmentHash(environment),
            }
            const hash = createHash('sha256').update(JSON.stringify(fields)).digest('hex')
            return [
              {
                kind: 'plan',
                value: validationPlanSchema.parse({
                  ...fields,
                  hash,
                  id: randomUUID(),
                  engagementId: project.id,
                  status: 'draft',
                }),
              },
            ]
          }
          case 'approve':
          case 'revoke': {
            const item = scoped('plan', action.planId)
            if (item.kind !== 'plan') throw new Error('Plan required')
            return [
              {
                kind: 'plan',
                value: {
                  ...item.value,
                  status: action.kind === 'approve' ? 'approved' : 'revoked',
                  approvedUntil: action.kind === 'approve' ? Date.now() + this.options.approvalTtlMs : 0,
                },
              },
            ]
          }
          case 'stop':
          case 'resume':
            return [{ kind: 'engagement', value: { ...project, stopped: action.kind === 'stop' } }]
          case 'remember':
            return [{ kind: 'knowledge', value: {
              id: randomUUID(), engagementId: project.id, title: action.entry.title,
              content: action.entry.summary, conditions: action.entry.conditions,
              tags: action.entry.tags, evidenceIds: [], published: false, entry: action.entry,
            } }]
          case 'publish': {
            const item = scoped('knowledge', action.knowledgeId)
            if (item.kind !== 'knowledge') throw new Error('Knowledge entry required')
            if (item.value.supersededBy || item.value.excluded || !item.value.entry) throw new Error('Refine this entry before sharing')
            return [{ kind: 'knowledge', value: { ...item.value, published: true } }]
          }
        }
      },
    )
    if (action.kind === 'stop' || action.kind === 'revoke') {
      const project = this.binding(sessionId)?.engagementId
      if (project) await this.cancelExecutions(project, action.kind === 'revoke' ? action.planId : undefined)
    }
    return this.view(sessionId)
  }
  private async createReport(sessionId: string, command: SecurityCommand, operator: boolean, signal: AbortSignal): Promise<WorkbenchView> {
    const snapshot = this.journal.view()
    const binding = this.requireBinding(snapshot, sessionId)
    if (binding.role !== 'coordinator') throw new Error('Coordinator role required')
    const project = this.project(snapshot, binding.engagementId)
    const input = { sessionId, operator, action: command.action }
    if (this.journal.replay(command.operationId, input)) return this.view(sessionId)
    const key = command.operationId
    const fingerprint = JSON.stringify(input)
    const running = this.reports.get(key)
    if (running) {
      if (running.fingerprint !== fingerprint) throw new Error('operationId was already used for different input')
      return running.pending
    }
    if (project.stopped) throw new Error('Project is stopped')
    if (snapshot.revision !== command.expectedRevision) throw new Error('Security state changed; reload before retrying')
    if (!this.generateReport || !this.options.reportLimits) throw new Error('Report model is unavailable')
    const generate = this.generateReport
    const limits = this.options.reportLimits
    const recordsOf = (view: WorkbenchView) => view.records.filter(record => record.kind !== 'binding' && record.kind !== 'report' &&
      (record.kind === 'engagement' ? record.value.id : record.value.engagementId) === project.id)
    const records = recordsOf(snapshot)
    const source = JSON.stringify(records)
    const abort = new AbortController()
    const combined = AbortSignal.any([signal, abort.signal])
    const pending = (async () => {
      combined.throwIfAborted()
      const prompt = reportPrompt(records, limits)
      const response = await generate(prompt, combined, sessionId)
      combined.throwIfAborted()
      const rendered = renderReport(records, response, limits)
      const markdown = await this.artifacts.put(Buffer.from(rendered.markdown), 'text/markdown')
      const findingsMarkdown = rendered.findingsMarkdown === undefined ? undefined
        : await this.artifacts.put(Buffer.from(rendered.findingsMarkdown), 'text/markdown')
      const json = await this.artifacts.put(Buffer.from(JSON.stringify({ revision: snapshot.revision, records })), 'application/json')
      await this.journal.commit(command.operationId, undefined, input, (view) => {
        combined.throwIfAborted()
        if (this.requireBinding(view, sessionId).engagementId !== project.id || this.project(view, project.id).stopped ||
          JSON.stringify(recordsOf(view)) !== source) throw new Error('Project analysis changed; generate the report again')
        return [{ kind: 'report', value: reportSchema.parse({ id: randomUUID(), engagementId: project.id,
          revision: snapshot.revision, createdAt: Date.now(), markdown, json, findingsMarkdown }) }]
      })
      return this.view(sessionId)
    })()
    const release = this.trackDelegation(project.id, abort, pending)
    const settled = pending.finally(() => { release(); this.reports.delete(key) })
    this.reports.set(key, { fingerprint, pending: settled })
    return settled
  }
  /** Persist a reviewer-authored conclusion without granting execution authority.
   * @param sessionId - independently bound reviewer Session.
   * @param input - review fields supplied by the reviewer tool.
   * @returns committed review visible to the reviewer. */
  async review(sessionId: string, input: unknown): Promise<WorkbenchView> {
    const schema = reviewSchema.omit({ id: true, engagementId: true, assetId: true, reviewerSessionId: true, createdAt: true })
      .extend({ basis: reviewSchema.shape.basis.unwrap() })
    const proposal = schema.parse(input)
    await this.journal.commit(randomUUID(), undefined, { sessionId, proposal }, (view) => {
      const binding = this.requireBinding(view, sessionId)
      if (binding.role !== 'reviewer') throw new Error('An independently bound reviewer is required')
      if (this.project(view, binding.engagementId).stopped) throw new Error('Project is stopped')
      const finding = this.view(sessionId).records.find(item => item.kind === 'finding' && item.value.id === proposal.findingId)
      if (finding?.kind !== 'finding' || findingHash(finding.value) !== proposal.findingHash)
        throw new Error('Finding is unavailable or changed')
      for (const id of [...proposal.supportingEvidenceIds, ...proposal.opposingEvidenceIds]) {
        const observation = view.records.find(item => item.kind === 'evidence' && item.value.id === id)
        if (observation?.kind !== 'evidence' || observation.value.engagementId !== binding.engagementId || observation.value.assetId !== finding.value.assetId)
          throw new Error('Review evidence belongs to another asset')
        if (observation.value.source.sessionId === sessionId) throw new Error('Reviewer must be independent of evidence collection')
      }
      return [{ kind: 'review', value: reviewSchema.parse({ ...proposal, id: randomUUID(),
        engagementId: binding.engagementId, assetId: finding.value.assetId, reviewerSessionId: sessionId, createdAt: Date.now() }) }]
    })
    return this.view(sessionId)
  }
  /** Read a project for the authenticated operator without changing a Session binding.
   * @param projectId - selected project identifier.
   * @returns project records excluding role bindings. */
  projectView(projectId: string): WorkbenchView {
    const view = this.journal.view()
    this.project(view, projectId)
    return { revision: view.revision, records: view.records.filter(item => item.kind !== 'binding' &&
      (item.kind === 'engagement' ? item.value.id : item.value.engagementId) === projectId) }
  }
  private requireBinding(view: WorkbenchView, sessionId: string): SessionBinding {
    const record = view.records.find(item => item.kind === 'binding' && item.value.sessionId === sessionId)
    if (record?.kind !== 'binding' || record.value.active === false) throw new Error('Select a security project first')
    return record.value
  }
  private project(view: WorkbenchView, id: string) {
    const record = view.records.find(item => item.kind === 'engagement' && item.value.id === id)
    if (record?.kind !== 'engagement') throw new Error('Unknown security project')
    return record.value
  }
  private environment(projectId: string, environmentId: string): SecurityEnvironment {
    const project = this.project(this.journal.view(), projectId)
    const environment = this.options.environments.find(item => item.id === environmentId)
    if (!project.environmentIds.includes(environmentId) || !environment)
      throw new Error('Environment is outside project scope')
    return environment
  }
  private dependencies(view: WorkbenchView, check: CheckStep): void {
    for (const id of check.dependencies) {
      const item = view.records.find(item => item.kind === 'check' && item.value.id === id)
      if (item?.kind !== 'check' || item.value.status !== 'completed')
        throw new Error('Check dependencies are incomplete')
    }
  }
  /**
   * Recover unsettled checks without repeating any external operation.
   * @returns completion after interrupted state is durable.
   */
  async recover(): Promise<void> {
    const view = this.journal.view()
    const records: SecurityRecord[] = view.records
      .filter(item => item.kind === 'check' && item.value.status === 'running')
      .map(item =>
        item.kind === 'check'
          ? {
            kind: 'check',
            value: {
              ...item.value,
              status: 'interrupted',
              rationale: 'Verify target and provider state before retrying',
            },
          }
          : item,
      )
    for (const item of view.records) {
      if (item.kind === 'plan' && item.value.status === 'approved')
        records.push({ kind: 'plan', value: { ...item.value, status: 'revoked', approvedUntil: 0 } })
      if (item.kind === 'execution' && item.value.status === 'running')
        records.push({
          kind: 'execution',
          value: {
            ...item.value,
            status: 'interrupted',
            detail: 'Reconcile external state; this execution will not be replayed',
          },
        })
    }
    if (records.length)
      await this.journal.commit(randomUUID(), view.revision, { recovery: view.revision }, () => records)
  }
  /**
   * Publish a child role before a delegated session can receive tools.
   * @param parentId - coordinating session.
   * @param childId - exact child session.
   * @param assetIds - narrowed parent asset set.
   * @param role - child role.
   * @returns completion after authority is durable.
   */
  async bindChild(
    parentId: string,
    childId: string,
    assetIds: string[],
    role: DelegatedRole,
  ): Promise<void> {
    const view = this.journal.view()
    const parent = this.requireBinding(view, parentId)
    if (parent.role !== 'coordinator') throw new Error('Nested delegation is disabled')
    const allowed = this.view(parentId)
      .records.filter(item => item.kind === 'asset')
      .map(item => item.value.id)
    if (!assetIds.length || assetIds.some(id => !allowed.some(assetId => assetId === id)))
      throw new Error('Invalid delegated assets')
    await this.journal.commit(randomUUID(), view.revision, { childId, assetIds, role }, () => [
      {
        kind: 'binding',
        value: { sessionId: childId, engagementId: parent.engagementId, assetIds, role },
      },
    ])
  }
  /** Read reviewed cross-project reference material.
   * @returns published knowledge, which is never executable authority. */
  sharedKnowledge(): SecurityRecord[] {
    return this.journal.view().records.filter(item => item.kind === 'knowledge' && item.value.published && !item.value.supersededBy && !item.value.excluded)
  }

  /**
   * Execute an approved plan once for an operation identity.
   * @param sessionId - coordinating session.
   * @param planId - immutable approved plan.
   * @param operationId - durable retry identity.
   * @param expectedRevision - state observed before execution.
   * @param callId - originating logged tool call.
   * @param signal - owning tool or job cancellation.
   * @returns project view after the execution and evidence settle.
   */
  async execute(
    sessionId: string,
    planId: string,
    operationId: string,
    expectedRevision: number,
    callId: string,
    signal: AbortSignal,
  ): Promise<WorkbenchView> {
    const initial = this.journal.view()
    const binding = this.requireBinding(initial, sessionId)
    if (binding.role !== 'coordinator') throw new Error('Only the coordinator executes validation plans')
    const prior = initial.records.find(item => item.kind === 'execution' && item.value.id === operationId)
    if (prior?.kind === 'execution') {
      if (prior.value.planId !== planId || prior.value.engagementId !== binding.engagementId)
        throw new Error('Execution identity was reused')
      return this.view(sessionId)
    }
    const entry = initial.records.find(
      item => item.kind === 'plan' && item.value.id === planId && item.value.engagementId === binding.engagementId,
    )
    if (entry?.kind !== 'plan') throw new Error('Unknown validation plan')
    const plan = entry.value
    const environment = this.environment(binding.engagementId, plan.operation.environmentId)
    if (this.environmentHash(environment) !== plan.environmentHash)
      throw new Error('Environment configuration changed; prepare another plan')
    const sample = this.view(sessionId).records.find(item => item.kind === 'asset' && item.value.id === plan.operation.assetId)
    if (sample?.kind !== 'asset') throw new Error('Plan asset is unavailable')
    const provider = this.providers.get(plan.operation.provider)
    const key = provider.resourceKey ? provider.resourceKey(plan.operation, sample.value) : environment.id
    const lease = key ?? randomUUID()
    if (this.active.has(environment.id) || this.active.has(lease)) throw new Error('Analysis instance is already leased')
    const controller = new AbortController()
    const combined = AbortSignal.any([signal, controller.signal])
    let settle!: () => void
    const done = new Promise<void>((resolve) => {
      settle = resolve
    })
    this.active.set(lease, { project: binding.engagementId, environment: environment.id, plan: planId, controller, done })
    let started = false
    try {
      combined.throwIfAborted()
      await this.journal.commit(operationId + ':start', expectedRevision, { sessionId, planId }, (view) => {
        const project = this.project(view, binding.engagementId)
        const current = view.records.find(item => item.kind === 'plan' && item.value.id === planId)
        if (
          project.stopped ||
          current?.kind !== 'plan' ||
          current.value.status !== 'approved' ||
          (current.value.approvedUntil ?? 0) <= Date.now()
        )
          throw new Error('Plan is not approved or project is stopped')
        const item = view.records.find(item => item.kind === 'check' && item.value.id === plan.checkId)
        if (item?.kind !== 'check' || item.value.status !== 'planned')
          throw new Error('Check must be planned before execution')
        if (item.value.attempts >= project.maxAttempts) throw new Error('Check attempt budget exhausted')
        this.dependencies(view, item.value)
        return [
          {
            kind: 'check',
            value: { ...item.value, status: 'running', attempts: item.value.attempts + 1, ownerSessionId: sessionId },
          },
          {
            kind: 'execution',
            value: {
              id: operationId,
              engagementId: project.id,
              assetId: item.value.assetId,
              planId,
              status: 'running',
              detail: '',
            },
          },
        ]
      })
      started = true
      combined.throwIfAborted()
      const context = {
        environment,
        asset: sample.value,
        artifacts: this.artifacts,
        signal: combined,
        durationMs: plan.durationMs,
        maxOutputBytes: this.options.maxOutputBytes,
      }
      const resolved = provider.resolve(plan.operation, context)
      if (JSON.stringify(resolved) !== JSON.stringify(plan.operation))
        throw new Error('Provider resolution changed; prepare a new plan')
      const result = await provider.run(resolved, context)
      const artifact = await this.artifacts.put(result.bytes, result.mediaType)
      const evidenceId = randomUUID()
      await this.journal.commit(operationId + ':settle', undefined, { operationId, artifact }, (view) => {
        const item = view.records.find(item => item.kind === 'check' && item.value.id === plan.checkId)
        if (item?.kind !== 'check') throw new Error('Executing check disappeared')
        return [
          {
            kind: 'evidence',
            value: evidenceSchema.parse({
              id: evidenceId,
              engagementId: binding.engagementId,
              assetId: sample.value.id,
              checkId: plan.checkId,
              planId,
              title: plan.operation.provider + ' ' + plan.operation.operation,
              summary: result.summary,
              artifact,
              provider: plan.operation.provider,
              operation: plan.operation.operation,
              toolVersion: result.toolVersion,
              request: plan.operation.parameters,
              source: { sessionId, callId, channel: callId.startsWith('operator:') ? 'operator' : 'tool' },
              incomplete: result.incomplete || !!result.failure || combined.aborted,
              failure: result.failure, cleanup: result.cleanup, method: result.method, observationKind: result.observationKind,
              createdAt: Date.now(),
            }),
          },
          {
            kind: 'check',
            value: {
              ...item.value,
              status: combined.aborted ? 'interrupted' : result.failure ? 'blocked' : 'planned',
              evidenceIds: [...item.value.evidenceIds, evidenceId],
              rationale: 'Review collected evidence against the check criterion',
            },
          },
          {
            kind: 'execution',
            value: {
              id: operationId,
              engagementId: binding.engagementId,
              assetId: sample.value.id,
              planId,
              status: combined.aborted ? 'interrupted' : result.failure ? 'failed' : 'completed',
              detail: JSON.stringify({ failure: result.failure, cleanup: result.cleanup, cancelled: combined.aborted }),
            },
          },
        ]
      })
      return this.view(sessionId)
    } catch (error) {
      if (started) {
        const detail = error instanceof Error ? error.message : String(error)
        const failure = await this.artifacts.put(Buffer.from(detail), 'text/plain')
        await this.journal.commit(operationId + ':failed', undefined, { operationId, detail }, (view) => {
          const item = view.records.find(item => item.kind === 'check' && item.value.id === plan.checkId)
          if (item?.kind !== 'check') throw new Error('Executing check disappeared')
          return [
            {
              kind: 'evidence',
              value: evidenceSchema.parse({
                id: randomUUID(),
                engagementId: binding.engagementId,
                assetId: item.value.assetId,
                checkId: plan.checkId,
                planId,
                title: 'Execution failed',
                summary: detail.slice(0, this.options.maxOutputBytes),
                artifact: failure,
                provider: plan.operation.provider,
                operation: plan.operation.operation,
                toolVersion: 'unavailable after failure',
                request: plan.operation.parameters,
                source: { sessionId, callId },
                incomplete: true,
                createdAt: Date.now(),
              }),
            },
            {
              kind: 'check',
              value: { ...item.value, status: combined.aborted ? 'interrupted' : 'blocked', rationale: detail },
            },
            {
              kind: 'execution',
              value: {
                id: operationId,
                engagementId: binding.engagementId,
                assetId: item.value.assetId,
                planId,
                status: combined.aborted ? 'interrupted' : 'failed',
                detail,
              },
            },
          ]
        })
      }
      throw error
    } finally {
      this.active.delete(lease)
      settle()
    }
  }
  /** Cancel active provider work and await cleanup.
   * @returns completion after every active provider reaches cleanup. */
  async dispose(): Promise<void> {
    const runs = [...this.active.values(), ...[...this.delegated].map(([controller, job]) => ({ ...job, controller }))]
    runs.forEach((run) => {
      run.controller.abort(new Error('Security workbench disposed'))
    })
    await Promise.allSettled(runs.map(run => run.done))
  }

  /**
   * Collect read-only static evidence without granting a validation capability.
   * @param sessionId - explicitly bound owner or child.
   * @param operation - static provider request.
   * @param callId - originating logged call.
   * @param signal - owner cancellation.
   * @returns committed evidence.
   */
  async observe(
    sessionId: string,
    operation: AnalysisOperation,
    callId: string,
    signal: AbortSignal,
  ): Promise<SecurityRecord> {
    const key = sessionId + ':' + callId
    const fingerprint = createHash('sha256').update(JSON.stringify(operation)).digest('hex')
    const existing = this.observations.get(key)
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new Error('Observation callId was already used for different input')
      return existing.pending
    }
    const pending = this.collectObservation(sessionId, operation, callId, signal, fingerprint)
    this.observations.set(key, { fingerprint, pending })
    try { return await pending }
    finally { this.observations.delete(key) }
  }

  private async collectObservation(sessionId: string, operation: AnalysisOperation, callId: string,
    signal: AbortSignal, fingerprint: string): Promise<SecurityRecord> {
    const view = this.view(sessionId)
    const binding = this.binding(sessionId)
    if (!binding) throw new Error('Select a security project first')
    if (this.project(this.journal.view(), binding.engagementId).stopped) throw new Error('Project is stopped')
    const sample = view.records.find(item => item.kind === 'asset' && item.value.id === operation.assetId)
    if (sample?.kind !== 'asset') throw new Error('Asset is outside the session scope')
    if (!canObserve(binding.role, operation.provider, operation.operation))
      throw new Error('This role cannot collect the requested observation')
    if (operation.script || !['binary', 'ghidra', 'android', 'source'].includes(operation.provider))
      throw new Error('Use an approved plan for dynamic or programmable operations')
    const previous = view.records.find(item => item.kind === 'evidence' &&
      item.value.source.sessionId === sessionId && item.value.source.callId === callId && !item.value.planId)
    if (previous?.kind === 'evidence') {
      if (previous.value.requestHash !== fingerprint) throw new Error('Observation callId was already used for different input')
      return previous
    }
    const environment = this.environment(binding.engagementId, operation.environmentId)
    const provider = this.providers.get(operation.provider)
    const key = provider.resourceKey ? provider.resourceKey(operation, sample.value) : environment.id
    const lease = key ?? randomUUID()
    if (this.active.has(environment.id) || this.active.has(lease)) throw new Error('Environment is already leased by another operation')
    const abort = new AbortController()
    const combined = AbortSignal.any([signal, abort.signal, AbortSignal.timeout(this.options.maxDurationMs)])
    const settled = Promise.withResolvers<void>()
    this.active.set(lease, { project: binding.engagementId, environment: environment.id, plan: '', controller: abort, done: settled.promise })
    try {
      combined.throwIfAborted()
      const context = { environment, asset: sample.value, artifacts: this.artifacts, signal: combined,
        durationMs: this.options.maxDurationMs, maxOutputBytes: this.options.maxOutputBytes }
      const resolved = provider.resolve(operation, context)
      if (resolved.impact !== 'observe') throw new Error('Static observations cannot modify analysis state or targets')
      let result: import('./providers.ts').AnalysisResult
      try { result = await provider.run(resolved, context) }
      catch (error) {
        const bytes = Buffer.from(error instanceof Error ? error.message : String(error))
          .subarray(0, Math.min(this.options.maxOutputBytes, this.options.maxArtifactBytes))
        result = { bytes, mediaType: 'text/plain', summary: bytes.toString('utf8'), incomplete: true,
          failure: bytes.toString('utf8'), toolVersion: 'unavailable after failure', method: 'static' }
      }
      const artifact = await this.artifacts.put(result.bytes, result.mediaType)
      const record: SecurityRecord = {
        kind: 'evidence',
        value: evidenceSchema.parse({
          id: randomUUID(), engagementId: binding.engagementId, assetId: sample.value.id,
          title: operation.provider + ' ' + operation.operation, summary: result.summary,
          artifact, provider: operation.provider, operation: operation.operation, toolVersion: result.toolVersion,
          request: resolved.parameters, requestHash: fingerprint,
          source: { sessionId, callId, channel: callId.startsWith('operator:') ? 'operator' : 'tool' },
          incomplete: result.incomplete || !!result.failure || combined.aborted,
          failure: result.failure, cleanup: result.cleanup, method: result.method ?? 'static', observationKind: result.observationKind, createdAt: Date.now(),
        }),
      }
      const committed = await this.journal.commit(sessionId + ':' + callId, undefined, { operation }, () => [record])
      const saved = committed.records.find(item => item.kind === 'evidence' &&
        item.value.source.sessionId === sessionId && item.value.source.callId === callId && !item.value.planId)
      if (!saved) throw new Error('Observation commit did not publish its evidence')
      return saved
    } finally {
      this.active.delete(lease)
      settled.resolve()
    }
  }
}
