/** Read-only prepared login and testing requests shown before approval. @module */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { HttpSequence, HttpStep } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import type { NS } from './locales.ts'
import css from './Workbench.module.css'

/** Render the exact prepared sequence without resolving private references.
 * @param props - immutable prepared plan and localized copy.
 * @returns request methods, routing, identity versions, fields and response rules. */
export function HttpPlanSummary({ sequence, t }: PropsLocale<typeof NS> & { sequence: HttpSequence }) {
  const value = (input: HttpStep['headers'][number]['value']) => typeof input === 'string' ? input : 'secret' in input ? `${t('httpSecret')}: ${input.secret}` : `${t('httpVariable')}: ${input.variable}`
  const fields = (items: HttpStep['headers']) => <dl className={css.planFacts}>{items.map((field, index) => <div key={index}><dt>{field.name}</dt><dd><code>{value(field.value)}</code></dd></div>)}</dl>
  return <section><h4>{t('httpSteps')}</h4>{sequence.steps.map((step, index) => <article className={css.planReview} key={step.id}>
    <strong>{index + 1}. {step.method} {step.path}</strong><p>{step.label} {step.login && `· ${t('httpLogin')}`}</p>
    <p>{t('httpIdentity')}: {step.identityId ?? t('httpAnonymous')} {sequence.identities.find(item => item.id === step.identityId)?.revision}</p>
    {!!step.query.length && <><h5>{t('httpQuery')}</h5>{fields(step.query)}</>}
    {!!step.headers.length && <><h5>{t('httpHeaders')}</h5>{fields(step.headers)}</>}
    {step.body && <><h5>{t('httpBody')} · {step.body.kind}</h5>{step.body.kind === 'text' ? <pre>{value(step.body.value)}</pre> : fields(step.body.fields)}</>}
    {!!step.extract.length && <><h5>{t('httpExtract')}</h5>{step.extract.map(item => <p key={item.name}>{item.name}: {item.from} · {item.key}</p>)}</>}
    {!!step.assertions.length && <><h5>{t('httpAssertions')}</h5>{step.assertions.map((item, i) => <p key={i}>{t(item.kind === 'status' ? 'httpAssertStatus' : item.kind === 'contains' ? 'httpAssertContains' : 'httpAssertJson')} {item.kind === 'json' && item.pointer} <code>{String(item.value)}</code></p>)}</>}
  </article>)}</section>
}
