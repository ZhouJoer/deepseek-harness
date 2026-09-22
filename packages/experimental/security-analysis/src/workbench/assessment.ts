/** Evidence-linked conclusions and immutable project report rendering. @module */
import { createHash } from 'node:crypto'
import type { SecurityRecord, Asset, FileAsset } from './model.ts'

/** Require a file sample before a binary provider uses its identity.
 * @param asset - scoped input asset.
 * @returns the imported file or throws for network targets. */
export function fileAsset(asset: Asset): FileAsset {
  if ('kind' in asset) throw new Error('This provider requires an imported file asset')
  return asset
}
/** Fingerprint the material claim, excluding its derived conclusion.
 * @param finding - persisted finding.
 * @returns content digest used by independent reviews. */
export function findingHash(finding: Extract<SecurityRecord, { kind: 'finding' }>['value']): string {
  const { status: _status, review: _review, ...claim } = finding
  return createHash('sha256').update(JSON.stringify(claim)).digest('hex')
}
/** Render a project revision with direct evidence identifiers.
 * @param records - project-scoped records.
 * @param revision - journal revision included in the export.
 * @returns portable Markdown with no active HTML. */
export function projectMarkdown(records: SecurityRecord[], revision: number): string {
  const clean = (value: string) => value.replace(/[<>|\x60*_[\]#]/gu, '').replace(/\r?\n/gu, ' ')
  const project = records.find(item => item.kind === 'engagement')
  const lines = ['# ' + clean(project?.value.title ?? 'Security report'), '', 'Revision: ' + String(revision), '', '## Conclusions', '']
  const findings = records.filter(item => item.kind === 'finding')
  if (!findings.length) lines.push('No findings have been recorded.', '')
  for (const item of findings) {
    lines.push('### ' + clean(item.value.title), '', 'Status: ' + item.value.status, '', clean(item.value.explanation), '',
      'Conditions: ' + clean(item.value.conditions), '', 'Evidence: ' + item.value.evidenceIds.join(', '), '', 'Review: ' + clean(item.value.review || 'pending'), '')
  }
  lines.push('## Coverage and blockers', '', '| Check | Phase | Status | Observation or blocker |', '| --- | --- | --- | --- |')
  for (const item of records) if (item.kind === 'check') lines.push('| ' + [item.value.title, item.value.phase, item.value.status, item.value.rationale || item.value.criterion].map(clean).join(' | ') + ' |')
  lines.push('', '## Execution and cleanup', '')
  for (const item of records) if (item.kind === 'execution' || item.kind === 'laboratory') lines.push('- ' + clean(item.value.id) + ': ' + clean(item.kind === 'execution' ? item.value.status : item.value.state) + ' — ' + clean(item.value.detail))
  lines.push('', '## Evidence index', '', '| Evidence | Target | Plan | SHA-256 | Incomplete |', '| --- | --- | --- | --- | --- |')
  for (const item of records) if (item.kind === 'evidence') lines.push('| ' + [item.value.id, item.value.assetId, item.value.planId ?? 'none', item.value.artifact.sha256, String(item.value.incomplete)].join(' | ') + ' |')
  lines.push('', '## Observation methods', '')
  for (const item of records) if (item.kind === 'evidence') lines.push('- ' + clean(item.value.id) + ': ' +
    (item.value.method ?? 'unspecified') + '; ' + clean(item.value.toolVersion) +
    (item.value.failure ? '; failure: ' + clean(item.value.failure) : '') +
    (item.value.cleanup ? '; cleanup: ' + clean(item.value.cleanup) : ''))
  lines.push('', '## Child Session summaries', '')
  for (const item of records) if (item.kind === 'binding' && item.value.report) lines.push(
    '- ' + clean(item.value.sessionId) + ' (' + item.value.role + '): ' + clean(item.value.report.summary) +
    '; evidence: ' + item.value.report.evidenceIds.join(', ') + '; uncertainty: ' + clean(item.value.report.uncertainty))
  lines.push('', '## Independent reviews', '')
  for (const item of records) if (item.kind === 'review') lines.push('- ' + clean(item.value.id) + ': ' + item.value.verdict + '; finding ' + clean(item.value.findingId) + ' @ ' + item.value.findingHash + '; reviewer ' + clean(item.value.reviewerSessionId) + '; ' + clean(item.value.explanation) + '; uncertainty: ' + clean(item.value.uncertainty))
  lines.push('')
  return lines.join('\n')
}
