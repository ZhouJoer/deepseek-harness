/** Managed Ghidra wire admission and bounded, correctly addressed queries. @module */
import { it, expect, vi, afterEach } from 'vitest'
import { GhidraProvider } from '../src/ghidra-provider.ts'
import { ArtifactStore } from '../src/workbench/artifacts.ts'
import { fileAssetSchema, operationSchema } from '../src/workbench/model.ts'
import type { AnalysisContext } from '../src/workbench/providers.ts'

const hash = 'a'.repeat(64)
const binding = { sha256: hash, programId: '/项目/sample', baseUrl: 'http://127.0.0.1:8080', token: 't'.repeat(32) }
function fixture(operation = 'functions', parameters: Record<string, string | number> = {}) {
  const provider = new GhidraProvider([binding], 100)
  const context = {
    asset: fileAssetSchema.parse({ id: 'sample', engagementId: 'project', label: 'Owned', artifact: { sha256: hash, size: 1, mediaType: 'application/octet-stream' }, format: 'pe', identity: 'measured' }),
    environment: { id: 'local', kind: 'local', label: 'Lab', cwd: process.cwd(), tools: [] },
    artifacts: new ArtifactStore(process.cwd(), 65536), signal: new AbortController().signal, durationMs: 1000, maxOutputBytes: 32,
  } satisfies AnalysisContext
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

it.each([hash + '\n/other/program\nARM', 'b'.repeat(64) + '\n' + binding.programId + '\nARM'])('rejects mismatched identity response fields', async (body) => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(body))
  const { provider, context, request } = fixture('identity')
  context.maxOutputBytes = 512
  await expect(provider.run(provider.resolve(request, context), context)).rejects.toThrow(/another sample/)
})
it('uses the actual Ghidra origin as the exclusive resource', () => {
  const { provider, context, request } = fixture()
  expect(provider.resourceKey(request, context.asset)).toBe('ghidra:http://127.0.0.1:8080')
  expect(provider.resourceKey({ ...request, environmentId: 'another' }, context.asset)).toBe(provider.resourceKey(request, context.asset))
})
it('propagates cancellation to the active request and reports closed servers', async () => {
  const { provider, context, request } = fixture()
  const abort = new AbortController()
  const entered = Promise.withResolvers<undefined>()
  context.signal = abort.signal
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, options) => {
    entered.resolve(undefined)
    return new Promise((_resolve, reject) =>{  options!.signal!.addEventListener('abort', () =>{  reject(options!.signal!.reason as Error) }, { once: true }) })
  })
  const pending = expect(provider.run(provider.resolve(request, context), context)).rejects.toThrow('Operator cancelled')
  await entered.promise
  abort.abort(new Error('Operator cancelled'))
  await pending
  fetch.mockRejectedValueOnce(new TypeError('fetch failed'))
  await expect(provider.run(provider.resolve(request, context), { ...context, signal: new AbortController().signal })).rejects.toThrow('fetch failed')
})
it('aborts an unresponsive Ghidra request at its deadline', async () => {
  const { provider, context, request } = fixture()
  const timeout = new AbortController()
  const deadline = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(timeout.signal)
  const entered = Promise.withResolvers<undefined>()
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, options) => {
    entered.resolve(undefined)
    return new Promise((_resolve, reject) =>{  options!.signal!.addEventListener('abort', () =>{  reject(options!.signal!.reason as Error) }, { once: true }) })
  })
  const pending = expect(provider.run(provider.resolve(request, context), context)).rejects.toThrow('deadline')
  await entered.promise
  timeout.abort(new Error('deadline'))
  await pending
  expect(deadline).toHaveBeenCalledWith(context.durationMs)
})
