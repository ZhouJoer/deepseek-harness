/** Operator-owned tool builds and isolated Juice Shop laboratory generations. @module */
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import type {} from './workbench/index.ts'
import type { SecurityController } from './workbench/controller.ts'
import type { Laboratory, WorkbenchView } from './workbench/model.ts'
import type { SecurityEnvironment } from './workbench/providers.ts'
import { verifyWebLaboratory } from './web-provider.ts'
import { runProcess, requireProcessSuccess } from './workbench/process.ts'

/** Toolchain and resource bounds controlled by the Host operator. */
export interface Config {
  /** Docker CLI executable on the Host. */
  dockerCommand: string
  /** Locally installed toolbox reference; reuse resolves it to an immutable image ID without pulling. */
  existingImage: string
  /** Official Kali reference pinned by digest. */
  baseImage: string
  /** Target image reference pinned by digest. */
  targetImage: string
  /** Maximum build and image download duration. */
  buildTimeoutMs: number
  /** Maximum duration of lifecycle inspection commands. */
  timeoutMs: number
  /** Grace period for subprocess termination. */
  graceMs: number
  /** Maximum captured stdout or stderr bytes. */
  maxOutputBytes: number
  /** Memory limit for each container in MiB. */
  memoryMb: number
  /** CPU quota for each container. */
  cpus: number
  /** Process limit for each container. */
  pids: number
  /** Worker temporary storage size in MiB. */
  temporaryMb: number
}
/** Laboratory plugin identity. */
export const name = 'experimental-security-laboratory'
/** Host-only Docker control. */
export const inject = ['securityWorkbench', 'subprocess']
/** Explicit image sources and bounded process execution. */
export const Config: Schema<Config> = Schema.object({
  dockerCommand: Schema.string().default('docker'),
  existingImage: Schema.string().default('vxcontrol/kali-linux:latest'),
  baseImage: Schema.string().default('kalilinux/kali-rolling@sha256:30399bd65187e06525008dd13eecc2b3439d26a82b2c6b0ba32dee72bd843117'),
  targetImage: Schema.string().default('bkimminich/juice-shop:v20.2.0@sha256:8739101ade29358abb5469ee66ae78e582c97ed0a5543a4ad102e5fa5193526b'),
  buildTimeoutMs: Schema.number().step(1).min(1).default(1800000),
  timeoutMs: Schema.number().step(1).min(1).default(120000),
  graceMs: Schema.number().step(1).min(1).default(5000),
  maxOutputBytes: Schema.number().step(1).min(4096).default(2097152),
  memoryMb: Schema.number().step(1).min(256).default(2048),
  cpus: Schema.number().min(0.1).default(2),
  pids: Schema.number().step(1).min(32).default(256),
  temporaryMb: Schema.number().step(1).min(64).default(512),
})
const actions = z.enum(['prepare', 'reuse', 'start', 'inspect', 'stop', 'reset'])
const imageId = z.string().regex(/^sha256:[a-f0-9]{64}$/u)

