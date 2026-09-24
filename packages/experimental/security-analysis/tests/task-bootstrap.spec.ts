/** Workspace intake uses configured resources and respects prior project choices. @module */
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import {
  resolveWorkspaceTaskAdmission, validateTaskIntake,
  type TaskIntakeConfig, type WorkspaceTaskAdmission,
} from '../src/task-bootstrap.ts'

const cwd = resolve('security-task-workspace')
const config: TaskIntakeConfig = {
  workspaces: [{ cwd, environmentIds: ['workspace-lab'] }],
  maxAttempts: 3,
}
function admission(overrides: Partial<WorkspaceTaskAdmission> = {}): WorkspaceTaskAdmission {
  return {
    message: createUserMessage({ content: [{ type: 'text', text: 'Analyze the management interface.\nUse the provided source.' }], source: { kind: 'user' } }),
    cwd, child: false, hasBindingHistory: false, config, ...overrides,
  }
}

describe('workspace task intake configuration', () => {
  it('accepts an omitted opt-in and resources explicitly selected from the deployment', () => {
    expect(() => { validateTaskIntake(undefined, []) }).not.toThrow()
    expect(() => { validateTaskIntake(config, ['workspace-lab', 'unrelated-device']) }).not.toThrow()
  })

  it('rejects relative and duplicate normalized workspace directories', () => {
    expect(() => { validateTaskIntake({ ...config, workspaces: [{ cwd: 'relative', environmentIds: [] }] }, []) }).toThrow('absolute workspace cwd')
    expect(() => { validateTaskIntake({ ...config, workspaces: [
      config.workspaces[0]!, { cwd: join(cwd, 'child', '..'), environmentIds: [] },
    ] }, ['workspace-lab']) }).toThrow('Duplicate security task intake workspace')
  })

  it('rejects duplicate and unavailable environment selections', () => {
    expect(() => { validateTaskIntake(config, []) }).toThrow('Unknown security task intake environment: workspace-lab')
    expect(() => { validateTaskIntake({ ...config, workspaces: [{ cwd, environmentIds: ['lab', 'lab'] }] }, ['lab']) })
      .toThrow('Duplicate security task intake environment: lab')
  })

  it.each([0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejects an invalid attempt budget: %s', (maxAttempts) => {
    expect(() => { validateTaskIntake({ ...config, maxAttempts }, ['workspace-lab']) }).toThrow('positive safe integer')
  })
})

describe('workspace task admission', () => {
  it('preserves the full objective and selects only resources mapped to the current workspace', () => {
    const objective = 'Analyze the management interface.\nAlso mention https://unrelated.example and unrelated-device.'
    const result = resolveWorkspaceTaskAdmission(admission({
      message: createUserMessage({ content: [{ type: 'text', text: objective }], source: { kind: 'user' } }),
    }))
    expect(result).toEqual({ kind: 'create', title: 'Analyze the management interface.', objective,
      environmentIds: ['workspace-lab'], maxAttempts: 3 })
    expect(result?.environmentIds).not.toBe(config.workspaces[0]!.environmentIds)
  })

  it.each([
    { config: undefined }, { cwd: undefined }, { child: true }, { hasBindingHistory: true },
    { cwd: join(cwd, 'nested') }, { cwd: cwd + '-other' },
  ])('does not initialize an ineligible or previously bound task: %j', (overrides) => {
    expect(resolveWorkspaceTaskAdmission(admission(overrides))).toBeUndefined()
  })

  it('matches a normalized directory without authorizing its subdirectories', () => {
    expect(resolveWorkspaceTaskAdmission(admission({ cwd: join(cwd, 'child', '..') }))?.environmentIds)
      .toEqual(['workspace-lab'])
  })

  it('does not invent an objective for empty text', () => {
    expect(resolveWorkspaceTaskAdmission(admission({
      message: createUserMessage({ content: [{ type: 'text', text: ' \n ' }], source: { kind: 'user' } }),
    }))).toBeUndefined()
  })

  it('preserves ordered text blocks without truncating the objective', () => {
    const detail = 'Analysis detail. '.repeat(300)
    expect(resolveWorkspaceTaskAdmission(admission({
      message: createUserMessage({ content: [{ type: 'text', text: 'Task\r\nFirst observation.' },
        { type: 'text', text: detail }], source: { kind: 'user' } }),
    }))).toMatchObject({ title: 'Task', objective: 'Task\r\nFirst observation.\n' + detail.trim() })
  })
})
