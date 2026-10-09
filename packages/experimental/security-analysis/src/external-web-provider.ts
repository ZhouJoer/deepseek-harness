/** Approved HTTP sequences for explicit operator targets, with private login state. @module */
import { Service, type Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { brandString } from '@deepseek-ai/dsh-brand'
import type {} from '@deepseek-ai/dsh-credentials'
import type {} from './index.ts'
import { CookieJar } from 'tough-cookie'
import { HttpIdentities, type HttpIdentitySnapshot } from './http-auth.ts'
import { httpSequenceSchema, type HttpStep, type HttpStepId, type HttpIdentityId, type HttpExchange, type HttpSequence } from './http-model.ts'
import { scopedWebPath } from './web-provider.ts'
import { sendScopedHttp, validateExternalTarget } from './http-scope.ts'
import { extractHttpValues, assertHttpResponse, resolveHttpValue, redactHttpHeaders, redactHttpText } from './http-values.ts'
import type { AnalysisProvider, AnalysisContext, AnalysisResult } from './workbench/providers.ts'
import type { AnalysisOperation, Asset } from './workbench/model.ts'

/** Deployment bounds applied to the complete prepared sequence. */
export interface Config { maxSteps: number; maxFieldBytes: number; maxRequestBytes: number }
type Target = Extract<Asset, { kind: 'external-web' }>
const forbiddenHeader = /^(?:host|authorization|proxy-authorization|cookie|connection|content-length|transfer-encoding|upgrade|proxy-.*)$/iu
function pendingExchange(step: HttpStep): HttpExchange {
  return { stepId: step.id, label: step.label, method: step.method, path: step.path, durationMs: 0,
    bytes: 0, incomplete: false, outcome: 'skipped', detail: '', login: !!step.login, request: step,
    headers: [], body: '', bodyOmitted: !!step.login }
}
function target(context: AnalysisContext): Target {
  if (!('kind' in context.asset) || context.asset.kind !== 'external-web' || context.environment.kind !== 'local' || context.asset.environmentId !== context.environment.id)
    throw new Error('External HTTP requires a registered target in its local Host environment')
  return context.asset
}
/** Executes only the fixed sequence resolved into an approved plan. */
export class ExternalWebProvider implements AnalysisProvider {
  readonly id = 'external-web'
  readonly operations = ['sequence']
  readonly inputGuide = 'sequence accepts {steps:[{id,label,method,path,identityId?,query:[],headers:[],body?,extract:[],assertions:[]}],replayOf?}. Field values are strings, {secret:name} or {variable:name}. Bodies use {kind:text,value} or {kind:json|form,fields:[{name,value}]}. Login steps come from operator-configured identities. Requires one approved, single-use validation plan. Responses are redacted; redirects and retries are never automatic.'
  constructor(private readonly identities: HttpIdentities, private readonly config: Config) {}
  /** Serialize plans sharing the same target.
   * @param request - prepared operation.
   * @param asset - registered target.
   * @returns the target's exclusive execution key. */
  resourceKey(request: AnalysisOperation, asset: Asset): string { return request.provider + ':' + asset.id }
  /** Expand login recipes and capture identity versions without contacting the target.
   * @param request - proposed testing steps.
   * @param context - target and deployment bounds.
   * @returns complete immutable request template. */
  async prepare(request: AnalysisOperation, context: AnalysisContext): Promise<AnalysisOperation> {
    const asset = target(context)
    const input = httpSequenceSchema.parse(request.parameters)
    if (input.prepared || input.identities.length || input.steps.some(step => step.login)) throw new Error('Submit testing steps only; the Host prepares login steps and identity versions')
    const steps: HttpStep[] = []; const identities: HttpSequence['identities'] = []
    const secrets: string[] = []
    const seen = new Set<HttpIdentityId>()
    for (const step of input.steps) {
      if (step.identityId && !seen.has(step.identityId)) {
        seen.add(step.identityId)
        const identity = await this.identities.read(asset.id, step.identityId)
        secrets.push(...Object.values(identity.secrets))
        identities.push({ id: identity.id, revision: identity.revision })
        if (identity.mode === 'login') identity.loginSteps.forEach((login, index) => steps.push({ ...login,
          id: brandString<HttpStepId>(`${identity.id}:${index}`), identityId: identity.id, login: true }))
      }
      steps.push(step)
    }
    const sequence: HttpSequence = { steps, identities, prepared: true, ...(input.replayOf ? { replayOf: input.replayOf } : {}) }
    const template = JSON.stringify(sequence)
    if (secrets.some(secret => template.includes(JSON.stringify(secret).slice(1, -1)))) throw new Error('HTTP templates must reference credential fields instead of embedding their values')
    return this.resolve({ ...request, parameters: JSON.parse(JSON.stringify(sequence)) as AnalysisOperation['parameters'] }, context)
  }
  /** Validate the frozen template deterministically; no credential or network reads occur.
   * @param request - prepared operation.
   * @param context - registered target.
   * @returns canonical single-use operation. */
  resolve(request: AnalysisOperation, context: AnalysisContext): AnalysisOperation {
    const asset = target(context)
    validateExternalTarget(asset)
    if (request.operation !== 'sequence' || request.script) throw new Error('External HTTP supports only declarative sequences')
    const sequence = httpSequenceSchema.parse(request.parameters)
    const minimumEvidence = sequence.steps.map(step => ({ ...pendingExchange(step),
      status: 599, durationMs: Number.MAX_VALUE, bytes: Number.MAX_SAFE_INTEGER, detail: ' '.repeat(128) }))
    if (Buffer.byteLength(JSON.stringify({ version: 1, exchanges: minimumEvidence })) > context.maxOutputBytes)
      throw new Error('HTTP sequence metadata exceeds its evidence byte budget')
    if (!sequence.prepared || sequence.steps.length > this.config.maxSteps) throw new Error('HTTP sequence is unprepared or exceeds the step limit')
    if (Buffer.byteLength(JSON.stringify(sequence)) > Math.min(this.config.maxRequestBytes, Math.floor(context.maxOutputBytes / 2)))
      throw new Error('HTTP sequence exceeds its request or evidence byte budget')
    if (new Set(sequence.steps.map(step => step.id)).size !== sequence.steps.length) throw new Error('HTTP step IDs must be unique')
    const identities = new Set(sequence.identities.map(identity => identity.id))
    for (const step of sequence.steps) {
      scopedWebPath(asset.origin, asset.pathPrefix, step.path)
      if (step.identityId && !identities.has(step.identityId)) throw new Error('HTTP step identity has no captured version')
      if (step.headers.some(field => forbiddenHeader.test(field.name) || !/^[!#$%&'*+.^`|~\w-]+$/u.test(field.name)))
        throw new Error('HTTP headers cannot override authentication, routing or framing')
      if ((step.method === 'GET' || step.method === 'HEAD') && step.body) throw new Error('GET and HEAD cannot include a request body')
    }
    const writes = sequence.steps.some(step => !['GET', 'HEAD', 'OPTIONS'].includes(step.method))
    return { ...request, parameters: JSON.parse(JSON.stringify(sequence)) as AnalysisOperation['parameters'], impact: writes ? 'target-write' : request.impact, approvalUse: 'single-execution' }
  }
  /** Execute a finite sequence, retaining completed observations on failure or cancellation.
   * @param request - approved resolved operation.
   * @param context - cancellation, target and complete output budget.
   * @returns one sanitized aggregate evidence artifact. */
  async run(request: AnalysisOperation, context: AnalysisContext): Promise<AnalysisResult> {
    const asset = target(context)
    const sequence = httpSequenceSchema.parse(this.resolve(request, context).parameters)
    const signal = AbortSignal.any([context.signal, AbortSignal.timeout(context.durationMs)])
    const snapshots = new Map<HttpIdentityId, HttpIdentitySnapshot>()
    const jars = new Map<string, CookieJar>(); const variables = new Map<string, Map<string, string>>()
    const privateValues = new Set<string>(); const exchanges: HttpExchange[] = []
    let failure: string | undefined
    try {
      for (const reference of sequence.identities) {
        const snapshot = await this.identities.read(asset.id, reference.id)
        if (snapshot.revision !== reference.revision) throw new Error('HTTP identity changed; prepare a new plan')
        snapshots.set(snapshot.id, snapshot)
        Object.values(snapshot.secrets).forEach(value => privateValues.add(value))
      }
      for (const step of sequence.steps) {
        const record = pendingExchange(step)
        exchanges.push(record)
        if (failure) { record.detail = 'Earlier step failed'; record.incomplete = true; continue }
        const started = performance.now()
        try {
          signal.throwIfAborted()
          const identity = step.identityId ? snapshots.get(step.identityId) : undefined
          if (identity && (await this.identities.read(asset.id, identity.id)).revision !== identity.revision)
            throw new Error('HTTP identity changed; prepare a new plan')
          const key = step.identityId ?? 'anonymous'
          let jar = jars.get(key)
          if (!jar) { jar = new CookieJar(); jars.set(key, jar) }
          let vars = variables.get(key)
          if (!vars) { vars = new Map(); variables.set(key, vars) }
          const value = (input: Parameters<typeof resolveHttpValue>[0]) => resolveHttpValue(input, identity?.secrets ?? {}, vars)
          const url = new URL(step.path, asset.origin)
          for (const field of step.query) url.searchParams.append(field.name, value(field.value))
          const headers: Record<string, string> = {}
          for (const field of step.headers) {
            const resolved = value(field.value)
            if (/[\r\n]/u.test(resolved)) throw new Error('HTTP header value contains a line break')
            headers[field.name.toLowerCase()] = resolved
          }
          if (identity?.mode === 'bearer') headers.authorization = `Bearer ${identity.secrets.token}`
          if (identity?.mode === 'login' && identity.tokenVariable) {
            const token = vars.get(identity.tokenVariable)
            if (token) headers.authorization = 'Bearer ' + token
            else if (!step.login) throw new Error('Login did not produce its configured token variable')
          }
          if (identity?.mode === 'basic') {
            const encoded = Buffer.from(`${identity.secrets.username}:${identity.secrets.password}`).toString('base64')
            privateValues.add(encoded); headers.authorization = 'Basic ' + encoded
          }
          const cookie = await jar.getCookieString(url.href)
          if (identity?.mode === 'cookie') headers.cookie = [identity.secrets.cookie, cookie].filter(Boolean).join('; ')
          else if (cookie) headers.cookie = cookie
          let body: string | undefined
          if (step.body?.kind === 'text') body = value(step.body.value)
          else if (step.body) {
            const fields = step.body.fields.map(field => [field.name, value(field.value)])
            body = step.body.kind === 'json' ? JSON.stringify(Object.fromEntries(fields)) : new URLSearchParams(fields).toString()
            headers['content-type'] = step.body.kind === 'json' ? 'application/json' : 'application/x-www-form-urlencoded'
          }
          if (Buffer.byteLength(JSON.stringify(headers)) + Buffer.byteLength(body ?? '') + Buffer.byteLength(url.href) > this.config.maxRequestBytes)
            throw new Error('Resolved HTTP request exceeds the byte limit')
          const response = await sendScopedHttp(asset, url.pathname + url.search, step.method, headers, body, signal,
            Math.floor(context.maxOutputBytes / (sequence.steps.length * 8)))
          record.status = response.status; record.bytes = response.bytes; record.incomplete = response.incomplete
          for (const [name, content] of response.headers) if (name.toLowerCase() === 'set-cookie') {
            privateValues.add(content)
            const stored = await jar.setCookie(content, url.href)
            if (stored) privateValues.add(stored.value)
          }
          record.headers = redactHttpHeaders(response.headers, privateValues, step.extract.filter(item => item.from === 'header').map(item => item.key.toLowerCase()))
          const extracted = extractHttpValues(step, response, this.config.maxFieldBytes)
          for (const [name, content] of extracted) { vars.set(name, content); privateValues.add(content) }
          record.headers = redactHttpHeaders(response.headers, privateValues, step.extract.filter(item => item.from === 'header').map(item => item.key.toLowerCase()))
          const contentType = response.headers.find(([name]) => name.toLowerCase() === 'content-type')?.[1] ?? ''
          record.bodyOmitted ||= !/^(?:text\/|application\/(?:json|[^;]+\+json|xml|x-www-form-urlencoded))/iu.test(contentType)
          if (!record.bodyOmitted) record.body = redactHttpText(response.body, privateValues)
          if (response.incomplete) throw new Error('HTTP response was interrupted or exceeded the byte limit')
          assertHttpResponse(step, response)
          record.outcome = 'observed'
        } catch (_error) {
          failure = signal.aborted ? 'HTTP execution cancelled or timed out' : 'HTTP step failed; inspect its configuration, response and assertions'
          record.outcome = 'failed'; record.incomplete = true; record.detail = failure
        } finally { record.durationMs = Math.max(0, performance.now() - started) }
      }
    } catch (_error) {
      failure = 'HTTP identity is unavailable or changed; prepare a new plan'
      for (const step of sequence.steps) exchanges.push({ stepId: step.id, label: step.label, method: step.method, path: step.path,
        durationMs: 0, bytes: 0, incomplete: true, outcome: 'skipped', detail: failure, login: !!step.login,
        request: step, headers: [], body: '', bodyOmitted: true })
    }
    finally { for (const jar of jars.values()) await jar.removeAllCookies(); snapshots.clear(); variables.clear() }
    // Later steps may reveal a credential already reflected by an earlier response.
    for (const exchange of exchanges) {
      exchange.body = redactHttpText(exchange.body, privateValues)
      exchange.headers = redactHttpHeaders(exchange.headers, privateValues, [])
    }
    let bytes = Buffer.from(JSON.stringify({ version: 1, exchanges }))
    if (bytes.length > context.maxOutputBytes) {
      for (const exchange of exchanges) { exchange.body = ''; exchange.headers = []; exchange.bodyOmitted = true; exchange.incomplete = true }
      bytes = Buffer.from(JSON.stringify({ version: 1, exchanges }))
    }
    if (bytes.length > context.maxOutputBytes) throw new Error('HTTP evidence metadata exceeds the output budget')
    return { bytes, mediaType: 'application/json', summary: failure ?? 'HTTP sequence observed; compare responses before drawing a conclusion',
      incomplete: !!failure || exchanges.some(item => item.incomplete), ...(failure ? { failure } : {}),
      cleanup: 'HTTP connections closed and temporary login state removed', toolVersion: 'DSH external HTTP v1',
      http: { version: 1, exchanges: exchanges.map(({ request: _request,
        headers: _headers, body: _body, bodyOmitted: _omitted, ...summary }) =>
        summary) } }
  }
}
declare module '@deepseek-ai/cordis' { interface Context { securityExternalWeb: SecurityExternalWeb } }
/** Optional Host owner for external HTTP execution and target credentials. */
export default class SecurityExternalWeb extends Service<Config> {
  static inject = ['securityWorkbench', 'credentials']
  static Config: Schema<Config> = Schema.object({ maxSteps: Schema.number().step(1).min(1).default(32),
    maxFieldBytes: Schema.number().step(1).min(1).default(16384), maxRequestBytes: Schema.number().step(1).min(1).default(1048576) })
  /** Host-owned authentication records; never expose private snapshots to clients. */
  readonly identities: HttpIdentities
  constructor(ctx: Context, config: Config) {
    super(ctx, 'securityExternalWeb')
    this.identities = new HttpIdentities(ctx.credentials)
    ctx.effect(async () => {
      const controller = await ctx.securityWorkbench.ready
      return controller.providers.register(new ExternalWebProvider(this.identities, config))
    })
  }
}
