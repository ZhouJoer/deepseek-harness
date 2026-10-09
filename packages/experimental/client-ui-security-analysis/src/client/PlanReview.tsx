/** Human-readable approval summary and persisted execution outcome for a validation plan. @module */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkbenchView } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { NS } from './locales.ts'
import css from './Workbench.module.css'

type Plan = Extract<WorkbenchView['records'][number], { kind: 'plan' }>['value']

/** Display the approved operation separately from its execution result.
 * @param props - saved plan, current records, localized environment name and operator actions.
 * @returns labeled approval summary with expandable technical details. */
export function PlanReview(props: PropsLocale<typeof NS> & {
  plan: Plan
  view: WorkbenchView
  environment: string
  disabled: boolean
  busy: boolean
  approve(this: void): void
  revoke(this: void): void
  execute(this: void): void
  preview(this: void): void
}) {
  const { plan, t } = props
  const execution = props.view.records.filter(item => item.kind === 'execution' && item.value.planId === plan.id).at(-1)
  const offline = plan.operation.provider === 'offline'
  const native = plan.operation.provider === 'native'
  const parameterText = (key: string) => {
    const value = plan.operation.parameters[key]
    return typeof value === 'string' ? value : JSON.stringify(value)
  }
  const failed = execution?.kind === 'execution' && ['failed', 'interrupted'].includes(execution.value.status)
  const markdown = (text: string) => <MarkdownText text={text} labels={{
    code: { copyLabel: t('markdownCopy'), copiedLabel: t('markdownCopied') }, footnotes: t('markdownFootnotes'),
  }} />
  return <article className={css.planReview}>
    <h3>{t('planQuestion')}</h3>{markdown(plan.hypothesis)}
    <dl className={css.planFacts}>
      <dt>{t('planApprovalStatus')}</dt><dd>{t(plan.status)}</dd>
      <dt>{t('planRuntime')}</dt><dd>{offline ? t('planOfflineRuntime') : native ? t('planNativeRuntime') : props.environment}</dd>
      {native && <><dt>{t('planNativePlatform')}</dt><dd>{parameterText('platform')}</dd>
        <dt>{t('planNativePython')}</dt><dd>{parameterText('python')} ({parameterText('version')})</dd>
        <dt>{t('planNativeCwd')}</dt><dd>{parameterText('cwd')}</dd></>}
      <dt>{t('expected')}</dt><dd>{markdown(plan.expectedObservation)}</dd>
      <dt>{t('impact')}</dt><dd>{markdown(plan.impact)}</dd>
      <dt>{t('cleanup')}</dt><dd>{markdown(plan.cleanup)}</dd>
      <dt>{t('duration')}</dt><dd>{plan.durationMs}</dd>
    </dl>
    {offline && <p className={css.planNotice}>{t('planOfflineLimits')}</p>}
    {native && <p className={css.planNotice}>{t('planNativeLimits')}</p>}
    {execution?.kind === 'execution' && <section className={css.planNotice} role={failed ? 'alert' : 'status'}>
      <strong>{t('planExecutionStatus')}: {t(execution.value.status)}</strong>
      {failed && <p>{t(offline && execution.value.detail.includes('FileNotFoundError') ? 'planOfflineMissingFile' : 'planExecutionFailureHint')}</p>}
      {execution.value.detail && <details><summary>{t('planExecutionDetails')}</summary><pre>{execution.value.detail}</pre></details>}
    </section>}
    <div className={css.taskActions}>
      <button disabled={props.busy || props.disabled || plan.status === 'approved'} onClick={props.approve}>{t('approve')}</button>
      <button disabled={props.busy || props.disabled || plan.status !== 'approved'} onClick={props.execute}>{t('execute')}</button>
      <button disabled={props.busy || plan.status !== 'approved'} onClick={props.revoke}>{t('revoke')}</button>
    </div>
    <details><summary>{t('planTechnicalDetails')}</summary>
      <dl className={css.planFacts}><dt>{t('environment')}</dt><dd>{props.environment}</dd>
        <dt>{t('planVersion')}</dt><dd><code>{plan.hash}</code></dd></dl>
      <pre>{JSON.stringify(plan.operation, null, 2)}</pre>
      {plan.operation.script && <button disabled={props.busy} onClick={props.preview}>{t('planViewScript')}</button>}
    </details>
  </article>
}
