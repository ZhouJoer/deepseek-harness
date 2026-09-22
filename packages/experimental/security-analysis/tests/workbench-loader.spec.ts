/** Real Loader composition for scoped evidence, workflow, and tool enforcement. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
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
import Security from '../src/workbench/index.ts'
import * as Ghidra from '../src/ghidra-provider.ts'
import * as Frida from '../src/frida-provider.ts'
import * as Android from '../src/android-provider.ts'
import * as Web from '../src/web-provider.ts'
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
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, inputModalities: ['text'] })
  }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    if (options.tools?.some(tool => tool.name === 'structured_output')) {
      const call = { type: 'tool-call' as const, id: ToolCallId('report'), name: 'structured_output',
        arguments: JSON.stringify({ summary: 'Assigned evidence review completed.', evidenceIds: [], uncertainty: 'No observations collected.', nextSteps: [] }) }
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: call.id, name: call.name, argumentsDelta: call.arguments }
      yield { type: 'block-end', index: 0, block: call }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    } else if (this.requests.length === 1) {
      const call = { type: 'tool-call' as const, id: ToolCallId('scope-call'), name: 'security_scope', arguments: '{}' }
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

async function load(inheritJobTool = false) {
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
    ['laboratory', Laboratory],
  ])
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
                    ? { root: join(root, 'workbench'), importRoots: [root], environments: [{ id: 'local', kind: 'local', label: 'Host', cwd: root, tools: [] }] }
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

function operator(controller: Awaited<Security['ready']>, agent: Agent) {
  return (action: Record<string, unknown>) => controller.command(agent.id, {
    operationId: JSON.stringify(action), expectedRevision: controller.view(agent.id).revision, action,
  }, true)
}

describe('security workbench Loader composition', () => {
  it('creates scoped reconnaissance and reviewer children with the driver-owned structured tool', async () => {
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
    for (const role of ['reconnaissance', 'reviewer'] as const) {
      const result = await execute(ctx, agent, 'security_delegate', {
        assetId: asset.value.id, role, question: 'Inspect the assigned scope.', criterion: 'Return a scoped structured report.',
      })
      expect(result.isError, JSON.stringify(result)).toBe(false)
      const { jobId } = JSON.parse(result.content.filter(block => block.type === 'text').map(block => block.text).join('')) as { jobId: string }
      const job = await ctx.jobs.wait(JobId(jobId), 10000, agent)
      expect(job.status, JSON.stringify(job)).toBe('completed')
      expect(ctx.jobs.read(JobId(jobId), agent).text).toContain('Assigned evidence review completed.')
      const child = model.requests.at(-1)!
      const names = child.tools?.map(tool => tool.name)
      expect(names).toContain('structured_output')
      expect(names).not.toContain('shell')
      expect(names).not.toContain('security_execute')
      expect(names).not.toContain('security_delegate')
    }
  })

  it('loads independent providers and logs model-visible scope through the unchanged loop', async () => {
    const { ctx, agent, controller, model } = await load()
    expect(controller.providers.list().sort()).toEqual(['android', 'binary', 'frida', 'ghidra', 'web'])
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
    const { ctx, agent, controller } = await load()
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
  const started = Promise.withResolvers<void>()
  const manager = controller.laboratories.get('local')
  const action = vi.spyOn(manager, 'action').mockImplementation(() => controller.manageEnvironment('shutdown-fixture', signal => {
    started.resolve()
    return new Promise(resolve => {
      signal.addEventListener('abort', () => resolve({ revision: 0, records: [] }), { once: true })
    })
  }))
  try {
    const pending = ctx.securityWorkbench.laboratory('fixture', 'inspect', 'fixture')
    await started.promise
    await ctx.fiber.dispose()
    expect(await pending).toEqual({ revision: 0, records: [] })
  } finally { action.mockRestore() }
})
