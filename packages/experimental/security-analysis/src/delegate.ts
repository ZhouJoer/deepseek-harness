/** Fresh-session reconnaissance with bounded output and managed background ownership. @module */

import assert from 'node:assert/strict'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { JobOutcome } from '@deepseek-ai/dsh-jobs'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import type { SecurityStore } from './store.ts'
import type { Config } from './config.ts'
import type {} from '@deepseek-ai/dsh-subagent'

/** Child capabilities also enforced by the plugin's execution guard. */
export const RECON_TOOLS = ['security_scope', 'security_static', 'security_search'] as const

/**
 * Create a bounded reconnaissance job; the job registry owns cancellation after admission.
 * @param ctx - context with subagents and the job registry.
 * @param config - deployment's provider and time/output limits.
 * @param store - engagement store used to validate returned evidence citations.
 * @param parent - live delegating agent.
 * @param assetId - authorized asset identifier.
 * @param question - bounded investigation and explicit success criteria.
 * @param signal - plugin lifetime; unload cancels children and waits for their cleanup.
 * @param onSettled - releases the caller's concurrency reservation.
 * @returns the session-owned job identity and quiescent completion.
 */
export function startReconnaissance(
  ctx: Context,
  config: Config,
  store: SecurityStore,
  parent: Agent,
  assetId: string,
  question: string,
  signal: AbortSignal,
  onSettled: () => void,
): { id: string; done: Promise<JobOutcome> } {
  let completion: Promise<JobOutcome> | undefined
  const id = ctx.jobs.start({
    kind: 'subagent',
    owner: parent,
    label: `Reconnaissance: ${assetId}`,
    outputLimitBytes: config.maxOutputBytes,
    run() {
      const controller = new AbortController()
      const combined = AbortSignal.any([signal, controller.signal])
      const timer = setTimeout(() => {
        controller.abort(new Error('reconnaissance deadline exceeded'))
      }, config.delegationTimeoutMs)
      const done = (async (): Promise<JobOutcome> => {
        try {
          const run = await ctx.subagents.start(config.subagentProvider, {
            parent,
            signal: combined,
            label: `Reconnaissance: ${assetId}`,
            maxDepth: 1,
            toolFilter: { allow: [...RECON_TOOLS] },
            prompt: [
              {
                type: 'text',
                text: `Read-only reconnaissance for asset ${assetId}. Answer only this bounded question; cite evidence IDs and state uncertainty. Do not validate, write assessments, or delegate.\n\n${question}`,
              },
            ],
            outputSchema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                summary: { type: 'string' },
                evidenceIds: { type: 'array', items: { type: 'string' } },
                uncertainty: { type: 'string' },
                nextSteps: { type: 'array', items: { type: 'string' } },
              },
              required: ['summary', 'evidenceIds', 'uncertainty', 'nextSteps'],
            },
          })
          try {
            const result = await run.result
            if (result.stopReason !== 'completed') throw new Error(`reconnaissance stopped: ${result.stopReason}`)
            const structured = result.structured as Record<string, JsonValue> | undefined
            if (structured === undefined || !Array.isArray(structured.evidenceIds))
              throw new Error('reconnaissance returned no structured report')
            for (const id of structured.evidenceIds) {
              const record = typeof id === 'string' ? store.get(id) : undefined
              if (record?.kind !== 'evidence' || record.assetId !== assetId)
                throw new Error('reconnaissance cited unknown or foreign-asset evidence')
            }
            const output = JSON.stringify({ childSessionId: run.id, report: structured })
            if (Buffer.byteLength(output, 'utf8') > config.maxOutputBytes)
              throw new Error('reconnaissance report exceeds maxOutputBytes; narrow the question')
            combined.throwIfAborted()
            return { status: 'completed', output }
          } finally {
            await run.dispose()
          }
        } catch (error) {
          return {
            status: combined.aborted ? 'killed' : 'failed',
            detail: error instanceof Error ? error.message : String(error),
          }
        } finally {
          clearTimeout(timer)
          onSettled()
        }
      })()
      completion = done
      return {
        cancel: () => {
          controller.abort(new Error('reconnaissance cancelled'))
        },
        done,
      }
    },
  })
  assert(completion, 'Jobs must start the delegated run before returning its handle')
  return { id, done: completion }
}
