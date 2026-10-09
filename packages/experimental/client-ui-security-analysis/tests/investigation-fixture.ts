/** Small committed investigation with dependency, review and incomplete-output cases. @module */
import { recordSchema } from '@deepseek-ai/dsh-experimental-security-analysis/src/workbench/model.ts'
import type { WorkbenchView } from '@deepseek-ai/dsh-experimental-security-analysis/client'

/** Create independently mutable records for each graph test.
 * @returns project records including one missing historical reference.
 */
export function investigationFixture(): WorkbenchView {
  const artifact = { sha256: 'a'.repeat(64), size: 100, mediaType: 'text/plain' }
  const records = [
    { kind: 'asset', value: { id: 'input', engagementId: 'project', label: 'Invoice service', artifact, format: 'other', identity: 'measured' } },
    ...['read', 'verify'].map((id, index) => ({ kind: 'check', value: { id, engagementId: 'project', assetId: 'input', title: index ? 'Check ownership' : 'Read handler',
      phase: 'assessment', criterion: 'Compare owner access', dependencies: index ? ['read'] : [], evidenceIds: index ? [] : ['source'], status: index ? 'blocked' : 'completed', attempts: 1, rationale: index ? 'Target unavailable' : '' } })),
    { kind: 'evidence', value: { id: 'source', engagementId: 'project', assetId: 'input', checkId: 'read', title: 'Handler source', summary: 'No owner comparison',
      artifact, provider: 'source', operation: 'read', toolVersion: '1', request: {}, source: { sessionId: 'session', callId: 'call' }, incomplete: false, method: 'static', createdAt: 1 } },
    { kind: 'evidence', value: { id: 'partial', engagementId: 'project', assetId: 'input', title: 'Partial response', summary: 'Capture interrupted',
      artifact, provider: 'web', operation: 'request', toolVersion: '1', request: {}, source: { sessionId: 'session', callId: 'other' }, incomplete: true, failure: 'Timeout', createdAt: 2 } },
    { kind: 'finding', value: { id: 'finding', engagementId: 'project', assetId: 'input', title: 'Missing ownership check', explanation: 'Caller can select another invoice', status: 'suspected', evidenceIds: ['source', 'missing'], conditions: 'Runtime reachability unverified', review: '' } },
    { kind: 'review', value: { id: 'review', engagementId: 'project', assetId: 'input', findingId: 'finding', findingHash: 'b'.repeat(64), reviewerSessionId: 'reviewer',
      verdict: 'confirmed', supportingEvidenceIds: ['source'], opposingEvidenceIds: ['partial'], explanation: 'Inspect the caller', uncertainty: 'Historical review', createdAt: 2 } },
    { kind: 'checkpoint', value: { id: 'first', engagementId: 'project', phase: 'recon', title: 'Locate entry point', summary: 'One handler', reason: '', next: 'Read authorization', evidenceIds: [], findings: [], createdAt: 1, updatedAt: 1 } },
    { kind: 'checkpoint', value: { id: 'second', engagementId: 'project', phase: 'assessment', title: 'Inspect authorization', summary: '', reason: '', next: '', evidenceIds: [], findings: [{ id: 'finding', title: 'Old title', status: 'confirmed' }], createdAt: 2, updatedAt: 2 } },
  ]
  return { revision: 5, records: records.map(record => recordSchema.parse(record)) }
}
