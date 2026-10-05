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
    analysisTurnTokens: 1000,
    evolution: { provider: 'deepseek-official', model: 'deepseek-v4-flash-vision-exp' },
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
      const service = securityCtx.securityWorkbench
      let selected = await service.view(exec.agent)
      const project = selected.records.find(record => record.kind === 'engagement')
      assert(project)
      selected = await service.importMaterials(exec.agent, JSON.stringify({ operationId: 'fixture-paste', expectedRevision: selected.revision,
        title: 'Notes', objective: 'Inspect the pasted notes', material: { kind: 'text', name: 'notes.txt', text: 'Owned static notes.\n' } }))
      assert(selected.records.some(record => record.kind === 'asset'))
      for (const kind of ['rename', 'archive', 'restore']) {
        await service.manageProject(project.value.id, JSON.stringify({ operationId: 'fixture-' + kind, expectedRevision: selected.revision,
          action: kind === 'rename' ? { kind, title: '静态安全简报' } : { kind } }))
        selected = await service.project(project.value.id)
        if (kind === 'archive') assert.equal((await service.view(exec.agent)).records.length, 0)
      }
      for (const action of [{ kind: 'select', engagementId: project.value.id }, { kind: 'resume' }]) {
        selected = await service.command(exec.agent, JSON.stringify({ operationId: 'fixture-' + action.kind, expectedRevision: selected.revision, action }))
      }
      let checkpointId
      for (const [index, phase, title] of [[1, 'recon', '材料侦察'], [2, 'recon', '材料侦察'],
        [3, 'assessment', '证据评估'], [4, 'recon', '补充侦察']]) {
        selected = await service.command(exec.agent, JSON.stringify({ operationId: 'fixture-checkpoint-' + index,
          expectedRevision: selected.revision, action: { kind: 'checkpoint', phase, title,
            ...(index === 2 ? { id: checkpointId } : {}), reason: index === 4 ? '实现证据不足' : '',
            summary: '仅有静态笔记，尚无安全结论。', next: '补充实现材料。', evidenceIds: [], findingIds: [] } }))
        checkpointId = selected.records.filter(record => record.kind === 'checkpoint').at(-1).value.id
      }
      assert.equal(selected.records.filter(record => record.kind === 'checkpoint').length, 3)
      const controller = await service.ready
      let revision = selected.revision
      for (const action of [
        { kind: 'create', title: 'Routine analysis', objective: 'Review an ordinary completed workflow', environmentIds: [], maxAttempts: 1 },
        { kind: 'checkpoint', phase: 'assessment', title: 'Evidence review', reason: 'Review supplied notes',
          summary: 'Available evidence was reviewed successfully; no workflow gap was observed.',
          next: 'Wait for additional material', evidenceIds: [], findingIds: [] },
      ]) {
        const saved = await controller.command('fixture-evolution-operator', { operationId: 'fixture-evolution-' + action.kind,
          expectedRevision: revision, action }, true)
        revision = saved.revision
      }
      const projectId = controller.binding('fixture-evolution-operator').engagementId
      const improvements = await service.improvements()
      await service.analyzeImprovements(JSON.stringify({ operationId: 'fixture-evolution-run',
        expectedRevision: improvements.revision, projectId }))
      const abort = new AbortController()
      let completed
      try {
        for await (const current of service.followImprovements(abort.signal)) {
          const run = current.runs.find(item => item.projectId === projectId)
          if (!run || run.status === 'queued' || run.status === 'running') continue
          assert.equal(run.status, 'completed', run.detail)
          assert.equal(run.proposalIds.length, 0)
          completed = { status: run.status, suggestions: run.proposalIds.length }
          break
        }
      } finally { abort.abort() }
      return { ...result, value: { report: result.value, restoredProject: await service.view(exec.agent), improvements: completed } }
    })
  })
}
