/** Managed Ghidra wire admission and bounded, correctly addressed queries. @module */
import { it, expect, vi, afterEach } from 'vitest'
import { GhidraProvider } from '../src/ghidra-provider.ts'
import { ArtifactStore } from '../src/workbench/artifacts.ts'
import { assetSchema, operationSchema } from '../src/workbench/model.ts'
import type { AnalysisContext } from '../src/workbench/providers.ts'

const hash = 'a'.repeat(64)
const binding = { sha256: hash, programId: '/项目/sample', baseUrl: 'http://127.0.0.1:8080', token: 't'.repeat(32) }
function fixture(operation = 'functions', parameters: Record<string, string | number> = {}) {
  const provider = new GhidraProvider([binding], 100)
  const context: AnalysisContext = {
    asset: assetSchema.parse({ id: 'sample', engagementId: 'project', label: 'Owned', artifact: { sha256: hash, size: 1, mediaType: 'application/octet-stream' }, format: 'pe', identity: 'measured' }),
    environment: { id: 'local', kind: 'local', label: 'Lab', cwd: process.cwd(), tools: [] },
    artifacts: new ArtifactStore(process.cwd(), 65536), signal: new AbortController().signal, durationMs: 1000, maxOutputBytes: 32,
  }
  const request = operationSchema.parse({ provider: 'ghidra', operation, environmentId: 'local', assetId: 'sample', parameters, impact: 'observe' })
  return { provider, context, request }
}
function response(text: string) {
  return new Response(text, { headers: { 'X-DSH-SHA256': hash, 'X-DSH-Ghidra-Version': '11.3.2' } })
}
afterEach(() => vi.restoreAllMocks())
it('requires loopback authentication and a measured program binding', () => {
  expect(() => new GhidraProvider([{ ...binding, baseUrl: 'http://example.com' }], 100)).toThrow(/loopback/)
  const { provider, context, request } = fixture()
  context.asset.artifact.sha256 = 'b'.repeat(64)
  expect(() => provider.resolve(request, context)).toThrow(/matches/)
})
it('uses bounded function search and preserves filter characters as one field', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response('entry'))
  const { provider, context, request } = fixture('functions', { filter: 'key&limit=999&offset=-1=秘密 +%', offset: 3, limit: 2 })
  const result = await provider.run(provider.resolve(request, context), context)
  const call = fetch.mock.calls[0]!
  const input = call[0]
  const url = new URL(input instanceof Request ? input.url : input)
  expect(url.pathname).toBe('/searchFunctions')
  expect(url.searchParams.get('query')).toBe(request.parameters.filter)
  expect(url.searchParams.get('limit')).toBe('2')
  expect(call[1]?.headers).toMatchObject({ Authorization: 'Bearer ' + binding.token, 'X-DSH-Program': encodeURIComponent(binding.programId) })
  expect(result.toolVersion).toContain('11.3.2')
})
it.each(['rename', 'prototype'])('uses upstream function_address for %s and requires a write plan', async (operation) => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response('Success'))
  const { provider, context, request } = fixture(operation, operation === 'rename' ? { address: '401000', name: 'parse_packet' } : { address: '401000', prototype: 'int parse_packet(void)' })
  const resolved = provider.resolve(request, context)
  expect(resolved.impact).toBe('analysis-write')
  await provider.run(resolved, context)
  const options = fetch.mock.calls[0]?.[1]
  expect(options?.method).toBe('POST')
  const form = new URLSearchParams(options?.body as string)
  expect(form.get('function_address')).toBe('401000')
  expect(form.has('address')).toBe(false)
})
it('refuses responses from an unpatched or incorrectly bound server', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('another program'))
  const { provider, context, request } = fixture()
  await expect(provider.run(provider.resolve(request, context), context)).rejects.toThrow(/identity/)
})
it('retains explicit truncation and refuses pagination above the configured budget', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(response('x'.repeat(80)))
  const { provider, context, request } = fixture()
  const result = await provider.run(provider.resolve(request, context), context)
  expect(result.bytes.byteLength).toBe(32)
  expect(result.incomplete).toBe(true)
  request.parameters.limit = 101
  expect(() => provider.resolve(request, context)).toThrow(/limit/)
})
