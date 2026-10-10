/** Real security workbench with operator-owned scope and logged model tool results. */
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { syncBuiltinESMExports } from 'node:module'
import { join } from 'node:path'
export const name = 'security-workbench-snapshot-fixture'
export const inject = ['tools', 'agents', 'systemPrompt', 'storageDomain', 'subagents', 'jobs', 'subprocess']
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
  const subprocess = ctx.subprocess
  const originalResolve = subprocess.resolveExecutable
  const originalSpawn = subprocess.spawn
  const dockerCommand = 'fixture-docker'
  const dockerPrefix = ['--context', 'fixture-remote']
  subprocess.resolveExecutable = async function(command, ...args) {
    return command === dockerCommand ? command : originalResolve.call(this, command, ...args)
  }
  subprocess.spawn = function(spec) {
    if (spec.argv[0] !== dockerCommand) return originalSpawn.call(this, spec)
    spec.signal.throwIfAborted()
    assert.deepEqual(spec.argv.slice(1, 3), dockerPrefix)
    const args = spec.argv.slice(3)
    let stdout
    switch (args[0]) {
      case 'info':
        assert.deepEqual(args, ['info', '--format', '{{.ServerVersion}}'])
        stdout = '27.0\n'
        break
      case 'inspect':
        assert.deepEqual(args, ['inspect', '--format', '{{.State.Running}}', 'fixture-container'])
        stdout = 'true\n'
        break
      default:
        assert.deepEqual(args, ['exec', '-i', '--workdir', '/analysis', 'fixture-container', 'fixture-console', '--version'])
        stdout = 'Fixture Console 1.0\n'
    }
    return {
      done: Promise.resolve({ exitCode: 0, signal: null }),
      collected: {
        stdout: { readFrom: () => ({ text: stdout, lossy: false }) },
        stderr: { readFrom: () => ({ text: '', lossy: false }) },
      },
      terminate() {},
      waitForExit: async () => true,
    }
  }
  ctx.effect(() => () => {
    subprocess.resolveExecutable = originalResolve
    subprocess.spawn = originalSpawn
  })
  ctx.on('agent/request', async (_request, next) => ({ ...await next(), maxTokens: 4096 }))
  const observationFailure = process.env.DSH_SECURITY_OBSERVATION_FAILURE === '1'
  const entry = process.env.DSH_EXAMPLE_MODE === 'lib' ? 'lib/index.js' : 'src/index.ts'
  const plugin = await import(new URL(`../../../packages/experimental/security-analysis/${entry}`, import.meta.url))
  await ctx.plugin(plugin.default, {
    root: join(process.env.DSH_HOME, 'security'),
    importRoots: [process.cwd()],
    toolCatalogPath: join(process.env.DSH_HOME, 'security-tool-catalog.json'),
    environments: [{ id: 'fixture-remote', label: 'Remote toolbox', kind: 'docker', cwd: process.cwd(),
      externalContainer: { name: 'fixture-container', workdir: '/analysis' },
      tools: [{ id: 'docker', command: dockerCommand, prefixArgs: dockerPrefix, versionArgs: ['--version'], source: 'Fixture endpoint' }] },
      ...observationFailure ? [{ id: 'fixture-local', label: 'Local binary observations', kind: 'local', cwd: process.cwd(), tools: [] }] : []],
    knowledgeIntervalMs: 0,
    analysisTurnTokens: 1000,
    evolution: { provider: 'deepseek-official', model: 'deepseek-v4-flash-vision-exp' },
  })
  const environmentEntry = process.env.DSH_EXAMPLE_MODE === 'lib' ? 'lib/environment-local.js' : 'src/environment-local.ts'
  const environments = await import(new URL(`../../../packages/experimental/security-analysis/${environmentEntry}`, import.meta.url))
  await ctx.plugin(environments, {})
  const nativeEntry = process.env.DSH_EXAMPLE_MODE === 'lib' ? 'lib/native.js' : 'src/native-provider.ts'
  const native = await import(new URL(`../../../packages/experimental/security-analysis/${nativeEntry}`, import.meta.url))
  await ctx.plugin(native, {})
  if (observationFailure) {
    const failure = await import('../security-observation-failure/fixture.mjs')
    failure.apply(ctx)
  }
  ctx.inject(['securityWorkbench'], (securityCtx) => {
    const pack = JSON.stringify({ version: 1, id: 'fixture-pack', label: 'Fixture tools', tools: [
      { id: 'fixture-console', label: 'Fixture Console', commands: ['fixture-console'], platforms: ['linux'],
        tags: ['security'], description: 'A separately registered container console.', args: ['--version'] },
    ] })
    const preview = securityCtx.securityWorkbench.previewToolPack(pack)
    assert.deepEqual(preview.conflicts, [])
    securityCtx.securityWorkbench.importToolPack(pack, preview.revision, false)
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
      const elf = Buffer.alloc(64)
      elf.set([0x7f, 0x45, 0x4c, 0x46, 2, 1])
      selected = await service.importMaterials(exec.agent, JSON.stringify({ operationId: 'fixture-paste', expectedRevision: selected.revision,
        title: 'Mixed materials', objective: 'Inspect source, firmware and traffic together', material: { kind: 'files', directory: false,
          files: [
            { name: 'handler.js', base64: Buffer.from('export const read = request => request.query;\n').toString('base64') },
            { name: 'firmware.elf', base64: elf.toString('base64') },
            { name: 'traffic.pcapng', base64: Buffer.from('0a0d0d0a', 'hex').toString('base64') },
            { name: 'unknown.bin', base64: Buffer.from([0, 1, 2, 3]).toString('base64') },
          ] } }))
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
            ...(index === 2 ? { id: checkpointId } : {}), reason: index === 4 ? '实现证据不足' : '源码、固件与抓包需要组合 Web、逆向和 IoT 方法。',
            summary: '已导入混合材料，尚无安全结论。', next: '先核对源码和文件内容，再选择所需工具。', evidenceIds: [], findingIds: [] } }))
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
      const toolbox = await service.toolboxInventory('fixture-remote', ['fixture-console'])
      assert.equal(toolbox.inventory.tools[0].status, 'available')
      assert.deepEqual(toolbox.inventory.tools[0].prefixArgs,
        [...dockerPrefix, 'exec', '-i', '--workdir', '/analysis', 'fixture-container', 'fixture-console'])
      return { ...result, value: JSON.parse(JSON.stringify({ report: result.value,
        restoredProject: await service.view(exec.agent), improvements: completed, toolbox })) }
    })
  })
}
