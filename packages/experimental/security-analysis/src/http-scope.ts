/** Exact-origin HTTP scope and address-pinned connections for registered targets. @module */
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { addAbortListener } from 'node:events'
import ipaddr from 'ipaddr.js'
import { Agent, request } from 'undici'
import { proxyRouteFor } from '@deepseek-ai/dsh-http-proxy'
import { scopedWebPath } from './web-provider.ts'

/** Operator-approved network coordinates. */
export interface HttpTargetScope { origin: string; pathPrefix: string; allowedAddresses: string[] }
/** Validate an operator's fixed target without sending traffic.
 * @param input - origin, path and explicit IP/CIDR ranges.
 * @returns canonical target coordinates. */
export function validateExternalTarget(input: HttpTargetScope): HttpTargetScope {
  const url = new URL(input.origin)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash)
    throw new Error('Specify an HTTP(S) origin without credentials, path, query or fragment')
  if (/[?#]/u.test(input.pathPrefix)) throw new Error('Target path prefix cannot contain a query or fragment')
  const pathPrefix = scopedWebPath(url.origin, '/', input.pathPrefix)
  if (!input.allowedAddresses.length) throw new Error('Declare at least one allowed IP address or CIDR')
  for (const address of input.allowedAddresses) {
    try { if (address.includes('/')) ipaddr.parseCIDR(address); else ipaddr.parse(address) }
    catch (_error) { throw new Error('Invalid allowed IP address or CIDR', { cause: _error }) }
  }
  return { origin: url.origin, pathPrefix, allowedAddresses: [...input.allowedAddresses] }
}
/** Check one resolved address against the declared address ranges.
 * @param address - observed IP address.
 * @param ranges - approved IP literals and CIDRs.
 * @returns whether one declared range includes the address. */
export function httpAddressAllowed(address: string, ranges: string[]): boolean {
  const value = ipaddr.process(address)
  return ranges.some((range) => {
    const [network, bits] = range.includes('/') ? ipaddr.parseCIDR(range) : [ipaddr.parse(range), isIP(range) === 4 ? 32 : 128] as const
    return value.kind() === network.kind() && value.match(network, bits)
  })
}
/** One bounded HTTP response; transport failures never expose request secrets. */
export interface HttpResponse { status: number; headers: [string, string][]; body: string; bytes: number; incomplete: boolean }
/** Send one approved request through a pinned direct connection, never following redirects.
 * @param scope - registered network coordinates.
 * @param path - already scoped path including encoded query.
 * @param method - approved HTTP method.
 * @param headers - Host-resolved request headers.
 * @param body - Host-resolved request body.
 * @param signal - complete execution lifetime.
 * @param maxBytes - response body byte budget.
 * @returns bounded response after releasing the connection. */
export async function sendScopedHttp(scope: HttpTargetScope, path: string, method: 'GET' | 'HEAD' | 'OPTIONS' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  headers: Record<string, string>, body: string | undefined, signal: AbortSignal, maxBytes: number): Promise<HttpResponse> {
  const url = new URL(scopedWebPath(scope.origin, scope.pathPrefix, path), scope.origin)
  if (proxyRouteFor(url).proxied) throw new Error('HTTP target address validation requires a direct route; configure NO_PROXY for this target')
  signal.throwIfAborted()
  const hostname = url.hostname.replace(/^\[|\]$/gu, '')
  const aborted = Promise.withResolvers<never>()
  const listener = addAbortListener(signal, () =>{  aborted.reject(new Error('HTTP DNS lookup cancelled or timed out')) })
  let addresses: { address: string; family: number }[]
  try { addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }]
    : await Promise.race([lookup(hostname, { all: true, order: 'verbatim' }), aborted.promise]) }
  finally { listener[Symbol.dispose]() }
  signal.throwIfAborted()
  const first = addresses[0]
  if (!first || addresses.some(item => !httpAddressAllowed(item.address, scope.allowedAddresses)))
    throw new Error('Resolved HTTP address is outside the registered target scope')
  // proxy-exempt: proxyRouteFor rejected proxy routes; this connector uses only the validated addresses.
  const dispatcher = new Agent({ connect: { lookup: (_hostname, options, callback) => {
    if (options.all) callback(null, addresses)
    else callback(null, first.address, first.family)
  } } })
  try {
    // proxy-exempt: the private dispatcher pins the explicitly registered target addresses.
    const response = await request(url, { dispatcher, method, headers, ...(body === undefined ? {} : { body }), signal })
    const chunks: Buffer[] = []; let bytes = 0; let incomplete = false
    try {
      for await (const chunk of response.body) {
        const value = Buffer.from(chunk as Uint8Array)
        const remaining = Math.max(0, maxBytes - bytes)
        chunks.push(value.subarray(0, remaining)); bytes += Math.min(value.length, remaining)
        if (value.length > remaining) { incomplete = true; break }
      }
    } catch (_error) {
      // Retain bytes already observed; the provider stops after incomplete transport.
      incomplete = true
    } finally { response.body.destroy() }
    const pairs: [string, string][] = []
    for (const [name, value] of Object.entries(response.headers)) {
      if (value !== undefined) for (const item of Array.isArray(value) ? value : [value]) pairs.push([name, item])
    }
    return { status: response.statusCode, headers: pairs, body: Buffer.concat(chunks).toString('utf8'), bytes, incomplete }
  } catch (_error) {
    throw new Error(signal.aborted ? 'HTTP execution cancelled or timed out' : 'HTTP connection or response failed')
  } finally { await dispatcher.destroy() }
}
