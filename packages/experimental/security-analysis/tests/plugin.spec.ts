/** Real Loader composition for scoped evidence, workflow, and tool enforcement. */
import { createServer } from 'node:http'
import type { Server } from 'node:http'
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
import Approval from '@deepseek-ai/dsh-user-approval'
import * as Security from '../src/legacy.ts'
import type { SecurityRecord } from '../src/store.ts'

const contexts: Context[] = []
const roots: string[] = []
const servers: Server[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(
    servers.splice(0).map(
      server =>
        new Promise<void>((resolve, reject) => {
          if (!server.listening) {
            resolve()
            return
          }
          server.closeAllConnections()
          server.close((error) => {
            if (error) reject(error)
            else resolve()
          })
        }),
    ),
  )
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

class ScopeModel extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, inputModalities: ['text'] })
  }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    if (this.requests.length === 1) {
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

async function load(existingRoot?: string, endpoint?: string) {
  const root = existingRoot ?? (await mkdtemp(join(tmpdir(), 'dsh-security-composition-')))
  if (existingRoot === undefined) roots.push(root)
  const requests: string[] = []
  if (endpoint === undefined) {
    const server = createServer((request, response) => {
      requests.push(request.url ?? '')
      response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
      response.end('0x401000 parse_packet\n0x401100 verify_header')
    })
    servers.push(server)
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject)
        resolve()
      })
    })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('Fixture did not acquire a loopback port')
    endpoint = `http://127.0.0.1:${address.port}`
  }
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
  ])
  const securityConfig = {
    engagementId: 'fixture-engagement',
    objective: 'Analyze the owned packet parser',
    dynamicPolicy: 'disabled',
    assets: [
      {
        id: 'sample',
        label: 'Owned parser',
        sha256: 'a'.repeat(64),
        ghidra: { baseUrl: endpoint, programBinding: 'owned-parser' },
      },
    ],
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
              ? { root: join(root, 'knowledge') }
              : name === 'storage-domain'
                ? { backend: 'json' }
                : name === 'security'
                  ? securityConfig
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
      if (!modules.has(specifier)) throw new Error(`Unexpected fixture module ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  const security = [...ctx.loader.entries()].find(entry => entry.options.id === 'security')?.fiber
  if (security === undefined) throw new Error('Security plugin was not loaded')
  await security.await()
  const { agent } = await ctx.agents.create({
    sessionId: SessionId('coordinator'),
    meta: { cwd: root },
    agentOptions: { provider: 'fixture', model: 'fixture' },
  })
  return { ctx, root, endpoint, requests, model, agent, security, shell }
}

function execute(ctx: Context, agent: Agent | undefined, name: string, args: Record<string, unknown> = {}) {
  return ctx.tools.execute({
    ...(agent === undefined ? {} : { agent }),
    name,
    arguments: args,
    callId: ToolCallId(`${name}-call`),
    signal: new AbortController().signal,
  })
}

function resultText(result: Awaited<ReturnType<typeof execute>>): string {
  return result.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')
}

async function record(
  ctx: Context,
  agent: Agent,
  kind: string,
  evidenceIds: string[] = [],
  status = kind === 'hypothesis' ? 'suspected' : 'observed',
) {
  return execute(ctx, agent, 'security_record', {
    assetId: 'sample',
    kind,
    title: `${kind} packet parser`,
    text: 'The configured packet parser is under analysis.',
    status,
    evidenceIds,
    tags: ['parser'],
  })
}

describe('security analysis Loader composition', () => {
  it('publishes scope and workflow guidance through the real model loop and session log', async () => {
    const { ctx, model, agent } = await load()
    agent.followup(
      createUserMessage({ content: [{ type: 'text', text: 'Inspect the analysis scope.' }], source: { kind: 'user' } }),
    )
    await agent.whenIdle()
    expect(model.requests).toHaveLength(2)
    expect(model.requests[0]?.tools?.map(tool => tool.name)).toContain('security_scope')
    expect(model.requests[0]?.tools?.map(tool => tool.name)).not.toContain('shell')
    const events = agent.session.snapshotEvents()
    expect(events.some(event => event.type === 'tool/call')).toBe(true)
    const logged = events.find(event => event.type === 'tool/result')
    expect(JSON.stringify(logged)).toContain('fixture-engagement')
    expect(JSON.stringify(logged)).toContain('operator-declared')
    const toolReply = model.requests[1]?.messages
      .flatMap(message => message.content)
      .find(block => block.type === 'tool-result')
    expect(toolReply).toMatchObject({ toolCallId: 'scope-call', isError: false })
    const prompt = await ctx.systemPrompt.assemble({ agent, scope: agent, signal: new AbortController().signal })
    expect(prompt.sections.find(section => section.name === 'security:workflow')?.text).toContain(
      'controlled validation',
    )
  })

  it('requires recorded phase evidence, persists static observations, and refuses unsupported validation', async () => {
    const loaded = await load()
    const { ctx, agent } = loaded
    expect((await execute(ctx, agent, 'security_scope')).value).toMatchObject({ phase: 'recon', role: 'coordinator' })
    const advance = (phase: string) =>
      execute(ctx, agent, 'security_workflow', { phase, rationale: 'Evidence supports this stage.' })
    expect(resultText(await advance('validation'))).toContain('cannot skip')
    expect(resultText(await advance('surface'))).toContain("requires at least one 'asset'")
    expect((await record(ctx, agent, 'asset')).isError).toBe(false)
    expect((await advance('surface')).value).toMatchObject({ phase: 'surface' })
    expect(resultText(await advance('assessment'))).toContain("requires at least one 'surface'")
    const observation = await execute(ctx, agent, 'security_static', {
      assetId: 'sample',
      operation: 'functions',
      limit: 2,
    })
    expect(observation.isError).toBe(false)
    const evidence = observation.value as SecurityRecord
    expect(evidence).toMatchObject({
      kind: 'evidence',
      evidenceType: 'static',
      status: 'observed',
      text: expect.stringContaining('parse_packet') as unknown,
    })
    expect(loaded.requests).toEqual(['/methods?offset=0&limit=2'])
    expect((await record(ctx, agent, 'surface', [evidence.id])).isError).toBe(false)
    expect((await advance('assessment')).value).toMatchObject({ phase: 'assessment' })
    expect(resultText(await record(ctx, agent, 'validation', [evidence.id], 'confirmed'))).toContain(
      'advance to the validation phase',
    )
    const hypothesisResult = await record(ctx, agent, 'hypothesis', [evidence.id])
    expect(hypothesisResult.isError).toBe(false)
    const hypothesis = hypothesisResult.value as SecurityRecord
    expect((await advance('validation')).value).toMatchObject({ phase: 'validation' })
    for (const refs of [[], [evidence.id], [hypothesis.id], [evidence.id, hypothesis.id]]) {
      expect(resultText(await record(ctx, agent, 'validation', refs, 'confirmed'))).toContain(
        'hypothesis and dynamic evidence',
      )
    }
    const dynamic = {
      assetId: 'sample',
      operation: 'modules',
      expectedObservation: 'Module presence.',
      impact: 'Read metadata only.',
    }
    expect(
      resultText(await execute(ctx, agent, 'security_dynamic', { ...dynamic, hypothesisId: 'missing' })),
    ).toContain('same-asset vulnerability hypothesis')
    expect(
      resultText(await execute(ctx, agent, 'security_dynamic', { ...dynamic, hypothesisId: hypothesis.id })),
    ).toContain('disabled')
    expect(
      (await execute(ctx, agent, 'security_search', { query: 'parse_packet', assetId: 'sample' })).value,
    ).toMatchObject({ records: [{ id: evidence.id }], total: 1 })
    expect((await execute(ctx, agent, 'security_static', { assetId: 'outside', operation: 'functions' })).isError).toBe(
      true,
    )
    await ctx.fiber.dispose()
    const reopened = await load(loaded.root, loaded.endpoint)
    expect((await execute(reopened.ctx, reopened.agent, 'security_scope')).value).toMatchObject({ phase: 'validation' })
    expect((await execute(reopened.ctx, reopened.agent, 'security_search', { id: evidence.id })).value).toEqual(
      evidence,
    )
  })

  it('rejects shell, late tools, descendant writes and ownerless calls after a forced allow', async () => {
    const { ctx, agent, shell } = await load()
    const late = independentTool(agent.ctx, 'new_shell')
    const { agent: child } = await ctx.agents.create({
      sessionId: SessionId('recon-child'),
      parentAgent: agent,
      meta: { parentSession: agent.id, origin: 'subagent', delegationDepth: 1 },
    })
    ctx.on('tools/pre-execute', async () => ({ kind: 'allow' }))
    for (const name of ['shell', 'new_shell']) {
      expect((await execute(ctx, agent, name)).isError).toBe(true)
      expect((await execute(ctx, child, name)).isError).toBe(true)
    }
    expect(shell).not.toHaveBeenCalled()
    expect(late).not.toHaveBeenCalled()
    expect((await execute(ctx, child, 'security_scope')).value).toMatchObject({ role: 'reconnaissance' })
    for (const [name, args] of [
      [
        'security_record',
        {
          assetId: 'sample',
          kind: 'asset',
          title: 'Asset',
          text: 'Asset',
          status: 'observed',
          evidenceIds: [],
          tags: [],
        },
      ],
      ['security_workflow', { phase: 'surface', rationale: 'Escalate.' }],
      [
        'security_dynamic',
        {
          assetId: 'sample',
          hypothesisId: 'missing',
          operation: 'modules',
          expectedObservation: 'Metadata',
          impact: 'Bounded',
        },
      ],
      ['security_delegate', { assetId: 'sample', question: 'Delegate again.' }],
    ] as const) {
      expect((await execute(ctx, child, name, args)).isError).toBe(true)
    }
    expect(resultText(await execute(ctx, undefined, 'security_scope'))).toContain('owning session')
    expect((await execute(ctx, child, 'security_static', { assetId: 'sample', operation: 'imports' })).isError).toBe(
      false,
    )
  })

  it('removes tools, prompt guidance, and execution restrictions when the plugin is disposed', async () => {
    const { ctx, agent, security, shell } = await load()
    expect((await execute(ctx, agent, 'shell')).isError).toBe(true)
    await security.dispose()
    expect(ctx.tools.schemas(agent).some(tool => tool.name.startsWith('security_'))).toBe(false)
    const prompt = await ctx.systemPrompt.assemble({ agent, scope: agent, signal: new AbortController().signal })
    expect(prompt.sections.some(section => section.name === 'security:workflow')).toBe(false)
    expect((await execute(ctx, agent, 'shell')).isError).toBe(false)
    expect(shell).toHaveBeenCalledOnce()
    expect((await execute(ctx, undefined, 'shell')).isError).toBe(false)
  })
})
