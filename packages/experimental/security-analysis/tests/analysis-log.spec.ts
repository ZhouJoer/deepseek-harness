/** Captures only committed caller-owned native interactions. @module */
import { expect, it } from 'vitest'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import { createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { analysisLog } from '../src/analysis-log.ts'

function call(seq: number, id: string, name = 'pwsh', args: object = {}): SessionEvent<'tool/call'> {
  return { type: 'tool/call', seq: SessionSeq(seq), time: 0,
    data: { turn: 0, step: 0, callId: ToolCallId(id), name, arguments: JSON.stringify(args) } }
}
function result(seq: number, id: string, text: string, isError = false): SessionEvent<'tool/result'> {
  return { type: 'tool/result', seq: SessionSeq(seq), time: 0, surfaceOp: 'append',
    data: { turn: 0, step: 0, message: createToolResultMessage({ callId: ToolCallId(id), content: [{ type: 'text', text }], isError }) } }
}
it('preserves logged failures and spill text without reading paths', () => {
  const events = [call(0, 'run'), result(1, 'run', 'failed; spilled to C:/private/secret', true)]
  expect(analysisLog(events, 0, ['run'])).toEqual(events)
  expect(() => analysisLog(events, 2, ['run'])).toThrow('committed')
  expect(() => analysisLog(events, 0, ['foreign'])).toThrow('committed')
  expect(() => analysisLog([call(0, 'pending')], 0, ['pending'])).toThrow('committed')
  expect(() => analysisLog([call(0, 'write', 'write'), result(1, 'write', 'ok')], 0, ['write'])).toThrow('Only native')
})
it('captures background start and earlier output up to an immutable cutoff', () => {
  const events = [call(0, 'start', 'bash', { run_in_background: true }), result(1, 'start', 'started background job job-1'),
    call(2, 'first', 'job_output', { job_id: 'job-1' }), result(3, 'first', 'first output'),
    call(4, 'second', 'job_output', { job_id: 'job-1' }), result(5, 'second', 'second output'),
    call(6, 'other', 'job_output', { job_id: 'job-2' }), result(7, 'other', 'foreign output')]
  expect(analysisLog(events, 0, ['second'])).toEqual(events.slice(0, 6))
  expect(analysisLog(events, 0, ['first', 'first'])).toEqual(events.slice(0, 4))
  expect(() => analysisLog(events, 0, ['start'])).toThrow('collecting')
  expect(() => analysisLog(events, 0, ['start', 'other'])).toThrow('collecting')
  expect(() => analysisLog(events, 0, ['other'])).toThrow('own recorded shell start')
  const failed = [call(0, 'failed', 'bash', { run_in_background: true }), result(1, 'failed', 'Execution denied', true)]
  expect(analysisLog(failed, 0, ['failed'])).toEqual(failed)
})
