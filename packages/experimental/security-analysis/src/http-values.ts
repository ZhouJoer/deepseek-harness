/** HTTP variable extraction, assertions and the shared evidence redaction projection. @module */
import { parse, type DefaultTreeAdapterMap } from 'parse5'
import type { HttpStep, HttpValue } from './http-model.ts'
import type { HttpResponse } from './http-scope.ts'

/** Read an own JSON member, rejecting absent or non-scalar values.
 * @param text - complete JSON response.
 * @param pointer - RFC 6901 pointer.
 * @returns the selected scalar. */
export function httpJsonScalar(text: string, pointer: string): string | number | boolean | null {
  let value: unknown = JSON.parse(text)
  if (pointer && !pointer.startsWith('/')) throw new Error('JSON pointer must start with /')
  for (const token of pointer ? pointer.slice(1).split('/') : []) {
    if (/~(?:[^01]|$)/u.test(token)) throw new Error('Invalid JSON pointer escape')
    const key = token.replace(/~1/gu, '/').replace(/~0/gu, '~')
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, key)) throw new Error('HTTP JSON field is missing')
    value = Reflect.get(value, key)
  }
  if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) throw new Error('HTTP JSON field must be scalar')
  return value as string | number | boolean | null
}
/** Extract declared values without evaluating response content.
 * @param step - approved extraction definitions.
 * @param response - bounded complete response.
 * @param maxBytes - maximum extracted scalar size.
 * @returns variables to retain only within this execution. */
export function extractHttpValues(step: HttpStep, response: HttpResponse, maxBytes: number): Map<string, string> {
  const values = new Map<string, string>()
  for (const extraction of step.extract) {
    if (response.incomplete) throw new Error('Cannot extract from an incomplete HTTP response')
    let value: string
    if (extraction.from === 'json') value = String(httpJsonScalar(response.body, extraction.key))
    else {
      const matches: string[] = []
      if (extraction.from === 'header') matches.push(...response.headers.filter(([name]) => name.toLowerCase() === extraction.key.toLowerCase()).map(([, item]) => item))
      else {
        const visit = (node: DefaultTreeAdapterMap['node']) => {
          if ('tagName' in node && node.tagName === 'input' && node.attrs.some(attr => attr.name === 'type' && attr.value.toLowerCase() === 'hidden') && node.attrs.some(attr => attr.name === 'name' && attr.value === extraction.key)) {
            const field = node.attrs.find(attr => attr.name === 'value')
            if (field) matches.push(field.value)
          }
          if ('childNodes' in node) for (const child of node.childNodes) visit(child)
        }
        visit(parse(response.body))
      }
      if (matches.length !== 1 || matches[0] === undefined) throw new Error('HTTP extraction requires exactly one matching field')
      value = matches[0]
    }
    if (!value || Buffer.byteLength(value) > maxBytes) throw new Error('HTTP extraction is empty or exceeds its byte limit')
    values.set(extraction.name, value)
  }
  return values
}
/** Evaluate approved predicates without exposing actual values in diagnostics.
 * @param step - approved predicates.
 * @param response - observed response.
 */
export function assertHttpResponse(step: HttpStep, response: HttpResponse): void {
  for (const assertion of step.assertions) {
    const matched = assertion.kind === 'status' ? response.status === assertion.value
      : !response.incomplete && (assertion.kind === 'contains' ? response.body.includes(assertion.value)
        : httpJsonScalar(response.body, assertion.pointer) === assertion.value)
    if (!matched) throw new Error('HTTP response assertion failed')
  }
}
/** Resolve a value from the captured identity and earlier steps.
 * @param value - literal or reference.
 * @param secrets - captured identity fields.
 * @param variables - earlier response extractions.
 * @returns execution-only text.
 */
export function resolveHttpValue(value: HttpValue, secrets: Record<string, string>, variables: Map<string, string>): string {
  if (typeof value === 'string') return value
  const resolved = 'secret' in value ? Object.hasOwn(secrets, value.secret) ? secrets[value.secret] : undefined : variables.get(value.variable)
  if (resolved === undefined) throw new Error('HTTP value reference is unavailable')
  return resolved
}
/** Remove captured secrets and common structured credential fields before storage.
 * @param value - raw response text.
 * @param secrets - execution-owned secret and extraction values.
 * @returns sanitized display text. */
export function redactHttpText(value: string, secrets: Iterable<string>): string {
  let result = value
  for (const secret of [...secrets].filter(Boolean).sort((a, b) => b.length - a.length)) {
    for (const variant of new Set([secret, encodeURIComponent(secret), JSON.stringify(secret).slice(1, -1)]))
      result = result.split(variant).join('[redacted]')
  }
  return result.replace(/("(?:password|passwd|token|access_token|refresh_token|csrf|secret|authorization|cookie)"\s*:\s*)"(?:\\.|[^"\\])*"/giu, '$1"[redacted]"')
    .replace(/((?:^|&)(?:password|passwd|token|access_token|refresh_token|csrf|secret)=)[^&]*/giu, '$1[redacted]')
}
/** Remove credential headers and redirect query values from evidence.
 * @param headers - response fields.
 * @param secrets - known secret values.
 * @param extracted - header names whose values were extracted.
 * @returns safe headers for every reader and export. */
export function redactHttpHeaders(headers: [string, string][], secrets: Iterable<string>, extracted: string[]): [string, string][] {
  return headers.map(([name, value]) => {
    const key = name.toLowerCase()
    if (['authorization', 'proxy-authorization', 'cookie', 'set-cookie'].includes(key) || extracted.includes(key)) return [name, '[redacted]']
    if (key === 'location') return [name, value.replace(/[?#].*$/su, '')]
    return [name, redactHttpText(value, secrets)]
  })
}
