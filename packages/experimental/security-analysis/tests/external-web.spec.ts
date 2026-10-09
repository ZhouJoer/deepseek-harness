/** Real loopback HTTP login, isolation, scope and failure observations. @module */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { expect, it, onTestFinished } from 'vitest'
import { MemoryCredentials } from '../../../credentials/credentials/tests/memory.ts'
import { HttpIdentities } from '../src/http-auth.ts'
import { ExternalWebProvider } from '../src/external-web-provider.ts'
import { httpEvidenceSchema, httpStepSchema } from '../src/http-model.ts'
import { externalWebAssetSchema, operationSchema, evidenceSchema, type WorkbenchView } from '../src/workbench/model.ts'
import { httpExchange, httpHistory } from '../src/http-evidence.ts'
import { ArtifactStore } from '../src/workbench/artifacts.ts'
import { sendScopedHttp, httpAddressAllowed, validateExternalTarget } from '../src/http-scope.ts'
import { extractHttpValues, httpJsonScalar } from '../src/http-values.ts'
import type { AnalysisContext } from '../src/workbench/providers.ts'

async function fixture(handler: (request: IncomingMessage, response: ServerResponse, body: string) => void) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-http-'))
  const ctx = new Context()
  const server = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', chunk => chunks.push(Buffer.from(chunk as Uint8Array)))
    request.on('end', () =>{  handler(request, response, Buffer.concat(chunks).toString()) })
  })
  onTestFinished(async () => {
    server.closeAllConnections()
    if (server.listening) await new Promise<void>((resolve, reject) =>
      server.close((error) =>{  if (error) reject(error)
      else resolve() }))
    await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true })
  })
  await ctx.plugin(MemoryCredentials)
  server.listen(0, '127.0.0.1'); await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing loopback listener')
  const scope = { origin: `http://127.0.0.1:${address.port}`, pathPrefix: '/', allowedAddresses: ['127.0.0.1/32'] }
  const asset = externalWebAssetSchema.parse({ ...scope, kind: 'external-web', id: 'target', engagementId: 'project', environmentId: 'local', label: 'Owned fixture' })
  const identities = new HttpIdentities(ctx.credentials)
  const provider = new ExternalWebProvider(identities, { maxSteps: 32, maxFieldBytes: 2048, maxRequestBytes: 32768 })
  const context: AnalysisContext = { asset, environment: { id: 'local', kind: 'local', label: 'Host', cwd: root, tools: [] },
    artifacts: new ArtifactStore(root, 262144), signal: new AbortController().signal, durationMs: 10000, maxOutputBytes: 131072 }
  const prepare = (steps: unknown[]) => provider.prepare(operationSchema.parse({ provider: 'external-web', operation: 'sequence', assetId: asset.id,
    environmentId: 'local', impact: 'observe', parameters: { steps } }), context)
  return { scope, identities, provider, context, prepare }
}
const step = (id: string, path: string, extra: object = {}) => ({ id, label: id, method: 'GET', path, ...extra })

it('logs in with a hidden CSRF field and keeps two identity cookie jars separate', async () => {
  const received: string[] = []
  const f = await fixture((request, response, body) => {
    received.push(request.url!); response.setHeader('Content-Type', 'text/plain')
    if (request.url === '/login' && request.method === 'GET') response.end('<input type="hidden" name="csrf" value="csrf-private">')
    else if (request.url === '/login') {
      const form = new URLSearchParams(body)
      if (form.get('csrf') !== 'csrf-private' || form.get('password') !== 'private-password') { response.statusCode = 403; response.end('denied'); return }
      response.setHeader('Set-Cookie', `session=${form.get('username')}-cookie; Path=/; HttpOnly`); response.end('signed in')
    } else response.end(request.headers.cookie?.startsWith('session=alice-') ? 'role-one ' + request.headers.cookie : request.headers.cookie?.startsWith('session=bob-') ? 'role-two ' + request.headers.cookie : 'anonymous')
  })
  const loginSteps = [step('csrf', '/login', { extract: [{ name: 'csrf', from: 'input', key: 'csrf' }] }),
    step('login', '/login', { method: 'POST', body: { kind: 'form', fields: [
      { name: 'username', value: { secret: 'username' } }, { name: 'password', value: { secret: 'password' } }, { name: 'csrf', value: { variable: 'csrf' } },
    ] }, assertions: [{ kind: 'status', value: 200 }] })]
  const a = await f.identities.write('target', { label: 'First', mode: 'login', secrets: { username: 'alice-private', password: 'private-password' }, loginSteps }, 'project')
  const b = await f.identities.write('target', { label: 'Second', mode: 'login', secrets: { username: 'bob-private', password: 'private-password' }, loginSteps }, 'project')
  expect((await f.identities.list('target')).map(item => item.id)).toEqual([a.id, b.id])
  const plan = await f.prepare([step('first', '/me', { identityId: a.id, assertions: [{ kind: 'contains', value: 'role-one' }] }), step('second', '/me', { identityId: b.id, assertions: [{ kind: 'contains', value: 'role-two' }] }), step('anonymous', '/me', { assertions: [{ kind: 'contains', value: 'anonymous' }] })])
  expect(plan.approvalUse).toBe('single-execution'); expect(plan.impact).toBe('target-write')
  const result = await f.provider.run(plan, f.context)
  expect(result.failure).toBeUndefined()
  const artifact = httpEvidenceSchema.parse(JSON.parse(result.bytes.toString()))
  expect(artifact.exchanges).toHaveLength(7)
  expect(artifact.exchanges.filter(item => item.login).every(item => item.bodyOmitted && !item.body)).toBe(true)
  expect(artifact.exchanges.at(-1)?.body).toBe('anonymous')
  expect(received).toEqual(['/login', '/login', '/me', '/login', '/login', '/me', '/me'])
  expect(artifact.exchanges[2]?.body).toBe('role-one session=[redacted]')
  await f.identities.removeProject('project'); expect(await f.identities.list('target')).toEqual([])
})

