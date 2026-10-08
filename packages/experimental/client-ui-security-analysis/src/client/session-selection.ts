/** Match project coordinator references to the accessible Session catalog. @module */
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
/** Prefer a matching main conversation, then the most recently updated coordinator.
 * @param ids - active project coordinator references.
 * @param directory - authoritative accessible Session catalog.
 * @param archived - Sessions excluded from continuation.
 * @returns a resumable coordinator identifier, or undefined without a match. */
export function selectCoordinator(
  ids: readonly SessionId[], directory: SessionListState, archived: readonly SessionId[],
): SessionId | undefined {
  return Object.values(directory.byId)
    .filter(row => ids.includes(row.id) && directory.ids.includes(row.id) && !archived.includes(row.id) && row.origin !== 'subagent')
    .sort((a, b) => Number(Boolean(b.retainedBy.mainView)) - Number(Boolean(a.retainedBy.mainView))
      || b.updatedAt - a.updatedAt || ids.indexOf(a.id) - ids.indexOf(b.id))[0]?.id
}
