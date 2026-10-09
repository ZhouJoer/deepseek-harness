/** Collapsed, copyable metadata for security analysis records. @module */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { CodeBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import type { NS } from './locales.ts'

/** Keep complete metadata available without placing identifiers in the reading path.
 * @param props - serializable record, localized copy and optional disclosure label.
 * @returns a closed disclosure containing copyable JSON.
 */
export function TechnicalDetails({ value, t, summary }: PropsLocale<typeof NS> & {
  value: object
  summary?: string
}) {
  return <details>
    <summary>{summary ?? t('toolDetails')}</summary>
    <CodeBlock code={JSON.stringify(value, null, 2)} lang="json"
      copyLabel={t('markdownCopy')} copiedLabel={t('markdownCopied')} />
  </details>
}