it('extracts a JSON login token, submits JSON fields and redacts reflected bearer values', async () => {
  let submitted = ''
  const f = await fixture((request, response, body) => {
    response.setHeader('Content-Type', 'application/json')
    if (request.url === '/login') {
      submitted = body
      response.end(JSON.stringify({ token: 'token-private' }))
    } else response.end(JSON.stringify({ auth: request.headers.authorization }))
  })
  const identity = await f.identities.write('target', { label: 'JSON', mode: 'login', secrets: { username: 'account-private', password: 'password-private' }, tokenVariable: 'access',
    loginSteps: [step('login', '/login', { method: 'POST', body: { kind: 'json', fields: [{ name: 'username', value: { secret: 'username' } }, { name: 'password', value: { secret: 'password' } }] }, extract: [{ name: 'access', from: 'json', key: '/token' }], assertions: [{ kind: 'status', value: 200 }] })] }, 'project')
  const result = await f.provider.run(await f.prepare([step('check', '/me', { identityId: identity.id })]), f.context)
  expect(result.failure).toBeUndefined(); expect(result.bytes.toString()).not.toContain('token-private')
  expect(JSON.parse(submitted)).toEqual({ username: 'account-private', password: 'password-private' })
  expect(result.bytes.toString()).not.toContain('password-private')
  expect(result.bytes.toString()).toContain('Bearer [redacted]')
})

it('submits approved methods, query fields and text bodies without changing their order', async () => {
  const received: { method: string | undefined; path: string | undefined; body: string }[] = []
  const f = await fixture((request, response, body) => {
    received.push({ method: request.method, path: request.url, body }); response.end()
  })
  const methods = ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE']
  const plan = await f.prepare(methods.map(method => step(method, '/resource', { method,
    query: [{ name: 'key', value: 'space /' }],
    ...(['GET', 'HEAD'].includes(method) ? {} : { body: { kind: 'text', value: 'approved text' } }) })))
  const result = await f.provider.run(plan, f.context)
  expect(result.failure).toBeUndefined()
  expect(received).toEqual(methods.map(method => ({ method, path: '/resource?key=space+%2F',
    body: ['GET', 'HEAD'].includes(method) ? '' : 'approved text' })))
})

it('keeps prior evidence when a later response times out and skips the remaining request', async () => {
  const requests: string[] = []
  const f = await fixture((request, response) => {
    requests.push(request.url ?? ''); response.setHeader('Content-Type', 'text/plain')
    if (request.url === '/first') response.end('completed observation')
    else { response.writeHead(200); response.write('partial observation') }
  })
  const plan = await f.prepare([step('first', '/first'), step('slow', '/slow'), step('never', '/never')])
  const result = await f.provider.run(plan, { ...f.context, durationMs: 2000 })
  const artifact = httpEvidenceSchema.parse(JSON.parse(result.bytes.toString()))
  expect(requests).toEqual(['/first', '/slow'])
  expect(artifact.exchanges[0]?.body).toBe('completed observation')
  expect(artifact.exchanges[1]).toMatchObject({ body: 'partial observation', incomplete: true, outcome: 'failed' })
  expect(artifact.exchanges[2]?.outcome).toBe('skipped')
})

