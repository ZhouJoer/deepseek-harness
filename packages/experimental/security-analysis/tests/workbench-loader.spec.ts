/** Real Loader composition for scoped evidence, workflow, and tool enforcement. */
import { mkdtemp, mkdir, rm, writeFile, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { afterEach, describe, expect, it, vi, onTestFinished } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Agents from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Llm, { LlmAdapter, ReasoningEffortId, ToolCallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools, { defineTool } from '@deepseek-ai/dsh-tools'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type {
  SubprocessHandle,
  SubprocessSpawnSpec,
  SubprocessTerminalEnvironment,
  SubprocessTerminalHandle,
} from '@deepseek-ai/dsh-subprocess'
import Subagents from '@deepseek-ai/dsh-subagent'
import Jobs from '@deepseek-ai/dsh-jobs-local'
import { JobId } from '@deepseek-ai/dsh-jobs'
import { startInProcessRun } from '@deepseek-ai/dsh-subagent-in-process-driver'
import type { WorkbenchView } from '../src/workbench/model.ts'
import { createScope, bindScopeParent, scopeOf } from '@deepseek-ai/dsh-scope'
import Approval from '@deepseek-ai/dsh-user-approval'
import Skills from '@deepseek-ai/dsh-skill'
import * as ToolSkill from '@deepseek-ai/dsh-tool-skill'
import Security from '../src/workbench/index.ts'
import type { ToolInstallation } from '../src/workbench/providers.ts'
import { findingHash } from '../src/workbench/assessment.ts'
import { bindDelegatedChild } from './delegation-fixture.ts'
import type { SessionBinding } from '../src/workbench/model.ts'
import type { EvolutionConfig } from '../src/evolution.ts'
import { evolutionInputSchema } from '../src/evolution-model.ts'
import * as Ghidra from '../src/ghidra-provider.ts'
import * as Frida from '../src/frida-provider.ts'
import * as Android from '../src/android-provider.ts'
import * as Web from '../src/web-provider.ts'
import ExternalWeb from '../src/external-web-provider.ts'
import { MemoryCredentials } from '../../../credentials/credentials/tests/memory.ts'
import * as Offline from '../src/offline-provider.ts'
import * as Native from '../src/native-provider.ts'
import * as PacketCapture from '../src/packet-capture-provider.ts'
import { captureInterfaces, uncheckedDevices } from '../src/device-inventory.ts'
import * as Laboratory from '../src/laboratory.ts'
import * as Environments from '../src/environment-local.ts'
import LocalSubprocess from '@deepseek-ai/dsh-subprocess-local'
import LocalFs from '@deepseek-ai/dsh-fs-local'
import LocalBash from '@deepseek-ai/dsh-bash-local'
import LocalPwsh from '@deepseek-ai/dsh-pwsh-local'
import * as ShellEnv from '@deepseek-ai/dsh-shell-env'
import * as NativeFs from '@deepseek-ai/dsh-tool-fs'
import * as NativeBash from '@deepseek-ai/dsh-tool-bash'
import * as NativePwsh from '@deepseek-ai/dsh-tool-pwsh'
import SessionQuery from '@deepseek-ai/dsh-session-query'
import AgentPresets from '@deepseek-ai/dsh-agent-preset-registry'
import * as NativeJobs from '@deepseek-ai/dsh-tool-jobs'

class ExactQuery extends SessionQuery {
  searchSessions(): Promise<never> { return Promise.reject(new Error('Search is outside this fixture')) }
  searchEvents(): Promise<never> { return Promise.reject(new Error('Search is outside this fixture')) }
}

const contexts: Context[] = []
const roots: string[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

class ScopeModel extends LlmAdapter {
  nativeCalls: { name: string; args: Record<string, unknown> | ((request: GenerateOptions) => Record<string, unknown>) }[] = []
  nativeCallId = (request: number) => 'native-' + String(request)
  readonly requests: GenerateOptions[] = []
  beforeResponse: ((request: number) => void) | undefined
  firstSkill: string | undefined
  scopeCalls = 1
  usageTokens = 0
  cacheReadTokens = 0
  exactUsageTotal = true
  reportFailure = false
  childReport: NonNullable<SessionBinding['report']> = {
    summary: 'Assigned evidence review completed.', evidenceIds: [], uncertainty: 'No observations collected.', nextSteps: [],
  }
  refinementOutput: ((prompt: string) => string) | undefined
  evolutionOutput: ((prompt: string) => string) | undefined
  evolutionTruncated = false
  reasoning: LlmResolvedModelInfo['reasoning']
  reportOutput: ((prompt: string) => string) | undefined
  refinementWait: ((signal: AbortSignal | undefined) => Promise<void>) | undefined
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, inputModalities: ['text'],
      ...this.reasoning === undefined ? {} : { reasoning: this.reasoning } })
  }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    this.beforeResponse?.(this.requests.length)
    if (this.usageTokens || this.cacheReadTokens) yield { type: 'usage', usage: { inputTokens: this.usageTokens, outputTokens: 0, cacheReadTokens: this.cacheReadTokens,
      ...(this.exactUsageTotal ? { totalTokens: this.usageTokens + this.cacheReadTokens } : {}) } }
    const native = this.nativeCalls[this.requests.length - 1]
    if (native) {
      const call = { type: 'tool-call' as const, id: ToolCallId(this.nativeCallId(this.requests.length)), name: native.name,
        arguments: JSON.stringify(typeof native.args === 'function' ? native.args(options) : native.args) }
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: call.id, name: call.name, argumentsDelta: call.arguments }
      yield { type: 'block-end', index: 0, block: call }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    const refinement = options.messages.flatMap(message => message.content).filter(block => block.type === 'text').map(block => block.text).find(text => text.includes('\nNotes: '))
    const evolution = options.messages.flatMap(message => message.content).filter(block => block.type === 'text').map(block => block.text).find(text => text.includes('\nObservations: '))
    const report = options.messages.flatMap(message => message.content).filter(block => block.type === 'text').map(block => block.text).find(text => text.includes('\nData: '))
    if (report && this.reportFailure) {
      yield { type: 'finish', reason: { kind: 'error', failure: { message: 'Fixture model rejected report', code: 'UNKNOWN' } } }
      return
    }
    if ((refinement && this.refinementOutput) || (report && this.reportOutput) || (evolution && this.evolutionOutput)) {
      await this.refinementWait?.(options.signal)
      const text = evolution && this.evolutionOutput ? this.evolutionOutput(evolution)
        : refinement && this.refinementOutput ? this.refinementOutput(refinement) : this.reportOutput!(report!)
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: evolution && this.evolutionTruncated ? 'max-tokens' : 'stop' } }
    } else if (options.tools?.some(tool => tool.name === 'structured_output')) {
      const call = { type: 'tool-call' as const, id: ToolCallId('report'), name: 'structured_output',
        arguments: JSON.stringify(this.childReport) }
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: call.id, name: call.name, argumentsDelta: call.arguments }
      yield { type: 'block-end', index: 0, block: call }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else if (this.requests.length <= this.scopeCalls && options.tools?.some(tool => tool.name === 'security_scope')) {
      const call = { type: 'tool-call' as const, id: ToolCallId('scope-call-' + String(this.requests.length)),
        name: this.firstSkill ? 'skill' : 'security_scope',
        arguments: this.firstSkill ? JSON.stringify({ name: this.firstSkill }) : '{}' }
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: call.id, name: call.name, argumentsDelta: call.arguments }
      yield { type: 'block-end', index: 0, block: call }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'The configured binary is ready for static reconnaissance.' }
      yield {
        type: 'block-end',
        index: 0,
        block: { type: 'text', text: 'The configured binary is ready for static reconnaissance.' },
      }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
}

class UnusedSubprocess extends SubprocessRuntime {
  resolveExecutable(): Promise<string> {
    return Promise.reject(new Error('Unexpected process lookup in static-only engagement'))
  }
  terminalEnvironment(): Promise<SubprocessTerminalEnvironment> {
    return Promise.reject(new Error('Unexpected terminal inspection'))
  }
  spawn(_spec: SubprocessSpawnSpec): SubprocessHandle {
    throw new Error('Unexpected child process')
  }
  spawnTerminal(): Promise<SubprocessTerminalHandle> {
    return Promise.reject(new Error('Unexpected terminal allocation'))
  }
}

function independentTool(ctx: Context, name: string, execute = vi.fn(async () => true)) {
  ctx.tools.register(
    defineTool({
      name,
      description: 'Fixture capability outside the security engagement.',
      parameters: {},
      output: { schema: { type: 'boolean' }, render: () => [{ type: 'text', text: 'Independent capability ran.' }] },
      execute,
    }),
  )
  return execute
}

async function load(inheritJobTool = false, knowledgeIntervalMs = 0,
  options: { evolution?: Partial<EvolutionConfig>; installations?: ToolInstallation[]; dedicatedModel?: boolean; analysisTurnTokens?: number; analysisCountCacheReads?: boolean; skills?: boolean; native?: boolean; taskIntake?: 'current' | 'other' | 'default'; maxConcurrentDelegations?: number; maxOutputBytes?: number; delegationTimeoutMs?: number } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-workbench-loader-'))
  roots.push(root)
  const model = new ScopeModel()
  const shell = vi.fn(async () => true)
  const modules = new Map<string, unknown>([
    ['prompt', SystemPrompt],
    ['tools', Tools],
    ['llm', Llm],
    ['sessions', Sessions],
    ['agents', Agents],
    ['loop', AgentLoop],
    ['projections', Projections],
    ['storage', Storage],
    ['storage-json', StorageJson],
    ['storage-domain', StorageDomain],
    ['subprocess', UnusedSubprocess],
    ['subagents', Subagents],
    ['jobs', Jobs],
    ['approval', Approval],
    [
      'model',
      {
        inject: ['llm'],
        apply(ctx: Context) {
          ctx.effect(() => ctx.llm.registerAdapter(['fixture'], model))
        },
      },
    ],
    [
      'independent',
      {
        inject: ['tools'],
        apply(ctx: Context) {
          independentTool(ctx, 'shell', shell)
        },
      },
    ],
    ['security', Security],
    ['ghidra', Ghidra],
    ['frida', Frida],
    ['android', Android],
    ['environments', Environments],
    ['web', Web],
    ['credentials', MemoryCredentials],
    ['external-web', ExternalWeb],
    ['offline', Offline],
    ['native-provider', Native],
    ['packet-capture', PacketCapture],
    ['laboratory', Laboratory],
  ])
  if (options.skills) {
    modules.set('skills', Skills)
    modules.set('tool-skill', ToolSkill)
  }
  if (options.native) {
    modules.set('subprocess', LocalSubprocess)
    modules.set('native-shell', process.platform === 'win32' ? LocalPwsh : LocalBash)
    modules.set('native-fs', LocalFs)
    modules.set('shell-env', ShellEnv)
    modules.set('query', ExactQuery)
  }
  const configPath = join(root, 'cordis.yml')
  await writeFile(
    configPath,
    JSON.stringify(
      [...modules.keys()].map(name => ({
        id: name,
        name: 'cordis:' + name,
        config:
          name === 'loop'
            ? { agents: [] }
            : name === 'storage-json'
              ? { root: join(root, 'domain') }
              : name === 'storage-domain'
                ? { backend: 'json' }
                : name === 'ghidra'
                  ? { programs: [] }
                  : name === 'security'
                    ? { knowledgeIntervalMs, ...(options.dedicatedModel === false ? {} : { knowledgeProvider: 'fixture', knowledgeModel: 'fixture' }),
                      ...(options.evolution ? { evolution: options.evolution } : {}),
                      ...(options.analysisTurnTokens === undefined ? {} : { analysisTurnTokens: options.analysisTurnTokens }),
                      ...(options.maxConcurrentDelegations === undefined ? {}
                        : { maxConcurrentDelegations: options.maxConcurrentDelegations }),
                      ...(options.maxOutputBytes === undefined ? {} : { maxOutputBytes: options.maxOutputBytes }),
                      ...(options.delegationTimeoutMs === undefined ? {} : { delegationTimeoutMs: options.delegationTimeoutMs }),
                      ...(options.analysisCountCacheReads === undefined ? {}
                        : { analysisCountCacheReads: options.analysisCountCacheReads }),
                      ...(options.taskIntake ? { taskIntake: { maxAttempts: 3,
                        ...(options.taskIntake === 'default' ? { defaultEnvironmentIds: ['local'] } : {}), workspaces: [
                          { cwd: options.taskIntake === 'current' ? root : join(root, 'other'), environmentIds: ['local'] },
                        ] } } : {}),
                      root: join(root, 'workbench'), importRoots: [root],
                      environments: [{ id: 'local', kind: 'local', label: 'Host', cwd: root, tools: options.installations ?? [] }] }
                    : {},
      })),
    ),
  )
  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  for (const [name, module] of modules) ctx.loader.builtins[name] = module
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  const controller = await ctx.securityWorkbench.ready
  const presetKey = {}
  if (options.native) {
    const presets = join(root, 'presets')
    await mkdir(join(presets, 'native'), { recursive: true })
    await writeFile(join(presets, 'native', 'preset.yml'), 'name: Native fixture\ndescription: Native analysis tools\n')
    ctx.loader.builtins['native-fs-tools'] = NativeFs
    ctx.loader.builtins['native-shell-tools'] = process.platform === 'win32' ? NativePwsh : NativeBash
    ctx.loader.builtins['native-jobs'] = NativeJobs
    await writeFile(join(presets, 'native', 'agent.cordis.yml'), JSON.stringify(['native-fs-tools', 'native-shell-tools', 'native-jobs'].map(name => ({ id: name, name: 'cordis:' + name,
      ...(name === 'native-jobs' ? { config: { completionDelivery: 'quiet' } } : {}) }))))
    await ctx.plugin(AgentPresets, { default: 'native' })
    ctx.effect(() => ctx.agentPresets.register({ id: 'native', name: 'Native fixture', plugins: ['native-fs-tools', 'native-shell-tools', 'native-jobs'].map(name => ({ id: name, name: 'cordis:' + name, ...(name === 'native-jobs' ? { config: { completionDelivery: 'quiet' } } : {}) })) }))
  } else if (inheritJobTool) {
    const preset = createScope(ctx.plugin(() => {}).ctx, presetKey).ctx
    await preset.plugin({ inject: ['tools'], apply(scoped: Context) { independentTool(scoped, 'job_output') } })
  }
  const { agent } = await ctx.agents.create({
    sessionId: SessionId('coordinator'),
    ...(options.native ? { setup: async (agentCtx: Context) => { await ctx.agentPresets.mount(agentCtx) } }
      : inheritJobTool ? { setup(agentCtx: Context) { bindScopeParent(scopeOf(agentCtx)!, presetKey) } } : {}),
    meta: { cwd: root },
    agentOptions: { provider: 'fixture', model: 'fixture' },
  })
  return { ctx, agent, controller, model, shell }
}
function execute(ctx: Context, agent: Agent, name: string, args: Record<string, unknown> = {}, callId = 'call-' + name) {
  return ctx.tools.execute({
    agent,
    name,
    arguments: args,
    callId: ToolCallId(callId),
    signal: new AbortController().signal,
  })
}

function webPrompt(text: string) {
  const source = { kind: 'user' as const, rpcId: 'fixture-prompt' }
  return createUserMessage({ content: [{ type: 'text', text }], source })
}

function operator(controller: Awaited<Security['ready']>, agent: Agent) {
  return (action: Record<string, unknown>) => controller.command(agent.id, {
    operationId: JSON.stringify(action), expectedRevision: controller.view(agent.id).revision, action,
  }, true)
}

