/** Generated analysis files have stable, separate workspace locations. @module */
import { join, relative, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { analysisDirectory } from '../src/analysis-workspace.ts'
import type { SessionBinding } from '../src/workbench/model.ts'

const cwd = resolve('workspace')
const binding: SessionBinding = { sessionId: 'main', engagementId: 'task', role: 'coordinator', assetIds: [] }

describe('analysis workspace directories', () => {
  it('keeps a stable directory across turns and separates tasks and delegated Sessions', () => {
    const parent = analysisDirectory(cwd, binding)
    expect(analysisDirectory(cwd, { ...binding, assetIds: ['sample'] })).toBe(parent)
    expect(analysisDirectory(cwd, { ...binding, engagementId: 'another-task' })).not.toBe(parent)
    expect(analysisDirectory(cwd, { ...binding, sessionId: 'child', role: 'reverse-analyst' })).not.toBe(parent)
    expect(analysisDirectory(resolve('another-workspace'), binding)).not.toBe(parent)
  })

  it('keeps opaque task and Session identifiers within one portable directory name', () => {
    const directory = analysisDirectory(cwd, { ...binding, engagementId: '../../CON', sessionId: 'a\\b:c' })!
    const member = relative(join(cwd, '.dsh', 'analysis'), directory)
    expect(member).toMatch(/^[a-f0-9]+$/)
    expect(member.split(sep)).toHaveLength(1)
  })

  it('has no analysis directory without a workspace and active task', () => {
    expect(analysisDirectory(undefined, binding)).toBeNull()
    expect(analysisDirectory(cwd, undefined)).toBeNull()
    expect(analysisDirectory(cwd, { ...binding, active: false })).toBeNull()
  })
})
