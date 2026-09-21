/** Ghidra's HTTP interface is mocked; these cases do not require a running Ghidra. */
import { afterEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { analyzeStatic, validateGhidraConfig, type GhidraConfig, type StaticAnalysisRequest } from '../src/ghidra.ts'

const config: GhidraConfig = {
  baseUrl: 'http://127.0.0.1:8080/',
  timeoutMs: 5_000,
  maxResponseBytes: 1_024,
  maxPageSize: 20,
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

async function withFetch<T>(response: Response, run: (mock: MockInstance<typeof fetch>) => Promise<T>): Promise<T> {
  const mock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response)
  try {
    return await run(mock)
  } finally {
    mock.mockRestore()
  }
}

describe('Ghidra endpoint validation', () => {
  it.each(['http://127.0.0.1:8080', 'https://127.2.3.4/', 'http://[::1]:8080/'])(
    'accepts literal loopback %s',
    (baseUrl) => {
      expect(() => {
        validateGhidraConfig({ ...config, baseUrl })
      }).not.toThrow()
    },
  )

  it.each([
    'http://localhost:8080/',
    'http://example.com/',
    'http://192.168.1.2/',
    'http://[::ffff:127.0.0.1]/',
    'ftp://127.0.0.1/',
    'http://name:secret@127.0.0.1/',
    'http://127.0.0.1/sse',
    'http://127.0.0.1/?key=value',
    'http://127.0.0.1/#fragment',
    'http://127.0.0.1/?',
    'http://127.0.0.1/#',
    'not a URL',
  ])('rejects a non-origin or nonliteral endpoint %s', (baseUrl) => {
    expect(() => {
      validateGhidraConfig({ ...config, baseUrl })
    }).toThrow()
  })

  it.each([
    { timeoutMs: 0 },
    { maxResponseBytes: -1 },
    { maxPageSize: 1.5 },
    { timeoutMs: 2_147_483_648 },
    { maxPageSize: 2_147_483_648 },
    { maxResponseBytes: Infinity },
  ])('rejects invalid limits %j', (overrides) => {
    expect(() => {
      validateGhidraConfig({ ...config, ...overrides })
    }).toThrow()
  })
})

describe('Ghidra static queries', () => {
  it.each([
    [{ operation: 'functions' }, '/methods?offset=0&limit=20'],
    [
      { operation: 'functions', filter: 'check key', offset: 20, limit: 10 },
      '/searchFunctions?query=check%2520key&offset=20&limit=10',
    ],
    [{ operation: 'imports' }, '/imports?offset=0&limit=20'],
    [{ operation: 'exports' }, '/exports?offset=0&limit=20'],
    [{ operation: 'strings', filter: 'key&value' }, '/strings?filter=key%2526value&offset=0&limit=20'],
    [{ operation: 'decompile', address: '0x10' }, '/decompile_function?address=0x10'],
    [{ operation: 'disassemble', address: 'AB10' }, '/disassemble_function?address=AB10'],
    [{ operation: 'xrefs-to', address: '10' }, '/xrefs_to?address=10&offset=0&limit=20'],
    [{ operation: 'xrefs-from', address: '10' }, '/xrefs_from?address=10&offset=0&limit=20'],
  ] satisfies [StaticAnalysisRequest, string][])('uses the read-only route for %j', async (request, expected) => {
    await withFetch(new Response('result'), async (mock) => {
      expect(await analyzeStatic(config, request, new AbortController().signal)).toEqual({
        text: 'result',
        truncated: false,
      })
      const [url, init] = mock.mock.calls[0]!
      expect((url instanceof Request ? url.url : String(url))).toBe(`http://127.0.0.1:8080${expected}`)
      expect(init).toMatchObject({ method: 'GET', redirect: 'error' })
      expect(init?.signal?.aborted).toBe(true)
    })
  })

  it.each([
    { operation: 'decompile' },
    { operation: 'disassemble', address: '../renameFunction' },
    { operation: 'xrefs-to', address: '0x' },
    { operation: 'imports', address: '10' },
    { operation: 'imports', filter: 'name' },
    { operation: 'functions', filter: '' },
    { operation: 'decompile', address: '10', limit: 1 },
    { operation: 'disassemble', address: '10', offset: 0 },
    { operation: 'strings', offset: -1 },
    { operation: 'strings', limit: 0 },
    { operation: 'strings', limit: 21 },
    { operation: 'strings', offset: 0.5 },
    { operation: 'strings', offset: 2_147_483_640, limit: 20 },
  ] satisfies StaticAnalysisRequest[])('rejects invalid query parameters %j before fetching', async (request) => {
    await withFetch(new Response('unused'), async (mock) => {
      await expect(analyzeStatic(config, request, new AbortController().signal)).rejects.toThrow()
      expect(mock).not.toHaveBeenCalled()
    })
  })

  it.each([
    'No program loaded',
    'Address is required',
    'Decompilation failed',
    'No function found at or containing address 10',
    'Error decompiling function: failed',
    'Error disassembling function: failed',
    'Error getting references to address: failed',
    'Error getting references from address: failed',
  ])('rejects an HTTP 200 Ghidra diagnostic: %s', async (diagnostic) => {
    await withFetch(new Response(diagnostic), async () => {
      await expect(
        analyzeStatic(config, { operation: 'decompile', address: '10' }, new AbortController().signal),
      ).rejects.toThrow('Ghidra analysis failed')
    })
  })

  it('accepts an empty page and ordinary names beginning with Error', async () => {
    for (const text of ['', 'ErrorHandler']) {
      await withFetch(new Response(text), async () => {
        expect(await analyzeStatic(config, { operation: 'functions' }, new AbortController().signal)).toEqual({
          text,
          truncated: false,
        })
      })
    }
  })

  it.each(['functions', 'strings'] as const)(
    'preserves %s filters through the upstream double decoder without changing pagination',
    async (operation) => {
      const filter = 'key&limit=999999&offset=-1=秘密 % +?'
      await withFetch(new Response('result'), async (mock) => {
        await analyzeStatic(config, { operation, filter, offset: 10, limit: 2 }, new AbortController().signal)
        const input = mock.mock.calls[0]![0]
        const url = new URL(input instanceof Request ? input.url : input)
        // Java URI.getQuery decodes percent escapes before the upstream split; URLDecoder also decodes '+'.
        const parameters = new Map<string, string>()
        for (const pair of decodeURIComponent(url.search.slice(1)).split('&')) {
          const fields = pair.split('=')
          if (fields.length === 2) {
            parameters.set(
              decodeURIComponent(fields[0]!.replaceAll('+', ' ')),
              decodeURIComponent(fields[1]!.replaceAll('+', ' ')),
            )
          }
        }
        expect(parameters).toEqual(
          new Map([
            [operation === 'functions' ? 'query' : 'filter', filter],
            ['offset', '10'],
            ['limit', '2'],
          ]),
        )
      })
    },
  )
  it('rejects diagnostics even when the response limit cuts their prefix', async () => {
    await withFetch(new Response('No program loaded'), async () => {
      await expect(
        analyzeStatic({ ...config, maxResponseBytes: 3 }, { operation: 'functions' }, new AbortController().signal),
      ).rejects.toThrow('Ghidra analysis failed')
    })
  })
  it('cancels an HTTP error body and rejects a response without a body', async () => {
    let cancelled = false
    await withFetch(
      new Response(
        new ReadableStream({
          cancel() {
            cancelled = true
          },
        }),
        { status: 503 },
      ),
      async () => {
        await expect(analyzeStatic(config, { operation: 'functions' }, new AbortController().signal)).rejects.toThrow(
          '503',
        )
        expect(cancelled).toBe(true)
      },
    )
    await withFetch(new Response(null), async () => {
      await expect(analyzeStatic(config, { operation: 'functions' }, new AbortController().signal)).rejects.toThrow(
        'no body',
      )
    })
  })

  it.each([
    [1, ''],
    [2, ''],
    [3, '中'],
    [4, '中a'],
    [5, '中ab'],
    [6, '中abc'],
  ])('bounds multibyte text to %i bytes and cancels oversized output', async (maxResponseBytes, expected) => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('中abcdef'))
      },
      cancel() {
        cancelled = true
      },
    })
    await withFetch(new Response(body), async () => {
      expect(
        await analyzeStatic({ ...config, maxResponseBytes }, { operation: 'functions' }, new AbortController().signal),
      ).toEqual({ text: expected, truncated: true })
      expect(cancelled).toBe(true)
      expect(Buffer.byteLength(expected)).toBeLessThanOrEqual(maxResponseBytes)
    })
  })

  it('distinguishes an exact limit from additional chunks and decodes split UTF-8', async () => {
    for (const extra of [false, true]) {
      const encoded = new TextEncoder().encode('中文')
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoded.subarray(0, 1))
          controller.enqueue(encoded.subarray(1))
          if (extra) controller.enqueue(new TextEncoder().encode('x'))
          controller.close()
        },
      })
      await withFetch(new Response(body), async () => {
        expect(
          await analyzeStatic(
            { ...config, maxResponseBytes: 6 },
            { operation: 'strings' },
            new AbortController().signal,
          ),
        ).toEqual({ text: '中文', truncated: extra })
      })
    }
  })

  it('propagates response-stream failures', async () => {
    const failure = new Error('connection lost')
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(failure)
      },
    })
    await withFetch(new Response(body), async () => {
      await expect(analyzeStatic(config, { operation: 'functions' }, new AbortController().signal)).rejects.toBe(
        failure,
      )
      expect(body.locked).toBe(false)
    })
  })

  it('rejects before fetching when already cancelled', async () => {
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    await withFetch(new Response('unused'), async (mock) => {
      await expect(analyzeStatic(config, { operation: 'functions' }, controller.signal)).rejects.toThrow('cancelled')
      expect(mock).not.toHaveBeenCalled()
    })
  })

  it.each(['caller', 'timeout'] as const)('cancels pending fetch on %s and clears the deadline', async (kind) => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const mock = vi.spyOn(globalThis, 'fetch').mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init!.signal!.addEventListener(
            'abort',
            () => {
              reject(init!.signal!.reason instanceof Error ? init!.signal!.reason : new Error('Aborted'))
            },
            { once: true },
          )
        }),
    )
    try {
      const result = analyzeStatic(config, { operation: 'functions' }, controller.signal)
      const rejection = expect(result).rejects.toThrow(kind === 'caller' ? 'cancelled' : 'timed out')
      if (kind === 'caller') controller.abort(new Error('cancelled'))
      else await vi.advanceTimersByTimeAsync(config.timeoutMs)
      await rejection
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      mock.mockRestore()
      vi.useRealTimers()
    }
  })
})