/** Lifecycle uses durable ownership and never adopts containers by image or name alone. */
export class LaboratoryManager {
  private readonly active = new Set<string>()
  private readonly host: SecurityEnvironment
  constructor(private readonly ctx: Context, private readonly controller: SecurityController, private readonly config: Config) {
    if (![config.baseImage, config.targetImage].every(value => /@sha256:[a-f0-9]{64}$/u.test(value))) throw new Error('Pin toolbox and target images by digest')
    if (!config.existingImage.trim() || config.existingImage.startsWith('-') || /\s/u.test(config.existingImage)) throw new Error('Configure a local toolbox image reference')
    this.host = { id: 'laboratory-control', kind: 'local', label: 'Docker control',
      cwd: dirname(fileURLToPath(import.meta.url)), tools: [{ id: 'docker', command: config.dockerCommand, versionArgs: ['--version'], source: 'Host installation' }] }
  }
  private async docker(args: string[], signal: AbortSignal, durationMs = this.config.timeoutMs, input?: string): Promise<string> {
    const result = await runProcess(this.ctx, this.host, 'docker', args, { signal, durationMs,
      maxOutputBytes: this.config.maxOutputBytes, graceMs: this.config.graceMs }, input)
    requireProcessSuccess(result)
    if (result.truncated) throw new Error('Docker output exceeded its configured limit')
    return result.stdout.trim()
  }
  private environment(lab: Laboratory): SecurityEnvironment {
    return { id: lab.environmentId, kind: 'docker', label: 'Web lab ' + lab.id, cwd: this.host.cwd,
      image: lab.imageId, resolvedImageId: lab.imageId,
      ...(lab.state === 'running' ? { containerId: lab.worker, webTarget: {
        origin: 'http://target:3000', instanceId: lab.instanceId, networkId: lab.network, address: lab.address, laboratoryId: lab.id, target: lab.target, targetImageId: lab.targetImageId,
      } } : {}),
      manifest: { recipe: lab.recipe, imageId: lab.imageId, tools: lab.tools, templates: lab.templates },
      tools: [
        { id: 'docker', command: this.config.dockerCommand, versionArgs: ['--version'], source: 'Host installation' },
        { id: 'python', command: 'python3', versionArgs: ['--version'], source: lab.imageId },
        { id: 'nuclei', command: 'nuclei', versionArgs: ['-version'], source: lab.imageId },
        { id: 'metasploit', command: 'msfconsole', versionArgs: ['--version'], source: lab.imageId },
        { id: 'john', command: 'john', versionArgs: ['--list=build-info'], source: lab.imageId },
      ] }
  }
  private publish(lab: Laboratory): void {
    const environments = this.controller.options.environments
    const index = environments.findIndex(env => env.id === lab.environmentId)
    if (index === -1) environments.push(this.environment(lab))
    else environments[index] = this.environment(lab)
  }
  /** Restore configuration without replaying an interrupted operation.
   * @returns completion after all unsettled generations are marked for reconciliation. */
  async recover(): Promise<void> {
    for (let lab of this.controller.laboratoriesView()) {
      if (lab.state === 'preparing' || lab.state === 'running') lab = await this.controller.saveLaboratory({ ...lab,
        state: 'interrupted', detail: 'Inspect or stop owned resources before starting another run' })
      this.publish(lab)
    }
  }
  private async owned(kind: 'container' | 'network', resource: string, lab: Laboratory, signal: AbortSignal): Promise<boolean> {
    const result = await runProcess(this.ctx, this.host, 'docker', [kind, 'inspect', resource], {
      signal, durationMs: this.config.timeoutMs, maxOutputBytes: this.config.maxOutputBytes, graceMs: this.config.graceMs,
    })
    if (result.exitCode !== 0 && /[Nn]o such (object|container|network)|network [^\r\n]+ not found/u.test(result.stderr)) return false
    requireProcessSuccess(result)
    if (result.truncated) throw new Error('Ownership inspection was truncated')
    const objects = z.array(z.object({ Labels: z.record(z.string(), z.string()).nullish(),
      Config: z.object({ Labels: z.record(z.string(), z.string()).nullish() }).loose().optional(),
    }).loose()).parse(JSON.parse(result.stdout))
    const labels = kind === 'network' ? objects[0]?.Labels : objects[0]?.Config?.Labels
    if (labels?.['dsh.security.laboratory'] !== lab.id) throw new Error('Resource ownership mismatch: ' + resource)
    return true
  }
  private async stop(lab: Laboratory, signal: AbortSignal): Promise<Laboratory> {
    for (const resource of [lab.worker, lab.target])
      if (await this.owned('container', resource, lab, signal)) await this.docker(['container', 'rm', '--force', resource], signal)
    if (await this.owned('network', lab.network, lab, signal)) await this.docker(['network', 'rm', lab.network], signal)
    return { ...lab, state: 'stopped', address: '', browserUrl: '', detail: 'Owned containers and network removed; evidence retained' }
  }
  /** Execute an operator lifecycle action; prepare or reuse creates a separate image generation.
   * @param projectId - owning security project.
   * @param action - prepare, reuse, start, inspect, stop or reset.
   * @param laboratoryId - existing generation for lifecycle actions.
   * @returns current project view after durable settlement. */
  async action(projectId: string, action: string, laboratoryId?: string): Promise<WorkbenchView> {
    const selected = actions.parse(action)
    const provisioning = selected === 'prepare' || selected === 'reuse'
    const project = this.controller.projectView(projectId)
    if ((provisioning || selected === 'start') &&
      project.records.some(item => item.kind === 'engagement' && item.value.stopped)) throw new Error('Resume the project before provisioning')
    if (this.active.has(projectId)) throw new Error('A laboratory operation is already running for this project')
    const id = provisioning ? randomUUID() : z.string().min(1).parse(laboratoryId)
    const existing = this.controller.laboratoriesView().find(item => item.id === id && item.engagementId === projectId)
    if (!provisioning && !existing) throw new Error('Unknown project laboratory')
    let lab: Laboratory = existing ?? { id: id, engagementId: projectId, environmentId: 'lab-' + id, recipe: selected === 'reuse' ? 'local-image-v1' : 'web-v1', state: 'preparing',
      imageId: '', targetImageId: '', instanceId: randomUUID(), baseImage: selected === 'reuse' ? this.config.existingImage : this.config.baseImage, targetImage: this.config.targetImage, network: 'dsh-lab-' + id, worker: 'dsh-worker-' + id, target: 'dsh-target-' + id,
      browserUrl: '', address: '', detail: '', tools: {}, templates: {}, createdAt: Date.now() }
    this.active.add(projectId)
    try {
      return await this.controller.manageEnvironment(lab.environmentId, async (signal) => {
        try {
          if (provisioning) {
            lab = await this.controller.saveLaboratory(lab)
            if (selected === 'reuse') {
              lab.imageId = imageId.parse(await this.docker(['image', 'inspect', '--format', '{{.Id}}', this.config.existingImage], signal))
              lab = await this.controller.saveLaboratory(lab)
              try {
                await this.docker(['run', '--detach', '--pull=never', '--name', lab.worker, '--label', 'dsh.security.laboratory=' + lab.id,
                  '--network=none', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--read-only',
                  '--tmpfs', '/tmp:rw,nosuid,nodev,size=' + String(this.config.temporaryMb) + 'm',
                  '--memory', String(this.config.memoryMb) + 'm', '--cpus', String(this.config.cpus), '--pids-limit', String(this.config.pids),
                  '--env', 'HOME=/tmp', '--env', 'XDG_CONFIG_HOME=/tmp/.config', '--env', 'XDG_CACHE_HOME=/tmp/.cache',
                  '--workdir', '/tmp', '--entrypoint', 'sleep', lab.imageId, 'infinity'], signal)
                const script = await readFile(new URL('../resources/toolbox/inspect.py', import.meta.url), 'utf8')
                const measured = await this.docker(['exec', '-i', lab.worker, 'python3', '-', String(this.config.timeoutMs / 10000), '--inventory'], signal, this.config.timeoutMs, script)
                lab.tools = z.record(z.string(), z.string()).parse(JSON.parse(measured))
              } finally {
                const cleanupSignal = new AbortController().signal
                if (await this.owned('container', lab.worker, lab, cleanupSignal)) await this.docker(['container', 'rm', '--force', lab.worker], cleanupSignal)
              }
            } else {
              const recipeRoot = fileURLToPath(new URL('../resources/toolbox/', import.meta.url))
              const tag = 'dsh-toolbox:' + lab.id
              await this.docker(['pull', this.config.baseImage], signal, this.config.buildTimeoutMs)
              await this.docker(['build', '--build-arg', 'BASE_IMAGE=' + this.config.baseImage, '-t', tag, recipeRoot], signal, this.config.buildTimeoutMs)
              lab.imageId = imageId.parse(await this.docker(['image', 'inspect', '--format', '{{.Id}}', tag], signal))
              const measured = await this.docker(['run', '--rm', '--network=none', '--read-only', '--tmpfs', '/tmp:rw,nosuid,nodev',
                '--entrypoint', 'cat', lab.imageId, '/opt/dsh-toolbox/manifest.json'], signal)
              lab.tools = z.record(z.string(), z.string()).parse(JSON.parse(measured))
            }
            await this.docker(['pull', this.config.targetImage], signal, this.config.buildTimeoutMs)
            lab.targetImageId = imageId.parse(await this.docker(['image', 'inspect', '--format', '{{.Id}}', this.config.targetImage], signal))
            lab.state = 'ready'
            lab.targetImage = await this.docker(['image', 'inspect', '--format', '{{index .RepoDigests 0}}', this.config.targetImage], signal)
            lab.detail = 'Tool inventory and John yescrypt result recorded; worker and target images pinned'
          } else if (selected === 'stop' || selected === 'reset') {
            lab = await this.stop(lab, signal)
          } else if (selected === 'inspect') {
            const worker = await this.owned('container', lab.worker, lab, signal)
            const target = await this.owned('container', lab.target, lab, signal)
            const network = await this.owned('network', lab.network, lab, signal)
            const running = worker && target && network &&
              await this.docker(['inspect', '--format', '{{.State.Running}}', lab.worker], signal) === 'true' &&
              await this.docker(['inspect', '--format', '{{.State.Running}}', lab.target], signal) === 'true'
            let health: string | undefined
            if (running) {
              const environment = this.environment({ ...lab, state: 'running' })
              verifyWebLaboratory(JSON.parse(await this.docker(['inspect', lab.worker, lab.target, lab.network], signal)), environment)
              const result = await runProcess(this.ctx, environment, 'python', ['-c', 'import http.client,sys; c=http.client.HTTPConnection(sys.argv[1],3000,timeout=5); c.request("HEAD","/",headers={"Host":"target:3000"}); print(c.getresponse().status); c.close()', lab.address],
                { signal, durationMs: this.config.timeoutMs, graceMs: this.config.graceMs, maxOutputBytes: this.config.maxOutputBytes })
              health = result.exitCode === 0 ? result.stdout.trim() : result.stderr.trim()
            }
            lab.detail = JSON.stringify({ worker, target, network, running, health, tools: lab.tools })
            if (!running && lab.state === 'running') lab.state = 'interrupted'
          } else {
            if (!['ready', 'stopped'].includes(lab.state)) throw new Error('Stop or reconcile this laboratory before starting')
            imageId.parse(lab.imageId); imageId.parse(lab.targetImageId)
            lab = await this.controller.saveLaboratory({ ...lab, state: 'preparing', instanceId: randomUUID() })
            const label = 'dsh.security.laboratory=' + lab.id
            await this.docker(['network', 'create', '--internal', '--opt', 'com.docker.network.bridge.gateway_mode_ipv4=isolated', '--label', label, lab.network], signal)
            const limits = ['--memory', String(this.config.memoryMb) + 'm', '--cpus', String(this.config.cpus), '--pids-limit', String(this.config.pids)]
            await this.docker(['run', '--detach', '--pull=never', '--name', lab.target, '--label', label,
              '--network', lab.network, '--network-alias', 'target', '--cap-drop=ALL', '--security-opt=no-new-privileges',
              ...limits, lab.targetImageId], signal)
            await this.docker(['run', '--detach', '--pull=never', '--name', lab.worker, '--label', label,
              '--network', lab.network, '--cap-drop=ALL', '--security-opt=no-new-privileges', '--read-only',
              '--tmpfs', '/tmp:rw,nosuid,nodev,size=' + String(this.config.temporaryMb) + 'm',
              '--workdir', '/tmp', ...limits, '--entrypoint', 'sleep', lab.imageId, 'infinity'], signal)
            const addresses = await this.docker(['inspect', '--format', '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}', lab.target], signal)
            lab.address = z.ipv4().parse(addresses)
            lab.browserUrl = ''
            lab.state = 'running'
            lab.detail = 'Containers started on an isolated network; browser forwarding unavailable; inspect HTTP readiness'
          }
          lab = await this.controller.saveLaboratory(lab)
          this.publish(lab)
        } catch (error) {
          lab = await this.controller.saveLaboratory({ ...lab, state: 'failed', detail: error instanceof Error ? error.message : String(error) })
          this.publish(lab)
          throw error
        }
        return this.controller.projectView(projectId)
      }, projectId)
    } finally { this.active.delete(projectId) }
  }
}
/** Register laboratory lifecycle without starting containers on plugin load.
 * @param ctx - Host services.
 * @param config - image and process settings. */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const controller = await ctx.securityWorkbench.ready
  const manager = new LaboratoryManager(ctx, controller, config)
  await manager.recover()
  ctx.effect(() => controller.laboratories.register({ id: 'local', action: (project, action, id) => manager.action(project, action, id) }))
}