it('reads bounded UTF-8 pages from verified HTTP artifacts and rejects mismatched summaries', async () => {
  const text = '界面 "quoted"\n'.repeat(120)
  const f = await fixture((_, response) => { response.setHeader('Content-Type', 'text/plain'); response.end(text) })
  const result = await f.provider.run(await f.prepare([step('read', '/')]), f.context)
  const artifact = await f.context.artifacts.put(result.bytes, result.mediaType)
  const evidence = evidenceSchema.parse({ id: 'http-evidence', engagementId: 'project', assetId: 'target',
    title: 'HTTP response', summary: result.summary, artifact, provider: 'external-web', operation: 'sequence',
    toolVersion: result.toolVersion, request: {}, source: { sessionId: 'session', callId: 'call' },
    incomplete: result.incomplete, http: result.http, createdAt: 1 })
  const view: WorkbenchView = { revision: 1, records: [{ kind: 'evidence', value: evidence }] }
  const history = httpHistory(view, { offset: 0, through: 1 }, 1)
  expect(history).toMatchObject({ through: 1, next: null, items: [{ evidenceId: evidence.id, stepId: 'read' }] })
  let offset = 0; let joined = ''
  for (;;) {
    const page = await httpExchange(view, f.context.artifacts, evidence.id, 'read', 'body', offset, 512)
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(512)
    joined += page.text
    if (page.next === null) break
    expect(page.next).toBeGreaterThan(offset); offset = page.next
  }
  expect(joined).toBe(text)
  await expect(httpExchange({ revision: 0, records: [] }, f.context.artifacts, evidence.id, 'read', 'body', 0, 512)).rejects.toThrow('scope')
  const summary = evidence.http?.exchanges[0]
  if (!summary) throw new Error('Missing HTTP summary')
  summary.status = 418
  await expect(httpExchange(view, f.context.artifacts, evidence.id, 'read', 'body', 0, 512)).rejects.toThrow('summary')
})

it('stops after a failed login assertion and retains skipped steps without sending them', async () => {
  const requests: string[] = []
  const f = await fixture((request, response) => { requests.push(request.url!); response.statusCode = 401; response.end('no') })
  const identity = await f.identities.write('target', { label: 'Failure', mode: 'login', secrets: { username: 'account', password: 'wrong-password' },
    loginSteps: [step('login', '/login', { method: 'POST', assertions: [{ kind: 'status', value: 200 }] })] }, 'project')
  const result = await f.provider.run(await f.prepare([step('protected', '/protected', { identityId: identity.id })]), f.context)
  expect(requests).toEqual(['/login']); expect(result.failure).toBeTruthy()
  expect(result.http?.exchanges.map(item => item.outcome)).toEqual(['failed', 'skipped'])
})

it('refuses changed credential versions without sending a request', async () => {
  let requests = 0
  const f = await fixture((_, response) => { requests++; response.end('unexpected') })
  const input = { label: 'Token', mode: 'bearer', secrets: { token: 'private-token-one' } }
  const identity = await f.identities.write('target', input, 'project')
  const plan = await f.prepare([step('one', '/', { identityId: identity.id })])
  await f.identities.write('target', { ...input, id: identity.id, secrets: { token: 'private-token-two' } }, 'project')
  const result = await f.provider.run(plan, f.context)
  expect(result.failure).toContain('changed'); expect(requests).toBe(0); expect(result.http?.exchanges[0]?.outcome).toBe('skipped')
})

it('does not follow redirects and rejects addresses or paths outside the registered scope', async () => {
  const requests: string[] = []
  const f = await fixture((request, response) => { requests.push(request.url!); response.writeHead(302, { Location: '/redirected' }); response.end() })
  const response = await sendScopedHttp(f.scope, '/', 'GET', {}, undefined, new AbortController().signal, 1024)
  expect(response.status).toBe(302); expect(requests).toEqual(['/'])
  await expect(sendScopedHttp({ ...f.scope, allowedAddresses: ['192.0.2.0/24'] }, '/', 'GET', {}, undefined, new AbortController().signal, 1024)).rejects.toThrow('outside')
  await expect(sendScopedHttp({ ...f.scope, pathPrefix: '/api' }, '/admin', 'GET', {}, undefined, new AbortController().signal, 1024)).rejects.toThrow()
  expect(httpAddressAllowed('::1', ['::1/128'])).toBe(true)
  expect(() => validateExternalTarget({ ...f.scope, origin: f.scope.origin + '/api' })).toThrow()
})

it('retains partial responses on cancellation and never sends subsequent steps', async () => {
  const entered = Promise.withResolvers<undefined>(); const requests: string[] = []
  const f = await fixture((request, response) => { requests.push(request.url!); response.writeHead(200, { 'Content-Type': 'text/plain' }); response.write('partial'); entered.resolve(undefined) })
  const abort = new AbortController()
  const result = f.provider.run(await f.prepare([step('first', '/slow'), step('second', '/never')]), { ...f.context, signal: abort.signal })
  await entered.promise; abort.abort()
  const saved = await result
  expect(requests).toEqual(['/slow']); expect(saved.incomplete).toBe(true); expect(saved.http?.exchanges.at(-1)?.outcome).toBe('skipped')
})

it('rejects missing or ambiguous CSRF and malformed JSON pointers', () => {
  const request = httpStepSchema.parse(step('csrf', '/', { extract: [{ name: 'csrf', from: 'input', key: 'csrf' }] }))
  for (const body of ['', '<input type="hidden" name="csrf" value="one"><input type="hidden" name="csrf" value="two">', '<input name="csrf" value="visible">'])
    expect(() => extractHttpValues(request, { status: 200, headers: [], body, bytes: body.length, incomplete: false }, 1024)).toThrow()
  expect(httpJsonScalar('{"a/b":{"~value":true}}', '/a~1b/~0value')).toBe(true)
  expect(() => httpJsonScalar('{}', '/~2')).toThrow()
})
