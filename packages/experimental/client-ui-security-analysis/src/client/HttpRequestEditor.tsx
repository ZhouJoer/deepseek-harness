/** Structured, declarative request editing shared by login recipes and validation drafts. @module */
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { HttpStep, HttpStepId, HttpIdentityId, HttpIdentityDescription } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import css from './Workbench.module.css'

/** Create an anonymous read-only request draft.
 * @param label - localized initial description.
 * @returns request with an execution-local step ID. */
export function newHttpStep(label: string): HttpStep {
  return { id: randomUUID() as HttpStepId, label, method: 'GET', path: '/', query: [], headers: [], extract: [], assertions: [{ kind: 'status', value: 200 }] }
}
type Value = HttpStep['headers'][number]['value']
type Fields = HttpStep['headers']
type Locale = PropsLocale<typeof NS>
function ValueEditor({ value, change, t }: Locale & { value: Value; change(this: void, value: Value): void }) {
  const mode = typeof value === 'string' ? 'literal' : 'secret' in value ? 'secret' : 'variable'
  const text = typeof value === 'string' ? value : 'secret' in value ? value.secret : value.variable
  const update = (kind: string, input: string) =>{  change(kind === 'secret' ? { secret: input } : kind === 'variable' ? { variable: input } : input) }
  return <><select aria-label={t('httpValueMode')} value={mode} onChange={(event) =>{  update(event.target.value, text) }}>
    <option value="literal">{t('httpLiteral')}</option><option value="secret">{t('httpSecret')}</option><option value="variable">{t('httpVariable')}</option>
  </select><input aria-label={t('httpFieldValue')} value={text} onChange={(event) =>{  update(mode, event.target.value) }} /></>
}
function FieldEditor({ fields, change, t }: Locale & { fields: Fields; change(this: void, value: Fields): void }) {
  return <div>{fields.map((field, index) => <div className={css.taskActions} key={index}>
    <input aria-label={t('httpFieldName')} value={field.name} onChange={(event) =>{  change(fields.map((item, i) => i === index ? { ...item, name: event.target.value } : item)) }} />
    <ValueEditor t={t} value={field.value} change={(value) =>
    {  change(fields.map((item, i) => i === index ? { ...item, value } : item)) }} />
    <button onClick={() =>{  change(fields.filter((_, i) => i !== index)) }}>{t('httpRemoveField')}</button>
  </div>)}<button onClick={() =>{  change([...fields, { name: '', value: '' }]) }}>{t('httpAddField')}</button></div>
}
/** Edit finite requests without allowing arbitrary login scripts.
 * @param props - draft steps, safe identity descriptions and update callback.
 * @returns labeled request fields and response rules. */
