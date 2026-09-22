/** Opt-in real Docker laboratory identity, HTTP evidence and egress rejection. @module */
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import { JsonStorageBackend } from '@deepseek-ai/dsh-storage-json'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import { it, expect } from 'vitest'
import { LaboratoryManager, Config } from '../src/laboratory.ts'
import { SecurityController } from '../src/workbench/controller.ts'
import { openSecurityJournal } from '../src/workbench/journal.ts'
import { ArtifactStore } from '../src/workbench/artifacts.ts'
import { runProcess, requireProcessSuccess } from '../src/workbench/process.ts'
import { WebProvider } from '../src/web-provider.ts'
import type { SecurityEnvironment } from '../src/workbench/providers.ts'

it.skipIf(!process.env.DSH_SECURITY_DOCKER_IMAGE)('collects HTTP inside the owned lab and refuses outside connections and reset identities', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-web-lab-'))
  const ctx = new Context()
  const backend = new JsonStorageBackend(root)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('test', backend)
  const facility = new DomainFacility(ctx, { backend: 'test' })
  ctx.storage.mount('domain', facility); ctx.provide('storageDomain', facility)
  await ctx.plugin(LocalSubprocess)
  const journal = await openSecurityJournal(ctx)
  const artifacts = new ArtifactStore(root, 2 * 1024 * 1024)
  const controller = new SecurityController(journal, artifacts, { importRoots: [root], environments: [],
    maxDurationMs: 30000, maxOutputBytes: 65536, approvalTtlMs: 60000, maxArtifactBytes: 2 * 1024 * 1024, maxDerivedAssets: 10 })
  const existingImage = process.env.DSH_SECURITY_DOCKER_IMAGE
  if (!existingImage) throw new Error('Configure the local toolbox image for this opt-in test')
  const config: Config = Config({ dockerCommand: process.env.DSH_SECURITY_DOCKER_COMMAND ?? 'docker', existingImage, baseImage: 'kalilinux/kali-rolling@sha256:30399bd65187e06525008dd13eecc2b3439d26a82b2c6b0ba32dee72bd843117', targetImage: 'bkimminich/juice-shop:v20.2.0@sha256:8739101ade29358abb5469ee66ae78e582c97ed0a5543a4ad102e5fa5193526b', buildTimeoutMs: 120000, timeoutMs: 120000, graceMs: 5000, maxOutputBytes: 65536, memoryMb: 2048, cpus: 2, pids: 256, temporaryMb: 512 })
  const manager = new LaboratoryManager(ctx, controller, config)
  const host: SecurityEnvironment = { id: 'host', kind: 'local', label: 'Docker', cwd: root, tools: [{ id: 'docker', command: config.dockerCommand, versionArgs: ['--version'], source: 'Host' }] }
  const limits = { signal: new AbortController().signal, durationMs: 30000, maxOutputBytes: 65536, graceMs: 5000 }
  const docker = async (args: string[]) => { const result = await runProcess(ctx, host, 'docker', args, limits); requireProcessSuccess(result); return result.stdout.trim() }
  let id = ''
  try {
    await controller.command('operator', { operationId: randomUUID(), expectedRevision: 0, action: { kind: 'create', title: 'Owned Web fixture', objective: 'Validate isolation and evidence', environmentIds: [], maxAttempts: 3 } }, true)
    const projectId = controller.projects()[0]!.id
    await manager.action(projectId, 'reuse')
    const reused = controller.laboratoriesView().find(item => item.state === 'ready')
    expect(reused).toBeDefined()
    if (!reused) throw new Error('Missing reused laboratory')
    id = reused.id
    expect(reused.imageId).toBe(await docker(['image', 'inspect', '--format', '{{.Id}}', config.existingImage]))
    expect(reused.tools.python).toBeTruthy()
    expect(['passed', 'failed', 'unavailable']).toContain(reused.tools['john.yescrypt'])
    console.info('Reused toolbox capabilities:', JSON.stringify(reused.tools))
    await manager.action(projectId, 'start', id)
    const laboratory = controller.laboratoriesView()[0]!
    const environment = controller.options.environments.find(item => item.id === laboratory.environmentId)!
    const provider = new WebProvider(ctx, 5000)
    await controller.command('operator', { operationId: randomUUID(), expectedRevision: journal.view().revision, action: { kind: 'web-target', environmentId: environment.id, label: 'Juice Shop', pathPrefix: '/' } }, true)
    const asset = controller.projectView(projectId).records.find(item => item.kind === 'asset')!
    if (asset.kind !== 'asset') throw new Error('Missing Web target')
    const context = { environment, asset: asset.value, artifacts, ...limits }
    const request = provider.resolve({ provider: 'web', operation: 'request', assetId: asset.value.id, environmentId: environment.id, parameters: { path: '/', method: 'GET' }, impact: 'observe' }, context)
    await expect.poll(async () => { const result = await provider.run(request, context); return result.failure ?? 'ready' }, { timeout: 30000, interval: 1000 }).toBe('ready')
    const result = await provider.run(request, context)
    expect(result.failure).toBeUndefined()
    const raw = JSON.parse(Buffer.from(result.bytes).toString()) as { stdout: string }
    expect(JSON.parse(raw.stdout)).toMatchObject({ responses: [{ status: 200 }] })
    const outside = await runProcess(ctx, environment, 'python', ['-c', 'import socket; s=socket.socket(); s.settimeout(2); s.connect(("203.0.113.1",80))'], limits)
    expect(outside.exitCode).not.toBe(0)
    expect(outside.stderr).toMatch(/Network is unreachable|Permission denied/u)
    const health = await manager.action(projectId, 'inspect', id)
    expect(health.records.find(item => item.kind === 'laboratory')?.value).toMatchObject({ state: 'running' })
    expect(laboratory.browserUrl).toBe('')
    const replacement = new LaboratoryManager(ctx, controller, Object.assign({}, config, { existingImage: 'dsh-missing-' + randomUUID() }))
    await expect(replacement.action(projectId, 'reuse')).rejects.toThrow()
    expect(controller.laboratoriesView().find(item => item.id === id)).toMatchObject({ state: 'running', imageId: reused.imageId })
    await manager.recover()
    expect(controller.options.environments.find(item => item.id === laboratory.environmentId)?.containerId).toBeUndefined()
    await manager.action(projectId, 'reset', id)
    await manager.action(projectId, 'start', id)
    const next = controller.options.environments.find(item => item.id === laboratory.environmentId)!
    expect(() => provider.resolve(request, { ...context, environment: next })).toThrow(/identity changed/)
  } finally {
    for (const lab of controller.laboratoriesView()) await manager.action(lab.engagementId, 'stop', lab.id)
    await controller.dispose(); await facility.closeAll(); await backend.close(); await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
}, 180000)
