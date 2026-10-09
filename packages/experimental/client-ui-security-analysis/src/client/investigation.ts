/** Read-only investigation relationships derived from committed domain references. @module */
import type { SecurityRecord, WorkbenchView } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import type { SecurityKey } from './locales.ts'

type GraphRecord = Extract<SecurityRecord, { kind: 'asset' | 'check' | 'checkpoint' | 'delegation' | 'evidence' | 'finding' | 'plan' | 'review' }>
/** A readable domain record; its stable identity is never used as display text. */
export interface InvestigationNode {
  id: string
  record: GraphRecord
  title: string
  summary: string
  state: SecurityKey | undefined
  attention: boolean
  running: boolean
}
/** Directed references retain their meaning rather than claiming causation. */
export interface InvestigationEdge {
  id: string
  source: string
  target: string
  relation: SecurityKey
}
/** Complete project projection, including unresolved references for detail readers. */
export interface Investigation {
  nodes: InvestigationNode[]
  edges: InvestigationEdge[]
  missing: Map<string, number>
}

/** Project references to readable nodes without deriving relationships from order.
 * @param view - one committed project revision.
 * @returns stable nodes, explicit references and missing-reference counts.
 */
export function investigation(view: WorkbenchView): Investigation {
  const nodes: InvestigationNode[] = []
  const edges: InvestigationEdge[] = []
  const missing = new Map<string, number>()
  const key = (kind: string, id: string) => `${kind}:${id}`
  for (const record of view.records) {
    let title: string
    let summary: string
    let state: SecurityKey | undefined
    let running = false
    let attention = false
    switch (record.kind) {
      case 'asset': title = record.value.label; summary = 'kind' in record.value && record.value.kind === 'web' ? record.value.origin : ''; break
      case 'checkpoint': title = record.value.title; summary = record.value.summary; break
      case 'check': {
        const value = record.value
        title = value.title; summary = value.rationale || value.criterion
        state = value.status; running = value.status === 'running'
        attention = value.status === 'blocked' || value.status === 'interrupted'
        break
      }
      case 'delegation': {
        const value = record.value
        title = value.question; summary = value.report?.summary || value.criterion
        state = value.status === 'completed' ? 'delegationReturned' : value.status === 'pending' ? 'delegationPending'
          : value.status === 'cancelled' ? 'activityCancelled' : value.status === 'interrupted' ? 'delegationInterrupted' : value.status
        running = value.status === 'running' || value.status === 'pending'
        attention = value.status === 'failed' || value.status === 'interrupted' || value.disposition?.decision === 'needs-more'
        break
      }
      case 'evidence': {
        const value = record.value
        title = value.title; summary = value.summary
        state = value.failure ? 'failed' : value.incomplete ? 'incomplete' : undefined
        attention = Boolean(value.failure || value.incomplete)
        break
      }
      case 'finding': title = record.value.title; summary = record.value.explanation; state = record.value.status; attention = state === 'inconclusive'; break
      case 'plan': title = record.value.hypothesis; summary = record.value.expectedObservation; state = record.value.status; attention = state === 'draft'; break
      case 'review': {
        const finding = view.records.find(item => item.kind === 'finding' && item.value.id === record.value.findingId)
        title = finding?.kind === 'finding' ? finding.value.title : ''
        summary = record.value.explanation
        // A saved review may belong to an earlier finding revision; only finding records carry the current verdict.
        break
      }
      default: continue
    }
    nodes.push({ id: key(record.kind, record.value.id), record, title, summary, state, running, attention })
  }
  const ids = new Set(nodes.map(node => node.id))
  const seen = new Set<string>()
  const link = (owner: string, source: string, target: string, relation: SecurityKey) => {
    if (!ids.has(source) || !ids.has(target)) { missing.set(owner, (missing.get(owner) ?? 0) + 1); return }
    const id = JSON.stringify([source, target, relation])
    if (source === target || seen.has(id)) return
    seen.add(id); edges.push({ id, source, target, relation })
  }
  for (const node of nodes) {
    const record = node.record
    const from = (kind: string, id: string, relation: SecurityKey) =>{  link(node.id, key(kind, id), node.id, relation) }
    const to = (kind: string, id: string, relation: SecurityKey) =>{  link(node.id, node.id, key(kind, id), relation) }
    switch (record.kind) {
      case 'asset': if ('parentId' in record.value && record.value.parentId) from('asset', record.value.parentId, 'graphContains'); break
      case 'check':
        from('asset', record.value.assetId, 'graphExamines')
        for (const id of record.value.dependencies) from('check', id, 'graphDepends')
        for (const id of record.value.evidenceIds) to('evidence', id, 'graphObservation')
        break
      case 'checkpoint':
        for (const id of record.value.evidenceIds) to('evidence', id, 'graphReferences')
        for (const item of record.value.findings) to('finding', item.id, 'graphReferences')
        break
      case 'delegation':
        from('asset', record.value.assetId, 'graphExamines')
        if (record.value.checkId) from('check', record.value.checkId, 'graphAssignment')
        for (const id of record.value.inputEvidenceIds ?? []) from('evidence', id, 'graphBasis')
        if (record.value.checkpointId) from('checkpoint', record.value.checkpointId, 'graphAssignment')
        if (record.value.retryOf) from('delegation', record.value.retryOf, 'graphFollowup')
        for (const id of record.value.report?.evidenceIds ?? []) to('evidence', id, 'graphReferences')
        break
      case 'evidence':
        if ((!record.value.checkId || !ids.has(key('check', record.value.checkId)))
          && (!record.value.planId || !ids.has(key('plan', record.value.planId)))
          && !view.records.some(item => item.kind === 'check' && item.value.evidenceIds.includes(record.value.id))) from('asset', record.value.assetId, 'graphSubject')
        if (record.value.checkId) from('check', record.value.checkId, 'graphObservation')
        if (record.value.planId) from('plan', record.value.planId, 'graphObservation')
        break
      case 'finding':
        if (!record.value.evidenceIds.some(id => ids.has(key('evidence', id)))) from('asset', record.value.assetId, 'graphSubject')
        for (const id of record.value.evidenceIds) from('evidence', id, 'graphBasis')
        break
      case 'plan': from('check', record.value.checkId, 'graphValidation'); break
      case 'review':
        from('finding', record.value.findingId, 'graphReviewRelation')
        for (const id of record.value.supportingEvidenceIds) from('evidence', id, 'graphSupports')
        for (const id of record.value.opposingEvidenceIds) from('evidence', id, 'graphOpposes')
        break
    }
  }
  return { nodes, edges, missing }
}