describe('security workbench Loader composition', () => {
  it('requires approval for native Python, saves its output and stops a running local process', async () => {
    const { agent, controller } = await load(false, 0, { native: true, installations: [{ id: 'python',
      command: process.env.DSH_SECURITY_SCRIPT_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3'),
      versionArgs: ['--version'], source: 'Test interpreter' }] })
    const root = roots[roots.length - 1]!
    const send = operator(controller, agent)
    await send({ kind: 'create', title: 'Native validation', objective: 'Run an owned Python fixture', environmentIds: ['local'], maxAttempts: 3 })
    const input = join(root, 'input.txt')
    await writeFile(input, 'native input')
    await send({ kind: 'import', path: input, label: 'Input' })
    const asset = controller.view(agent.id).records.find(item => item.kind === 'asset')!
    if (asset.kind !== 'asset') throw new Error('Missing input asset')
    await send({ kind: 'check', check: { assetId: asset.value.id, title: 'Native check', phase: 'validation',
      criterion: 'Read the local file and save bounded output', dependencies: [], evidenceIds: [] } })
    const check = controller.view(agent.id).records.find(item => item.kind === 'check')!
    if (check.kind !== 'check') throw new Error('Missing check')
    const script = 'from pathlib import Path\nassert Path("input.txt").read_text() == "native input"\nPath("result.txt").write_text("42")\nprint("native result 42")\n'
    const prepare = async (code: string) => {
      await send({ kind: 'plan', checkId: check.value.id, hypothesis: 'Native Python can read its workspace',
        expectedObservation: '42', impact: 'Write fixture files', cleanup: 'Keep output', durationMs: 30000,
        operation: { provider: 'native', operation: 'python', environmentId: 'local', assetId: asset.value.id, parameters: {}, impact: 'observe' }, script: code })
      const plan = controller.view(agent.id).records.filter(item => item.kind === 'plan').at(-1)!
      if (plan.kind !== 'plan') throw new Error('Missing plan')
      return plan.value
    }
    const plan = await prepare(script)
    expect(plan.operation).toMatchObject({ impact: 'target-write', script: { mediaType: 'text/x-python' } })
    const run = () => controller.execute(agent.id, plan.id, randomUUID(), controller.view(agent.id).revision, 'native-test', new AbortController().signal)
    await expect(run()).rejects.toThrow('approved')
    await expect(readFile(join(root, 'result.txt'))).rejects.toThrow()
    await send({ kind: 'approve', planId: plan.id })
    await run()
    expect(await readFile(join(root, 'result.txt'), 'utf8')).toBe('42')
    const evidence = controller.view(agent.id).records.find(item => item.kind === 'evidence' && item.value.planId === plan.id)
    if (evidence?.kind !== 'evidence') throw new Error('Missing native evidence')
    expect(evidence.value.incomplete).toBe(false)
    expect(JSON.parse((await controller.artifacts.read(evidence.value.artifact)).toString())).toMatchObject({
      stdout: 'native result 42' + (process.platform === 'win32' ? '\r\n' : '\n'), exitCode: 0, timedOut: false, cancelled: false, signal: null })
    const waiting = await prepare('from pathlib import Path\nimport time\nPath("started.txt").write_text("ready")\nwhile True: time.sleep(1)\n')
    await send({ kind: 'approve', planId: waiting.id })
    const running = controller.execute(agent.id, waiting.id, randomUUID(), controller.view(agent.id).revision, 'native-stop', new AbortController().signal)
    const settled = running.catch((error: unknown) => error)
    try {
      await vi.waitFor(async () => { expect(await readFile(join(root, 'started.txt'), 'utf8')).toBe('ready') }, { timeout: 15000 })
    } finally { await send({ kind: 'stop' }) }
    expect(await settled).toBeInstanceOf(Error)
    expect(controller.view(agent.id).records.some(item => item.kind === 'execution' && item.value.planId === waiting.id && item.value.status === 'interrupted')).toBe(true)
  })
  it.skipIf(!process.env.DSH_SECURITY_TSHARK)('stores offline wireless provider evidence through the Loader and operator Remote', async () => {
    const { ctx, agent, controller } = await load(false, 0, { native: true, installations: [
      { id: 'tshark', command: process.env.DSH_SECURITY_TSHARK!, prefixArgs: [], versionArgs: ['--version'], source: 'Test installation' },
    ] })
    const root = roots[roots.length - 1]!
    if (process.platform === 'win32') {
      const diagnostics = await ctx.securityWorkbench.deviceInventory('local')
      expect(diagnostics.inventory.checkedAt).toBeGreaterThan(0)
      expect(diagnostics.inventory.checks.find(check => check.id === 'tshark')?.status).toBe('available')
      expect(diagnostics.inventory.checks.find(check => check.id === 'capture-validation')?.status).toBe('not-checked')
    }
    const send = operator(controller, agent)
    await send({ kind: 'create', title: 'Wireless capture', objective: 'Inspect an owned recording', environmentIds: ['local'], maxAttempts: 1 })
    const capture = join(root, 'wireless.pcap')
    const original = Buffer.from('d4c3b2a1020004000000000000000000ffff000069000000', 'hex')
    await writeFile(capture, original)
    await send({ kind: 'import', path: capture, label: 'Wireless capture' })
    const asset = controller.view(agent.id).records.find(item => item.kind === 'asset')!
    if (asset.kind !== 'asset' || 'kind' in asset.value) throw new Error('Missing capture')
    const request = { provider: 'packet-capture', operation: 'summary', assetId: asset.value.id,
      environmentId: 'local', parameters: { protocol: 'wifi' }, impact: 'observe' }
    const view = await ctx.securityWorkbench.observe(agent, JSON.stringify(request))
    const evidence = view.records.find(item => item.kind === 'evidence')
    if (evidence?.kind !== 'evidence') throw new Error('Missing evidence')
    expect(evidence.value).toMatchObject({ provider: 'packet-capture', method: 'static', incomplete: false })
    expect(JSON.parse((await controller.artifacts.read(evidence.value.artifact)).toString())).toMatchObject({
      inputSha256: asset.value.artifact.sha256, records: [{ kind: 'capture', matchedFrames: 0 }],
    })
    expect(JSON.parse(await ctx.securityWorkbench.projectArtifact(asset.value.engagementId, asset.value.artifact.sha256)))
      .toMatchObject({ binary: true, text: '', size: original.length })
    expect(await readFile(capture)).toEqual(original)
    await expect(ctx.securityWorkbench.observe(agent, JSON.stringify({ ...request, assetId: 'foreign' }))).rejects.toThrow('scope')
    await expect(ctx.securityWorkbench.observe(agent, JSON.stringify({ ...request, parameters: { protocol: 'wifi', interface: 'COM7' } }))).rejects.toThrow()
    await send({ kind: 'stop' })
    await expect(ctx.securityWorkbench.observe(agent, JSON.stringify(request))).rejects.toThrow('stopped')
  }, 30000)
  it('retains cached interfaces after failed checks and removes disappeared devices after a successful check', async () => {
    const { ctx, controller } = await load()
    const directory = ctx.securityWorkbench.deviceDirectory('local')
    expect(directory.inventory.checkedAt).toBe(0)
    const environment = controller.options.environments[0]!
    const devices = captureInterfaces('1. nrf_sniffer_ble_COM8 (nRF Sniffer for Bluetooth LE)')
    const measured = { ...uncheckedDevices(environment), devices, checkedAt: 100 }
    const inspect = vi.spyOn(controller.environments.get('local').manager, 'devices').mockResolvedValueOnce(measured)
    try {
      await ctx.securityWorkbench.deviceInventory('local')
      inspect.mockResolvedValueOnce({ ...uncheckedDevices(environment), checkedAt: 200,
        checks: [{ id: 'capture-interfaces', status: 'error', detail: 'Access denied' }] })
      expect((await ctx.securityWorkbench.deviceInventory('local')).inventory).toMatchObject({ checkedAt: 200, devices })
      inspect.mockRejectedValueOnce(new Error('cancelled'))
      await expect(ctx.securityWorkbench.deviceInventory('local')).rejects.toThrow('cancelled')
      expect(ctx.securityWorkbench.deviceDirectory('local').inventory.devices).toEqual(devices)
      inspect.mockResolvedValueOnce({ ...uncheckedDevices(environment), checkedAt: 300,
        checks: [{ id: 'capture-interfaces', status: 'missing', detail: '' }] })
      expect((await ctx.securityWorkbench.deviceInventory('local')).inventory.devices).toEqual([])
    } finally { inspect.mockRestore() }
  })
  it('records rejected provider requests as failed and unverified without claiming execution', async () => {
    const { ctx, agent, controller } = await load()
    await operator(controller, agent)({ kind: 'create', title: 'Rejected request', objective: 'Inspect fixture',
      environmentIds: ['local'], maxAttempts: 1 })
    const project = controller.binding(agent.id)!.engagementId
    const revision = controller.view(agent.id).revision
    const args = { provider: 'source', operation: 'read', assetId: 'missing', environmentId: 'local', parameters: '{}' }
    expect((await execute(ctx, agent, 'security_static', args)).isError).toBe(true)
    expect((await execute(ctx, agent, 'security_static', args)).isError).toBe(true)
    expect(controller.activity!.usage(project)).toMatchObject([{ tool: 'source', verified: false, total: 1, failed: 1 }])
    expect(controller.view(agent.id).revision).toBe(revision)
  })
  it('loads task-specific definitions on demand without injecting paths or unrelated guides', async () => {
    const installations = [{ id: 'radare2', command: '/tools/radare2', prefixArgs: ['--fixture'],
      versionArgs: ['-v'], source: 'Fixture configuration' }]
    const { ctx, agent, model, controller } = await load(false, 0, { installations })
    await operator(controller, agent)({ kind: 'create', title: 'Binary analysis', objective: 'Inspect an owned ELF',
      environmentIds: ['local'], maxAttempts: 2 })
    agent.followup(webPrompt('Inspect the supplied native binary.'))
    await agent.whenIdle()
    const request = JSON.stringify(model.requests[0])
    expect(request).toContain('query security_capabilities')
    expect(request).toContain('Prefer native machine-readable results')
    expect(request).toContain('observed contents of all relevant materials')
    expect(request).toContain('User preferences are soft priorities, not exclusions')
    expect(request).not.toContain('/tools/radare2')
    expect(request).not.toContain('USBPcapCMD.exe')
    expect(request).not.toContain('pdgj')
    expect(request).not.toContain('rcTemplate')
    const result = await execute(ctx, agent, 'security_capabilities', { toolIds: ['radare2'], details: true })
    expect(result.isError).toBe(false)
    expect(JSON.stringify(result)).toContain('prefer available radare2/r2')
    expect(JSON.stringify(result)).not.toContain('USBPcapCMD.exe')
    const web = await execute(ctx, agent, 'security_capabilities', { collectionIds: ['web'] })
    expect(JSON.stringify(web.value)).toContain('nuclei')
    expect(JSON.stringify(web.value)).not.toContain('radare2')
    expect(JSON.stringify(web.value)).not.toContain('Prefer native XML')
    expect(JSON.stringify(web.value)).not.toContain('rcTemplate')
    for (const query of ['IoT', '物联网', 'MQTT', 'pcapng', 'BLE', 'Wi-Fi']) {
      const discovered = await execute(ctx, agent, 'security_capabilities', { query })
      expect(discovered.isError).toBe(false)
      const value = JSON.parse(discovered.content.filter(block => block.type === 'text').map(block => block.text).join('')) as {
        catalog: { id: string; skills: string[] }[]
      }
      const tshark = value.catalog.find(tool => tool.id === 'tshark')
      expect(tshark?.skills).toEqual(['security-packet-analysis', 'security-mqtt', 'security-iot-offline'])
      expect(JSON.stringify(value)).not.toContain('USBPcapCMD.exe')
    }
    for (const id of ['radare2', 'r2ghidra', 'r2pipe', 'unicorn', 'frida', 'jadx', 'adb', 'curl', 'nmap', 'nuclei', 'metasploit', 'tshark', 'file', 'strings', 'readelf', 'objdump', 'nm']) {
      const detail = await execute(ctx, agent, 'security_capabilities', { toolIds: [id], details: true })
      expect(detail.isError).toBe(false)
      const { catalog } = JSON.parse(detail.content.filter(block => block.type === 'text').map(block => block.text).join('')) as { catalog: { id: string; guide: string }[] }
      expect(catalog.map(({ id, guide }) => ({ id, guide }))).toMatchSnapshot(id)
      if (id === 'metasploit') {
        const template = catalog[0]?.guide.match(/```json\n([\s\S]*?)\n```/u)?.[1]
        expect(template).toBeDefined()
        expect(JSON.parse(template!)).toMatchObject({
          recipe: { toolId: 'metasploit', module: null, options: [{ name: null, value: null, reason: null }] },
          binding: { environmentId: null, command: null, prefixArgs: [], containerId: null, targetOptions: {} },
          result: { exitCode: null, timedOut: null, negativeControl: { status: 'not-run' }, files: [{ path: null, sha256: null }] },
        })
      }
    }
    ctx.securityWorkbench.toolPreferences(agent, JSON.stringify({ toolIds: ['radare2'], tags: [], collectionIds: [] }))
    const scope = scopeOf(agent.ctx)
    if (!scope) throw new Error('Expected an agent scope')
    const assembly = await ctx.systemPrompt.assemble({ agent, scope })
    expect(JSON.stringify(assembly.contexts)).toContain('radare2')
    expect(JSON.stringify(assembly.contexts)).not.toContain('/tools/radare2')
    const other = await ctx.agents.create({ sessionId: SessionId('other-tool-preferences') })
    expect(ctx.securityWorkbench.toolPreferences(other.agent).toolIds).toEqual([])
    ctx.securityWorkbench.toolPreferences(other.agent, JSON.stringify({ toolIds: ['tshark'], tags: [], collectionIds: [] }))
    await other.dispose()
    expect(ctx.securityWorkbench.toolPreferences(other.agent).toolIds).toEqual([])
    expect(ctx.securityWorkbench.toolPreferences(agent).toolIds).toEqual(['radare2'])
    ctx.securityWorkbench.toolPreferences(agent, JSON.stringify({ toolIds: [], tags: [], collectionIds: [] }))
    expect(ctx.securityWorkbench.toolPreferences(agent)).toEqual({ toolIds: [], tags: [], collectionIds: [] })
  })
  it('runs generated scripts and relative outputs in the analysis directory and captures the execution log', async () => {
    const { ctx, agent, model, controller } = await load(false, 0, { native: true })
    const root = roots[roots.length - 1]!
    const send = operator(controller, agent)
    await send({ kind: 'create', title: 'Scripts', objective: 'Analyze an owned sample', environmentIds: ['local'], maxAttempts: 2 })
    await writeFile(join(root, 'sample.bin'), 'owned fixture')
    await send({ kind: 'import', path: join(root, 'sample.bin'), label: 'sample' })
    const asset = controller.view(agent.id).records.find(item => item.kind === 'asset')!
    if (asset.kind !== 'asset') throw new Error('Missing asset')
    const python = process.env.DSH_SECURITY_NATIVE_PYTHON
    const capabilities = await execute(ctx, agent, 'security_capabilities')
    expect(capabilities.isError).toBe(false)
    const { analysisDirectory: directory } = JSON.parse(capabilities.content.filter(block => block.type === 'text').map(block => block.text).join('')) as { analysisDirectory: string | null }
    if (!directory) throw new Error('Missing analysis directory')
    expect(directory.startsWith(join(root, '.dsh', 'analysis') + (process.platform === 'win32' ? '\\' : '/'))).toBe(true)
    const before = await readdir(root)
    const script = join(directory, 'scripts', python ? 'analysis.py' : 'analysis.cjs')
    const inputPath = JSON.stringify(join(root, 'sample.bin'))
    const content = python
      ? 'from pathlib import Path\nassert Path(' + inputPath + ').read_text() == "owned fixture"\nPath("outputs").mkdir()\nPath("tmp").mkdir()\nPath("outputs/result.txt").write_text(str(6 * 6))\nPath("tmp/input.txt").write_text("owned fixture")\nprint(Path("outputs/result.txt").read_text())\n'
      : 'const fs = require("node:fs")\nif (fs.readFileSync(' + inputPath + ', "utf8") !== "owned fixture") throw new Error("Missing input")\nfs.mkdirSync("outputs")\nfs.mkdirSync("tmp")\nfs.writeFileSync("outputs/result.txt", String(6 * 6))\nfs.writeFileSync("tmp/input.txt", "owned fixture")\nconsole.log(fs.readFileSync("outputs/result.txt", "utf8"))\n'
    const executable = python ?? process.execPath
    const quote = (value: string) => "'" + value.replaceAll("'", process.platform === 'win32' ? "''" : "'\\''") + "'"
    let capturedCallId: string | undefined
    model.nativeCallId = () => randomUUID()
    model.nativeCalls = [
      { name: 'security_capabilities', args: {} },
      { name: 'write', args: { file_path: script, content } },
      { name: 'edit', args: { file_path: script, old_string: '6 * 6', new_string: '6 * 7' } },
      { name: process.platform === 'win32' ? 'pwsh' : 'bash', args: { command: (process.platform === 'win32' ? '& ' : '') + quote(executable) + ' ' + quote(script), description: 'Run the owned analysis script', workdir: directory } },
      { name: 'security_capture_analysis', args: { assetId: asset.value.id } },
      { name: 'security_capture_analysis', args: (request) => {
        const message = request.messages.at(-1)
        if (message?.role !== 'tool' || message.content[0]?.type !== 'text') throw new Error('Missing call list')
        const page = JSON.parse(message.content[0].text) as { calls: { callId: string }[] }
        expect(page.calls).toHaveLength(1)
        capturedCallId = page.calls[0]!.callId
        return { assetId: asset.value.id, callIds: [capturedCallId] }
      } },
    ]
    agent.followup(webPrompt('Write and run an analysis script, then save its evidence.'))
    await agent.whenIdle()
    const evidence = controller.view(agent.id).records.find(item => item.kind === 'evidence' && item.value.provider === 'session-tool')
    expect(evidence?.kind).toBe('evidence')
    if (evidence?.kind !== 'evidence') throw new Error('Missing script evidence')
    expect((await controller.artifacts.read(evidence.value.artifact)).toString()).toContain('42')
    expect(await readFile(join(directory, 'outputs', 'result.txt'), 'utf8')).toBe('42')
    const activityProject = controller.binding(agent.id)!.engagementId
    expect(controller.activity!.usage(activityProject)).toEqual([
      expect.objectContaining({ tool: 'script', verified: false, total: 1, completed: 1 }),
    ])
    expect(controller.activity!.page(activityProject, '', 0, 10).items[0]?.evidenceIds).toEqual([evidence.value.id])
    const checkpoint = { kind: 'checkpoint' as const, phase: 'recon' as const, title: 'Script result',
      reason: 'Inspect the saved script output', summary: 'The fixture returned 42', next: 'Review the recorded output',
      evidenceIds: [evidence.value.id], findingIds: [] }
    await expect(send({ ...checkpoint, evidenceIds: ['foreign'] })).rejects.toThrow('foreign')
    expect(controller.activity!.page(activityProject, '', 0, 10).items).toHaveLength(1)
    await send(checkpoint)
    const checkpointId = controller.checkpointId(agent.id)
    expect(controller.activity!.page(activityProject, '', 0, 10).items).toHaveLength(0)
    expect(controller.activity!.page(activityProject, checkpointId, 0, 10).items[0])
      .toMatchObject({ callId: capturedCallId, status: 'completed', evidenceIds: [evidence.value.id] })
    expect(controller.view(agent.id).records.some(item => item.kind === 'finding')).toBe(false)
    expect(await readFile(join(directory, 'tmp', 'input.txt'), 'utf8')).toBe('owned fixture')
    expect((await readdir(root)).filter(name => !before.includes(name))).toEqual(['.dsh'])
    expect(JSON.stringify(model.requests[1]!.messages)).toContain('analysisDirectory')
    expect(ctx.tools.schemas().some(tool => tool.name === 'write')).toBe(false)
    expect(ctx.tools.schemas(agent).some(tool => tool.name === 'write')).toBe(true)
    const revision = controller.view(agent.id).revision
    const listed = await execute(ctx, agent, 'security_capture_analysis', { assetId: asset.value.id })
    expect(listed.isError).toBe(false)
    expect(controller.view(agent.id).revision).toBe(revision)
    expect((await execute(ctx, agent, 'security_capture_analysis', { assetId: 'foreign' })).isError).toBe(true)
    expect((await execute(ctx, agent, 'security_capture_analysis', { assetId: asset.value.id, offset: -1 })).isError).toBe(true)
    expect((await execute(ctx, agent, 'security_capture_analysis', {
      assetId: asset.value.id, callIds: [capturedCallId], jobId: 'pwsh-13',
    })).isError).toBe(true)
    await send({ kind: 'stop' })
    expect((await execute(ctx, agent, 'security_capture_analysis', { assetId: asset.value.id })).isError).toBe(true)
    expect((await execute(ctx, agent, process.platform === 'win32' ? 'pwsh' : 'bash', { command: 'echo blocked', description: 'Attempt stopped analysis' })).isError).toBe(true)
  })
  it.skipIf(!process.env.DSH_SECURITY_TSHARK)('loads a bundled capture method, executes its installed script and captures evidence', async () => {
    const { ctx, agent, model, controller } = await load(false, 0, { native: true, skills: true })
    const root = roots[roots.length - 1]!
    const send = operator(controller, agent)
    await send({ kind: 'create', title: 'Capture library', objective: 'Inspect an owned empty capture', environmentIds: ['local'], maxAttempts: 2 })
    const capture = join(root, 'owned capture.pcap')
    await writeFile(capture, Buffer.from('d4c3b2a1020004000000000000000000ffff000001000000', 'hex'))
    await send({ kind: 'import', path: capture, label: 'capture' })
    const asset = controller.view(agent.id).records.find(item => item.kind === 'asset')!
    if (asset.kind !== 'asset') throw new Error('Missing capture asset')
    const capabilities = await execute(ctx, agent, 'security_capabilities')
    const { analysisDirectory: directory } = JSON.parse(capabilities.content.filter(block => block.type === 'text').map(block => block.text).join('')) as { analysisDirectory: string }
    await mkdir(join(directory, 'outputs'), { recursive: true })
    const script = ctx.securityWorkbench.scriptCatalog().find(item => item.kind === 'captureSummary')!
    const python = process.env.DSH_SECURITY_SCRIPT_PYTHON ?? (process.platform === 'win32' ? 'python' : 'python3')
    const output = join(directory, 'outputs', 'capture.json')
    const quote = (value: string) => "'" + value.replaceAll("'", process.platform === 'win32' ? "''" : "'\\''") + "'"
    const argv = [python, script.path, '--input', capture, '--output', output, '--tshark', process.env.DSH_SECURITY_TSHARK!,
      '--timeout', '10', '--max-packets', '100', '--max-output-bytes', '4096', '--max-decode-bytes', '65536']
    model.nativeCallId = () => randomUUID()
    model.nativeCalls = [
      { name: 'skill', args: { name: script.skill } },
      { name: process.platform === 'win32' ? 'pwsh' : 'bash', args: {
        command: (process.platform === 'win32' ? '& ' : '') + argv.map(quote).join(' '), workdir: directory, description: 'Analyze the owned capture with the bundled script',
      } },
      { name: 'security_capture_analysis', args: { assetId: asset.value.id } },
      { name: 'security_capture_analysis', args: (request) => {
        const message = request.messages.at(-1)
        if (message?.role !== 'tool' || message.content[0]?.type !== 'text') throw new Error('Missing call listing')
        const page = JSON.parse(message.content[0].text) as { calls: { callId: string }[] }
        return { assetId: asset.value.id, callIds: page.calls.map(call => call.callId) }
      } },
    ]
    agent.followup(webPrompt('Use the bundled script to inspect this capture and save its evidence.'))
    await agent.whenIdle()
    expect(JSON.parse(await readFile(output, 'utf8'))).toMatchObject({ scriptId: script.id, records: [{ kind: 'capture', frames: 0 }] })
    const evidence = controller.view(agent.id).records.find(item => item.kind === 'evidence' && item.value.provider === 'session-tool')
    if (evidence?.kind !== 'evidence') throw new Error('Missing bundled script evidence')
    expect((await controller.artifacts.read(evidence.value.artifact)).toString()).toContain('tshark.capture-summary')
    expect(agent.session.snapshotEvents().some(event => event.type === 'tool/call' && ['write', 'edit'].includes(event.data.name))).toBe(false)
  })
  it('persists scoped child evidence reports without requiring or creating a finding review', async () => {
    const { ctx, agent, controller, model } = await load(true, 0, { native: true })
    expect(ctx.tools.schemas().some(tool => tool.name === 'job_output')).toBe(false)
    expect(ctx.tools.get('job_output', agent)).toBeDefined()
    ctx.jobs.attachController('security-test')
    ctx.effect(() => ctx.subagents.registerProvider({
      name: 'spawn', inheritsParentContext: false,
      capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
      start: request => startInProcessRun(request, {}),
    }))
    const root = roots[roots.length - 1]!
    await writeFile(join(root, 'delegation.bin'), 'owned sample')
    const send = operator(controller, agent)
    await send({ kind: 'create', title: 'Delegation', objective: 'Review owned fixture', environmentIds: ['local'], maxAttempts: 2 })
    await send({ kind: 'import', path: join(root, 'delegation.bin'), label: 'sample' })
    const asset = controller.view(agent.id).records.find(item => item.kind === 'asset')!
    if (asset.kind !== 'asset') throw new Error('Missing asset')
    const evidence = await controller.observe(agent.id, { provider: 'binary', operation: 'hex', assetId: asset.value.id,
      environmentId: 'local', parameters: {}, impact: 'observe' }, 'delegation-evidence', new AbortController().signal)
    if (evidence.kind !== 'evidence') throw new Error('Missing evidence')
    model.childReport = { summary: 'Assigned evidence review completed.', evidenceIds: [evidence.value.id],
      uncertainty: 'No candidate finding exists; this evidence assessment does not conclude a finding.',
      nextSteps: ['The coordinator can record a suspected finding if the evidence supports a candidate.'] }
    expect(controller.view(agent.id).records.filter(item => item.kind === 'finding' || item.kind === 'review')).toEqual([])
    ctx.securityWorkbench.toolPreferences(agent, JSON.stringify({ toolIds: ['radare2'], tags: [], collectionIds: [] }))
    for (const role of ['reconnaissance', 'reviewer'] as const) {
      const result = await execute(ctx, agent, 'security_delegate', {
        assetId: asset.value.id, role, question: 'Inspect the assigned scope.', criterion: 'Return a scoped structured report.',
      }, 'delegation-' + role)
      expect(result.isError, JSON.stringify(result)).toBe(false)
      const { jobId } = JSON.parse(result.content.filter(block => block.type === 'text').map(block => block.text).join('')) as { jobId: string }
      const job = await ctx.jobs.wait(JobId(jobId), 10000, agent.id)
      expect(job.status, JSON.stringify(job)).toBe('completed')
      expect(ctx.jobs.read(JobId(jobId), agent.id).result).toContain('Assigned evidence review completed.')
      expect(controller.view(agent.id).records.filter(item => item.kind === 'delegation').filter(item => item.value.role === role)
        .map(item => item.value.report)).toContainEqual(model.childReport)
      expect(controller.view(agent.id).records.filter(item => item.kind === 'finding' || item.kind === 'review')).toEqual([])
      const child = model.requests.at(-1)!
      expect(JSON.stringify(child.messages)).toContain('Operator tool preferences for this active session')
      expect(JSON.stringify(child.messages)).toContain('radare2')
      const names = child.tools?.map(tool => tool.name)
      expect(names).toContain('structured_output')
      expect(names?.includes('write')).toBe(role === 'reconnaissance')
      expect(names?.includes(process.platform === 'win32' ? 'pwsh' : 'bash')).toBe(role === 'reconnaissance')
      expect(names?.includes('security_review')).toBe(role === 'reviewer')
      expect(names).not.toContain('shell')
      expect(names).not.toContain('security_execute')
      expect(names).not.toContain('security_delegate')
    }
  })

  it.each([false, true])('cancels native processes on project stop or archive (background=%s)', async (background) => {
    const { ctx, agent, controller } = await load(false, 0, { native: true })
    ctx.jobs.attachController('native-test')
    const root = roots[roots.length - 1]!
    const send = operator(controller, agent)
    await send({ kind: 'create', title: 'Cancellation', objective: 'Own a process', environmentIds: ['local'], maxAttempts: 1 })
    const script = join(root, 'wait.cjs')
    const ready = join(root, 'ready.txt')
    await writeFile(script, `require('node:fs').writeFileSync(${JSON.stringify(ready)}, 'ready'); setInterval(() => {}, 1000);`)
    const quote = (value: string) => "'" + value.replaceAll("'", process.platform === 'win32' ? "''" : "'\\''") + "'"
    const name = process.platform === 'win32' ? 'pwsh' : 'bash'
    const running = execute(ctx, agent, name, { command: (process.platform === 'win32' ? '& ' : '') + quote(process.execPath) + ' ' + quote(script),
      description: 'Wait in the owned fixture', run_in_background: background })
    await vi.waitFor(async () => { expect(await readFile(ready, 'utf8')).toBe('ready') }, { timeout: 10_000 })
    const projectId = controller.binding(agent.id)!.engagementId
    expect(controller.activity!.usage(projectId)).toMatchObject([{ total: 1, running: 1, completed: 0 }])
    if (background) {
      expect((await running).isError).toBe(false)
      const project = controller.binding(agent.id)!.engagementId
      await controller.manageProject(project, { operationId: 'archive-native', expectedRevision: controller.view(agent.id).revision, action: { kind: 'archive' } })
      expect(ctx.jobs.list(agent.id).every(job => job.status !== 'running' && job.status !== 'stopping')).toBe(true)
    } else await send({ kind: 'stop' })
    await running
    expect(controller.activity!.usage(projectId)).toMatchObject([{ total: 1, running: 0, cancelled: 1 }])
    if (background) {
      const job = ctx.jobs.list(agent.id)[0]!
      expect((await execute(ctx, agent, 'job_output', { job_id: job.id })).isError).toBe(false)
      expect(controller.activity!.usage(projectId)).toMatchObject([{ total: 1, cancelled: 1 }])
    }
    expect((await execute(ctx, agent, name, { command: 'echo blocked', description: 'Try stopped execution' })).isError).toBe(true)
  })

  it('returns one requested command envelope while preserving full help and rejecting unknown actions', async () => {
    const { ctx, agent } = await load()
    const selected = await execute(ctx, agent, 'security_help', { action: 'check' })
    expect(selected.isError, JSON.stringify(selected)).toBe(false)
    const schema: unknown = JSON.parse(selected.content.filter(block => block.type === 'text').map(block => block.text).join(''))
    expect(schema).toMatchObject({
      type: 'object', required: ['operationId', 'expectedRevision', 'action'], additionalProperties: false,
      properties: {
        operationId: { type: 'string', minLength: 1 },
        expectedRevision: { type: 'integer', minimum: 0 },
        action: { required: ['kind', 'check'], additionalProperties: false, properties: {
          kind: { const: 'check' },
          check: { required: ['assetId', 'title', 'phase', 'criterion', 'dependencies', 'evidenceIds'],
            properties: { assetId: { type: 'string' }, evidenceIds: { type: 'array', items: { type: 'string' } } } },
        } },
      },
    })
    expect(schema).not.toHaveProperty('properties.action.oneOf')
    expect(schema).not.toHaveProperty('properties.action.properties.path')
    expect(schema).not.toHaveProperty('properties.action.properties.finding')
    const plan = await execute(ctx, agent, 'security_help', { action: 'plan' })
    expect(plan.isError, JSON.stringify(plan)).toBe(false)
    const planSchema: unknown = JSON.parse(plan.content.filter(block => block.type === 'text').map(block => block.text).join(''))
    expect(planSchema).toHaveProperty('properties.action.properties.kind.const', 'plan')
    expect(planSchema).toHaveProperty('$defs')
    const full = await execute(ctx, agent, 'security_help')
    expect(full.isError, JSON.stringify(full)).toBe(false)
    const fullSchema: unknown = JSON.parse(full.content.filter(block => block.type === 'text').map(block => block.text).join(''))
    expect(fullSchema).toHaveProperty('properties.action.oneOf')
    const unknown = await execute(ctx, agent, 'security_help', { action: 'not-a-command' })
    expect(unknown.isError).toBe(true)
    expect(JSON.stringify(unknown)).toContain('Unknown security command action: not-a-command')
  })
  it('loads independent providers and logs model-visible scope through the unchanged loop', async () => {
    const { ctx, agent, controller, model } = await load()
    expect(controller.providers.list().sort()).toEqual(['android', 'binary', 'external-web', 'frida', 'ghidra', 'native', 'offline', 'packet-capture', 'source', 'web'])
    expect(controller.environments.list()).toEqual(['local'])
    agent.followup(
      createUserMessage({ content: [{ type: 'text', text: 'Inspect the scope.' }], source: { kind: 'user' } }),
    )
    await agent.whenIdle()
    expect(model.requests).toHaveLength(2)
    expect(model.requests[0]?.tools?.map(tool => tool.name)).not.toContain('shell')
    expect(agent.session.snapshotEvents().some(event => event.type === 'tool/result')).toBe(true)
    expect((await execute(ctx, agent, 'security_help')).isError).toBe(false)
  })
  it('registers a site through task intake, executes one approved HTTP plan and serves redacted evidence through the Host readers', async () => {
    const server = createServer((request, response) => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ reflected: request.headers.authorization })) })
    onTestFinished(async () => { server.closeAllConnections()
      if (server.listening) await new Promise<void>((resolve, reject) =>
        server.close((error) =>{  if (error) reject(error)
        else resolve() })) })
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing listener')
    const { ctx, agent, controller, model: reportModel } = await load()
    const view = await ctx.securityWorkbench.importMaterials(agent, JSON.stringify({ operationId: 'http-task', expectedRevision: 0,
      title: 'Owned HTTP target', objective: 'Compare authorized identity', resources: { environmentIds: ['local'], maxAttempts: 3 },
      target: { label: 'Fixture', environmentId: 'local', origin: `http://127.0.0.1:${address.port}`, pathPrefix: '/', allowedAddresses: ['127.0.0.1'] } }))
    const target = view.records.find(item => item.kind === 'asset')!; const project = controller.projects()[0]!
    const identity = await ctx.securityWorkbench.configureHttpIdentity(project.id, target.value.id, JSON.stringify({ label: 'Reader', mode: 'bearer', secrets: { token: 'private-http-token' } }))
    expect(JSON.stringify(await ctx.securityWorkbench.httpIdentities(project.id, target.value.id))).not.toContain('private-http-token')
    const send = operator(controller, agent)
    await send({ kind: 'check', check: { assetId: target.value.id, title: 'HTTP', phase: 'validation', criterion: 'Read one response', dependencies: [], evidenceIds: [] } })
    const check = controller.view(agent.id).records.find(item => item.kind === 'check')!
    await send({ kind: 'plan', checkId: check.value.id, hypothesis: 'Authorized response', expectedObservation: '200', impact: 'Read', cleanup: 'Close', durationMs: 5000,
      operation: { provider: 'external-web', operation: 'sequence', environmentId: 'local', assetId: target.value.id, impact: 'observe', parameters: { steps: [{ id: 'read', label: 'Read', method: 'GET', path: '/', identityId: identity.id }] } } })
    const plan = controller.view(agent.id).records.find(item => item.kind === 'plan')!
    await send({ kind: 'approve', planId: plan.value.id })
    await ctx.securityWorkbench.execute(agent, plan.value.id, 'http-execute', controller.view(agent.id).revision)
    const history = await ctx.securityWorkbench.httpHistory(project.id, '{}')
    expect(history.items).toHaveLength(1); expect(history.items[0]?.status).toBe(200)
    const evidenceId = history.items[0]!.evidenceId
    const body = await ctx.securityWorkbench.httpExchange(project.id, evidenceId, 'read', 'body', 0)
    expect(body.text).toContain('[redacted]'); expect(body.text).not.toContain('private-http-token')
    const model = await execute(ctx, agent, 'security_evidence', { evidenceId, stepId: 'read', part: 'body' })
    expect(model.isError).not.toBe(true); expect(JSON.stringify(model)).not.toContain('private-http-token')
    expect(JSON.stringify(controller.view(agent.id))).not.toContain('private-http-token')
    await send({ kind: 'finding', finding: { assetId: target.value.id, title: 'Authorized response observation',
      explanation: 'The owned fixture returned the approved response.', conditions: 'Registered test identity',
      evidenceIds: [evidenceId], status: 'suspected', review: '' } })
    const originalFinding = controller.view(agent.id).records.find(item => item.kind === 'finding')
    if (originalFinding?.kind !== 'finding') throw new Error('Missing HTTP finding')
    await send({ kind: 'finding-http-reference', findingId: originalFinding.value.id,
      evidenceId, stepId: 'read', role: 'verification' })
    const finding = controller.view(agent.id).records.find(item => item.kind === 'finding')
    if (finding?.kind !== 'finding') throw new Error('Missing linked finding')
    expect(finding.value.status).toBe('suspected')
    await bindDelegatedChild(controller, agent.id, 'http-reviewer', target.value.id, 'reviewer')
    const reviewed = await controller.review('http-reviewer', { findingId: finding.value.id,
      findingHash: findingHash(finding.value), basis: 'runtime', verdict: 'confirmed',
      supportingEvidenceIds: [evidenceId], opposingEvidenceIds: [], explanation: 'Independent observation review', uncertainty: '' })
    const review = reviewed.records.findLast(item => item.kind === 'review')
    if (review?.kind !== 'review') throw new Error('Missing independent HTTP review')
    await send({ kind: 'conclude', reviewId: review.value.id })
    reportModel.reportOutput = () => JSON.stringify({ assessment: 'The approved observation was independently reviewed.',
      findings: [{ index: 0, mechanism: 'Authorized response', conditions: 'Owned test identity', impact: 'Observation only',
        location: '/', fix: 'No application change requested' }], excludedIndices: [], lessons: [], uncovered: ['Other application routes'] })
    await send({ kind: 'report' })
    const report = controller.view(agent.id).records.findLast(item => item.kind === 'report')
    if (report?.kind !== 'report') throw new Error('Missing HTTP report')
    const exported = (await controller.artifacts.read(report.value.json)).toString()
    expect(exported).toContain('httpReferences')
    expect(exported).not.toContain('private-http-token')
    await expect(ctx.securityWorkbench.httpExchange(project.id, 'foreign', 'read', 'body', 0)).rejects.toThrow('scope')
    const abort = new AbortController(); const directory = ctx.securityWorkbench.followProjects(abort.signal)[Symbol.asyncIterator]()
    const directoryPage = await directory.next()
    if (directoryPage.done) throw new Error('Directory ended before its first snapshot')
    expect(directoryPage.value[0]?.pendingPlanIds).toEqual([])
    const pending = directory.next(); abort.abort(); expect((await pending).done).toBe(true)
  })
  it('creates a workspace task from the Web prompt and logs its scope without granting model authority', async () => {
    const { ctx, agent, controller, model } = await load(false, 0, { taskIntake: 'current', skills: true })
    const objective = 'Check this Web application for authorization failures.'
    agent.followup(webPrompt(objective))
    await agent.whenIdle()
    expect(controller.projects()).toHaveLength(1)
    const project = controller.projects()[0]!
    expect(project).toMatchObject({ title: objective, objective, environmentIds: ['local'], maxAttempts: 3 })
    expect(controller.binding(agent.id)?.engagementId).toBe(project.id)
    const scope = agent.session.snapshotEvents().find(event => event.type === 'tool/result')
    if (scope?.type !== 'tool/result') throw new Error('Missing scope result')
    expect(scope.data.message.isError).not.toBe(true)
    expect(JSON.stringify(scope.data.message)).toContain(objective)
    expect(model.requests[1]?.messages).toContainEqual(scope.data.message)
    for (const action of [
      { kind: 'create', title: 'Model project', objective: 'Widen scope', environmentIds: ['local'], maxAttempts: 3 },
      { kind: 'approve', planId: 'model-plan' },
    ]) {
      const denied = await execute(ctx, agent, 'security_command', {
        command: JSON.stringify({ operationId: 'model-' + action.kind,
          expectedRevision: controller.view(agent.id).revision, action }),
      })
      expect(denied.isError).toBe(true)
      expect(JSON.stringify(denied)).toContain('operator')
    }
    agent.followup(webPrompt('Focus on administrator-only routes.'))
    await agent.whenIdle()
    expect(controller.projects()).toEqual([project])
    await operator(controller, agent)({ kind: 'leave' })
    agent.followup(webPrompt('Continue discussing the supplied material.'))
    await agent.whenIdle()
    expect(controller.binding(agent.id)).toBeUndefined()
    expect(controller.projects()).toEqual([project])
  })

  it.each([false, true])('prepares an explicit analysis without workspace setup (material: %s)', async (withMaterial) => {
    const { ctx, agent, controller } = await load(false, 1)
    const objective = 'Explain the supplied code without executing it.'
    const input = JSON.stringify({ operationId: 'explicit-analysis', expectedRevision: controller.view(agent.id).revision,
      title: 'Sample analysis', objective, resources: { environmentIds: ['local'], maxAttempts: 3 },
      ...(withMaterial ? { material: { kind: 'text', name: 'sample.py', text: 'print(42)' } } : {}) })
    const prepared = await ctx.securityWorkbench.importMaterials(agent, input)
    expect(await ctx.securityWorkbench.importMaterials(agent, input)).toEqual(prepared)
    expect(controller.projects()).toHaveLength(1)
    expect(prepared.records.filter(item => item.kind === 'asset')).toHaveLength(withMaterial ? 1 : 0)
    agent.followup(webPrompt(objective))
    await agent.whenIdle()
    expect(controller.projects()).toHaveLength(1)
    const result = agent.session.snapshotEvents().find(event => event.type === 'tool/result')
    expect(JSON.stringify(result)).toContain('Sample analysis')
    expect(agent.session.snapshotEvents().filter(event => event.type === 'user/message')
      .some(event => JSON.stringify(event).includes(objective))).toBe(true)
    expect(controller.projects()[0]).toMatchObject({ title: 'Sample analysis', objective, environmentIds: ['local'] })
    expect(await ctx.securityWorkbench.configuration(agent)).toMatchObject({ workspace: { configured: false } })
  })

  it('rejects an unknown environment before creating an explicit task', async () => {
    const { ctx, agent, controller } = await load(false, 0)
    await expect(ctx.securityWorkbench.importMaterials(agent, JSON.stringify({ operationId: 'invalid-environment',
      expectedRevision: controller.view(agent.id).revision, title: 'Sample', objective: 'Inspect sample',
      resources: { environmentIds: ['unknown'], maxAttempts: 3 },
    }))).rejects.toThrow('Unknown environment')
    expect(controller.projects()).toEqual([])
  })

  it.each(['disabled', 'unmapped'] as const)('starts a task after saving resources for a %s workspace', async (mapping) => {
    const { ctx, agent, controller, model } = await load(false, 0, mapping === 'unmapped' ? { taskIntake: 'other' } : {})
    expect(await ctx.securityWorkbench.configuration(agent)).toMatchObject({
      workspace: { cwd: agent.session.header.cwd, configured: false, revision: 0, environmentIds: [] },
    })
    agent.followup(webPrompt('Inspect the current workspace.'))
    await agent.whenIdle()
    expect(controller.projects()).toEqual([])
    expect(controller.binding(agent.id)).toBeUndefined()
    const saved = await ctx.securityWorkbench.configureWorkspace(agent, JSON.stringify({
      expectedRevision: 0, environmentIds: ['local'], maxAttempts: 5,
    }))
    expect(saved).toMatchObject({
      workspace: { configured: true, revision: 1, environmentIds: ['local'], maxAttempts: 5 },
    })
    expect(controller.projects()).toEqual([])
    model.scopeCalls = model.requests.length + 1
    const objective = 'Check the supplied application for missing authorization.'
    agent.followup(webPrompt(objective))
    await agent.whenIdle()
    expect(controller.projects()).toHaveLength(1)
    expect(controller.projects()[0]).toMatchObject({ objective, environmentIds: ['local'], maxAttempts: 5 })
    expect(controller.binding(agent.id)?.engagementId).toBe(controller.projects()[0]!.id)
    const result = agent.session.snapshotEvents().filter(event => event.type === 'tool/result').at(-1)!
    expect(JSON.stringify(result)).toContain(objective)
  })

  it.each(['current', 'default'] as const)('keeps an empty resource selection disabled with %s intake', async (taskIntake) => {
    const { ctx, agent, controller } = await load(false, 0, { taskIntake })
    expect(await ctx.securityWorkbench.configuration(agent)).toMatchObject({
      workspace: { configured: true, revision: 0, environmentIds: ['local'] },
    })
    const saved = await ctx.securityWorkbench.configureWorkspace(agent, JSON.stringify({
      expectedRevision: 0, environmentIds: [], maxAttempts: 4,
    }))
    expect(saved).toMatchObject({
      workspace: { configured: true, revision: 1, environmentIds: [], maxAttempts: 4 },
    })
    await expect(ctx.securityWorkbench.configureWorkspace(agent, JSON.stringify({
      expectedRevision: 0, environmentIds: ['local'], maxAttempts: 2,
    }))).rejects.toThrow('Workspace resource configuration changed')
    expect(await ctx.securityWorkbench.configuration(agent)).toEqual(saved)
    agent.followup(webPrompt('Inspect the supplied firmware.'))
    await agent.whenIdle()
    expect(controller.projects()).toEqual([])
    expect(controller.binding(agent.id)).toBeUndefined()
  })

  it('admits a chat request outside the launch workspace using only the default resources', async () => {
    const { ctx, agent, controller } = await load(false, 0, { taskIntake: 'default' })
    expect(await ctx.securityWorkbench.configuration(agent)).toMatchObject({
      workspace: { configured: true, environmentIds: ['local'] },
    })
    agent.followup(webPrompt('Inspect ctk-1.4.3.apk with static analysis.'))
    await agent.whenIdle()
    expect(controller.projects()).toHaveLength(1)
    expect(controller.projects()[0]).toMatchObject({ objective: 'Inspect ctk-1.4.3.apk with static analysis.', environmentIds: ['local'] })
    expect(controller.binding(agent.id)?.engagementId).toBe(controller.projects()[0]!.id)
    expect(controller.view(agent.id).records.filter(record => record.kind === 'asset')).toEqual([])
    const capabilities = await execute(ctx, agent, 'security_capabilities')
    expect(JSON.stringify(capabilities)).toContain('local')
    const denied = await execute(ctx, agent, 'security_command', { command: JSON.stringify({
      operationId: 'model-create', expectedRevision: controller.view(agent.id).revision,
      action: { kind: 'create', title: 'Unapproved', objective: 'Unapproved', environmentIds: ['local'], maxAttempts: 3 },
    }) })
    expect(denied.isError).toBe(true)
    expect(controller.projects()).toHaveLength(1)
  })

  it('applies saved resources to future tasks without changing an existing project', async () => {
    const { ctx, agent, controller, model } = await load(false, 0, { taskIntake: 'current' })
    agent.followup(webPrompt('Inspect this application with the selected resources.'))
    await agent.whenIdle()
    const project = controller.projects()[0]!
    expect(project).toMatchObject({ environmentIds: ['local'], maxAttempts: 3 })
    await ctx.securityWorkbench.configureWorkspace(agent, JSON.stringify({
      expectedRevision: 0, environmentIds: [], maxAttempts: 7,
    }))
    expect(controller.projects()).toEqual([project])
    expect(controller.binding(agent.id)?.engagementId).toBe(project.id)
    const { agent: future } = await ctx.agents.create({
      sessionId: SessionId('future-task'),
      meta: { cwd: agent.session.header.cwd! },
      agentOptions: { provider: 'fixture', model: 'fixture' },
    })
    model.scopeCalls = model.requests.length + 1
    future.followup(webPrompt('Inspect a second application.'))
    await future.whenIdle()
    expect(controller.binding(future.id)).toBeUndefined()
    expect(controller.projects()).toEqual([project])
  })

  it('does not expose workspace resource configuration as a model tool or command', async () => {
    const { ctx, agent, controller, model } = await load()
    const configuration = await ctx.securityWorkbench.configuration(agent)
    agent.followup(webPrompt('Configure local resources for this task.'))
    await agent.whenIdle()
    const names = model.requests[0]!.tools!.map(tool => tool.name)
    expect(names).not.toContain('configureWorkspace')
    expect(names).not.toContain('security_configure_workspace')
    const denied = await execute(ctx, agent, 'security_command', {
      command: JSON.stringify({ operationId: 'model-configure', expectedRevision: controller.view(agent.id).revision,
        action: { kind: 'configureWorkspace', environmentIds: ['local'], maxAttempts: 3 } }),
    })
    expect(denied.isError).toBe(true)
    expect(await ctx.securityWorkbench.configuration(agent)).toEqual(configuration)
    expect(controller.projects()).toEqual([])
  })

  it.each(['origin', 'binding'] as const)('rejects workspace changes from a delegated session identified by %s', async (authority) => {
    const { ctx, agent, controller } = await load()
    const send = operator(controller, agent)
    await send({ kind: 'create', title: 'Delegation', objective: 'Inspect the supplied sample', environmentIds: ['local'], maxAttempts: 2 })
    const { agent: child } = await ctx.agents.create({
      sessionId: SessionId('configuration-child'), parentAgent: agent,
      meta: { cwd: agent.session.header.cwd!, parentSession: agent.id,
        ...(authority === 'origin' ? { origin: 'subagent', delegationDepth: 1 } : {}) },
      agentOptions: { provider: 'fixture', model: 'fixture' },
    })
    if (authority === 'binding') {
      const path = join(agent.session.header.cwd!, 'delegated.bin')
      await writeFile(path, 'owned sample')
      await send({ kind: 'import', path, label: 'sample' })
      const asset = controller.view(agent.id).records.find(item => item.kind === 'asset')!
      if (asset.kind !== 'asset') throw new Error('Missing asset')
      await bindDelegatedChild(controller, agent.id, child.id, asset.value.id, 'researcher')
    } else {
      expect(controller.binding(child.id)).toBeUndefined()
    }
    const configuration = await ctx.securityWorkbench.configuration(agent)
    await expect(ctx.securityWorkbench.configureWorkspace(child, JSON.stringify({
      expectedRevision: 0, environmentIds: ['local'], maxAttempts: 4,
    }))).rejects.toThrow('Delegated sessions cannot configure workspace resources')
    expect(await ctx.securityWorkbench.configuration(agent)).toEqual(configuration)
  })

  it('admits a new user task in a fork without inheriting its parent project', async () => {
    const { ctx, agent, controller, model } = await load(false, 0, { taskIntake: 'current' })
    agent.followup(webPrompt('Inspect the original Web application.'))
    await agent.whenIdle()
    const original = controller.binding(agent.id)!.engagementId
    const { agent: fork } = await ctx.agents.create({
      sessionId: SessionId('user-fork'),
      seed: agent.session.snapshotEvents(),
      meta: { cwd: agent.session.header.cwd!, parentSession: agent.id },
      agentOptions: { provider: 'fixture', model: 'fixture' },
    })
    expect(fork.session.header.parentSession).toBe(agent.id)
    expect(fork.session.header.origin).toBeUndefined()
    expect(controller.binding(fork.id)).toBeUndefined()
    model.requests.splice(0)
    const objective = 'Inspect the supplied firmware in this task.'
    fork.followup(webPrompt(objective))
    await fork.whenIdle()
    expect(controller.projects()).toHaveLength(2)
    expect(controller.binding(agent.id)?.engagementId).toBe(original)
    expect(controller.binding(fork.id)?.engagementId).not.toBe(original)
    expect(controller.projects().find(project => project.id === controller.binding(fork.id)?.engagementId))
      .toMatchObject({ objective, environmentIds: ['local'], maxAttempts: 3 })
  })

  it.each([
    'disabled', 'unmapped', 'internal', 'child', 'rejected', 'removed', 'cancelled', 'injected',
    'outer-rejected', 'outer-removed',
  ] as const)(
    'does not create a workspace task for %s input',
    async (input) => {
      const { ctx, agent, controller } = await load(false, 0, input === 'disabled' ? {} : {
        taskIntake: input === 'unmapped' ? 'other' : 'current',
      })
      let target = agent
      if (input === 'child') {
        target = (await ctx.agents.create({ sessionId: SessionId('intake-child'), parentAgent: agent,
          meta: { cwd: agent.session.header.cwd!, parentSession: agent.id, origin: 'subagent', delegationDepth: 1 },
          agentOptions: { provider: 'fixture', model: 'fixture' } })).agent
      }
      if (['rejected', 'removed', 'cancelled', 'injected', 'outer-rejected', 'outer-removed'].includes(input)) {
        ctx.on('agent/pre-step', async ({ agent: current }, next) => {
          const decision = await next()
          if (decision.kind === 'reject') return decision
          if (input === 'rejected' || input === 'outer-rejected') return { kind: 'reject' }
          if (input === 'removed' || input === 'outer-removed') return { ...decision, messages: [] }
          if (input === 'cancelled') current.cancel({ kind: 'user' })
          if (input === 'injected') return { ...decision, messages: [...decision.messages, webPrompt('Injected task')] }
          return decision
        }, { prepend: input.startsWith('outer-') })
      }
      target.followup(input === 'internal' || input === 'injected'
        ? createUserMessage({ content: [{ type: 'text', text: 'Internal analysis request' }], source: { kind: 'user' } })
        : webPrompt('Inspect the supplied firmware.'))
      await target.whenIdle()
      expect(controller.projects()).toEqual([])
      expect(controller.binding(target.id)).toBeUndefined()
    },
  )

  it.each(['whitespace', 'uncommitted'] as const)(
    'admits same-turn user steering after a %s initial message',
    async (initial) => {
      const { ctx, agent, controller, model } = await load(false, 0, { taskIntake: 'current' })
      model.scopeCalls = 2
      const first = webPrompt(initial === 'whitespace' ? ' \n\t ' : 'Original request removed before admission.')
      const objective = 'Inspect the administrator authorization checks.'
      if (initial === 'uncommitted') {
        ctx.on('agent/pre-step', async ({ step }, next) => {
          const decision = await next()
          if (decision.kind === 'reject' || step !== 1) return decision
          return { ...decision, messages: [
            ...decision.messages.filter(message => message.id !== first.id),
            createUserMessage({ content: [{ type: 'text', text: 'Internal context' }], source: { kind: 'user' } }),
          ] }
        }, { prepend: true })
      }
      let projectsBeforeSteering: number | undefined
      ctx.on('agent/request', async (_request, next) => {
        const request = await next()
        if (projectsBeforeSteering === undefined) {
          projectsBeforeSteering = controller.projects().length
          agent.steer(webPrompt(objective))
        }
        return request
      })
      agent.followup(first)
      await agent.whenIdle()
      expect(model.requests).toHaveLength(3)
      expect(projectsBeforeSteering).toBe(0)
      expect(controller.projects()).toHaveLength(1)
      expect(controller.projects()[0]).toMatchObject({ objective, environmentIds: ['local'], maxAttempts: 3 })
      const events = agent.session.snapshotEvents()
      expect(events.filter(event => event.type === 'turn/start')).toHaveLength(1)
      expect(events.some(event => event.type === 'user/message' && event.data.id === first.id))
        .toBe(initial === 'whitespace')
    },
  )

  it('logs the security method catalog and loaded instructions and removes methods on unload', async () => {
    const { ctx, agent, model, shell } = await load(false, 0, { skills: true })
    model.firstSkill = 'security-web'
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'Load the method for checking Web authorization.' }], source: { kind: 'user' },
    }))
    await agent.whenIdle()
    expect(model.requests).toHaveLength(2)
    expect(model.requests[0]?.tools?.map(tool => tool.name)).toContain('skill')
    const events = agent.session.snapshotEvents()
    const catalog = events.find(event => event.type === 'user/message' && event.data.source.kind === 'skill-catalog')
    if (catalog?.type !== 'user/message' || catalog.data.source.kind !== 'skill-catalog') throw new Error('Missing skill catalog')
    expect(catalog.data.source.entries.map(entry => entry.name).sort()).toEqual([
      'security-android', 'security-dynamic', 'security-firmware', 'security-investigation', 'security-iot-offline', 'security-mqtt', 'security-packet-analysis', 'security-web',
    ])
    const loaded = events.find(event => event.type === 'tool/result')
    if (loaded?.type !== 'tool/result') throw new Error('Missing loaded skill result')
    expect(loaded.data.message.isError).not.toBe(true)
    const text = loaded.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('')
    expect(text).toContain('<skill_content name="security-web">')
    expect(text).toContain('expected authorization rule')
    expect(model.requests[1]?.messages).toContainEqual(loaded.data.message)
    const scripts = ctx.securityWorkbench.scriptCatalog()
    expect(scripts).toHaveLength(7)
    const packetMethod = await execute(ctx, agent, 'skill', { name: 'security-packet-analysis' })
    expect(packetMethod.isError).not.toBe(true)
    expect(JSON.stringify(packetMethod)).toContain('tshark/capture_summary.py')
    expect(scripts.every(script => script.path.includes('analysis-scripts'))).toBe(true)
    expect((await execute(ctx, agent, 'shell')).isError).toBe(true)
    expect(shell).not.toHaveBeenCalled()
    await [...ctx.loader.entries()].find(entry => entry.options.id === 'security')!.fiber!.dispose()
    expect(await ctx.skills.list({ scope: agent })).toEqual([])
  })
  it('rejects raw, scoped and forced-allow tools and refuses model-authored approval', async () => {
    const { ctx, agent, shell } = await load()
    const bypass = independentTool(agent.ctx, 'raw_mcp')
    expect(() => independentTool(agent.ctx, 'run_code')).toThrow('reserved')
    ctx.on('tools/pre-execute', async () => ({ kind: 'allow' }))
    for (const name of ['shell', 'raw_mcp', 'run_code']) expect((await execute(ctx, agent, name)).isError).toBe(true)
    expect(shell).not.toHaveBeenCalled()
    expect(bypass).not.toHaveBeenCalled()

    const denied = await execute(ctx, agent, 'security_command', {
      command: JSON.stringify({
        operationId: 'approve',
        expectedRevision: 0,
        action: { kind: 'approve', planId: 'plan' },
      }),
    })
    expect(denied.isError).toBe(true)
    expect(JSON.stringify(denied)).toContain('operator')
  })
  it('enforces durable child roles even when a caller bypasses schema filtering', async () => {
    const { ctx, agent, controller } = await load(false, 0, { skills: true })
    independentTool(ctx, 'web_search')
    independentTool(ctx, 'web_fetch')
    const root = roots[roots.length - 1]!
    await writeFile(join(root, 'sample.bin'), 'sample strings')
    const send = operator(controller, agent)
    await send({ kind: 'create', title: 'Role check', objective: 'Inspect owned fixture', environmentIds: ['local'], maxAttempts: 2 })
    await send({ kind: 'import', path: join(root, 'sample.bin'), label: 'sample' })
    const asset = controller.view(agent.id).records.find(item => item.kind === 'asset')!
    if (asset.kind !== 'asset') throw new Error('Missing asset')
    for (const role of ['reconnaissance', 'reverse-analyst', 'web-analyst', 'researcher', 'reviewer'] as const) {
      const id = SessionId('child-' + role)
      await bindDelegatedChild(controller, agent.id, id, asset.value.id, role)
      const { agent: child } = await ctx.agents.create({ sessionId: id, parentAgent: agent,
        meta: { parentSession: agent.id, origin: 'subagent', delegationDepth: 1 } })
      const visible = ctx.tools.schemas(child).map(tool => tool.name)
      expect(visible).toContain('skill')
      const investigation = await execute(ctx, child, 'skill', { name: 'security-investigation' })
      expect(investigation.isError).toBe(false)
      expect(JSON.stringify(investigation)).toContain('Work from question to required observations')
      expect(visible).not.toContain('security_execute')
      expect(visible).not.toContain('security_delegate')
      expect(visible.includes('security_static')).toBe(['reconnaissance', 'reverse-analyst', 'web-analyst'].includes(role))
      for (const name of ['web_search', 'web_fetch'])
        expect(visible.includes(name)).toBe(['reverse-analyst', 'web-analyst', 'researcher'].includes(role))
      if (role === 'researcher' || role === 'reviewer') {
        await expect(controller.observe(child.id, { provider: 'packet-capture', operation: 'summary', assetId: asset.value.id,
          environmentId: 'local', impact: 'observe', parameters: { protocol: 'wifi' } }, 'wireless-role', new AbortController().signal))
          .rejects.toThrow('role')
        expect((await execute(ctx, child, 'security_capture_analysis', { assetId: asset.value.id })).isError).toBe(true)
        expect(() => controller.analysisAsset(child.id, asset.value.id)).toThrow('Analysis collection role required')
      } else {
        expect(() => controller.analysisAsset(child.id, asset.value.id)).not.toThrow()
        const childScope = scopeOf(child.ctx)
        if (!childScope) throw new Error('Expected a child scope')
        const prompt = await ctx.systemPrompt.assemble({ agent: child, scope: childScope })
        expect(JSON.stringify(prompt)).toContain('Prefer native machine-readable results')
        for (const id of ['radare2', 'tshark', 'curl']) {
          const detail = await execute(ctx, child, 'security_capabilities', { toolIds: [id], details: true })
          expect(detail.isError).toBe(false)
          const parentDetail = await execute(ctx, agent, 'security_capabilities', { toolIds: [id], details: true })
          const catalogOf = (result: typeof detail) => (JSON.parse(result.content.filter(block => block.type === 'text').map(block => block.text).join('')) as { catalog: object[] }).catalog
          expect(catalogOf(detail)).toEqual(catalogOf(parentDetail))
        }
      }
      for (const name of ['security_execute', 'security_delegate', 'security_command'])
        expect((await execute(ctx, child, name)).isError).toBe(true)
      const capabilities = await execute(ctx, child, 'security_capabilities', { providerId: 'binary', details: true })
      expect(capabilities.isError).toBe(false)
      expect(JSON.stringify(await execute(ctx, child, 'security_capabilities', { providerId: 'ghidra', details: true }))).toContain('hexadecimal address')
      expect(JSON.stringify(capabilities)).toContain('minLength')
      if (role === 'reconnaissance' || role === 'reverse-analyst') {
        const observed = await execute(ctx, child, 'security_static', {
          provider: 'binary', operation: 'hex', assetId: asset.value.id, environmentId: 'local', parameters: '{}',
        })
        expect(observed.isError).toBe(false)
        const evidence = controller.view(child.id).records.find(item => item.kind === 'evidence')
        expect(evidence?.kind).toBe('evidence')
        if (evidence?.kind === 'evidence') {
          expect(evidence.value.provider).toBe('binary')
          expect((await controller.artifacts.read(evidence.value.artifact)).toString()).toContain('73616d706c65')
        }
        expect((await execute(ctx, child, 'security_environment', { environmentId: 'local' })).isError).toBe(false)
        expect((await execute(ctx, child, 'security_environment', { environmentId: 'foreign' })).isError).toBe(true)
      }
      if (role === 'researcher' || role === 'reviewer') {
        expect((await execute(ctx, child, 'security_static', {
          provider: 'binary', operation: 'identity', assetId: asset.value.id, environmentId: 'local', parameters: '{}',
        })).isError).toBe(true)
        await expect(controller.observe(child.id, { provider: 'binary', operation: 'identity', assetId: asset.value.id,
          environmentId: 'local', parameters: {}, impact: 'observe' }, 'direct', new AbortController().signal))
          .rejects.toThrow('role')
      }
    }
  })
  it('does not infer authority from a parent session and releases profile effects', async () => {
    const { ctx, agent, controller, shell } = await load()
    const { agent: child } = await ctx.agents.create({
      sessionId: SessionId('unbound-child'),
      parentAgent: agent,
      meta: { parentSession: agent.id, origin: 'subagent', delegationDepth: 1 },
    })
    expect(controller.binding(child.id)).toBeUndefined()
    const plugin = [...ctx.loader.entries()].find(entry => entry.options.id === 'security')!.fiber!
    await plugin.dispose()
    expect((await execute(ctx, agent, 'shell')).isError).toBe(false)
    expect(shell).toHaveBeenCalledOnce()
    expect(ctx.tools.schemas(agent).some(tool => tool.name === 'security_scope')).toBe(false)
  })
})

