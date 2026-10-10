/** Real binary observation failure with persisted diagnostics available to the model. */
import assert from 'node:assert/strict'

export function apply(ctx) {
  ctx.inject(['securityWorkbench'], (securityCtx) => {
    const service = securityCtx.securityWorkbench
    securityCtx.on('tools/execute', async (exec, next) => {
      if (exec.callId === 'prepare-observation') {
        assert(exec.agent)
        const before = await service.view(exec.agent)
        const created = await service.command(exec.agent, JSON.stringify({ operationId: 'fixture-observation-project',
          expectedRevision: before.revision, action: { kind: 'create', title: '失败的二进制观察',
            objective: '检查静态读取错误是否明确报告并保留原始诊断。', environmentIds: ['fixture-local'], maxAttempts: 1 } }))
        await service.importMaterials(exec.agent, JSON.stringify({ operationId: 'fixture-observation-material',
          expectedRevision: created.revision, title: '失败的二进制观察', objective: '读取已导入样本。',
          material: { kind: 'files', directory: false, files: [{ name: 'sample.bin', base64: 'AAECAw==' }] } }))
      }
      const result = await next()
      if (exec.callId === 'identity-invalid-path') {
        assert.equal(result.isError, true)
        assert.match(result.content[0].text, /binary identity accepts no parameter keys/)
        const view = await service.view(exec.agent)
        assert.equal(view.records.filter(record => record.kind === 'evidence').length, 1)
      }
      if (exec.callId === 'identity-corrected') {
        assert.notEqual(result.isError, true)
        const view = await service.view(exec.agent)
        const evidence = view.records.filter(record => record.kind === 'evidence')
        assert.equal(evidence.length, 2)
        const identity = evidence.find(record => record.value.operation === 'identity')
        assert(identity)
        const controller = await service.ready
        const value = JSON.parse((await controller.artifacts.read(identity.value.artifact)).toString())
        assert.equal(value.size, 4)
        assert.match(value.sha256, /^[a-f0-9]{64}$/)
      }
      if (exec.callId === 'observe-outside-sample') {
        assert.equal(result.isError, true)
        assert.equal(result.content[0].text, 'Error: Offset exceeds sample size')
        assert(exec.agent)
        const view = await service.view(exec.agent)
        const evidence = view.records.find(record => record.kind === 'evidence')
        assert(evidence)
        assert.equal(evidence.value.incomplete, true)
        assert.equal(evidence.value.failure, 'Offset exceeds sample size')
        assert.equal(evidence.value.provider, 'binary')
        const controller = await service.ready
        assert.equal((await controller.artifacts.read(evidence.value.artifact)).toString(), 'Offset exceeds sample size')
      }
      if (exec.name === 'security_evidence') {
        assert.notEqual(result.isError, true)
        assert.equal(result.value.incomplete, true)
        assert.equal(result.value.text, 'Offset exceeds sample size')
      }
      return result
    })
  })
}
