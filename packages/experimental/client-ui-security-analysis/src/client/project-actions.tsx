/** Security project actions and sidebar registration glyph. @module */
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { WorkbenchView } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import type { ToolboxActions } from './Toolbox.tsx'

/** Authenticated project reads and explicit laboratory gestures. */
export interface ProjectActions extends ToolboxActions {
  manageProject(this: void, projectId: string, input: string): Promise<string>
  projects(): Promise<string>
  project(id: string): Promise<WorkbenchView>
  laboratory(projectId: string, action: string, id: string): Promise<WorkbenchView>
  report(this: void, projectId: string, reportId: string, format: 'markdown' | 'json' | 'findingsMarkdown'): Promise<string>
  subscribeReset(this: void, listener: () => void): () => void
}
/** Sidebar glyph; the shell owns its accessible label.
 * @param props - requested icon size.
 * @returns decorative shield glyph. */
export function ProjectIcon({ size }: PropsRuntime<'sidebar.panellist'>) {
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6Z" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
}
