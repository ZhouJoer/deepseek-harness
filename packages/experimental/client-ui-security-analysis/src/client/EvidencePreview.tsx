/** Human-readable source locations with the complete structured output behind a disclosure. @module */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { CodeBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import type { NS } from './locales.ts'

/** Present saved output without promoting machine metadata into the reading path.
 * @param props - saved text preview, provider identity and localized labels.
 * @returns source excerpts, plain output or collapsed structured data.
 */
export function EvidencePreview({ text, provider, t }: PropsLocale<typeof NS> & { text: string; provider: string }) {
  const raw = <details><summary>{t('graphRawOutput')}</summary><CodeBlock code={text} lang="json"
    copyLabel={t('markdownCopy')} copiedLabel={t('markdownCopied')} /></details>
  let output: unknown
  try { output = JSON.parse(text) }
  catch (_error) {
    // Plain text and clipped JSON are valid artifact previews.
    return /^[\s]*[\[{]/.test(text)
      ? raw : <pre>{text}</pre>
  }
  const files = new Map<string, string[]>()
  if (provider === 'source' && output !== null && typeof output === 'object' && 'items' in output && Array.isArray(output.items)) {
    const items: unknown[] = output.items
    for (const item of items) {
      if (item === null || typeof item !== 'object' || !('path' in item) || typeof item.path !== 'string'
        || !('line' in item) || typeof item.line !== 'number' || !('text' in item) || typeof item.text !== 'string') continue
      const lines = files.get(item.path) ?? []
      lines.push(`${item.line}: ${item.text}`)
      files.set(item.path, lines)
    }
  }
  return <>{[...files].map(([path, lines]) => <section key={path}><h4>{path}</h4><pre>{lines.join('\n')}</pre></section>)}
    {raw}
  </>
}
