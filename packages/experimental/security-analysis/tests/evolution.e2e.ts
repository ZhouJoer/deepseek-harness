/** Real-model discovery from distributable network/IoT workflow observations. @module */
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import Llm, { BlockAssembler, createSystemMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import * as DeepSeek from '@deepseek-ai/dsh-llm-deepseek-api-key'
import { expect, it, vi } from 'vitest'
import { evolutionInputSchema, evolutionOutputSchema } from '../src/evolution-model.ts'
import { evolutionPrompt, evolutionRequest } from '../src/evolution.ts'

it.skipIf(!process.env.DEEPSEEK_API_KEY)('finds a source-code capability gap in a complex IoT workflow', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-evolution-model-'))
  const ctx = new Context()
  vi.stubEnv('DSH_HOME', root)
  try {
    await ctx.plugin(Llm)
    await ctx.plugin(DeepSeek, { maxTokens: 8192 })
    const input = evolutionInputSchema.parse({ projectId: 'owned-iot-fixture', objective: 'Correlate MQTT reconnects with firmware behavior',
      version: 'test-fixture', candidates: [], gaps: ['Synthetic workflow observations; no device execution claimed.'], sources: [
        { id: 'capture:1', projectId: 'owned-iot-fixture', sessionId: 'capture', seq: 1, kind: 'tool/result', recordedAt: 1,
          truncated: false, excerpt: 'TShark successfully decoded three captures. For each capture, the analyst wrote a separate script to normalize MQTT reconnect timestamps and packet identities. The same conversion was needed again for the next device.' },
        { id: 'delegate:2', projectId: 'owned-iot-fixture', sessionId: 'delegate', seq: 2, kind: 'delegation', recordedAt: 2,
          truncated: false, excerpt: 'Firmware and network reviewers received summaries but no shared packet-to-log time mapping. Both asked the coordinator to rebuild the mapping manually before they could compare the same reconnect event. Existing tools were available and all commands succeeded.' },
      ] })
    const assembler = new BlockAssembler()
    for await (const chunk of ctx.llm.stream({ provider: 'deepseek-official', model: 'deepseek-v4-flash', maxTokens: 8192,
      messages: [createSystemMessage(evolutionPrompt), createUserMessage({ source: { kind: 'user' },
        content: [{ type: 'text', text: evolutionRequest(input, 5) }] })], signal: AbortSignal.timeout(90000) })) assembler.push(chunk)
    expect(assembler.finish.kind).toBe('stop')
    const output = assembler.blocks().filter(block => block.type === 'text').map(block => block.text).join('')
    const result = evolutionOutputSchema.parse(JSON.parse(output))
    expect(result.suggestions.length).toBeGreaterThan(0)
    expect(result.suggestions.length).toBeLessThanOrEqual(5)
    for (const suggestion of result.suggestions) {
      expect(suggestion.sourceIds.every(id => input.sources.some(source => source.id === id))).toBe(true)
      expect(suggestion.acceptance.length).toBeGreaterThan(0)
    }
  } finally { await ctx.fiber.dispose(); vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }) }
})