export function HttpRequestEditor({ steps, change, identities, t }: Locale & {
  steps: HttpStep[]
  change(this: void, value: HttpStep[]): void
  identities?: HttpIdentityDescription[]
}) {
  const update = (index: number, patch: Partial<HttpStep>) =>{  change(steps.map((step, i) => i === index ? { ...step, ...patch } : step)) }
  return <div>{steps.map((step, index) => <fieldset className={css.httpFields} key={step.id}>
    <legend>{index + 1}. {step.label}</legend>
    <label className={css.field}>{t('httpStepLabel')}<input value={step.label} onChange={(event) =>{  update(index, { label: event.target.value }) }} /></label>
    <label className={css.field}>{t('httpMethod')}<select value={step.method} onChange={(event) =>{  update(index, { method: event.target.value as HttpStep['method'] }) }}>
      {(['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'] as const).map(method => <option key={method}>{method}</option>)}
    </select></label>
    <label className={css.field}>{t('httpPath')}<input value={step.path} onChange={(event) =>{  update(index, { path: event.target.value }) }} /></label>
    {identities && <label className={css.field}>{t('httpIdentity')}<select aria-label={t('httpIdentity')} value={step.identityId ?? ''} onChange={(event) =>{  update(index, { identityId: event.target.value ? event.target.value as HttpIdentityId : undefined }) }}>
      <option value="">{t('httpAnonymous')}</option>{identities.map(identity => <option value={identity.id} key={identity.id}>{identity.label}</option>)}
    </select></label>}
    <details><summary>{t('httpQuery')}</summary><FieldEditor t={t} fields={step.query} change={(query) =>{  update(index, { query }) }} /></details>
    <details><summary>{t('httpHeaders')}</summary><FieldEditor t={t} fields={step.headers} change={(headers) =>{  update(index, { headers }) }} /></details>
    <label className={css.field}>{t('httpBody')}<select value={step.body?.kind ?? 'none'} onChange={(event) => {
      const kind = event.target.value
      update(index, { body: kind === 'none' ? undefined : kind === 'text' ? { kind, value: '' } : { kind: kind as 'json' | 'form', fields: [] } })
    }}><option value="none">{t('httpNone')}</option><option value="text">{t('httpText')}</option><option value="json">{t('httpJson')}</option><option value="form">{t('httpForm')}</option></select></label>
    {step.body?.kind === 'text' && <ValueEditor t={t} value={step.body.value} change={(value) =>{  update(index, { body: { kind: 'text', value } }) }} />}
    {step.body && step.body.kind !== 'text' && <FieldEditor t={t} fields={step.body.fields} change={(fields) =>{  update(index, { body: { kind: step.body?.kind === 'json' ? 'json' : 'form', fields } }) }} />}
    <details><summary>{t('httpExtract')}</summary>{step.extract.map((item, i) => <div className={css.taskActions} key={i}>
      <input aria-label={t('httpFieldName')} value={item.name} onChange={(event) =>{  update(index, { extract: step.extract.map((entry, n) => n === i ? { ...entry, name: event.target.value } : entry) }) }} />
      <select aria-label={t('httpExtractFrom')} value={item.from} onChange={(event) =>{  update(index, { extract: step.extract.map((entry, n) => n === i ? { ...entry, from: event.target.value as typeof item.from } : entry) }) }}>
        <option value="input">{t('httpInput')}</option><option value="json">{t('httpJson')}</option><option value="header">{t('httpHeader')}</option>
      </select><input aria-label={t('httpExtractKey')} value={item.key} onChange={(event) =>{  update(index, { extract: step.extract.map((entry, n) => n === i ? { ...entry, key: event.target.value } : entry) }) }} />
      <button onClick={() =>{  update(index, { extract: step.extract.filter((_, n) => n !== i) }) }}>{t('httpRemoveField')}</button>
    </div>)}<button onClick={() =>{  update(index, { extract: [...step.extract, { name: '', from: 'input', key: '' }] }) }}>{t('httpAddExtract')}</button></details>
    <details open><summary>{t('httpAssertions')}</summary>{step.assertions.map((item, i) => <div className={css.taskActions} key={i}>
      <select aria-label={t('httpAssertions')} value={item.kind} onChange={(event) =>{  update(index, { assertions: step.assertions.map((entry, n) => n !== i ? entry : event.target.value === 'status' ? { kind: 'status', value: 200 } : event.target.value === 'json' ? { kind: 'json', pointer: '', value: '' } : { kind: 'contains', value: '' }) }) }}>
        <option value="status">{t('httpAssertStatus')}</option><option value="contains">{t('httpAssertContains')}</option><option value="json">{t('httpAssertJson')}</option>
      </select>{item.kind === 'json' && <input aria-label={t('httpExtractKey')} value={item.pointer} onChange={(event) =>{  update(index, { assertions: step.assertions.map((entry, n) => n === i ? { ...item, pointer: event.target.value } : entry) }) }} />}
      <input aria-label={t('expected')} type={item.kind === 'status' ? 'number' : 'text'} value={String(item.value ?? '')} onChange={(event) =>{  update(index, { assertions: step.assertions.map((entry, n) => n === i ? item.kind === 'status' ? { ...item, value: Number(event.target.value) } : { ...item, value: event.target.value } : entry) }) }} />
      <button onClick={() =>{  update(index, { assertions: step.assertions.filter((_, n) => n !== i) }) }}>{t('httpRemoveField')}</button>
    </div>)}<button onClick={() =>{  update(index, { assertions: [...step.assertions, { kind: 'status', value: 200 }] }) }}>{t('httpAddAssertion')}</button></details>
    <button onClick={() =>{  change(steps.filter((_, i) => i !== index)) }}>{t('httpRemoveStep')}</button>
  </fieldset>)}<button onClick={() =>{  change([...steps, newHttpStep(t('httpValidationTitle'))]) }}>{t('httpAddStep')}</button></div>
}
