/** Per-turn exploration accounting and a single logged budget wrap-up. @module */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { WorkbenchConfig } from './index.ts'

type BudgetConfig = Pick<WorkbenchConfig, 'analysisTurnTokens' | 'analysisCountCacheReads'>
interface TurnBudget {
  used: number
  last: number
  closing: boolean
}

/** Install per-Session accounting without changing provider usage or billing totals.
 * @param ctx - security plugin context owning the listeners and tool guard.
 * @param config - resolved exploration limit and cache accounting policy.
 * @param hasTask - whether the Session currently belongs to an analysis task.
 */
export function installAnalysisBudget(ctx: Context, config: BudgetConfig, hasTask: (id: SessionId) => boolean): void {
  const turns = new Map<SessionId, TurnBudget>()
  const closingState = (agent: Agent): TurnBudget | undefined => {
    const state = turns.get(agent.id)
    return hasTask(agent.id) && state !== undefined
      && (state.closing || state.used + state.last >= config.analysisTurnTokens) ? state : undefined
  }
  ctx.on('session/event', (session, event) => {
    if (event.type === 'turn/start' || event.type === 'turn/end') {
      turns.delete(session.id)
    } else if (event.type === 'assistant/message' && event.data.usage) {
      const usage = event.data.usage
      const total = usage.totalTokens ?? usage.inputTokens + usage.outputTokens
        + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
      const counted = config.analysisCountCacheReads ? total : total - (usage.cacheReadTokens ?? 0)
      const state = turns.get(session.id) ?? { used: 0, last: 0, closing: false }
      state.used += counted
      state.last = counted
      turns.set(session.id, state)
    }
  })
  ctx.on('agent/disposed', ({ agent }) => { turns.delete(agent.id) })
  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembly = await next()
    if (!context.agent || !closingState(context.agent)) return assembly
    return { ...assembly, tools: assembly.tools.filter(tool => tool.name === 'structured_output') }
  }, { prepend: true })
  ctx.tools.guard(exec => exec.agent && turns.get(exec.agent.id)?.closing && exec.name !== 'structured_output'
    ? 'Analysis budget wrap-up allows only the final response; continue exploration in a follow-up turn.'
    : undefined)
  ctx.on('agent/pre-step', async ({ agent, signal }, next) => {
    const decision = await next()
    if (decision.kind === 'reject' || signal.aborted) return decision
    const state = closingState(agent)
    if (!state) return decision
    if (state.closing) {
      for (const message of decision.messages) {
        if (message.source.kind === 'user') agent.send(message, 'next-turn', false)
      }
      return { kind: 'reject' }
    }
    state.closing = true
    const accounting = config.analysisCountCacheReads ? 'including cache reads' : 'excluding cache reads'
    return {
      ...decision,
      messages: [...decision.messages, createUserMessage({
        source: { kind: 'plugin', plugin: 'security-analysis-budget' },
        content: [{ type: 'text', text: 'Analysis exploration is ending for this turn. Counted usage: '
          + String(state.used) + ' / ' + String(config.analysisTurnTokens) + ' tokens (' + accounting + '). '
          + 'Another request comparable to the last would reach the allowance. '
          + 'Continue the current research direction without creating a new stage. Write three concise lines in Simplified Chinese: current conclusion, key impact or limitation, and next action or blocker. Preserve code identifiers and paths. Include tools only when essential. Use only existing results: what is established, '
          + 'saved evidence or file locations, uncertainty and unfinished checks, and the next focused action. '
          + 'Explain that analysis can continue from these results in a follow-up; do not claim the investigation is complete. '
          + 'Do not call exploration tools. If structured_output is available, return the assigned report with uncertainty and nextSteps.' }],
      })],
    }
  })
  ctx.effect(() => () => { turns.clear() })
}
