/** Captures only committed caller-owned native interactions. @module */
import { expect, it } from 'vitest'
import { SessionSeq, type SessionEvent } from '@deepseek-ai/dsh-session'
import { createToolResultMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { analysisCallPage, analysisLog } from '../src/analysis-log.ts'

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
it('exposes capturable call IDs separately from background job identities', () => {
  const events = [call(0, 'inherited'), result(1, 'inherited', 'parent output'),
    call(2, 'start', 'pwsh'), result(3, 'start', 'started background job pwsh-13'),
    call(4, 'opaque-output-id', 'job_output', { job_id: 'pwsh-13' }), result(5, 'opaque-output-id', 'output'),
    call(6, 'pending'), call(7, 'foreign-job', 'job_output', { job_id: 'pwsh-14' }), result(8, 'foreign-job', 'output'),
    call(9, 'failed'), result(10, 'failed', 'denied', true),
    call(11, 'write', 'write'), result(12, 'write', 'ok')]
  expect(analysisCallPage(events, 2, 0, 4096)).toEqual({ calls: [
    { callId: 'opaque-output-id', tool: 'job_output', sequence: 4, isError: false, jobId: 'pwsh-13' },
    { callId: 'failed', tool: 'pwsh', sequence: 9, isError: true },
  ], nextOffset: null })
  expect(analysisCallPage(events, 2, 0, 4096, 'pwsh-13').calls.map(item => item.callId)).toEqual(['opaque-output-id'])
  expect(analysisCallPage(events, 4, 0, 4096, 'pwsh-13').calls).toEqual([])
  expect(analysisCallPage(events, 2, 0, 4096, 'missing').calls).toEqual([])
  const page = analysisCallPage(events, 2, 0, 160)
  expect(page.calls.map(item => item.callId)).toEqual(['opaque-output-id'])
  expect(page.nextOffset).toBe(1)
  expect(analysisCallPage(events, 2, page.nextOffset!, 160).calls.map(item => item.callId)).toEqual(['failed'])
  expect(() => analysisCallPage(events, 2, 0, 20)).toThrow('output budget')
  expect(analysisCallPage(events, 2, 10, 4096)).toEqual({ calls: [], nextOffset: null })
})