/** Fold linked observations while retaining direct access to all original records.
 * @param graph - complete project graph.
 * @param expanded - whether observation nodes are expanded.
 * @returns a display projection; folded edges explicitly represent referenced observations.
 */
export function visibleInvestigation(graph: Investigation, expanded: boolean): Investigation {
  if (expanded) return graph
  const linked = new Set(graph.edges.map(edge => edge.target))
  const folded = new Set(graph.nodes.filter(node => node.record.kind === 'evidence' && !node.attention && linked.has(node.id)).map(node => node.id))
  const edges = graph.edges.filter(edge => !folded.has(edge.source) && !folded.has(edge.target))
  const seen = new Set(edges.map(edge => JSON.stringify([edge.source, edge.target, edge.relation])))
  for (const id of folded) {
    const incoming = graph.edges.filter(edge => edge.target === id)
    const outgoing = graph.edges.filter(edge => edge.source === id)
    for (const before of incoming) for (const after of outgoing) {
      const relation = after.relation === 'graphSupports' || after.relation === 'graphOpposes' ? after.relation : 'graphLinkedObservation'
      if (relation === 'graphLinkedObservation' && edges.some(edge => edge.source === before.source && edge.target === after.target)) continue
      const identity = JSON.stringify([before.source, after.target, relation])
      if (before.source === after.target || seen.has(identity)) continue
      seen.add(identity)
      edges.push({ id: `fold:${identity}`, source: before.source, target: after.target, relation })
    }
  }
  return { ...graph, nodes: graph.nodes.filter(node => !folded.has(node.id)), edges }
}
