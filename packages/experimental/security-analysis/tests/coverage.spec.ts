/** Coverage records observations separately from current accepted conclusions. @module */
import { expect, it } from 'vitest'
import { deriveProjectCoverage } from '../src/workbench/coverage.ts'
import { recordSchema, type SecurityRecord } from '../src/workbench/model.ts'
import { findingHash } from '../src/workbench/assessment.ts'

function fixture() {
  const artifact = { sha256: 'a'.repeat(64), size: 4, mediaType: 'text/plain' }
  const records: SecurityRecord[] = [
    recordSchema.parse({ kind: 'asset', value: { id: 'asset', engagementId: 'project', label: 'Source', format: 'other', identity: 'measured', artifact } }),
    recordSchema.parse({ kind: 'check', value: { id: 'check', engagementId: 'project', assetId: 'asset', title: 'Check ownership',
      criterion: 'Compare owner and another user', phase: 'validation', status: 'completed', attempts: 1, rationale: '', dependencies: [], evidenceIds: ['evidence'] } }),
    recordSchema.parse({ kind: 'evidence', value: { id: 'evidence', engagementId: 'project', assetId: 'asset', title: 'Source observation',
      summary: 'Implementation read', artifact, provider: 'source', operation: 'read', request: { path: 'handler.ts' },
      toolVersion: 'test', source: { sessionId: 'collector', callId: 'read' }, incomplete: false, method: 'static', observationKind: 'implementation', createdAt: 1 } }),
  ]
  return { records, artifact }
}
it('keeps missing references, failed observations and unfinished dependencies visible', () => {
  const { records } = fixture()
  const check = records.find(item => item.kind === 'check')!
  check.value.evidenceIds.push('missing')
  check.value.dependencies.push('missing-check')
  const evidence = records.find(item => item.kind === 'evidence')!
  evidence.value.incomplete = true
  evidence.value.failure = 'Read was interrupted'
  const coverage = deriveProjectCoverage(records, 7)
  expect(coverage).toMatchObject({ revision: 7, checks: [{ status: 'completed', implementation: 0,
    missingEvidenceIds: ['missing'], unmetDependencies: ['missing-check'], failed: 1, incomplete: 1, reviews: [] }] })
})
it('deduplicates explicit links and leaves same-asset observations unlinked', () => {
  const { records } = fixture()
  const evidence = records.find(item => item.kind === 'evidence')!
  evidence.value.checkId = 'check'
  records.push(recordSchema.parse({ kind: 'evidence', value: { ...evidence.value, id: 'unlinked', checkId: undefined } }))
  const result = deriveProjectCoverage(records, 1)
  expect(result.checks[0]?.evidenceIds).toEqual(['evidence'])
  expect(result.assets[0]?.unlinkedEvidenceIds).toEqual(['unlinked'])
  expect(result.checks[0]?.reviews).toEqual([])
})
it('requires an applied current review and complete implementation evidence for static conclusions', () => {
  const { records } = fixture()
  const finding = recordSchema.parse({ kind: 'finding', value: { id: 'finding', engagementId: 'project', assetId: 'asset',
    title: 'Missing ownership check', explanation: 'Implementation lacks an owner check', conditions: 'Caller controls object',
    status: 'confirmed', evidenceIds: ['evidence'], review: 'review' } })
  if (finding.kind !== 'finding') throw new Error('Finding required')
  records.push(finding, recordSchema.parse({ kind: 'review', value: { id: 'review', engagementId: 'project', assetId: 'asset',
    findingId: 'finding', findingHash: findingHash(finding.value), basis: 'static', reviewerSessionId: 'reviewer', verdict: 'confirmed',
    supportingEvidenceIds: ['evidence'], opposingEvidenceIds: [], explanation: 'Read the branch', uncertainty: '', createdAt: 1 } }))
  expect(deriveProjectCoverage(records, 1).checks[0]?.reviews).toMatchObject([{ basis: 'static', verdict: 'confirmed' }])
  finding.value.review = ''
  expect(deriveProjectCoverage(records, 2).checks[0]?.reviews).toEqual([])
  finding.value.review = 'review'; finding.value.explanation = 'Changed claim'
  expect(deriveProjectCoverage(records, 3).checks[0]?.reviews).toEqual([])
})
it('requires completed validation for runtime reviews and retains simulation identity', () => {
  const { records } = fixture()
  const evidence = records.find(item => item.kind === 'evidence')!
  evidence.value.method = 'simulation'; evidence.value.planId = 'plan'
  records.push(recordSchema.parse({ kind: 'plan', value: { id: 'plan', engagementId: 'project', checkId: 'check',
    hypothesis: 'Check owner', expectedObservation: 'Access differs', impact: 'Local simulation', cleanup: 'No resources',
    operation: { provider: 'offline', operation: 'python', environmentId: 'local', assetId: 'asset', parameters: {}, impact: 'observe' },
    durationMs: 1000, hash: 'a'.repeat(64), environmentHash: 'b'.repeat(64), status: 'revoked' } }))
  const finding = recordSchema.parse({ kind: 'finding', value: { id: 'finding', engagementId: 'project', assetId: 'asset',
    title: 'Ownership', explanation: 'Access differs', conditions: 'Simulator', status: 'refuted', evidenceIds: ['evidence'], review: 'review' } })
  if (finding.kind !== 'finding') throw new Error('Finding required')
  records.push(finding, recordSchema.parse({ kind: 'review', value: { id: 'review', engagementId: 'project', assetId: 'asset',
    findingId: 'finding', findingHash: findingHash(finding.value), reviewerSessionId: 'reviewer', verdict: 'refuted',
    supportingEvidenceIds: [], opposingEvidenceIds: ['evidence'], explanation: 'Observed simulation', uncertainty: 'Not a device', createdAt: 1 } }))
  expect(deriveProjectCoverage(records, 1).checks[0]?.reviews).toEqual([])
  records.push(recordSchema.parse({ kind: 'execution', value: { id: 'run', engagementId: 'project', assetId: 'asset', planId: 'plan', status: 'completed', detail: '' } }))
  expect(deriveProjectCoverage(records, 2).checks[0]).toMatchObject({ methods: ['simulation'], reviews: [{ basis: 'runtime', verdict: 'refuted' }] })
})