it('settles an operator laboratory job when the Host is disposed', async () => {
  const { ctx, controller } = await load()
  const started = Promise.withResolvers<undefined>()
  const manager = controller.laboratories.get('local')
  const action = vi.spyOn(manager, 'action').mockImplementation(() => controller.manageEnvironment('shutdown-fixture', (signal) => {
    started.resolve(undefined)
    return new Promise((resolve) => {
      signal.addEventListener('abort', () => { resolve({ revision: 0, records: [] }) }, { once: true })
    })
  }))
  try {
    const pending = ctx.securityWorkbench.laboratory('fixture', 'inspect', 'fixture')
    await started.promise
    await ctx.fiber.dispose()
    expect(await pending).toEqual({ revision: 0, records: [] })
  } finally { action.mockRestore() }
})

it('runs logged tool-free refinement through the Loader and disposes its model Session', async () => {
  const { ctx, agent, controller, model } = await load()
  const send = operator(controller, agent)
  await send({ kind: 'create', title: 'Notes', objective: 'Learn from parser review', environmentIds: ['local'], maxAttempts: 2 })
  const entry = { category: 'experience', title: 'Bounds', summary: 'Check lengths', conditions: 'Binary parsers', actions: ['Validate before reading'], pitfalls: [], tags: [] }
  await send({ kind: 'remember', entry })
  const note = controller.view(agent.id).records.find(item => item.kind === 'knowledge')!
  model.refinementOutput = () => JSON.stringify({ entries: [{ sourceIds: ['id' in note.value ? note.value.id : ''], entry: { ...entry, summary: 'Validate available bytes before each read.' } }], excludedSourceIds: [] })
  const logged: string[] = []
  let worker: Agent | undefined
  ctx.on('agent/created', ({ agent: created }) => { if (created.id !== agent.id) worker = created })
  ctx.on('session/event', (session, event) => {
    if (session.id !== agent.id && event.type === 'user/message') logged.push(JSON.stringify(event.data))
  })
  const result = await ctx.securityWorkbench.refineProjectKnowledge(agent)
  expect(result.records.find(item => item.kind === 'knowledge')?.value).toMatchObject({ content: 'Validate available bytes before each read.' })
  expect(logged.join('')).toContain('Refine the supplied project notes')
  expect(model.requests.at(-1)?.tools ?? []).toHaveLength(0)
  expect(JSON.stringify(model.requests.at(-1)?.messages)).not.toContain('Start with security_scope')
  expect(worker).toBeDefined()
  expect(ctx.agents.get(worker!.id)).toBeUndefined()
  await ctx.securityWorkbench.refineProjectKnowledge(agent)
  expect(model.requests).toHaveLength(1)
})

