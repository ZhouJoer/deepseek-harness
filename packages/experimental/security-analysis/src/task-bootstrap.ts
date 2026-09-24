/** Resolve explicitly configured workspace intake for authenticated user tasks. @module */
import { isAbsolute, resolve } from 'node:path'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { SecurityCommand } from './workbench/controller.ts'

/** Host-owned resource selection for one exact workspace directory. */
export interface TaskIntakeWorkspace {
  cwd: string
  environmentIds: string[]
}

/** Presence enables intake only for the listed workspace directories. */
export interface TaskIntakeConfig {
  workspaces: TaskIntakeWorkspace[]
  maxAttempts: number
}

/** The caller establishes user-carrier origin before requesting a task proposal. */
export interface WorkspaceTaskAdmission {
  /** Original authenticated user message; model and internal messages are ineligible. */
  message: UserMessage
  cwd: string | undefined
  child: boolean
  /** Includes inactive bindings so leaving a project does not create another one. */
  hasBindingHistory: boolean
  /** Validated deployment configuration; omission disables automatic intake. */
  config: TaskIntakeConfig | undefined
}

/** Normalize a Host workspace directory for exact configuration lookup.
 * @param cwd - absolute Host directory supplied by configuration or a Session.
 * @returns normalized path with Windows case folding.
 */
export function workspaceKey(cwd: string): string {
  const absolute = resolve(cwd)
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute
}

/**
 * Reject ambiguous workspace mappings and unavailable configured resources at load.
 * @param config - optional Host-owned intake configuration.
 * @param environmentIds - resource identities registered by the deployment.
 * @throws When a directory is relative, a mapping is duplicated, a resource is unknown, or the attempt limit is invalid.
 */
export function validateTaskIntake(config: TaskIntakeConfig | undefined, environmentIds: readonly string[]): void {
  if (config === undefined) return
  if (!Number.isSafeInteger(config.maxAttempts) || config.maxAttempts < 1)
    throw new Error('Security task intake maxAttempts must be a positive safe integer')
  const directories = new Set<string>()
  for (const workspace of config.workspaces) {
    if (!isAbsolute(workspace.cwd)) throw new Error('Security task intake requires an absolute workspace cwd: ' + workspace.cwd)
    const key = workspaceKey(workspace.cwd)
    if (directories.has(key)) throw new Error('Duplicate security task intake workspace: ' + workspace.cwd)
    directories.add(key)
    const selected = new Set<string>()
    for (const id of workspace.environmentIds) {
      if (selected.has(id)) throw new Error('Duplicate security task intake environment: ' + id)
      if (!environmentIds.includes(id)) throw new Error('Unknown security task intake environment: ' + id)
      selected.add(id)
    }
  }
}

/**
 * Propose the first project for an authenticated user message without executing it.
 * @param input - trusted carrier input, complete binding history, and validated workspace mappings.
 * @returns A create action limited to the matching mapping, or no action for an ineligible message or workspace.
 */
export function resolveWorkspaceTaskAdmission(input: WorkspaceTaskAdmission):
  Extract<SecurityCommand['action'], { kind: 'create' }> | undefined {
  const { config, cwd } = input
  if (config === undefined || cwd === undefined || input.child || input.hasBindingHistory) return undefined
  const workspace = config.workspaces.find(item => workspaceKey(item.cwd) === workspaceKey(cwd))
  if (workspace === undefined) return undefined
  const objective = input.message.content.filter(part => part.type === 'text').map(part => part.text).join('\n').trim()
  if (objective === '') return undefined
  return {
    kind: 'create',
    title: objective.replace(/\r?\n.*$/su, ''),
    objective,
    environmentIds: [...workspace.environmentIds],
    maxAttempts: config.maxAttempts,
  }
}
