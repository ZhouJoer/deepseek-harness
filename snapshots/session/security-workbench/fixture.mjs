/** Real security workbench with operator-owned scope and logged model tool results. */
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { syncBuiltinESMExports } from 'node:module'
import { join } from 'node:path'
export const name = 'security-workbench-snapshot-fixture'
export const inject = ['tools', 'agents', 'systemPrompt', 'storageDomain', 'subagents', 'jobs']
export async function apply(ctx) {
  const originalNow = Date.now
  const originalUUID = crypto.randomUUID
  let identifier = 0
  let clock = 1800000000000
  Date.now = () => clock
  crypto.randomUUID = () => '00000000-0000-4000-8000-' + String(++identifier).padStart(12, '0')
  syncBuiltinESMExports()
  ctx.effect(() => () => {
    Date.now = originalNow
    crypto.randomUUID = originalUUID
    syncBuiltinESMExports()
  })
  ctx.on('agent/request', async (_request, next) => ({ ...await next(), maxTokens: 4096 }))
  const entry = process.env.DSH_EXAMPLE_MODE === 'lib' ? 'lib/index.js' : 'src/index.ts'
  const plugin = await import(new URL(`../../../packages/experimental/security-analysis/${entry}`, import.meta.url))
  await ctx.plugin(plugin.default, {
    root: join(process.env.DSH_HOME, 'security'),
    importRoots: [process.cwd()],
    environments: [],
    knowledgeIntervalMs: 0,
  })
  ctx.inject(['securityWorkbench'], (securityCtx) => {
    securityCtx.on('tools/execute', async (exec, next) => {
      if (exec.name !== 'security_command' || JSON.parse(exec.arguments.command).action.kind !== 'report') return next()
      assert(exec.agent)
      clock = 1800000001000
      const before = await securityCtx.securityWorkbench.view(exec.agent)
      assert.equal(before.revision, 0)
      await securityCtx.securityWorkbench.command(exec.agent, JSON.stringify({ operationId: 'fixture-create-report-project',
        expectedRevision: before.revision, action: { kind: 'create', title: '静态安全简报',
          objective: '仅静态检查提供的源码。没有独立复核时保持待复核状态。', environmentIds: [], maxAttempts: 1 } }))
      const result = await next()
      assert.notEqual(result.isError, true)
      const view = await securityCtx.securityWorkbench.view(exec.agent)
      const report = view.records.find(record => record.kind === 'report')
      assert(report)
      const markdown = await securityCtx.securityWorkbench.report(report.value.engagementId, report.value.id, 'markdown')
      assert(markdown.includes('尚无可判断目标安全性的实现证据。'))
      assert(markdown.includes('目标实现尚未检查'))
      return result
    })
  })
}
