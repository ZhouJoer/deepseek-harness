/** Check execution and accepted review facts derived from one project revision. @module */
import { findingHash } from './assessment.ts'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { AssetId, CheckId, EvidenceId, SecurityRecord } from './model.ts'

/** Evidence facts never imply that the target is safe. */
export interface CheckCoverage {
  checkId: CheckId
  assetId: AssetId
  title: string
  criterion: string
  status: Extract<SecurityRecord, { kind: 'check' }>['value']['status']
  rationale: string
  evidenceIds: EvidenceId[]
  missingEvidenceIds: EvidenceId[]
  unmetDependencies: CheckId[]
  inventory: number
  implementation: number
  other: number
  failed: number
  incomplete: number
  methods: string[]
  reviews: { findingId: string; title: string; verdict: 'confirmed' | 'refuted'; basis: 'static' | 'runtime' }[]
}

/** Non-persistent coverage sent with the records from the same revision. */
export interface ProjectCoverage {
  revision: number
  checks: CheckCoverage[]
  assets: {
    assetId: AssetId
    label: string
    hasChecks: boolean
    unlinkedEvidenceIds: EvidenceId[]
    sourceFilesRead: number
    auxiliaryAnalysisLogs: number
    completeImplementationObservations: number
    inventoryObservations: number
    incompleteObservations: number
  }[]
}

/** Derive explicit check relationships and current accepted conclusions.
 * @param records - records from one project snapshot.
 * @param revision - revision owning these records.
 * @returns execution and observation facts without a numerical security score.
 */
export function deriveProjectCoverage(records: readonly SecurityRecord[], revision: number): ProjectCoverage {
  const checks = records.filter(item => item.kind === 'check').map(item => item.value)
  const observations = records.filter(item => item.kind === 'evidence').map(item => item.value)
  const plans = records.filter(item => item.kind === 'plan').map(item => item.value)
  const findings = records.filter(item => item.kind === 'finding').map(item => item.value)
  const reviews = records.filter(item => item.kind === 'review').map(item => item.value)
  const executions = records.filter(item => item.kind === 'execution').map(item => item.value)
  const complete = (observation: typeof observations[number]) => !observation.incomplete && !observation.failure
  const accepted = findings.flatMap((finding) => {
    if (finding.status !== 'confirmed' && finding.status !== 'refuted') return []
    const review = reviews.find(item => item.id === finding.review && item.findingId === finding.id
      && item.findingHash === findingHash(finding) && item.engagementId === finding.engagementId
      && item.assetId === finding.assetId && item.verdict === finding.status)
    if (!review) return []
    const ids = review.verdict === 'confirmed' ? review.supportingEvidenceIds : review.opposingEvidenceIds
    const evidence = ids.map(id => observations.find(item => item.id === id && item.assetId === finding.assetId
      && item.engagementId === finding.engagementId))
    if (!evidence.length || evidence.some(item => !item || !complete(item))) return []
    const basis = review.basis ?? 'runtime'
    const supported = basis === 'static'
      ? evidence.some(item => item?.method === 'static' && item.observationKind === 'implementation')
      : evidence.some((item) => {
        const plan = plans.find(plan => plan.id === item?.planId && plan.engagementId === finding.engagementId
          && plan.operation.assetId === finding.assetId)
        return plan && checks.some(check => check.id === plan.checkId && check.phase === 'validation'
          && check.engagementId === finding.engagementId && check.assetId === finding.assetId)
          && executions.some(run => run.planId === plan.id && run.assetId === finding.assetId
            && run.engagementId === finding.engagementId && run.status === 'completed')
      })
    return supported ? [{ findingId: finding.id, title: finding.title, verdict: finding.status, basis, ids }] : []
  })
  const linked = new Set<string>()
  const projected: CheckCoverage[] = checks.map((check) => {
    const refs = new Set(check.evidenceIds)
    for (const observation of observations) {
      const plan = plans.find(item => item.id === observation.planId && item.engagementId === check.engagementId
        && item.operation.assetId === check.assetId)
      if (observation.engagementId === check.engagementId && observation.assetId === check.assetId
        && (observation.checkId === check.id || plan?.checkId === check.id)) refs.add(observation.id)
    }
    const evidence = observations.filter(item => refs.has(item.id)
      && item.engagementId === check.engagementId && item.assetId === check.assetId)
    const evidenceIds = evidence.map(item => item.id)
    for (const id of evidenceIds) linked.add(id)
    return { checkId: check.id, assetId: brandString<AssetId>(check.assetId), title: check.title, criterion: check.criterion,
      status: check.status, rationale: check.rationale, evidenceIds,
      missingEvidenceIds: [...refs].filter(id => !evidenceIds.some(found => found === id)).map(brandString<EvidenceId>),
      unmetDependencies: check.dependencies.filter(id => !checks.some(item => item.id === id
        && item.engagementId === check.engagementId && item.status === 'completed')).map(brandString<CheckId>),
      inventory: evidence.filter(item => complete(item) && item.observationKind === 'inventory').length,
      implementation: evidence.filter(item => complete(item) && item.method === 'static' && item.observationKind === 'implementation').length,
      other: evidence.filter(item => complete(item) && item.observationKind !== 'inventory'
        && !(item.method === 'static' && item.observationKind === 'implementation')).length,
      failed: evidence.filter(item => item.failure).length, incomplete: evidence.filter(item => item.incomplete).length,
      methods: [...new Set(evidence.map(item => item.method ?? 'unknown'))],
      reviews: accepted.filter(item => item.ids.some(id => evidenceIds.some(found => found === id)))
        .map(({ ids: _ids, ...review }) => review),
    }
  })
  const order = { blocked: 0, interrupted: 1, running: 2, planned: 3, completed: 4, skipped: 5 }
  projected.sort((left, right) => order[left.status] - order[right.status])
  return { revision, checks: projected, assets: records.filter(item => item.kind === 'asset').map(({ value: asset }) => {
    const evidence = observations.filter(item => item.assetId === asset.id && item.engagementId === asset.engagementId)
    return { assetId: asset.id, label: asset.label,
      hasChecks: checks.some(item => item.assetId === asset.id && item.engagementId === asset.engagementId),
      unlinkedEvidenceIds: evidence.filter(item => !linked.has(item.id)).map(item => item.id),
      sourceFilesRead: new Set(evidence.flatMap(item => item.provider === 'source' && item.operation === 'read'
        && typeof item.request.path === 'string' ? [item.request.path] : [])).size,
      auxiliaryAnalysisLogs: evidence.filter(item => item.provider === 'session-tool').length,
      completeImplementationObservations: evidence.filter(item => item.observationKind === 'implementation' && complete(item)).length,
      inventoryObservations: evidence.filter(item => item.observationKind === 'inventory').length,
      incompleteObservations: evidence.filter(item => item.incomplete).length,
    }
  }) }
}
