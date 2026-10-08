/** Select committed native analysis interactions without trusting output as authority. @module */
import assert from 'node:assert/strict'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import { z } from 'zod'

class UncapturableAnalysisCall extends Error {}

/** Metadata for one caller-owned interaction that can be captured by itself. */
interface AnalysisCall {
  callId: ToolCallId
  tool: string
  sequence: number
  isError: boolean
  jobId?: string
}

/** List committed native interactions without disclosing command or output bodies. Malformed job arguments are rejected.
 * @param events - immutable Session observation.
 * @param inherited - fork prefix excluded from caller-owned analysis.
 * @param offset - continuation position within the filtered interactions.
 * @param maxBytes - complete serialized response budget.
 * @param jobId - optional background job identity used only to filter results.
 * @returns capturable call IDs in log order and an explicit continuation.
 */
export function analysisCallPage(events: readonly SessionEvent[], inherited: number, offset: number,
  maxBytes: number, jobId?: string): { calls: AnalysisCall[]; nextOffset: number | null } {
  const calls: AnalysisCall[] = []
  for (const event of events) {
    if (event.type !== 'tool/call' || event.seq < inherited || !['bash', 'pwsh', 'job_output'].includes(event.data.name)) continue
    const result = events.find(item => item.type === 'tool/result' && item.seq >= inherited
      && item.seq > event.seq && item.data.message.toolCallId === event.data.callId)
    if (result?.type !== 'tool/result') continue
    try { analysisLog(events, inherited, [event.data.callId]) }
    catch (error) {
      if (!(error instanceof UncapturableAnalysisCall)) throw error
      continue
    }
    const job = event.data.name === 'job_output'
      ? z.object({ job_id: z.string().min(1) }).parse(JSON.parse(event.data.arguments)).job_id : undefined
    if (jobId !== undefined && job !== jobId) continue
    calls.push({ callId: event.data.callId, tool: event.data.name, sequence: event.seq,
      isError: result.data.message.isError ?? false, ...(job === undefined ? {} : { jobId: job }) })
  }
  const page: { calls: AnalysisCall[]; nextOffset: number | null } = { calls: [], nextOffset: null }
  for (let index = offset; index < calls.length; index++) {
    const call = calls[index]
    assert(call, 'Page index must address an existing analysis call')
    page.calls.push(call)
    page.nextOffset = index + 1 < calls.length ? index + 1 : null
    if (Buffer.byteLength(JSON.stringify(page)) > maxBytes) {
      page.calls.pop()
      if (!page.calls.length) throw new Error('One analysis call exceeds the output budget')
      page.nextOffset = index
      break
    }
  }
  return page
}

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
    if (!call || !result || result.seq <= call.seq) throw new UncapturableAnalysisCall('Analysis call must have a committed result in this Session; omit callIds to list capturable call IDs. Background job IDs are not call IDs')
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
      if (!start) throw new UncapturableAnalysisCall('Background output requires its own recorded shell start')
      pair(start.data.callId)
      for (const candidate of calls) {
        if (candidate.data.name !== 'job_output' || candidate.seq > call.seq || candidate.seq < start.seq) continue
        const args = z.object({ job_id: z.string() }).parse(JSON.parse(candidate.data.arguments))
        if (args.job_id === job) pair(candidate.data.callId)
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
      })) throw new UncapturableAnalysisCall('Capture background output after collecting it with job_output')
    }
  }
  return events.filter(event => selected.has(event.seq))
}
