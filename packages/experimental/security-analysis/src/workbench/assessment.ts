/** File asset checks and finding fingerprints for independent reviews. @module */
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
