/** Real security tools and storage with deterministic clocks and record identifiers. */
import crypto from 'node:crypto'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { syncBuiltinESMExports } from 'node:module'

export const name = 'security-analysis-snapshot-fixture'
export const inject = ['tools', 'agents', 'systemPrompt', 'storageDomain', 'subprocess', 'subagents', 'jobs', 'approval']

export async function apply(ctx) {
  const originalNow = Date.now
  const originalUUID = crypto.randomUUID
  let identifier = 0
  const restore = () => {
    Date.now = originalNow
    crypto.randomUUID = originalUUID
    syncBuiltinESMExports()
  }
  ctx.effect(() => restore)
  ctx.on('tools/execute', async (exec, next) => {
    if (exec.name !== 'security_record' && exec.name !== 'security_workflow') return next()
    Date.now = () => 1800000000000
    crypto.randomUUID = () => `00000000-0000-4000-8000-${String(++identifier).padStart(12, '0')}`
    syncBuiltinESMExports()
    try {
      const result = await next()
      const stored = JSON.parse(await readFile(join(process.env.DSH_HOME, 'storages/security_snapshot_reverse.json'), 'utf8'))
      assert.equal(Object.values(stored.tables.records).length, 1)
      assert.equal(Object.values(stored.tables.records)[0].kind, 'asset')
      assert.equal(Object.values(stored.tables.records)[0].assetId, 'fixture')
      assert.equal(stored.global.assets[0].sha256, 'a'.repeat(64))
      if (exec.name === 'security_workflow') assert.equal(stored.tables.workflow['1'].phase, 'surface')
      return result
    } finally { restore() }
  })
  const entry = process.env.DSH_EXAMPLE_MODE === 'lib' ? 'lib/legacy.js' : 'src/legacy.ts'
  const plugin = await import(new URL(`../../../packages/experimental/security-analysis/${entry}`, import.meta.url))
  await ctx.plugin(plugin, {
    engagementId: 'snapshot-reverse',
    objective: 'Inventory the authorized fixture binary and record its analysis scope.',
    assets: [{ id: 'fixture', label: 'Fixture binary', sha256: 'a'.repeat(64) }],
    dynamicPolicy: 'disabled',
  })
}