it.each(['plain', 'fenced'] as const)('generates a %s JSON brief through the Loader and stores a readable report', async (format) => {
  const { ctx, agent, controller, model } = await load(false, 0, { dedicatedModel: false })
  ctx.systemPrompt.section({ name: 'fixture:requires-model', order: 5, text: 'Model {{model}} in {{cwd}}' })
  const send = operator(controller, agent)
  await send({ kind: 'create', title: 'Report fixture', objective: '仅静态检查此文件。没有独立复核时保持待复核状态。',
    environmentIds: ['local'], maxAttempts: 1 })
  const root = roots[roots.length - 1]!
  const source = join(root, 'report-source.js')
  await writeFile(source, 'export function invoice(user, row) { if (!user) throw Error(); return row }\n')
  await send({ kind: 'import-source', path: source, label: 'Report source' })
  const asset = controller.view(agent.id).records.find(item => item.kind === 'asset')!
  if (asset.kind !== 'asset') throw new Error('Missing report asset')
  const observation = await controller.observe(agent.id, { provider: 'source', operation: 'read', assetId: asset.value.id,
    environmentId: 'local', parameters: { path: 'report-source.js', startLine: 1, limit: 100 }, impact: 'observe' },
  'report-observation', new AbortController().signal)
  if (observation.kind !== 'evidence') throw new Error('Missing report evidence')
  await send({ kind: 'finding', finding: { assetId: asset.value.id, title: 'Owner check absent',
    explanation: 'The function checks authentication and returns the supplied row without an ownership check.',
    conditions: 'A caller supplies another owner invoice.', status: 'suspected', evidenceIds: [observation.value.id], review: '' } })
  const finding = controller.view(agent.id).records.find(item => item.kind === 'finding')!
  if (finding.kind !== 'finding') throw new Error('Missing report finding')
  await bindDelegatedChild(controller, agent.id, 'report-reviewer', asset.value.id, 'reviewer')
  const reviewed = await controller.review('report-reviewer', { findingId: finding.value.id, findingHash: findingHash(finding.value),
    basis: 'static', verdict: 'confirmed', supportingEvidenceIds: [observation.value.id], opposingEvidenceIds: [],
    explanation: 'The complete function implements authentication without object ownership checks.',
    uncertainty: 'Callers and runtime behavior remain unverified.' })
  const review = reviewed.records.find(item => item.kind === 'review')!
  if (review.kind !== 'review') throw new Error('Missing accepted review')
  await send({ kind: 'conclude', reviewId: review.value.id })
  const loggedInputs: string[] = []
  ctx.on('session/event', (session, event) => {
    if (session.id !== agent.id && event.type === 'user/message' && event.data.source.kind === 'user')
      loggedInputs.push(event.data.content.filter(block => block.type === 'text').map(block => block.text).join(''))
  })
  let submittedPrompt = ''
  model.reportOutput = (prompt) => {
    submittedPrompt = prompt
    const material = JSON.parse(prompt.split('\nData: ')[1]!) as { project: unknown; findings: unknown[] }
    expect(material.project).toMatchObject({ requestedObjective: '仅静态检查此文件。没有独立复核时保持待复核状态。' })
    expect(material.findings).toMatchObject([{ status: 'confirmed', review: {
      accepted: true, verdict: 'confirmed', basis: 'static', uncertainty: 'Callers and runtime behavior remain unverified.',
    } }])
    const output = JSON.stringify({ assessment: '目标已完成独立静态复核，运行行为仍未验证。', findings: [{ index: 0,
      mechanism: '认证后直接返回记录', conditions: '调用方可提供其他用户的记录', impact: '对象级权限检查缺失',
      location: 'report-source.js:1', fix: '读取前校验记录所有权' }], excludedIndices: [],
    lessons: [], uncovered: ['调用方与运行行为未验证。'] })
    return format === 'fenced' ? '```json\n' + output + '\n```' : output
  }
  const result = await send({ kind: 'report' })
  const report = result.records.find(item => item.kind === 'report')
  expect(report?.kind).toBe('report')
  if (report?.kind !== 'report') throw new Error('Report missing')
  const markdown = (await controller.artifacts.read(report.value.markdown)).toString()
  expect(markdown).toContain('已确认，静态分析')
  expect(markdown).toContain('调用方与运行行为未验证。')
  expect(loggedInputs).toEqual([submittedPrompt])
  if (format === 'plain') expect(loggedInputs[0]!.replaceAll(asset.value.id, '<asset-id>'))
    .toMatchSnapshot('logged report Session input with an accepted static review')
  expect(model.requests).toHaveLength(1)
  expect(model.requests[0]?.tools ?? []).toHaveLength(0)
})

