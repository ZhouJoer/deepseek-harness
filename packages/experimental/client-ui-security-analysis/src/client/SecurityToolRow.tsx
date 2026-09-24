/** Compact security tool presentation with optional technical details. @module */
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS, SecurityKey } from './locales.ts'
import css from './SecurityToolRow.module.css'

/** Registered workbench tool names and their localized actions. */
export const securityToolNames = ['security_scope', 'security_capabilities', 'security_help', 'security_search',
  'security_static', 'security_evidence', 'security_command', 'security_execute', 'security_delegate',
  'security_review', 'security_environment'] as const

const labels: Record<string, SecurityKey> = {
  security_scope: 'toolScope', security_capabilities: 'toolCapabilities', security_help: 'toolHelp',
  security_search: 'toolSearch', security_static: 'toolStatic', security_evidence: 'toolEvidence',
  security_command: 'toolCommand', security_execute: 'toolExecute', security_delegate: 'toolDelegate',
  security_review: 'toolReview', security_environment: 'toolEnvironment',
}

/** Render the security result summary before expandable raw details. */
export function SecurityToolRow({ block, toolName, t }: ToolCallViewProps & PropsLocale<typeof NS>) {
  const settled = 'kind' in block
  const output = settled ? block.content.map(item => item.type === 'text' ? item.text : JSON.stringify(item)).join('\n') : ''
  let summary = ''
  try {
    const value = JSON.parse(output) as unknown
    if (typeof value === 'object' && value !== null) {
      if ('summary' in value && typeof value.summary === 'string') summary = value.summary.slice(0, 180)
      else if ('committed' in value && value.committed === true) summary = t('toolSaved')
      else if ('total' in value && typeof value.total === 'number') summary = t('toolRecords') + ': ' + String(value.total)
    }
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
    // Non-JSON output stays available in the technical details.
  }
  const state = !settled ? t('toolRunning') : block.isError ? t('toolFailed') : t('toolDone')
  return <div className={css.row} data-tool={toolName}>
    <strong>{t(labels[toolName] ?? 'toolSecurity')}</strong><span>{state}</span>{summary && <span>{summary}</span>}
    {output && <details><summary>{t('toolDetails')}</summary><pre>{output}</pre></details>}
  </div>
}
