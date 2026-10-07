/** Logged, tool-free model synthesis shared by security summaries and improvements. @module */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage, type ReasoningEffortId } from '@deepseek-ai/dsh-llm'

/** Fully resolved model selection and output limits for an isolated request. */
export interface SynthesisRequest {
  provider: string
  model: string
  maxTokens: number
  /** Resolved provider-supported effort; omission keeps the provider default. */
  reasoningEffort?: ReasoningEffortId | undefined
  instructions: string
  prompt: string
  signal: AbortSignal
  cwd?: string | undefined
  sessionId?: string
}

/** Run one persistent, isolated Session with executor-level tool denial.
 * @param ctx - Agent and prompt services.
 * @param request - resolved route, exact input and cancellation owner.
 * @returns completed visible model text after Agent teardown. */
export async function synthesize(ctx: Context, request: SynthesisRequest): Promise<string> {
  const { provider, model, signal, reasoningEffort } = request
  const result = { output: '', completed: false, failure: '' }
  const handle = await ctx.agents.create({
    sessionId: brandString<SessionId>(request.sessionId ?? randomUUID()),
    meta: { cwd: request.cwd ?? process.cwd() },
    agentOptions: { provider, model, maxTokens: request.maxTokens }, signal,
    setup: (scoped, agent) => {
      installModelSelection(scoped, { current: { provider, model,
        ...reasoningEffort === undefined ? {} : { reasoningEffort } }, assembled: undefined })
      scoped.effect(() => scoped.tools.presentAs('native'))
      scoped.effect(() => scoped.tools.restrict({ allow: [] }))
      scoped.tools.guard(() => 'Tools are unavailable in a synthesis Session')
      scoped.systemPrompt.section({ name: 'security:workbench',
        order: scoped.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX'), text: request.instructions, interpolate: false })
      scoped.on('session/event', (session, event) => {
        if (session.id !== agent.id) return
        if (event.type === 'assistant/message') result.output = event.data.message.content.filter(block => block.type === 'text').map(block => block.text).join('')
        if (event.type === 'turn/end') {
          result.completed = event.data.reason.kind === 'completed'
          if (event.data.reason.kind === 'error') result.failure = event.data.reason.error.message
          else if (event.data.reason.kind === 'max-tokens') result.failure = 'Synthesis reached its output-token limit; increase the configured output budget and retry'
          else if (!result.completed) result.failure = `Synthesis stopped: ${event.data.reason.kind}`
        }
      })
    },
  })
  const cancel = () => { handle.agent.cancel({ kind: 'parent' }) }
  signal.addEventListener('abort', cancel, { once: true })
  try {
    signal.throwIfAborted()
    handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: request.prompt }], source: { kind: 'user' } }))
    await handle.agent.whenIdle()
    signal.throwIfAborted()
    if (!result.completed) throw new Error(result.failure || 'Synthesis model did not complete')
    return result.output
  } finally { signal.removeEventListener('abort', cancel); await handle.dispose() }
}