it('rejects a fenced report with missing required fields without publishing an artifact', async () => {
  const { agent, controller, model } = await load(false, 0, { dedicatedModel: false })
  const send = operator(controller, agent)
  await send({ kind: 'create', title: 'Invalid report', objective: 'Assess source', environmentIds: ['local'], maxAttempts: 1 })
  model.reportOutput = () => '```json\n{"assessment":"Incomplete response"}\n```'
  await expect(send({ kind: 'report' })).rejects.toThrow(/findings/u)
  expect(controller.view(agent.id).records.some(item => item.kind === 'report')).toBe(false)
})
it('reports the model failure and does not publish a partial report', async () => {
  const { agent, controller, model } = await load(false, 0, { dedicatedModel: false })
  const send = operator(controller, agent)
  await send({ kind: 'create', title: 'Failed report', objective: 'Assess source', environmentIds: ['local'], maxAttempts: 1 })
  model.reportFailure = true
  await expect(send({ kind: 'report' })).rejects.toThrow('Fixture model rejected report')
  expect(controller.view(agent.id).records.some(item => item.kind === 'report')).toBe(false)
})

it.each([500, 1200])('summarizes once when another comparable step would reach the budget (usage=%s)', async (usage) => {
  const { agent, controller, model } = await load(false, 0, { analysisTurnTokens: 1000 })
  const send = operator(controller, agent)
  await send({ kind: 'create', title: 'Bounded analysis', objective: 'Inspect source', environmentIds: ['local'], maxAttempts: 1 })
  model.usageTokens = usage
  agent.followup(webPrompt('Inspect the project.'))
  await agent.whenIdle()
  expect(model.requests).toHaveLength(2)
  expect(model.requests[1]!.tools ?? []).toEqual([])
  const events = agent.session.snapshotEvents()
  const checkpoint = events.filter(event => event.type === 'user/message' && event.data.source.kind === 'plugin:security-analysis-budget')
  expect(checkpoint).toHaveLength(1)
  expect(JSON.stringify(checkpoint)).toContain(String(usage) + ' / 1000 tokens (excluding cache reads)')
  expect(JSON.stringify(model.requests[1]!.messages)).toContain('saved evidence or file locations')
  const end = events.findLast(event => event.type === 'turn/end')
  expect(end?.type === 'turn/end' && end.data.reason.kind).toBe('completed')
  const projectId = controller.binding(agent.id)!.engagementId
  const subscription = new AbortController()
  const stream = controller.activity!.follow(projectId, () => controller.view(agent.id), () => () => {}, subscription.signal)
  try {
    await vi.waitFor(async () => {
      const frame = (await stream.next()).value
      expect(frame?.type === 'snapshot' || frame?.type === 'activity' ? frame.briefs : []).toMatchObject([{ checkpointId: '' }])
    })
  } finally { subscription.abort(); await stream.return?.() }
  expect(controller.view(agent.id).records.some(item => item.kind === 'checkpoint')).toBe(false)
  model.usageTokens = 0
  agent.followup(webPrompt('Continue from the saved results.'))
  await agent.whenIdle()
  expect(model.requests).toHaveLength(3)
  expect(model.requests[2]!.tools?.some(tool => tool.name === 'security_scope')).toBe(true)
})

