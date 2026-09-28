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
  return ids.filter(id => directory.ids.includes(id) && !archived.includes(id) && directory.byId[id]?.origin !== 'subagent')
    .sort((a, b) => Number(Boolean(directory.byId[b]?.retainedBy.mainView)) - Number(Boolean(directory.byId[a]?.retainedBy.mainView))
      || (directory.byId[b]?.updatedAt ?? 0) - (directory.byId[a]?.updatedAt ?? 0))[0]
}
