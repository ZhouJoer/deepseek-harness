/** Security command validation and durable project authority. @module */
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import {
  engagementSchema,
  fileAssetSchema,
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
  knowledgeSchema,
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
import { findingHash, projectMarkdown } from './assessment.ts'
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
  z.object({ kind: z.literal('import'), path: text, label: text }).strict(),
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
  z
    .object({
      kind: z.literal('knowledge'),
      title: text,
      content: text,
      conditions: text,
      tags: z.array(text),
      evidenceIds: z.array(text),
    })
    .strict(),
  z.object({ kind: z.literal('publish'), knowledgeId: text }).strict(),
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
  private readonly delegated = new Map<AbortController, { project: string; done: Promise<unknown> }>()
  private readonly active = new Map<
    string,
    { project: string; plan: string; controller: AbortController; done: Promise<void> }
  >()
  constructor(
    private readonly journal: SecurityJournal,
    readonly artifacts: ArtifactStore,
    readonly options: WorkbenchOptions,
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
    if (this.active.has(environmentId)) throw new Error('Environment is already leased by another operation')
    const controller = new AbortController()
    const settled = Promise.withResolvers<undefined>()
    this.active.set(environmentId, { project, plan: '', controller, done: settled.promise })
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
    return record?.kind === 'binding' ? record.value : undefined
  }
  /** List projects for operator selection.
   * @returns project labels available to the local operator, never delegated tool callers. */
  projects(): Engagement[] {
    return this.journal
      .view()
      .records.filter(item => item.kind === 'engagement')
      .map(item => item.value)
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
        const project = item.kind === 'engagement' ? item.value.id : item.value.engagementId
        if (project !== binding.engagementId) return false
        if (item.kind === 'engagement') return true
        if (item.kind === 'binding') return item.value.sessionId === sessionId
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
   * Issue a structured command. Only the user-facing carrier sets operator.
   * @param sessionId - authenticated session identity.
   * @param input - untrusted command JSON.
   * @param operator - true only for a user gesture, never model-supplied.
   * @returns committed project state.
   */
  async command(sessionId: string, input: unknown, operator: boolean = false): Promise<WorkbenchView> {
    const command = commandSchema.parse(input)
    const action = command.action
    const operatorActions = ['create', 'select', 'approve', 'publish', 'resume', 'web-target']
    if (operatorActions.includes(action.kind) && !operator) throw new Error('This action requires an operator gesture')
    await this.journal.commit(
      command.operationId,
      action.kind === 'stop' || action.kind === 'revoke' ? undefined : command.expectedRevision,
      { sessionId, operator, action },
      async (view) => {
        if (action.kind === 'create') {
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
        if (action.kind === 'select') {
          this.project(view, action.engagementId)
          return [
            {
              kind: 'binding',
              value: { sessionId, engagementId: action.engagementId, role: 'coordinator', assetIds: [] },
            },
          ]
        }
        const binding = this.requireBinding(view, sessionId)
        const project = this.project(view, binding.engagementId)
        if (binding.role !== 'coordinator' && !['finding', 'knowledge'].includes(action.kind))
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
          case 'report': {
            const records = view.records.filter(record => record.kind !== 'binding' && record.kind !== 'report' &&
              (record.kind === 'engagement' ? record.value.id : record.value.engagementId) === project.id)
            return [{ kind: 'report', value: reportSchema.parse({
              id: randomUUID(), engagementId: project.id, revision: view.revision, createdAt: Date.now(),
              markdown: await this.artifacts.put(Buffer.from(projectMarkdown(records, view.revision)), 'text/markdown'),
              json: await this.artifacts.put(Buffer.from(JSON.stringify({ revision: view.revision, records })), 'application/json'),
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
              if (!ids.some((id) => {
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
          case 'import': {
            const measured = await this.artifacts.import(action.path, this.options.importRoots)
            const sample = fileAssetSchema.parse({
              id: randomUUID(),
              engagementId: project.id,
              label: action.label,
              ...measured,
              identity: 'measured',
            })
            const samples: Asset[] = [sample]
            if (sample.format === 'apk') {
              const members = await apkMembers(
                await this.artifacts.read(sample.artifact),
                this.options.maxArtifactBytes,
                this.options.maxDerivedAssets,
              )
              for (const member of members)
                samples.push(
                  fileAssetSchema.parse({
                    id: randomUUID(),
                    engagementId: project.id,
                    label: member.path,
                    format: member.format,
                    identity: 'measured',
                    parentId: sample.id,
                    artifact: await this.artifacts.put(member.bytes, 'application/octet-stream'),
                  }),
                )
            }
            return samples.map(value => ({ kind: 'asset' as const, value }))
          }
          case 'template': {
            const selected = asset(action.assetId)
            const web = 'kind' in selected
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
                script: await this.artifacts.put(Buffer.from(action.script), 'text/javascript'),
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
          case 'knowledge':
            evidence(action.evidenceIds)
            return [
              {
                kind: 'knowledge',
                value: knowledgeSchema.parse({
                  id: randomUUID(),
                  engagementId: project.id,
                  title: action.title,
                  content: action.content,
                  conditions: action.conditions,
                  tags: action.tags,
                  evidenceIds: action.evidenceIds,
                  published: false,
                }),
              },
            ]
          case 'publish': {
            const item = scoped('knowledge', action.knowledgeId)
            if (item.kind !== 'knowledge') throw new Error('Knowledge entry required')
            return [{ kind: 'knowledge', value: { ...item.value, published: true } }]
          }
        }
      },
    )
    if (action.kind === 'stop' || action.kind === 'revoke') {
      const project = this.binding(sessionId)?.engagementId
      const cancelled = [...this.active.values(), ...[...this.delegated].map(([controller, job]) => ({ ...job, controller, plan: '' }))].filter(
        run => run.project === project && (action.kind === 'stop' || run.plan === action.planId),
      )
      cancelled.forEach((run) => {
        run.controller.abort(new Error('Operator revoked execution'))
      })
      await Promise.allSettled(cancelled.map(run => run.done))
    }
    return this.view(sessionId)
  }
  /** Persist a reviewer-authored conclusion without granting execution authority.
   * @param sessionId - independently bound reviewer Session.
   * @param input - review fields supplied by the reviewer tool.
   * @returns committed review visible to the reviewer. */
  async review(sessionId: string, input: unknown): Promise<WorkbenchView> {
    const schema = reviewSchema.omit({ id: true, engagementId: true, assetId: true, reviewerSessionId: true, createdAt: true })
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
    if (record?.kind !== 'binding') throw new Error('Select a security project first')
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
    return this.journal.view().records.filter(item => item.kind === 'knowledge' && item.value.published)
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
    if (this.active.has(environment.id)) throw new Error('Environment is already leased by another operation')
    const controller = new AbortController()
    const combined = AbortSignal.any([signal, controller.signal])
    let settle!: () => void
    const done = new Promise<void>((resolve) => {
      settle = resolve
    })
    this.active.set(environment.id, { project: binding.engagementId, plan: planId, controller, done })
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
      const sample = this.view(sessionId).records.find(
        item => item.kind === 'asset' && item.value.id === plan.operation.assetId,
      )
      if (sample?.kind !== 'asset') throw new Error('Plan asset is unavailable')
      const provider = this.providers.get(plan.operation.provider)
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
      this.active.delete(environment.id)
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
    const view = this.view(sessionId)
    const binding = this.binding(sessionId)
    if (!binding) throw new Error('Select a security project first')
    if (this.project(this.journal.view(), binding.engagementId).stopped) throw new Error('Project is stopped')
    const sample = view.records.find(item => item.kind === 'asset' && item.value.id === operation.assetId)
    if (sample?.kind !== 'asset') throw new Error('Asset is outside the session scope')
    if (!canObserve(binding.role, operation.provider, operation.operation))
      throw new Error('This role cannot collect the requested observation')
    if (operation.script || !['binary', 'ghidra', 'android'].includes(operation.provider))
      throw new Error('Use an approved plan for dynamic or programmable operations')
    const environment = this.environment(binding.engagementId, operation.environmentId)
    const provider = this.providers.get(operation.provider)
    if (this.active.has(environment.id)) throw new Error('Environment is already leased by another operation')
    const abort = new AbortController()
    const combined = AbortSignal.any([signal, abort.signal])
    let settle!: () => void
    const done = new Promise<void>((resolve) => {
      settle = resolve
    })
    this.active.set(environment.id, { project: binding.engagementId, plan: '', controller: abort, done })
    try {
      combined.throwIfAborted()
      const context = {
        environment,
        asset: sample.value,
        artifacts: this.artifacts,
        signal: combined,
        durationMs: this.options.maxDurationMs,
        maxOutputBytes: this.options.maxOutputBytes,
      }
      const resolved = provider.resolve(operation, context)
      if (resolved.impact !== 'observe') throw new Error('Static observations cannot modify analysis state or targets')
      const result = await provider.run(resolved, context)
      const artifact = await this.artifacts.put(result.bytes, result.mediaType)
      const record: SecurityRecord = {
        kind: 'evidence',
        value: evidenceSchema.parse({
          id: randomUUID(),
          engagementId: binding.engagementId,
          assetId: sample.value.id,
          title: operation.provider + ' ' + operation.operation,
          summary: result.summary,
          artifact,
          provider: operation.provider,
          operation: operation.operation,
          toolVersion: result.toolVersion,
          request: resolved.parameters,
          source: { sessionId, callId, channel: callId.startsWith('operator:') ? 'operator' : 'tool' },
          incomplete: result.incomplete || combined.aborted,
          createdAt: Date.now(),
        }),
      }
      await this.journal.commit(sessionId + ':' + callId, undefined, { operation, artifact }, () => [record])
      return record
    } finally {
      this.active.delete(environment.id)
      settle()
    }
  }
}