it.each([undefined, false, true])('keeps full logged usage while optionally counting cache reads (include=%s)', async (include) => {
  const { agent, controller, model } = await load(false, 0, {
    analysisTurnTokens: 1000, ...(include === undefined ? {} : { analysisCountCacheReads: include }),
  })
  await operator(controller, agent)({ kind: 'create', title: 'Cached context', objective: 'Inspect source', environmentIds: ['local'], maxAttempts: 1 })
  model.usageTokens = 100
  model.cacheReadTokens = 1200
  model.exactUsageTotal = include !== false
  model.scopeCalls = 2
  agent.followup(webPrompt('Inspect the project.'))
  await agent.whenIdle()
  const expectedCalls = include ? 2 : 3
  expect(model.requests).toHaveLength(expectedCalls)
  const usage = agent.session.snapshotEvents().find(event => event.type === 'assistant/message')
  expect(usage?.type === 'assistant/message' && usage.data.usage).toMatchObject({ inputTokens: 100, cacheReadTokens: 1200, ...(include === false ? {} : { totalTokens: 1300 }) })
  if (include) expect(model.requests[1]!.tools ?? []).toEqual([])
  else expect(model.requests[1]!.tools?.some(tool => tool.name === 'security_scope')).toBe(true)
})

it('blocks repeated wrap-up exploration and preserves new user steering for the next turn', async () => {
  const { agent, controller, model, shell } = await load(false, 0, { analysisTurnTokens: 1000 })
  await operator(controller, agent)({ kind: 'create', title: 'Stop exploration', objective: 'Inspect source', environmentIds: ['local'], maxAttempts: 1 })
  model.usageTokens = 1200
  model.beforeResponse = (request) => {
    if (request === 2) agent.steer(webPrompt('Continue with the saved results.'))
  }
  model.nativeCalls[1] = { name: 'security_command', args: { command: JSON.stringify({
    operationId: 'ignored-checkpoint', expectedRevision: controller.view(agent.id).revision,
    action: { kind: 'remember', entry: { category: 'experience', title: 'Unwanted write', summary: 'No evidence',
      conditions: 'None', actions: [], pitfalls: [], tags: [] } },
  }) } }
  agent.followup(webPrompt('Inspect the project.'))
  await agent.whenIdle()
  expect(model.requests).toHaveLength(2)
  agent.followup(webPrompt('Resume the queued instruction.'))
  await agent.whenIdle()
  expect(model.requests).toHaveLength(4)
  expect(model.requests[2]!.tools?.some(tool => tool.name === 'security_scope')).toBe(true)
  expect(JSON.stringify(model.requests[2]!.messages)).toContain('Continue with the saved results.')
  expect(controller.view(agent.id).records.some(record => record.kind === 'knowledge')).toBe(false)
  expect(shell).not.toHaveBeenCalled()
  const results = agent.session.snapshotEvents().filter(event => event.type === 'tool/result')
  expect(JSON.stringify(results)).toContain('Analysis budget wrap-up allows only the final response')
  const endings = agent.session.snapshotEvents().filter(event => event.type === 'turn/end')
  expect(endings.map(event => event.data.reason.kind)).toEqual(['blocked', 'completed', 'completed'])
})

it('keeps a delegated structured report available during budget wrap-up', async () => {
  const { ctx, agent, controller, model } = await load(true, 0, { analysisTurnTokens: 1000 })
  ctx.jobs.attachController('budget-child')
  ctx.effect(() => ctx.subagents.registerProvider({
    name: 'spawn', inheritsParentContext: false,
    capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
    start: request => startInProcessRun(request, {}),
  }))
  const root = roots[roots.length - 1]!
  await writeFile(join(root, 'budget.bin'), 'owned fixture')
  const send = operator(controller, agent)
  await send({ kind: 'create', title: 'Child checkpoint', objective: 'Inspect source', environmentIds: ['local'], maxAttempts: 1 })
  await send({ kind: 'import', path: join(root, 'budget.bin'), label: 'sample' })
  const asset = controller.view(agent.id).records.find(item => item.kind === 'asset')!
  if (asset.kind !== 'asset') throw new Error('Missing asset')
  model.usageTokens = 600
  model.nativeCalls = [{ name: 'security_scope', args: {} }]
  const result = await execute(ctx, agent, 'security_delegate', {
    assetId: asset.value.id, role: 'reconnaissance', question: 'Inspect the assigned scope.', criterion: 'Return established evidence.',
  })
  expect(result.isError, JSON.stringify(result)).toBe(false)
  const { jobId } = JSON.parse(result.content.filter(block => block.type === 'text').map(block => block.text).join('')) as { jobId: string }
  expect((await ctx.jobs.wait(JobId(jobId), 10000, agent.id)).status).toBe('completed')
  expect(model.requests).toHaveLength(2)
  expect(model.requests[1]!.tools?.map(tool => tool.name)).toEqual(['structured_output'])
  expect(JSON.stringify(model.requests[1]!.messages)).toContain('security-analysis-budget')
  expect(controller.view(agent.id).records.filter(item => item.kind === 'delegation').map(item => item.value.report)).toContainEqual(model.childReport)
})

async function delegationFixture(
  options: { maxConcurrentDelegations?: number; maxOutputBytes?: number; delegationTimeoutMs?: number } = {},
) {
  const fixture = await load(true, 0, options)
  const { ctx, agent, controller } = fixture
  ctx.jobs.attachController('delegation-test')
  const root = roots[roots.length - 1]!
  await writeFile(join(root, 'delegation.bin'), 'owned fixture')
  const send = operator(controller, agent)
  await send({ kind: 'create', title: 'Bounded work', objective: 'Inspect independent parser paths', environmentIds: ['local'], maxAttempts: 1 })
  await send({ kind: 'import', path: join(root, 'delegation.bin'), label: 'sample' })
  const asset = controller.view(agent.id).records.find(item => item.kind === 'asset')!
  if (asset.kind !== 'asset') throw new Error('Missing asset')
  const args = { assetId: asset.value.id, role: 'reverse-analyst' as const, task: 'assessment' as const,
    question: 'Inspect length checks', criterion: 'Return implementation observations', reason: 'Independent parser inspection' }
  return { ...fixture, send, args }
}

it('logs check instructions and explicit evidence references in a delegated child', async () => {
  const { ctx, agent, controller, args, send, model } = await delegationFixture()
  ctx.effect(() => ctx.subagents.registerProvider({ name: 'spawn', inheritsParentContext: false,
    capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
    start: request => startInProcessRun(request, {}) }))
  await send({ kind: 'check', check: { assetId: args.assetId, title: 'Inspect assigned parser', phase: 'assessment',
    criterion: 'Return the checked input condition', dependencies: [], evidenceIds: [] } })
  const check = controller.view(agent.id).records.find(item => item.kind === 'check')!
  const evidence = await controller.captureAnalysis(agent.id, args.assetId, ['input-observation'], Buffer.from('untrusted raw input'), new AbortController().signal)
  if (evidence.kind !== 'evidence') throw new Error('Missing evidence')
  const input = { ...args, checkId: check.value.id, inputEvidenceIds: [evidence.value.id] }
  const result = await execute(ctx, agent, 'security_delegate', input, 'linked-assignment')
  expect(result.isError, JSON.stringify(result)).toBe(false)
  expect((await ctx.jobs.wait(JobId((result.value as { jobId: string }).jobId), 10000, agent.id)).status).toBe('completed')
  const messages = JSON.stringify(model.requests.flatMap(request => request.messages))
  expect(messages).toContain('Inspect assigned parser')
  expect(messages).toContain('Return the checked input condition')
  expect(messages).toContain(evidence.value.id)
  expect(messages).not.toContain('untrusted raw input')
  expect(controller.view(agent.id).records.find(item => item.kind === 'check')?.value).toMatchObject({ status: 'planned' })
  expect((await execute(ctx, agent, 'security_delegate', { ...input, inputEvidenceIds: [] }, 'linked-assignment')).isError).toBe(true)
})

it('reserves worker capacity before asynchronous admission and replays one logged call without another child', async () => {
  const { ctx, agent, controller, args } = await delegationFixture({ maxConcurrentDelegations: 1 })
  args.question = '  ' + args.question + '  '
  args.criterion = '  ' + args.criterion + '  '
  args.reason = '  ' + args.reason + '  '
  const provider = vi.fn((request: Parameters<typeof startInProcessRun>[0]) => startInProcessRun(request, {}))
  ctx.effect(() => ctx.subagents.registerProvider({ name: 'spawn', inheritsParentContext: false,
    capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true }, start: provider }))
  const entered = Promise.withResolvers<undefined>()
  const continueAdmission = Promise.withResolvers<undefined>()
  const original = controller.admitDelegation.bind(controller)
  const admission = vi.spyOn(controller, 'admitDelegation').mockImplementation(async (...input) => {
    entered.resolve(undefined); await continueAdmission.promise; return original(...input)
  })
  const first = execute(ctx, agent, 'security_delegate', args, 'first-assignment')
  try {
    await entered.promise
    const replay = execute(ctx, agent, 'security_delegate', args, 'first-assignment')
    const excess = await execute(ctx, agent, 'security_delegate', args, 'excess-assignment')
    expect(excess.isError).toBe(true)
    expect(JSON.stringify(excess)).toContain('concurrency limit')
    continueAdmission.resolve(undefined)
    const [result, repeated] = await Promise.all([first, replay])
    expect(result.isError, JSON.stringify(result)).toBe(false)
    expect(repeated.value).toEqual(result.value)
    const receipt = result.value as { delegationId: string; jobId: string }
    expect((await ctx.jobs.wait(JobId(receipt.jobId), 10000, agent.id)).status).toBe('completed')
    expect(provider).toHaveBeenCalledTimes(1)
    expect(admission).toHaveBeenCalledTimes(1)
    expect((await execute(ctx, agent, 'security_delegate', args, 'first-assignment')).value).toEqual(receipt)
    expect((await execute(ctx, agent, 'security_delegate', { ...args, question: 'Changed request' }, 'first-assignment')).isError).toBe(true)
    agent.followup(webPrompt('Inspect settled work before continuing.'))
    await agent.whenIdle()
    expect(JSON.stringify(agent.session.snapshotEvents())).toContain('awaitingDisposition')
    await execute(ctx, agent, 'security_command', { command: JSON.stringify({ operationId: 'accept-report',
      expectedRevision: controller.view(agent.id).revision,
      action: { kind: 'delegation-disposition', delegationId: receipt.delegationId, decision: 'accepted', reason: 'Use these observations to plan the next question' } }) })
    const scope = scopeOf(agent.ctx)
    if (!scope) throw new Error('Expected agent scope')
    expect((await ctx.systemPrompt.assemble({ agent, scope })).contexts.find(item => item.name === 'security:delegations')?.text).toContain('"awaitingDisposition":0')
  } finally { continueAdmission.resolve(undefined); admission.mockRestore(); await first }
})

it('replays saved assignments without returning job identities from another Host lifetime', async () => {
  const { ctx, agent, controller, args } = await delegationFixture()
  const assignment = await controller.admitDelegation(agent.id, 'historical-call', args)
  const unrelated = ctx.jobs.start({ kind: 'subagent', owner: agent.id, label: 'Unrelated task',
    run: () => ({ cancel() {}, done: Promise.resolve({ status: 'completed', result: 'Unrelated result' }) }) })
  await controller.attachDelegationJob(assignment.id, unrelated)
  await controller.settleDelegation(assignment.id, { status: 'interrupted', detail: 'Previous Host ended' })
  const replay = await execute(ctx, agent, 'security_delegate', args, 'historical-call')
  expect(replay.value).toEqual({ delegationId: assignment.id })
  expect(ctx.jobs.read(unrelated, agent.id).result).toBe('Unrelated result')
})

it('persists worker creation failure and admits a fresh retry after its reservation is released', async () => {
  const { ctx, agent, controller, args } = await delegationFixture({ maxConcurrentDelegations: 1 })
  const result = await execute(ctx, agent, 'security_delegate', args, 'missing-provider')
  const receipt = result.value as { jobId: string }
  expect((await ctx.jobs.wait(JobId(receipt.jobId), 10000, agent.id)).status).toBe('failed')
  expect(controller.delegationForCall(agent.id, 'missing-provider')).toMatchObject({ status: 'failed' })
  ctx.effect(() => ctx.subagents.registerProvider({ name: 'spawn', inheritsParentContext: false,
    capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
    start: request => startInProcessRun(request, {}) }))
  const retry = await execute(ctx, agent, 'security_delegate', { ...args, retryOf: controller.delegationForCall(agent.id, 'missing-provider')!.id }, 'available-provider')
  expect(retry.isError, JSON.stringify(retry)).toBe(false)
  expect((await ctx.jobs.wait(JobId((retry.value as { jobId: string }).jobId), 10000, agent.id)).status).toBe('completed')
})

it('records a worker deadline separately from its cancelled execution status', async () => {
  const { ctx, agent, controller, args } = await delegationFixture({ delegationTimeoutMs: 25 })
  ctx.effect(() => ctx.subagents.registerProvider({ name: 'spawn', inheritsParentContext: false,
    capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
    start: request => new Promise((_resolve, reject) => {
      if (request.signal.aborted) reject(new Error('Worker deadline'))
      else request.signal.addEventListener('abort', () => { reject(new Error('Worker deadline')) }, { once: true })
    }) }))
  const result = await execute(ctx, agent, 'security_delegate', args, 'deadline')
  expect((await ctx.jobs.wait(JobId((result.value as { jobId: string }).jobId), 10000, agent.id)).status).toBe('killed')
  expect(controller.delegationForCall(agent.id, 'deadline')).toMatchObject({ status: 'cancelled', timedOut: true })
})

