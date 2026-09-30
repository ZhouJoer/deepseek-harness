/** Select committed native analysis interactions without trusting output as authority. @module */
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { z } from 'zod'

/** Select complete local call/result pairs, including recorded background increments.
 * @param events - immutable Session observation.
 * @param inherited - fork prefix excluded from caller-owned analysis.
 * @param callIds - requested native call identities.
 * @returns original events in log order; spill paths are never dereferenced.
 */
export function analysisLog(events: readonly SessionEvent[], inherited: number, callIds: readonly string[]): SessionEvent[] {
  const calls = events.filter(event => event.type === 'tool/call').filter(event => event.seq >= inherited)
  const results = events.filter(event => event.type === 'tool/result').filter(event => event.seq >= inherited)
  const selected = new Set<number>()
  const pair = (id: string) => {
    const call = calls.find(event => event.data.callId === id)
    const result = results.find(event => event.data.message.toolCallId === id)
    if (!call || !result || result.seq <= call.seq) throw new Error('Analysis call must have a committed result in this Session')
    if (!['bash', 'pwsh', 'job_output'].includes(call.data.name)) throw new Error('Only native shell and job output can be captured')
    selected.add(call.seq); selected.add(result.seq)
    return { call, result }
  }
  for (const id of callIds) {
    const { call, result } = pair(id)
    if (call.data.name === 'job_output') {
      const { job_id: job } = z.object({ job_id: z.string().min(1) }).parse(JSON.parse(call.data.arguments))
      const start = calls.find((candidate) => {
        if (!['bash', 'pwsh'].includes(candidate.data.name) || candidate.seq >= call.seq) return false
        const output = results.find(item => item.data.message.toolCallId === candidate.data.callId)
        const blocks = output?.data.message.content
        return blocks?.length === 1 && blocks[0]?.type === 'text' && blocks[0].text.trim() === 'started background job ' + job
      })
      if (!start) throw new Error('Background output requires its own recorded shell start')
      pair(start.data.callId)
      for (const candidate of calls) {
        if (candidate.data.name !== 'job_output' || candidate.seq > call.seq || candidate.seq < start.seq) continue
        const args = z.object({ job_id: z.string() }).safeParse(JSON.parse(candidate.data.arguments))
        if (args.success && args.data.job_id === job) pair(candidate.data.callId)
      }
    } else {
      const blocks = result.data.message.content
      const started = blocks.length === 1 && blocks[0]?.type === 'text'
        && blocks[0].text.trim().startsWith('started background job ')
      if (started && !callIds.some((other) => {
        const candidate = calls.find(item => item.data.callId === other)
        if (candidate?.data.name !== 'job_output' || candidate.seq <= result.seq) return false
        const args = z.object({ job_id: z.string() }).parse(JSON.parse(candidate.data.arguments))
        return blocks.length === 1 && blocks[0]?.type === 'text'
          && blocks[0].text.trim() === 'started background job ' + args.job_id
      })) throw new Error('Capture background output after collecting it with job_output')
    }
  }
  return events.filter(event => selected.has(event.seq))
}
