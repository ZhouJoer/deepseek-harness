/** Operator workflow for registered sites, private identities and approved request sequences. @module */
import { useEffect, useRef, useState } from 'react'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { HttpStep, HttpIdentityDescription, HttpIdentityId, HttpHistoryItem, HttpSequence, WorkbenchView, WorkbenchConfiguration } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import { HttpRequestEditor, newHttpStep } from './HttpRequestEditor.tsx'
import { HttpHistory, type HttpReadActions } from './HttpHistory.tsx'
import { PlanReview } from './PlanReview.tsx'
import type { NS } from './locales.ts'
import css from './Workbench.module.css'

/** Narrow operator capabilities for the external HTTP workflow. */
export interface HttpActions extends HttpReadActions {
  httpIdentities(this: void, project: string, target: string): Promise<HttpIdentityDescription[]>
  configureHttpIdentity(this: void, project: string, target: string, input: string): Promise<HttpIdentityDescription>
  removeHttpIdentity(this: void, project: string, target: string, identity: HttpIdentityId): Promise<void>
  configuration(this: void, session: SessionId): Promise<WorkbenchConfiguration>
  command(this: void, session: SessionId, input: string): Promise<WorkbenchView>
  execute(this: void, session: SessionId, plan: string, operation: string, revision: number): Promise<WorkbenchView>
}
/** Register targets and prepare plans without sending network requests before approval.
 * @param props - retained session, current project and authenticated Host actions.
 * @returns target, identity, request and evidence controls. */