it.each(['completed', 'cancelled', 'cleanup-failed'] as const)('settles %s only after child disposal', async (outcome) => {
  const { ctx, agent, controller, args, send } = await delegationFixture()
  const disposing = Promise.withResolvers<undefined>()
  const released = Promise.withResolvers<undefined>()
  ctx.effect(() => ctx.subagents.registerProvider({ name: 'spawn', inheritsParentContext: false,
    capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
    start: async (request) => {
      const run = await startInProcessRun(request, {})
      return { ...run, dispose: async () => {
        disposing.resolve(undefined); await released.promise; await run.dispose()
        if (outcome === 'cleanup-failed') throw new Error('Fixture cleanup failed')
      } }
    } }))
  const result = await execute(ctx, agent, 'security_delegate', args, 'cleanup-assignment')
  expect(result.isError, JSON.stringify(result)).toBe(false)
  const receipt = result.value as { jobId: string }
  let stopping: Promise<WorkbenchView> | undefined
  try {
    await disposing.promise
    expect(controller.delegationForCall(agent.id, 'cleanup-assignment')).toMatchObject({ status: 'running' })
    expect(controller.delegationForCall(agent.id, 'cleanup-assignment')?.report).toBeUndefined()
    if (outcome === 'cancelled') {
      stopping = send({ kind: 'stop' })
      await vi.waitFor(() => { expect(controller.view(agent.id).records.find(item => item.kind === 'engagement')?.value).toMatchObject({ stopped: true }) })
    }
  } finally { released.resolve(undefined); await stopping }
  expect((await ctx.jobs.wait(JobId(receipt.jobId), 10000, agent.id)).status).toBe(outcome === 'completed' ? 'completed' : outcome === 'cancelled' ? 'killed' : 'failed')
  expect(controller.delegationForCall(agent.id, 'cleanup-assignment')).toMatchObject({ status: outcome === 'cleanup-failed' ? 'failed' : outcome })
  expect(controller.delegationForCall(agent.id, 'cleanup-assignment')?.report !== undefined).toBe(outcome === 'completed')
})

