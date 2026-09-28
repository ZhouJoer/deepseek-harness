/** Coordinator recovery excludes inaccessible, archived and delegated Sessions. @module */
import { expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import { selectCoordinator } from '../src/client/session-selection.ts'
it('prefers the current matching coordinator and falls back to the latest accessible one', () => {
  const ids = ['missing', 'archived', 'child', 'recent', 'current'] as SessionId[]
  const directory: SessionListState = { ids: ids.slice(1), phase: 'ready', byId: {}, subagentsByParent: {}, jobsBySession: {} }
  for (const [index, id] of ids.entries()) directory.byId[id] = { id, displayTitle: id, blank: false, running: false,
    updatedAt: 100 - index, retainedBy: id === 'current' ? { mainView: 1 } : {}, ...(id === 'child' ? { origin: 'subagent' as const } : {}) }
  expect(selectCoordinator(ids, directory, ['archived' as SessionId])).toBe('current')
  directory.byId['current' as SessionId] = { ...directory.byId['current' as SessionId]!, retainedBy: {} }
  expect(selectCoordinator(ids, directory, ['archived' as SessionId])).toBe('recent')
  expect(selectCoordinator(['missing', 'child', 'archived'] as SessionId[], directory, ['archived' as SessionId])).toBeUndefined()
})
