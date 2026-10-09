/** Lightweight task execution facts, derived without a second persistent task status. @module */
import type { Engagement, WorkbenchView, CheckId, ValidationPlanId } from './workbench/model.ts'

/** Orthogonal runtime and operator-action facts for one task. */
export interface SecurityProjectSummary {
  project: Engagement
  runningAgentCount: number
  runningInvocationCount: number
  pendingPlanIds: ValidationPlanId[]
  blockedCheckIds: CheckId[]
  interruptedCheckIds: CheckId[]
  next: string
  state: 'removed' | 'stopping' | 'stopped' | 'running' | 'interrupted' | 'approval' | 'blocked' | 'idle'
}
/** Derive one directory snapshot from committed records and live execution counts.
 * @param view - one consistent journal snapshot.
 * @param agents - running Agent counts by project.
 * @param invocations - running invocation counts by project, counted once per invocation.
 * @returns lightweight task directory. */
export function projectDirectory(view: WorkbenchView, agents: ReadonlyMap<string,
  number>, invocations: ReadonlyMap<string, number>): SecurityProjectSummary[] {
  const grouped = new Map<string, WorkbenchView['records']>()
  for (const record of view.records) {
    const id = record.kind === 'engagement' ? record.value.id : record.value.engagementId
    const items = grouped.get(id) ?? []; items.push(record); grouped.set(id, items)
  }
  return view.records.filter(record => record.kind === 'engagement').map(({ value: project }) => {
    const records = grouped.get(project.id) ?? []
    const checks = records.filter(item => item.kind === 'check')
    const consumed = new Set(records.filter(item => item.kind === 'execution').map(item => item.value.planId))
    const runningAgentCount = agents.get(project.id) ?? 0
    const runningInvocationCount = invocations.get(project.id) ?? 0
    const active = runningAgentCount > 0 || runningInvocationCount > 0 || records.some(item =>
      item.kind === 'execution' && item.value.status === 'running' || item.kind === 'delegation' && ['pending', 'running'].includes(item.value.status))
    const pendingPlanIds = records.filter(item => item.kind === 'plan').filter(item => item.value.status === 'draft' && !consumed.has(item.value.id) &&
      checks.some(check => check.value.id === item.value.checkId && check.value.status === 'planned')).map(item => item.value.id)
    const blockedCheckIds = checks.filter(item => item.value.status === 'blocked').map(item => item.value.id)
    const interruptedCheckIds = checks.filter(item => item.value.status === 'interrupted').map(item => item.value.id)
    const state: SecurityProjectSummary['state'] = project.archived ? 'removed' : project.stopped ? active ? 'stopping' : 'stopped'
      : active ? 'running' : interruptedCheckIds.length ? 'interrupted' : pendingPlanIds.length ? 'approval' : blockedCheckIds.length ? 'blocked' : 'idle'
    return { project, runningAgentCount, runningInvocationCount, pendingPlanIds, blockedCheckIds, interruptedCheckIds, state,
      next: records.filter(item => item.kind === 'checkpoint').at(-1)?.value.next ?? '' }
  })
}
