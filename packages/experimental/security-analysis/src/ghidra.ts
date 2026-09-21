/** Read-only queries against the GhidraMCP Java plugin's active GUI program. */
import { isIP } from 'node:net'

/** Connection and resource limits for the Java HTTP plugin, not the MCP bridge. */
export interface GhidraConfig {
  baseUrl: string
  timeoutMs: number
  maxResponseBytes: number
  maxPageSize: number
}

/** Static queries; addresses are hexadecimal and filters apply to functions or strings. */
export interface StaticAnalysisRequest {
  operation: 'functions' | 'imports' | 'exports' | 'strings' | 'decompile' | 'disassemble' | 'xrefs-to' | 'xrefs-from'
  address?: string
  filter?: string
  offset?: number
  limit?: number
}

/** Bounded UTF-8 output; truncation means the response is incomplete. */
export interface StaticAnalysisResult {
  text: string
  truncated: boolean
}

/**
 * Require a literal loopback HTTP origin and positive resource limits.
 * @param config Deployment configuration; invalid values throw before any request.
 */
export function validateGhidraConfig(config: GhidraConfig): void {
  const url = new URL(config.baseUrl)
  const loopback = url.hostname === '[::1]' || (isIP(url.hostname) === 4 && url.hostname.startsWith('127.'))
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !loopback ||
    url.username ||
    url.password ||
    url.href.includes('?') ||
    url.href.includes('#') ||
    url.pathname !== '/'
  ) {
    throw new Error(
      'Ghidra baseUrl must be a literal loopback HTTP(S) origin without credentials, path, query, or fragment',
    )
  }
  for (const field of ['timeoutMs', 'maxResponseBytes', 'maxPageSize'] as const) {
    if (!Number.isSafeInteger(config[field]) || config[field] <= 0) {
      throw new Error(`Ghidra ${field} must be a positive safe integer`)
    }
  }
  if (config.timeoutMs > 2_147_483_647 || config.maxPageSize > 2_147_483_647) {
    throw new Error('Ghidra timeoutMs and maxPageSize must fit a positive signed 32-bit integer')
  }
}

function resolveQuery(config: GhidraConfig, request: StaticAnalysisRequest): URL {
  const routes = {
    functions: request.filter === undefined ? '/methods' : '/searchFunctions',
    imports: '/imports',
    exports: '/exports',
    strings: '/strings',
    decompile: '/decompile_function',
    disassemble: '/disassemble_function',
    'xrefs-to': '/xrefs_to',
    'xrefs-from': '/xrefs_from',
  } satisfies Record<StaticAnalysisRequest['operation'], string>
  const url = new URL(routes[request.operation], config.baseUrl)
  const addressed = ['decompile', 'disassemble', 'xrefs-to', 'xrefs-from'].includes(request.operation)
  if (addressed) {
    if (request.address === undefined || !/^(?:0x)?[\da-f]+$/i.test(request.address)) {
      throw new Error('Ghidra address must contain hexadecimal digits with an optional 0x prefix')
    }
    url.searchParams.set('address', request.address)
  } else if (request.address !== undefined) {
    throw new Error('Ghidra address is only supported for decompile, disassemble, and cross-reference queries')
  }
  if (request.filter !== undefined) {
    if (!['functions', 'strings'].includes(request.operation) || request.filter.length === 0) {
      throw new Error('Ghidra filter must be nonempty and is only supported for functions and strings')
    }
    // GhidraMCP decodes URI.getQuery() before splitting fields, then URLDecoder decodes values.
    url.searchParams.set(request.operation === 'functions' ? 'query' : 'filter', encodeURIComponent(request.filter))
  }
  if (request.operation === 'decompile' || request.operation === 'disassemble') {
    if (request.offset !== undefined || request.limit !== undefined) {
      throw new Error('Ghidra decompile and disassemble queries do not support pagination')
    }
  } else {
    const offset = request.offset ?? 0
    const limit = request.limit ?? config.maxPageSize
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > config.maxPageSize ||
      offset + limit > 2_147_483_647
    ) {
      throw new Error(
        'Ghidra pagination requires a nonnegative offset and a positive limit within maxPageSize and signed 32-bit range',
      )
    }
    url.searchParams.set('offset', String(offset))
    url.searchParams.set('limit', String(limit))
  }
  return url
}

/**
 * Read an allowlisted Ghidra query, rejecting HTTP failures and upstream diagnostics.
 * The upstream API exposes no program identity: callers must record the operator's
 * active-program binding, and must not treat this response as an asset identity check.
 * @param config Validated loopback endpoint and resource limits.
 * @param request Query parameters; invalid combinations fail before network access.
 * @param signal Cancellation for connection and response consumption.
 * @returns UTF-8 text within maxResponseBytes, with incomplete output marked truncated.
 */
export async function analyzeStatic(
  config: GhidraConfig,
  request: StaticAnalysisRequest,
  signal: AbortSignal,
): Promise<StaticAnalysisResult> {
  validateGhidraConfig(config)
  const url = resolveQuery(config, request)
  signal.throwIfAborted()
  const controller = new AbortController()
  const combined = AbortSignal.any([signal, controller.signal])
  const timer = setTimeout(() => {
    controller.abort(new Error('Ghidra analysis timed out'))
  }, config.timeoutMs)
  try {
    const response = await fetch(url, { method: 'GET', redirect: 'error', signal: combined })
    if (!response.ok) {
      await response.body?.cancel()
      throw new Error(`Ghidra HTTP request failed with status ${response.status}`)
    }
    if (response.body === null) throw new Error('Ghidra HTTP response has no body')
    const reader = response.body.getReader()
    const decoder = new TextDecoder('utf-8', { fatal: true })
    let text = ''
    let bytes = 0
    let truncated = false
    try {
      for (;;) {
        const chunk = await reader.read()
        combined.throwIfAborted()
        if (chunk.done) break
        const remaining = config.maxResponseBytes - bytes
        text += decoder.decode(chunk.value.subarray(0, remaining), { stream: true })
        bytes += Math.min(chunk.value.byteLength, remaining)
        if (chunk.value.byteLength > remaining) {
          truncated = true
          await reader.cancel()
          break
        }
      }
      if (!truncated) text += decoder.decode()
    } finally {
      reader.releaseLock()
    }
    const diagnostic = text.trim()
    const failurePrefixes = [
      'No program loaded',
      'Address is required',
      'Decompilation failed',
      'No function found at ',
      'Error decompiling function:',
      'Error disassembling function:',
      'Error getting references to address:',
      'Error getting references from address:',
    ]
    if (
      failurePrefixes.some(
        prefix =>
          diagnostic.startsWith(prefix) || (truncated && diagnostic.length > 0 && prefix.startsWith(diagnostic)),
      )
    ) {
      throw new Error(`Ghidra analysis failed: ${diagnostic}`)
    }
    return { text, truncated }
  } finally {
    clearTimeout(timer)
    controller.abort()
  }
}
