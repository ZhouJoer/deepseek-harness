/** Workspace locations and model instructions for generated analysis files. @module */
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import type { SessionBinding } from './workbench/model.ts'

/** Shared file organization for coordinators and delegated collecting roles. */
export const ANALYSIS_FILES_GUIDANCE = 'Before creating analysis files, read analysisDirectory from security_capabilities. Use scripts/ for generated Python, Bash and PowerShell files, outputs/ for results and logs, and tmp/ for extracted data and temporary files beneath that directory. Create these subdirectories as needed. Set the native shell workdir to analysisDirectory and use absolute paths for original inputs. Keep generated analysis files out of the workspace root and project source directories. A null analysisDirectory means a workspace and active analysis task must be selected first. Each task and Session has a separate directory; use other Sessions\' saved evidence instead of writing to their files. User-requested project code and deliverables follow the project\'s layout. These workspace files remain available across turns; capture relevant tool results as evidence before cleanup.'

/** Resolve a stable per-task, per-Session directory without creating files or granting access.
 * @param cwd - workspace directory from the Session header.
 * @param binding - active task selection, if any.
 * @returns absolute analysis directory, or null without a workspace and active binding.
 */
export function analysisDirectory(cwd: string | undefined, binding: SessionBinding | undefined): string | null {
  if (!cwd || !binding || binding.active === false) return null
  const key = createHash('sha256').update(JSON.stringify([binding.engagementId, binding.sessionId])).digest('hex')
  return join(cwd, '.dsh', 'analysis', key)
}