export function HttpWorkbench(props: PropsLocale<typeof NS> & HttpActions & {
  project: string
  session?: SessionId | undefined
  view: WorkbenchView
  disabled: boolean
  connect(this: void): void
  changed(this: void, view: WorkbenchView): void
}) {
  const { t } = props
  const targets = props.view.records.filter(item => item.kind === 'asset').map(item => item.value).filter(asset => 'kind' in asset && asset.kind === 'external-web')
  const [targetId, setTargetId] = useState(''); const target = targets.find(item => item.id === targetId) ?? targets[0]
  const [configuration, setConfiguration] = useState<WorkbenchConfiguration>()
  const [environment, setEnvironment] = useState(''); const [origin, setOrigin] = useState(''); const [prefix, setPrefix] = useState('/')
  const [addresses, setAddresses] = useState(''); const [label, setLabel] = useState('')
  const [identities, setIdentities] = useState<HttpIdentityDescription[]>([])
  const [identityId, setIdentityId] = useState(''); const [identityLabel, setIdentityLabel] = useState('')
  const [mode, setMode] = useState<HttpIdentityDescription['mode']>('login')
  const [username, setUsername] = useState(''); const [password, setPassword] = useState(''); const [token, setToken] = useState(''); const [tokenVariable, setTokenVariable] = useState('')
  const [loginSteps, setLoginSteps] = useState<HttpStep[]>(() => [{ ...newHttpStep(t('httpValidationTitle')), method: 'POST' as const, path: '/login', label: t('httpLogin'), body: { kind: 'form' as const, fields: [{ name: 'username', value: { secret: 'username' } }, { name: 'password', value: { secret: 'password' } }] } }])
  const [steps, setSteps] = useState(() => [newHttpStep(t('httpValidationTitle'))]); const [replayOf, setReplayOf] = useState<HttpSequence['replayOf']>()
  const [hypothesis, setHypothesis] = useState(''); const [expected, setExpected] = useState(''); const [impact, setImpact] = useState(''); const [cleanup, setCleanup] = useState(''); const [duration, setDuration] = useState(30000)
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false)
  const check = useRef<{ target: string; id: string }>()
  const attempts = useRef(new Map<string, string>())
  const [link, setLink] = useState<HttpHistoryItem>(); const [findingId, setFindingId] = useState(''); const [role, setRole] = useState('baseline')
  useEffect(() => {
    let active = true
    if (props.session) void props.configuration(props.session).then((value) =>
    { if (active) setConfiguration(value) }).catch((error: unknown) =>
    { if (active) setError(String(error)) })
    return () => { active = false }
  }, [props.session, props.configuration])
  useEffect(() => {
    let active = true; setIdentities([]); setIdentityId(''); setUsername(''); setPassword(''); setToken('')
    if (target) void props.httpIdentities(props.project, target.id).then((value) =>
    { if (active) setIdentities(value) }).catch((error: unknown) =>
    { if (active) setError(String(error)) })
    return () => { active = false }
  }, [props.project, target?.id, props.httpIdentities])
  const run = async (action: () => Promise<void>) => { setBusy(true); setError(''); setNotice(''); try { await action() } catch (error) { setError(String(error)) } finally { setBusy(false) } }
  const command = async (action: object, view = props.view) => {
    if (!props.session) throw new Error(t('httpNeedSession'))
    const next = await props.command(props.session, JSON.stringify({ operationId: randomUUID(), expectedRevision: view.revision, action }))
    props.changed(next); return next
  }
  const prepare = async () => {
    if (!target) return
    let view = props.view
    if (check.current?.target !== target.id) {
      const before = new Set(view.records.filter(item => item.kind === 'check').map(item => item.value.id))
      view = await command({ kind: 'check', check: { assetId: target.id, title: t('httpValidationTitle'), phase: 'validation', criterion: expected, dependencies: [], evidenceIds: [] } }, view)
      const created = view.records.find(item => item.kind === 'check' && !before.has(item.value.id))
      if (created?.kind !== 'check') throw new Error(t('unavailableReference'))
      check.current = { target: target.id, id: created.value.id }
    }
    await command({ kind: 'plan', checkId: check.current.id, hypothesis, expectedObservation: expected, impact, cleanup, durationMs: duration,
      operation: { provider: 'external-web', operation: 'sequence', environmentId: target.environmentId, assetId: target.id, impact: 'observe', parameters: { steps, ...(replayOf ? { replayOf } : {}) } } }, view)
    check.current = undefined; setNotice(t('httpPrepared'))
  }
  const replay = (row: HttpHistoryItem) => {
    const evidence = props.view.records.find(item => item.kind === 'evidence' && item.value.id === row.evidenceId)
    const plan = evidence?.kind === 'evidence' ? props.view.records.find(item => item.kind === 'plan' && item.value.id === evidence.value.planId) : undefined
    if (plan?.kind !== 'plan') { setError(t('unavailableReference')); return }
    const sequence = plan.value.operation.parameters as HttpSequence
    setSteps(sequence.steps.filter(step => !step.login).map(step => ({ ...step })))
    setReplayOf({ evidenceId: row.evidenceId, stepId: row.stepId })
    setHypothesis(plan.value.hypothesis)
    setExpected(plan.value.expectedObservation)
    setImpact(plan.value.impact); setCleanup(plan.value.cleanup); setDuration(plan.value.durationMs); check.current = undefined
  }
  const local = configuration?.environments.filter(item => item.kind === 'local') ?? []
  const disabled = busy || props.disabled || !props.session
  return <section className={css.planReview} aria-label={t('httpTitle')}><h2>{t('httpTitle')}</h2>
    {!props.session && <p>{t('httpNeedSession')} <button onClick={props.connect}>{t('httpConnect')}</button></p>}
    {error && <p role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
    <details open={!targets.length}><summary>{t('httpTargets')}</summary><fieldset className={css.httpFields} disabled={disabled}>
      <label className={css.field}>{t('name')}<input value={label} onChange={(event) =>{  setLabel(event.target.value) }} /></label>
      <label className={css.field}>{t('httpOrigin')}<input value={origin} onChange={(event) =>{  setOrigin(event.target.value) }} /></label>
      <label className={css.field}>{t('httpPrefix')}<input value={prefix} onChange={(event) =>{  setPrefix(event.target.value) }} /></label>
      <label className={css.field}>{t('httpAddresses')}<textarea value={addresses} onChange={(event) =>{  setAddresses(event.target.value) }} /></label>
      <label className={css.field}>{t('environment')}<select value={environment || local[0]?.id || ''} onChange={(event) =>{  setEnvironment(event.target.value) }}>{local.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <button disabled={!label || !origin || !addresses || !local.length} onClick={() => void run(async () => { await command({ kind: 'external-web-target', label, origin, pathPrefix: prefix, allowedAddresses: addresses.split(/\s+/u).filter(Boolean), environmentId: environment || local[0]?.id }); setNotice(t('httpSaved')) })}>{t('httpRegister')}</button>
    </fieldset></details>
    <label className={css.field}>{t('httpTarget')}<select value={target?.id ?? ''} onChange={(event) => { setTargetId(event.target.value); setSteps([newHttpStep(t('httpValidationTitle'))]); setReplayOf(undefined); check.current = undefined }}>{targets.map(item => <option key={item.id} value={item.id}>{item.label} · {item.origin}</option>)}</select></label>
    {target && <><details><summary>{t('httpIdentities')}</summary><fieldset className={css.httpFields} disabled={disabled}><p>{t('httpIdentityHint')}</p>
      <select aria-label={t('httpIdentity')} value={identityId} onChange={(event) => { const item = identities.find(identity => identity.id === event.target.value); setIdentityId(event.target.value); setIdentityLabel(item?.label ?? ''); setMode(item?.mode ?? 'login'); if (item) setLoginSteps(item.loginSteps); setTokenVariable(item?.tokenVariable ?? ''); setUsername(''); setPassword(''); setToken('') }}>
        <option value="">{t('httpSaveIdentity')}</option>{identities.map(item => <option key={item.id} value={item.id}>{item.label} · {item.revision}</option>)}
      </select><label className={css.field}>{t('name')}<input value={identityLabel} onChange={(event) =>{  setIdentityLabel(event.target.value) }} /></label>
      <label className={css.field}>{t('httpIdentityMode')}<select value={mode} onChange={(event) =>{  setMode(event.target.value as typeof mode) }}><option value="login">{t('httpLogin')}</option><option value="basic">{t('httpBasic')}</option><option value="bearer">{t('httpToken')}</option><option value="cookie">{t('httpCookie')}</option></select></label>
      {mode === 'login' || mode === 'basic' ? <><label className={css.field}>{t('httpUsername')}<input autoComplete="off" value={username} onChange={(event) =>{  setUsername(event.target.value) }} /></label><label className={css.field}>{t('httpPassword')}<input type="password" autoComplete="new-password" value={password} onChange={(event) =>{  setPassword(event.target.value) }} /></label></> : <label className={css.field}>{t(mode === 'cookie' ? 'httpCookie' : 'httpToken')}<input type="password" autoComplete="new-password" value={token} onChange={(event) =>{  setToken(event.target.value) }} /></label>}
      {mode === 'login' && <><h3>{t('httpLoginSteps')}</h3><label className={css.field}>{t('httpTokenVariable')}<input value={tokenVariable} onChange={(event) =>{  setTokenVariable(event.target.value) }} /></label><HttpRequestEditor t={t} steps={loginSteps} change={setLoginSteps} /></>}
      <button onClick={() => void run(async () => { await props.configureHttpIdentity(props.project, target.id, JSON.stringify({ ...(identityId ? { id: identityId } : {}), label: identityLabel, mode, secrets: mode === 'login' || mode === 'basic' ? { username, password } : mode === 'bearer' ? { token } : { cookie: token }, loginSteps: mode === 'login' ? loginSteps : [], ...(tokenVariable ? { tokenVariable } : {}) })); setPassword(''); setUsername(''); setToken(''); setIdentities(await props.httpIdentities(props.project, target.id)); setNotice(t('httpSaved')) })}>{t('httpSaveIdentity')}</button>
      {identityId && <button onClick={() => void run(async () => { await props.removeHttpIdentity(props.project, target.id, identityId as HttpIdentityId); setIdentityId(''); setIdentities(await props.httpIdentities(props.project, target.id)) })}>{t('httpRemoveIdentity')}</button>}
    </fieldset></details>
    <fieldset className={css.httpFields} disabled={disabled}><legend>{t('httpSteps')}</legend><HttpRequestEditor t={t} steps={steps} change={setSteps} identities={identities} />
      <label className={css.field}>{t('planQuestion')}<textarea value={hypothesis} onChange={(event) =>{  setHypothesis(event.target.value) }} /></label>
      <label className={css.field}>{t('expected')}<textarea value={expected} onChange={(event) =>{  setExpected(event.target.value) }} /></label>
      <label className={css.field}>{t('impact')}<textarea placeholder={t('httpImpact')} value={impact} onChange={(event) =>{  setImpact(event.target.value) }} /></label>
      <label className={css.field}>{t('cleanup')}<textarea placeholder={t('httpCleanup')} value={cleanup} onChange={(event) =>{  setCleanup(event.target.value) }} /></label>
      <label className={css.field}>{t('httpDuration')}<input type="number" min={1} value={duration} onChange={(event) =>{  setDuration(Number(event.target.value)) }} /></label>
      <button disabled={!steps.length || !hypothesis || !expected || !impact || !cleanup} onClick={() => void run(prepare)}>{t('httpPrepare')}</button>
    </fieldset>
    {props.view.records.filter(item => item.kind === 'plan' && item.value.operation.provider === 'external-web' && item.value.operation.assetId === target.id).map(item => item.kind === 'plan' && <PlanReview key={item.value.id} t={t} plan={item.value} view={props.view} environment={target.environmentId} busy={busy} disabled={disabled}
      approve={() => void run(async () => { await command({ kind: 'approve', planId: item.value.id }) })}
      revoke={() => void run(async () => { await command({ kind: 'revoke', planId: item.value.id }) })}
      execute={() => void run(async () => { let operation = attempts.current.get(item.value.id)
        if (!operation) { operation = randomUUID()
          attempts.current.set(item.value.id, operation) } props.changed(await props.execute(props.session as SessionId,
          item.value.id, operation, props.view.revision)) })} preview={() =>
      {}} />)}
    </>}
    {link && <fieldset className={css.httpFields} disabled={disabled}><legend>{t('httpLinkFinding')}</legend><p>{link.method} {link.path}</p>
      <select aria-label={t('findings')} value={findingId} onChange={(event) =>{  setFindingId(event.target.value) }}><option value="">{t('notSelected')}</option>{props.view.records.filter(item => item.kind === 'finding' && item.value.assetId === link.assetId).map(item => item.kind === 'finding' && <option value={item.value.id} key={item.value.id}>{item.value.title}</option>)}</select>
      <select aria-label={t('httpLinkFinding')} value={role} onChange={(event) =>{  setRole(event.target.value) }}><option value="baseline">{t('httpBaseline')}</option><option value="verification">{t('httpVerification')}</option><option value="supporting">{t('httpSupporting')}</option></select>
      <button disabled={!findingId} onClick={() => void run(async () => { await command({ kind: 'finding-http-reference', findingId, evidenceId: link.evidenceId, stepId: link.stepId, role }); setLink(undefined) })}>{t('httpLinkFinding')}</button>
    </fieldset>}
    <HttpHistory {...props} assetId={target?.id} revision={props.view.revision}
      replay={props.disabled ? undefined : replay} associate={props.disabled ? undefined : setLink} />
  </section>
}