it.each(['oversized', 'foreign-evidence'] as const)('rejects %s child reports and releases their worker slot', async (failure) => {
  const { ctx, agent, controller, model, args } = await delegationFixture({ maxConcurrentDelegations: 1, maxOutputBytes: 4096 })
  ctx.effect(() => ctx.subagents.registerProvider({ name: 'spawn', inheritsParentContext: false,
    capabilities: { agentOptions: true, outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
    start: request => startInProcessRun(request, {}) }))
  const ordinary = model.childReport
  model.childReport = failure === 'oversized' ? { ...ordinary, summary: '中文😀'.repeat(1024) } : { ...ordinary, evidenceIds: ['foreign'] }
  const result = await execute(ctx, agent, 'security_delegate', args, 'invalid-report')
  const receipt = result.value as { jobId: string }
  expect((await ctx.jobs.wait(JobId(receipt.jobId), 10000, agent.id)).status).toBe('failed')
  expect(controller.delegationForCall(agent.id, 'invalid-report')).toMatchObject({ status: 'failed' })
  expect(controller.delegationForCall(agent.id, 'invalid-report')?.report).toBeUndefined()
  model.childReport = ordinary
  const retried = await execute(ctx, agent, 'security_delegate', { ...args, retryOf: controller.delegationForCall(agent.id, 'invalid-report')!.id }, 'retry-report')
  expect(retried.isError, JSON.stringify(retried)).toBe(false)
  expect((await ctx.jobs.wait(JobId((retried.value as { jobId: string }).jobId), 10000, agent.id)).status).toBe('completed')
})

it('periodically refines changed notes and stops its timer when unloaded', async () => {
  const { ctx, agent, controller, model } = await load(false, 40)
  const send = operator(controller, agent)
  await send({ kind: 'create', title: 'Periodic notes', objective: 'Learn from review', environmentIds: [], maxAttempts: 1 })
  const entry = { category: 'experience', title: 'Validate input', summary: 'Check lengths', conditions: 'Parsers', actions: ['Check bytes'], pitfalls: [], tags: [] }
  model.refinementOutput = (prompt) => {
    const notes = JSON.parse(prompt.split('\nNotes: ')[1]!) as { id: string }[]
    return JSON.stringify({ entries: [{ sourceIds: notes.map(note => note.id), entry }], excludedSourceIds: [] })
  }
  await send({ kind: 'remember', entry })
  await vi.waitFor(() =>{  expect(controller.view(agent.id).records.find(item => item.kind === 'knowledge-maintenance')?.value).toMatchObject({ status: 'completed' }) })
  expect(model.requests).toHaveLength(1)
  const registry = ctx.agents
  await ctx.fiber.dispose()
  expect(registry.get(agent.id)).toBeUndefined()
})

it('cancels an active refinement and drains the worker before project stop returns', async () => {
  const { ctx, agent, controller, model } = await load()
  const send = operator(controller, agent)
  await send({ kind: 'create', title: 'Cancellation', objective: 'Review notes', environmentIds: [], maxAttempts: 1 })
  const entry = { category: 'experience', title: 'Bounds', summary: 'Check lengths', conditions: 'Parsers', actions: ['Check bytes'], pitfalls: [], tags: [] }
  await send({ kind: 'remember', entry })
  const before = controller.view(agent.id).records.filter(item => item.kind === 'knowledge')
  const started = Promise.withResolvers<undefined>()
  model.refinementOutput = () => JSON.stringify({ entries: [], excludedSourceIds: [] })
  model.refinementWait = signal => new Promise((resolve, reject) => {
    if (!signal) { reject(new Error('Missing model cancellation signal')); return }
    started.resolve(undefined)
    if (signal.aborted) resolve()
    else signal.addEventListener('abort', () => { resolve() }, { once: true })
  })
  let worker: Agent | undefined
  ctx.on('agent/created', ({ agent: created }) => { if (created.id !== agent.id) worker = created })
  const pending = ctx.securityWorkbench.refineProjectKnowledge(agent)
  const rejected = expect(pending).rejects.toThrow()
  await started.promise
  await send({ kind: 'stop' })
  await rejected
  expect(controller.view(agent.id).records.filter(item => item.kind === 'knowledge')).toEqual(before)
  expect(ctx.agents.get(worker!.id)).toBeUndefined()
})

it.each(['directory', 'file'] as const)('imports and reads a source %s through the real Loader tool composition', async (selection) => {
  const { ctx, agent, controller } = await load()
  const root = roots[roots.length - 1]!
  const source = join(root, 'source')
  await mkdir(source)
  await writeFile(join(source, 'app.py'), 'VALUE = "中文\\n"\nprint(VALUE)\n')
  const send = operator(controller, agent)
  await send({ kind: 'create', title: 'Source', objective: 'Read immutable lines', environmentIds: ['local'], maxAttempts: 2 })
  await writeFile(join(source, 'unselected.py'), 'PRIVATE = true')
  await send({ kind: 'import-source', path: selection === 'file' ? join(source, 'app.py') : source, label: 'Sources' })
  const asset = controller.view(agent.id).records.find(item => item.kind === 'asset')!
  if (asset.kind !== 'asset' || !('kind' in asset.value) || asset.value.kind !== 'source') throw new Error('Missing source')
  if (selection === 'file') {
    const manifest = JSON.parse((await controller.artifacts.read(asset.value.artifact)).toString()) as { files: { path: string }[] }
    expect(manifest.files.map(file => file.path)).toEqual(['app.py'])
  }
  await writeFile(join(source, 'app.py'), 'changed')
  const beforeObservation = controller.view(agent.id).revision
  const result = await execute(ctx, agent, 'security_static', {
    provider: 'source', operation: 'read', assetId: asset.value.id, environmentId: 'local', parameters: JSON.stringify({ path: 'app.py', startLine: 2, limit: 1 }),
  })
  expect(result.isError, JSON.stringify(result)).toBe(false)
  const receipt = JSON.parse(result.content.filter(block => block.type === 'text').map(block => block.text).join('')) as { evidenceId: string; detail: string; revision: number }
  expect(receipt.detail).toContain('security_evidence')
  expect(receipt.revision).toBeGreaterThan(beforeObservation)
  const next = await execute(ctx, agent, 'security_command', { command: JSON.stringify({
    operationId: 'check-from-observation', expectedRevision: receipt.revision,
    action: { kind: 'check', check: { assetId: asset.value.id, title: 'Inspect source observation', phase: 'assessment',
      criterion: 'Explain the observed source line', dependencies: [], evidenceIds: [receipt.evidenceId] } },
  }) })
  expect(next.isError, JSON.stringify(next)).toBe(false)
  expect(controller.view(agent.id).records.filter(item => item.kind === 'check')).toHaveLength(1)
  const stale = await execute(ctx, agent, 'security_command', { command: JSON.stringify({
    operationId: 'stale-observation-revision', expectedRevision: receipt.revision, action: { kind: 'template', assetId: asset.value.id },
  }) })
  expect(stale.isError).toBe(true)
  expect(JSON.stringify(stale)).toContain('Security state changed; reload before retrying')
  const evidence = controller.view(agent.id).records.find(item => item.kind === 'evidence')
  expect(evidence).toMatchObject({ kind: 'evidence', value: { provider: 'source', method: 'static', source: { sessionId: agent.id } } })
  if (evidence?.kind !== 'evidence') throw new Error('Missing observation')
  expect((await controller.artifacts.read(evidence.value.artifact)).toString()).toContain('print(VALUE)')
  const detail = await execute(ctx, agent, 'security_scope', { kind: 'evidence', recordId: evidence.value.id,
    expectedRevision: controller.view(agent.id).revision })
  expect(detail.isError, JSON.stringify(detail)).toBe(false)
  expect(detail.content.filter(block => block.type === 'text').map(block => block.text).join('')).toContain('observationKind')
  const original = await controller.artifacts.read(evidence.value.artifact)
  const pages: Buffer[] = []
  for (let offset = 0; offset < original.length;) {
    const response = await execute(ctx, agent, 'security_evidence', { evidenceId: evidence.value.id, offset, length: 7 })
    expect(response.isError, JSON.stringify(response)).toBe(false)
    const page = JSON.parse(response.content.filter(block => block.type === 'text').map(block => block.text).join('')) as
      { offset: number; nextOffset: number; text?: string; base64?: string }
    expect(page.nextOffset).toBeGreaterThan(offset)
    pages.push(page.base64 === undefined ? Buffer.from(page.text ?? '') : Buffer.from(page.base64, 'base64'))
    offset = page.nextOffset
  }
  expect(Buffer.concat(pages)).toEqual(original)
  const lines = await execute(ctx, agent, 'security_evidence', {
    evidenceId: evidence.value.id, startLine: 2, lineCount: 1,
  })
  expect(lines.isError, JSON.stringify(lines)).toBe(false)
  const selected = JSON.parse(lines.content.filter(block => block.type === 'text').map(block => block.text).join('')) as
    { lines: { line: number; text: string }[]; incomplete: boolean }
  expect(selected.lines).toEqual([{ line: 2, text: 'print(VALUE)' }])
  expect(selected.incomplete).toBe(true)
  const mixed = await execute(ctx, agent, 'security_evidence', {
    evidenceId: evidence.value.id, offset: 0, length: 10, startLine: 2, lineCount: 1,
  })
  expect(mixed.isError).toBe(true)
})

it('acknowledges reviews in a large project without turning a committed review into an output error', async () => {
  const { ctx, agent, controller } = await load()
  const root = roots[roots.length - 1]!
  await writeFile(join(root, 'review.bin'), 'owned')
  const send = operator(controller, agent)
  await send({ kind: 'create', title: 'Large review', objective: 'Bound committed results', environmentIds: ['local'], maxAttempts: 2 })
  await send({ kind: 'import', path: join(root, 'review.bin'), label: 'sample' })
  const asset = controller.view(agent.id).records.find(item => item.kind === 'asset')!
  if (asset.kind !== 'asset') throw new Error('Missing asset')
  const evidence = await controller.observe(agent.id, { provider: 'binary', operation: 'hex', assetId: asset.value.id,
    environmentId: 'local', parameters: {}, impact: 'observe' }, 'observation', new AbortController().signal)
  if (evidence.kind !== 'evidence') throw new Error('Missing evidence')
  for (let index = 0; index < 40; index++) await send({ kind: 'finding', finding: {
    assetId: asset.value.id, title: 'Candidate ' + String(index), explanation: 'x'.repeat(2000), conditions: 'fixture',
    evidenceIds: [evidence.value.id], status: 'suspected', review: '',
  } })
  const finding = controller.view(agent.id).records.find(item => item.kind === 'finding')!
  if (finding.kind !== 'finding') throw new Error('Missing finding')
  const childId = SessionId('large-reviewer')
  await bindDelegatedChild(controller, agent.id, childId, asset.value.id, 'reviewer')
  const { agent: child } = await ctx.agents.create({ sessionId: childId, parentAgent: agent,
    meta: { cwd: root, parentSession: agent.id, origin: 'subagent', delegationDepth: 1 } })
  const result = await execute(ctx, child, 'security_review', { review: JSON.stringify({
    findingId: finding.value.id, findingHash: findingHash(finding.value), basis: 'static', verdict: 'inconclusive',
    supportingEvidenceIds: [evidence.value.id], opposingEvidenceIds: [], explanation: 'No validation yet', uncertainty: 'Static only',
  }) })
  expect(result.isError, JSON.stringify(result)).toBe(false)
  expect(result.content.filter(block => block.type === 'text').map(block => block.text).join('')).toContain('"committed":true')
  expect(controller.view(agent.id).records.filter(item => item.kind === 'review')).toHaveLength(1)
})

it.each(['guard', 'outer-pre-execute'] as const)(
  'does not admit a workspace task after a final %s tool denial',
  async (denial) => {
    const { ctx, agent, controller } = await load(false, 0, { taskIntake: 'current' })
    const reason = 'Fixture final tool denial'
    if (denial === 'guard') {
      ctx.tools.guard(exec => exec.name === 'security_scope' ? reason : undefined)
    } else {
      ctx.on('tools/pre-execute', async (exec, next) => {
        const decision = await next()
        return exec.name === 'security_scope' ? { kind: 'deny', reason } : decision
      }, { prepend: true })
    }
    const dispatch = vi.fn()
    ctx.on('tools/execute', async (exec, next) => {
      dispatch(exec.name)
      return next()
    })
    const message = webPrompt('Inspect the supplied source file.')
    agent.followup(message)
    await agent.whenIdle()
    const events = agent.session.snapshotEvents()
    expect(events.some(event => event.type === 'user/message' && event.data.id === message.id)).toBe(true)
    const result = events.find(event => event.type === 'tool/result')
    if (result?.type !== 'tool/result') throw new Error('Missing denied tool result')
    expect(result.data.message.isError).toBe(true)
    expect(JSON.stringify(result.data.message)).toContain(reason)
    expect(dispatch).not.toHaveBeenCalled()
    expect(controller.projects()).toEqual([])
    expect(controller.binding(agent.id)).toBeUndefined()
  },
)

it('reads project artifacts and coordinator IDs without writes, rejecting foreign artifacts and inactive bindings', async () => {
  const { ctx, agent, controller } = await load()
  const send = operator(controller, agent)
  await send({ kind: 'create', title: 'First', objective: 'Inspect owned material', environmentIds: ['local'], maxAttempts: 3 })
  const first = controller.binding(agent.id)!.engagementId
  await controller.importMaterials(agent.id, { operationId: 'first-material', expectedRevision: controller.view(agent.id).revision,
    material: { kind: 'text', name: 'owned.txt', text: 'owned' } })
  const asset = controller.projectView(first).records.find(item => item.kind === 'asset')!
  if (asset.kind !== 'asset' || !('artifact' in asset.value)) throw new Error('Expected artifact')
  await bindDelegatedChild(controller, agent.id, 'reviewer', asset.value.id, 'reviewer')
  const before = controller.projectView(first)
  const events = agent.session.snapshotEvents()
  expect(await ctx.securityWorkbench.projectSessions(first)).toEqual([agent.id])
  expect(JSON.parse(await ctx.securityWorkbench.projectArtifact(first, asset.value.artifact.sha256))).toMatchObject({ truncated: false })
  expect(controller.projectView(first)).toEqual(before)
  expect(agent.session.snapshotEvents()).toEqual(events)
  await expect(ctx.securityWorkbench.projectSessions('unknown')).rejects.toThrow('Unknown')
  await send({ kind: 'create', title: 'Second', objective: 'Separate material', environmentIds: ['local'], maxAttempts: 3 })
  const second = controller.binding(agent.id)!.engagementId
  await expect(ctx.securityWorkbench.projectArtifact(second, asset.value.artifact.sha256)).rejects.toThrow('outside')
  expect(await ctx.securityWorkbench.projectSessions(first)).toEqual([])
  await send({ kind: 'leave' })
  expect(await ctx.securityWorkbench.projectSessions(second)).toEqual([])
})

it('streams Session selection from unbound through create, switch and leave, and cancels idle reads', async () => {
  const { ctx, agent, controller } = await load()
  const abort = new AbortController()
  // Remote's AsyncIterable signature erases this generator's void return type.
  const stream = ctx.securityWorkbench.followSessionView(agent, abort.signal)[Symbol.asyncIterator]() as AsyncIterator<WorkbenchView, void>
  try {
    expect((await stream.next()).value?.records).toEqual([])
    const send = operator(controller, agent)
    const first = stream.next()
    await send({ kind: 'create', title: 'First', objective: 'Inspect owned material', environmentIds: ['local'], maxAttempts: 3 })
    expect((await first).value?.records.find(item => item.kind === 'engagement')?.value.title).toBe('First')
    const second = stream.next()
    await send({ kind: 'create', title: 'Second', objective: 'Separate material', environmentIds: ['local'], maxAttempts: 3 })
    expect((await second).value?.records.find(item => item.kind === 'engagement')?.value.title).toBe('Second')
    const left = stream.next()
    await send({ kind: 'leave' })
    expect((await left).value?.records).toEqual([])
    const pending = stream.next()
    abort.abort()
    expect((await pending).done).toBe(true)
  } finally { abort.abort(); await stream.return?.() }
})

it('finds functional improvements in an isolated Loader Session and exports a coding task', async () => {
  const { ctx, agent, controller, model } = await load(false, 0, { evolution: { provider: 'fixture', model: 'fixture' } })
  const send = operator(controller, agent)
  await send({ kind: 'create', title: 'Parser workflow', objective: 'Inspect packet captures', environmentIds: ['local'], maxAttempts: 2 })
  await send({ kind: 'checkpoint', phase: 'assessment', title: 'Packet processing', reason: 'Compare captures',
    summary: 'Repeatedly wrote the same packet parser in successful tasks', next: 'Reuse parsing results', evidenceIds: [], findingIds: [] })
  const projectId = controller.binding(agent.id)!.engagementId
  const originalRevision = controller.view(agent.id).revision
  model.evolutionOutput = (prompt) => {
    const data = evolutionInputSchema.parse(JSON.parse(prompt.split('\nObservations: ')[1]!))
    expect(data.projectId).toBe(projectId)
    return JSON.stringify({ suggestions: [{ title: 'Reusable packet analysis', component: 'security analysis scripts',
      conditions: 'Tasks inspecting packet captures', problem: 'Each task writes the same parser', change: 'Ship a reusable parser tool',
      acceptance: ['Use the tool in two capture-analysis tasks'], uncertainty: 'Inspect existing script coverage', sourceIds: [data.sources[0]!.id] }] })
  }
  const before = await ctx.securityWorkbench.improvements()
  await ctx.securityWorkbench.analyzeImprovements(JSON.stringify({ operationId: 'first-analysis', projectId, expectedRevision: before.revision }))
  await vi.waitFor(async () => { expect((await ctx.securityWorkbench.improvements()).runs.at(-1)).toMatchObject({ status: 'completed', detail: '' }) })
  const result = await ctx.securityWorkbench.improvements(projectId)
  expect(result.proposals).toHaveLength(1)
  expect(controller.view(agent.id).revision).toBe(originalRevision)
  expect(model.requests.at(-1)?.tools ?? []).toHaveLength(0)
  expect((await ctx.securityWorkbench.exportImprovement(result.proposals[0]!.id)).markdown).toContain('AGENTS.md')
  const ownedSession = result.runs.at(-1)!.sessionId!
  await expect(ctx.agents.create({ sessionId: SessionId(ownedSession), agentOptions: { provider: 'fixture', model: 'fixture' } })).rejects.toThrow('read-only')
  const latest = await ctx.securityWorkbench.improvements()
  await ctx.securityWorkbench.analyzeImprovements(JSON.stringify({ operationId: 'repeat-analysis', projectId, expectedRevision: latest.revision }))
  await vi.waitFor(async () => { expect((await ctx.securityWorkbench.improvements()).runs.at(-1)).toMatchObject({ status: 'completed', detail: '' }) })
  expect(model.requests).toHaveLength(1)
  expect((await ctx.securityWorkbench.improvements()).proposals[0]?.occurrences).toHaveLength(1)
})

it('cancels improvement synthesis and waits for teardown before task stop returns', async () => {
  const { ctx, agent, controller, model } = await load(false, 0, { evolution: { provider: 'fixture', model: 'fixture' } })
  const send = operator(controller, agent)
  await send({ kind: 'create', title: 'Stop synthesis', objective: 'Review delegation', environmentIds: ['local'], maxAttempts: 2 })
  await send({ kind: 'checkpoint', phase: 'assessment', title: 'Context gaps', reason: 'Investigate',
    summary: 'Delegates repeatedly needed missing context', next: 'Improve assignment input', evidenceIds: [], findingIds: [] })
  const started = Promise.withResolvers<undefined>()
  let exited = false
  model.evolutionOutput = () => '{"suggestions":[]}'
  model.refinementWait = (signal): Promise<void> => new Promise((_resolve, reject) => {
    started.resolve(undefined)
    signal!.addEventListener('abort', () => { exited = true; reject(new Error('Fixture cancelled')) }, { once: true })
  })
  const before = await ctx.securityWorkbench.improvements()
  const projectId = controller.binding(agent.id)!.engagementId
  await ctx.securityWorkbench.analyzeImprovements(JSON.stringify({ operationId: 'slow-analysis', projectId, expectedRevision: before.revision }))
  await started.promise
  await send({ kind: 'stop' })
  expect(exited).toBe(true)
  expect((await ctx.securityWorkbench.improvements()).runs.at(-1)?.status).toBe('cancelled')
  expect((await ctx.securityWorkbench.improvements()).proposals).toHaveLength(0)
})

it('automatically analyzes newly settled work only after the configured idle interval', async () => {
  const { ctx, agent, controller, model } = await load(false, 0, { evolution: { auto: true, idleMs: 300000 } })
  await operator(controller, agent)({ kind: 'create', title: 'Idle analysis', objective: 'Review owned fixture', environmentIds: ['local'], maxAttempts: 2 })
  model.evolutionOutput = () => '{"suggestions":[]}'
  agent.followup(webPrompt('Summarize the available fixture without running external tools.'))
  await agent.whenIdle()
  await ctx.securityWorkbench.improvements()
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  try {
    ctx.emit('agent/status', { agent, status: 'idle' })
    await vi.advanceTimersByTimeAsync(0)
    expect((await ctx.securityWorkbench.improvements()).runs).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(300000)
    await vi.waitFor(async () => { expect((await ctx.securityWorkbench.improvements()).runs.at(-1)).toMatchObject({ status: 'completed', detail: '' }) })
    const count = model.requests.length
    await vi.advanceTimersByTimeAsync(600000)
    expect(model.requests).toHaveLength(count)
  } finally { await ctx.fiber.dispose(); vi.useRealTimers() }
})

it('keeps observed Session intervals with their task when the coordinator switches tasks', async () => {
  const { ctx, agent, controller, model } = await load(false, 0, { evolution: { provider: 'fixture', model: 'fixture' } })
  const send = operator(controller, agent)
  await send({ kind: 'create', title: 'Alpha', objective: 'Alpha analysis', environmentIds: ['local'], maxAttempts: 2 })
  const alpha = controller.binding(agent.id)!.engagementId
  agent.followup(webPrompt('ALPHA_ONLY observation'))
  await agent.whenIdle()
  await send({ kind: 'create', title: 'Beta', objective: 'Beta analysis', environmentIds: ['local'], maxAttempts: 2 })
  agent.followup(webPrompt('BETA_ONLY observation'))
  await agent.whenIdle()
  model.evolutionOutput = (prompt) => {
    const input = evolutionInputSchema.parse(JSON.parse(prompt.split('\nObservations: ')[1]!))
    expect(input.projectId).toBe(alpha)
    expect(input.sources.some(source => source.excerpt.includes('ALPHA_ONLY'))).toBe(true)
    expect(input.sources.some(source => source.excerpt.includes('BETA_ONLY'))).toBe(false)
    return '{"suggestions":[]}'
  }
  await vi.waitFor(async () => {
    const before = await ctx.securityWorkbench.improvements()
    await ctx.securityWorkbench.analyzeImprovements(JSON.stringify({ projectId: alpha,
      expectedRevision: before.revision, operationId: 'analyze-alpha' }))
  })
  await vi.waitFor(async () => { expect((await ctx.securityWorkbench.improvements()).runs.at(-1)).toMatchObject({ status: 'completed' }) })
})

it('denies unsolicited tools in improvement synthesis at the executor', async () => {
  const { ctx, agent, controller, model } = await load(false, 0, { evolution: { provider: 'fixture', model: 'fixture' } })
  const send = operator(controller, agent)
  await send({ kind: 'create', title: 'Tool denial', objective: 'Review workflow', environmentIds: ['local'], maxAttempts: 2 })
  await send({ kind: 'checkpoint', phase: 'assessment', title: 'Evidence', reason: 'Inspect',
    summary: 'Manual parsing', next: 'Reuse parsing', evidenceIds: [], findingIds: [] })
  const executed = vi.fn()
  ctx.on('tools/execute', async (exec, next) => { executed(exec.name); return next() })
  model.nativeCalls.push({ name: 'security_scope', args: {} })
  model.evolutionOutput = () => '{"suggestions":[]}'
  const denied: string[] = []
  ctx.on('session/event', (_session, event) => {
    if (event.type === 'tool/result' && event.data.message.isError) denied.push(JSON.stringify(event.data.message))
  })
  const before = await ctx.securityWorkbench.improvements()
  await ctx.securityWorkbench.analyzeImprovements(JSON.stringify({ projectId: controller.binding(agent.id)!.engagementId,
    expectedRevision: before.revision, operationId: 'deny-tool' }))
  await vi.waitFor(async () => { expect((await ctx.securityWorkbench.improvements()).runs.at(-1)).toMatchObject({ status: 'completed' }) })
  expect(executed).not.toHaveBeenCalled()
  expect(denied.join(' ')).toContain('Tools are unavailable')
})

it.each([
  { offered: ['low', 'high'], configured: undefined, expected: 'high' },
  { offered: ['low', 'high'], configured: 'low', expected: 'low' },
  { offered: ['high'], configured: undefined, expected: 'high' },
  { offered: [], configured: undefined, expected: undefined },
  { offered: ['low', 'high'], configured: 'unsupported', expected: undefined },
])('resolves improvement reasoning from provider capabilities: $offered / $configured', async ({ offered, configured, expected }) => {
  const { ctx, agent, controller, model } = await load(false, 0, { evolution: { provider: 'fixture', model: 'fixture',
    ...configured === undefined ? {} : { reasoningEffort: configured } } })
  if (offered.length) model.reasoning = { efforts: offered.map(id => ({ id: ReasoningEffortId(id), name: id })),
    defaultEffort: ReasoningEffortId('high') }
  const loggedEfforts: (ReasoningEffortId | undefined)[] = []
  ctx.on('session/event', (_session, event) => {
    if (event.type === 'request/header') loggedEfforts.push(event.data.header.config.reasoningEffort)
  })
  const send = operator(controller, agent)
  await send({ kind: 'create', title: 'Reasoning budget', objective: 'Review packet processing', environmentIds: ['local'], maxAttempts: 2 })
  await send({ kind: 'checkpoint', phase: 'assessment', title: 'Repeated conversion', reason: 'Review workflow',
    summary: 'Time mapping was reconstructed manually', next: 'Assess script reuse', evidenceIds: [], findingIds: [] })
  model.evolutionOutput = () => '{"suggestions":[]}'
  const before = await ctx.securityWorkbench.improvements()
  await ctx.securityWorkbench.analyzeImprovements(JSON.stringify({ projectId: controller.binding(agent.id)!.engagementId,
    expectedRevision: before.revision, operationId: 'reasoning-policy' }))
  await vi.waitFor(async () => {
    const run = (await ctx.securityWorkbench.improvements()).runs.at(-1)
    expect(run?.status).toBe(configured === 'unsupported' ? 'failed' : 'completed')
    if (configured === 'unsupported') expect(run?.detail).toContain('evolution.reasoningEffort "unsupported" is unsupported')
  })
  const requests = model.requests.filter(request => request.messages.some(message => message.content.some(block =>
    block.type === 'text' && block.text.includes('\nObservations: '))))
  if (configured === 'unsupported') expect(requests).toHaveLength(0)
  else {
    expect(requests).toHaveLength(1)
    expect(requests[0]?.reasoningEffort).toBe(expected)
    expect(requests[0]?.maxTokens).toBe(24576)
    expect(loggedEfforts).toEqual([expected])
  }
})

it('reports an exhausted synthesis budget and accepts an explicit retry', async () => {
  const { ctx, agent, controller, model } = await load(false, 0, { evolution: { provider: 'fixture', model: 'fixture' } })
  const send = operator(controller, agent)
  await send({ kind: 'create', title: 'Output budget', objective: 'Review source observations', environmentIds: ['local'], maxAttempts: 2 })
  await send({ kind: 'checkpoint', phase: 'assessment', title: 'Repeated conversion', reason: 'Review workflow',
    summary: 'Time mapping was reconstructed manually', next: 'Assess script reuse', evidenceIds: [], findingIds: [] })
  model.evolutionOutput = () => '{"suggestions":[]}'
  model.evolutionTruncated = true
  const projectId = controller.binding(agent.id)!.engagementId
  const before = await ctx.securityWorkbench.improvements()
  await ctx.securityWorkbench.analyzeImprovements(JSON.stringify({ projectId, expectedRevision: before.revision, operationId: 'budget-first' }))
  await vi.waitFor(async () => {
    const run = (await ctx.securityWorkbench.improvements()).runs.at(-1)
    expect(run?.status).toBe('failed')
    expect(run?.detail).toContain('output-token limit')
  })
  const failed = await ctx.securityWorkbench.improvements()
  expect(failed.proposals).toHaveLength(0)
  expect(failed.runs).toHaveLength(1)
  model.evolutionTruncated = false
  await ctx.securityWorkbench.analyzeImprovements(JSON.stringify({ projectId, expectedRevision: failed.revision, operationId: 'budget-retry' }))
  await vi.waitFor(async () => { expect((await ctx.securityWorkbench.improvements()).runs.at(-1)?.status).toBe('completed') })
})

it('serializes improvement analysis across independently queued tasks', async () => {
  const { ctx, agent, controller, model } = await load(false, 0, { evolution: { provider: 'fixture', model: 'fixture', concurrency: 1 } })
  const send = operator(controller, agent)
  const projects: string[] = []
  for (const title of ['Packet timing', 'Firmware timing']) {
    await send({ kind: 'create', title, objective: title, environmentIds: ['local'], maxAttempts: 2 })
    await send({ kind: 'checkpoint', phase: 'assessment', title, reason: 'Review workflow',
      summary: 'Repeated manual time conversion', next: 'Consider a shared script', evidenceIds: [], findingIds: [] })
    projects.push(controller.binding(agent.id)!.engagementId)
  }
  const releases: (() => void)[] = []
  let concurrent = 0
  let peak = 0
  model.evolutionOutput = () => '{"suggestions":[]}'
  model.refinementWait = async (signal) => {
    concurrent++; peak = Math.max(peak, concurrent)
    try { await new Promise<void>((resolve, reject) => {
      if (signal?.aborted) { reject(new Error('Fixture cancelled')); return }
      const abort = () => { reject(new Error('Fixture cancelled')) }
      signal?.addEventListener('abort', abort, { once: true })
      releases.push(() => { signal?.removeEventListener('abort', abort); resolve() })
    }) }
    finally { concurrent-- }
  }
  for (const projectId of projects) {
    const view = await ctx.securityWorkbench.improvements()
    await ctx.securityWorkbench.analyzeImprovements(JSON.stringify({ projectId, expectedRevision: view.revision, operationId: projectId }))
    if (projectId === projects[0]) await vi.waitFor(() => { expect(releases).toHaveLength(1) })
  }
  expect((await ctx.securityWorkbench.improvements()).runs.map(run => run.status)).toEqual(['running', 'queued'])
  releases[0]!()
  await vi.waitFor(() => { expect(releases).toHaveLength(2) })
  expect(peak).toBe(1)
  releases[1]!()
  await vi.waitFor(async () => { expect((await ctx.securityWorkbench.improvements()).runs.map(run => run.status)).toEqual(['completed', 'completed']) })
})

it('settles a timed-out improvement request without publishing or retrying it', async () => {
  const { ctx, agent, controller, model } = await load(false, 0, { evolution: { provider: 'fixture', model: 'fixture', timeoutMs: 50 } })
  const send = operator(controller, agent)
  await send({ kind: 'create', title: 'Timeout', objective: 'Review workflow', environmentIds: ['local'], maxAttempts: 2 })
  await send({ kind: 'checkpoint', phase: 'assessment', title: 'Source', reason: 'Review workflow',
    summary: 'A repeated manual conversion', next: 'Consider reuse', evidenceIds: [], findingIds: [] })
  model.evolutionOutput = () => '{"suggestions":[]}'
  model.refinementWait = signal => new Promise((_resolve, reject) => {
    if (signal?.aborted) { reject(new Error('Fixture cancelled')); return }
    signal?.addEventListener('abort', () => { reject(new Error('Fixture cancelled')) }, { once: true })
  })
  const view = await ctx.securityWorkbench.improvements()
  await ctx.securityWorkbench.analyzeImprovements(JSON.stringify({ projectId: controller.binding(agent.id)!.engagementId,
    expectedRevision: view.revision, operationId: 'timeout' }))
  await vi.waitFor(async () => {
    const result = await ctx.securityWorkbench.improvements()
    expect(result.runs).toHaveLength(1)
    expect(result.runs[0]?.status).toBe('failed')
    expect(result.runs[0]?.detail).toContain('TimeoutError')
    expect(result.proposals).toHaveLength(0)
  })
})
