/** Real Loader composition for scoped evidence, workflow, and tool enforcement. */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Agents from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Llm, { LlmAdapter, ToolCallId, createUserMessage } from '@deepseek-ai/dsh-llm'
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
import { createScope, bindScopeParent, scopeOf } from '@deepseek-ai/dsh-scope'
import Approval from '@deepseek-ai/dsh-user-approval'
import Skills from '@deepseek-ai/dsh-skill'
import * as ToolSkill from '@deepseek-ai/dsh-tool-skill'
import Security from '../src/workbench/index.ts'
import { findingHash } from '../src/workbench/assessment.ts'
import type { SessionBinding } from '../src/workbench/model.ts'
import * as Ghidra from '../src/ghidra-provider.ts'
import * as Frida from '../src/frida-provider.ts'
import * as Android from '../src/android-provider.ts'
import * as Web from '../src/web-provider.ts'
import * as Offline from '../src/offline-provider.ts'
import * as Laboratory from '../src/laboratory.ts'
import * as Environments from '../src/environment-local.ts'

const contexts: Context[] = []
const roots: string[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

class ScopeModel extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  firstSkill: string | undefined
  scopeCalls = 1
  usageTokens = 0
  reportFailure = false
  childReport: NonNullable<SessionBinding['report']> = {
    summary: 'Assigned evidence review completed.', evidenceIds: [], uncertainty: 'No observations collected.', nextSteps: [],
  }
  refinementOutput: ((prompt: string) => string) | undefined
  reportOutput: ((prompt: string) => string) | undefined
  refinementWait: ((signal: AbortSignal | undefined) => Promise<void>) | undefined
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, inputModalities: ['text'] })
  }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const refinement = options.messages.flatMap(message => message.content).filter(block => block.type === 'text').map(block => block.text).find(text => text.includes('\nNotes: '))
    const report = options.messages.flatMap(message => message.content).filter(block => block.type === 'text').map(block => block.text).find(text => text.includes('Write a concise Chinese security brief'))
    if (this.usageTokens) yield { type: 'usage', usage: { inputTokens: this.usageTokens, outputTokens: 0 } }
    if (report && this.reportFailure) {
      yield { type: 'finish', reason: { kind: 'error', failure: { message: 'Fixture model rejected report', code: 'UNKNOWN' } } }
      return
    }
    if ((refinement && this.refinementOutput) || (report && this.reportOutput)) {
      await this.refinementWait?.(options.signal)
      const text = refinement && this.refinementOutput ? this.refinementOutput(refinement) : this.reportOutput!(report!)
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    } else if (options.tools?.some(tool => tool.name === 'structured_output')) {
      const call = { type: 'tool-call' as const, id: ToolCallId('report'), name: 'structured_output',
        arguments: JSON.stringify(this.childReport) }
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: call.id, name: call.name, argumentsDelta: call.arguments }
      yield { type: 'block-end', index: 0, block: call }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else if (this.requests.length <= this.scopeCalls) {
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
  options: { dedicatedModel?: boolean; analysisTurnTokens?: number; skills?: boolean; taskIntake?: 'current' | 'other' } = {}) {
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
    ['offline', Offline],
    ['laboratory', Laboratory],
  ])
  if (options.skills) {
    modules.set('skills', Skills)
    modules.set('tool-skill', ToolSkill)
  }
  const configPath = join(root, 'cordis.yml')
  await writeFile(
    configPath,
    JSON.stringify(
      [...modules.keys()].map(name => ({
        id: name,
        name,
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
                      ...(options.analysisTurnTokens === undefined ? {} : { analysisTurnTokens: options.analysisTurnTokens }),
                      ...(options.taskIntake ? { taskIntake: { maxAttempts: 3, workspaces: [
                        { cwd: options.taskIntake === 'current' ? root : join(root, 'other'), environmentIds: ['local'] },
                      ] } } : {}),
                      root: join(root, 'workbench'), importRoots: [root],
                      environments: [{ id: 'local', kind: 'local', label: 'Host', cwd: root, tools: [] }] }
                    : {},
      })),
    ),
  )
  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error('Unexpected fixture module ' + specifier)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  const controller = await ctx.securityWorkbench.ready
  const presetKey = {}
  if (inheritJobTool) {
    const preset = createScope(ctx.plugin(() => {}).ctx, presetKey).ctx
    await preset.plugin({ inject: ['tools'], apply(scoped: Context) { independentTool(scoped, 'job_output') } })
  }
  const { agent } = await ctx.agents.create({
    sessionId: SessionId('coordinator'),
    ...(inheritJobTool ? { setup(agentCtx: Context) { bindScopeParent(scopeOf(agentCtx)!, presetKey) } } : {}),
    meta: { cwd: root },
    agentOptions: { provider: 'fixture', model: 'fixture' },
  })
  return { ctx, agent, controller, model, shell }
}
function execute(ctx: Context, agent: Agent, name: string, args: Record<string, unknown> = {}) {
  return ctx.tools.execute({
    agent,
    name,
    arguments: args,
    callId: ToolCallId('call-' + name),
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
  it('persists scoped child evidence reports without requiring or creating a finding review', async () => {
    const { ctx, agent, controller, model } = await load(true)
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
    for (const role of ['reconnaissance', 'reviewer'] as const) {
      const result = await execute(ctx, agent, 'security_delegate', {
        assetId: asset.value.id, role, question: 'Inspect the assigned scope.', criterion: 'Return a scoped structured report.',
      })
      expect(result.isError, JSON.stringify(result)).toBe(false)
      const { jobId } = JSON.parse(result.content.filter(block => block.type === 'text').map(block => block.text).join('')) as { jobId: string }
      const job = await ctx.jobs.wait(JobId(jobId), 10000, agent)
      expect(job.status, JSON.stringify(job)).toBe('completed')
      expect(ctx.jobs.read(JobId(jobId), agent).text).toContain('Assigned evidence review completed.')
      expect(controller.view(agent.id).records.filter(item => item.kind === 'binding').filter(item => item.value.role === role)
        .map(item => item.value.report)).toContainEqual(model.childReport)
      expect(controller.view(agent.id).records.filter(item => item.kind === 'finding' || item.kind === 'review')).toEqual([])
      const child = model.requests.at(-1)!
      const names = child.tools?.map(tool => tool.name)
      expect(names).toContain('structured_output')
      expect(names).not.toContain('shell')
      expect(names).not.toContain('security_execute')
      expect(names).not.toContain('security_delegate')
    }
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
    expect(controller.providers.list().sort()).toEqual(['android', 'binary', 'frida', 'ghidra', 'offline', 'source', 'web'])
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
    expect(scope.data.message.content[0].isError).not.toBe(true)
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

  it.each(['disabled', 'unmapped'] as const)('starts a task after saving resources for a %s workspace', async (mapping) => {
    const { ctx, agent, controller, model } = await load(false, 0, mapping === 'unmapped' ? { taskIntake: 'other' } : {})
    expect(JSON.parse(await ctx.securityWorkbench.configuration(agent))).toMatchObject({
      workspace: { cwd: agent.session.header.cwd, configured: false, revision: 0, environmentIds: [] },
    })
    agent.followup(webPrompt('Inspect the current workspace.'))
    await agent.whenIdle()
    expect(controller.projects()).toEqual([])
    expect(controller.binding(agent.id)).toBeUndefined()
    const saved = await ctx.securityWorkbench.configureWorkspace(agent, JSON.stringify({
      expectedRevision: 0, environmentIds: ['local'], maxAttempts: 5,
    }))
    expect(JSON.parse(saved)).toMatchObject({
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

  it('keeps an empty resource selection disabled instead of restoring the static mapping', async () => {
    const { ctx, agent, controller } = await load(false, 0, { taskIntake: 'current' })
    expect(JSON.parse(await ctx.securityWorkbench.configuration(agent))).toMatchObject({
      workspace: { configured: true, revision: 0, environmentIds: ['local'] },
    })
    const saved = await ctx.securityWorkbench.configureWorkspace(agent, JSON.stringify({
      expectedRevision: 0, environmentIds: [], maxAttempts: 4,
    }))
    expect(JSON.parse(saved)).toMatchObject({
      workspace: { configured: true, revision: 1, environmentIds: [], maxAttempts: 4 },
    })
    await expect(ctx.securityWorkbench.configureWorkspace(agent, JSON.stringify({
      expectedRevision: 0, environmentIds: ['local'], maxAttempts: 2,
    }))).rejects.toThrow('Workspace resource configuration changed')
    expect(await ctx.securityWorkbench.configuration(agent)).toBe(saved)
    agent.followup(webPrompt('Inspect the supplied firmware.'))
    await agent.whenIdle()
    expect(controller.projects()).toEqual([])
    expect(controller.binding(agent.id)).toBeUndefined()
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
    expect(await ctx.securityWorkbench.configuration(agent)).toBe(configuration)
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
      await controller.bindChild(agent.id, child.id, [asset.value.id], 'researcher')
    } else {
      expect(controller.binding(child.id)).toBeUndefined()
    }
    const configuration = await ctx.securityWorkbench.configuration(agent)
    await expect(ctx.securityWorkbench.configureWorkspace(child, JSON.stringify({
      expectedRevision: 0, environmentIds: ['local'], maxAttempts: 4,
    }))).rejects.toThrow('Delegated sessions cannot configure workspace resources')
    expect(await ctx.securityWorkbench.configuration(agent)).toBe(configuration)
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
      'security-firmware', 'security-investigation', 'security-iot-offline', 'security-web',
    ])
    const loaded = events.find(event => event.type === 'tool/result')
    if (loaded?.type !== 'tool/result') throw new Error('Missing loaded skill result')
    expect(loaded.data.message.content[0].isError).not.toBe(true)
    const text = loaded.data.message.content[0].content.filter(block => block.type === 'text').map(block => block.text).join('')
    expect(text).toContain('<skill_content name="security-web">')
    expect(text).toContain('expected authorization rule')
    expect(model.requests[1]?.messages).toContainEqual(loaded.data.message)
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
    const root = roots[roots.length - 1]!
    await writeFile(join(root, 'sample.bin'), 'sample strings')
    const send = operator(controller, agent)
    await send({ kind: 'create', title: 'Role check', objective: 'Inspect owned fixture', environmentIds: ['local'], maxAttempts: 2 })
    await send({ kind: 'import', path: join(root, 'sample.bin'), label: 'sample' })
    const asset = controller.view(agent.id).records.find(item => item.kind === 'asset')!
    if (asset.kind !== 'asset') throw new Error('Missing asset')
    for (const role of ['reconnaissance', 'reverse-analyst', 'researcher', 'reviewer'] as const) {
      const id = SessionId('child-' + role)
      await controller.bindChild(agent.id, id, [asset.value.id], role)
      const { agent: child } = await ctx.agents.create({ sessionId: id, parentAgent: agent,
        meta: { parentSession: agent.id, origin: 'subagent', delegationDepth: 1 } })
      const visible = ctx.tools.schemas(child).map(tool => tool.name)
      expect(visible).toContain('skill')
      expect((await execute(ctx, child, 'skill', { name: 'security-investigation' })).isError).toBe(false)
      expect(visible).not.toContain('security_execute')
      expect(visible).not.toContain('security_delegate')
      expect(visible.includes('security_static')).toBe(['reconnaissance', 'reverse-analyst'].includes(role))
      for (const name of ['security_execute', 'security_delegate', 'security_command'])
        expect((await execute(ctx, child, name)).isError).toBe(true)
      const capabilities = await execute(ctx, child, 'security_capabilities')
      expect(capabilities.isError).toBe(false)
      expect(JSON.stringify(capabilities)).toContain('hexadecimal address')
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
  await controller.bindChild(agent.id, 'report-reviewer', [asset.value.id], 'reviewer')
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

it('stops project analysis before another model request when the turn token budget is reached', async () => {
  const { agent, controller, model } = await load(false, 0, { analysisTurnTokens: 1000 })
  const send = operator(controller, agent)
  await send({ kind: 'create', title: 'Bounded analysis', objective: 'Inspect source', environmentIds: ['local'], maxAttempts: 1 })
  model.usageTokens = 1200
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Inspect the project.' }], source: { kind: 'user' } }))
  await agent.whenIdle()
  expect(model.requests).toHaveLength(1)
  const end = agent.session.snapshotEvents().findLast(event => event.type === 'turn/end')
  expect(end?.type === 'turn/end' && end.data.reason.kind === 'error'
    ? end.data.reason.error.message : '').toContain('1000-token budget')
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
  await controller.bindChild(agent.id, childId, [asset.value.id], 'reviewer')
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
    expect(result.data.message.content[0].isError).toBe(true)
    expect(JSON.stringify(result.data.message)).toContain(reason)
    expect(dispatch).not.toHaveBeenCalled()
    expect(controller.projects()).toEqual([])
    expect(controller.binding(agent.id)).toBeUndefined()
  },
)
