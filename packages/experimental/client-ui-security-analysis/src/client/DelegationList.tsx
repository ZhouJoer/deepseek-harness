/** Question-scoped child work and coordinator decisions from committed project records. @module */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SecurityDelegation, WorkbenchView } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import type { NS, SecurityKey } from './locales.ts'
import { TechnicalDetails } from './TechnicalDetails.tsx'
import css from './Dashboard.module.css'

type Props = PropsLocale<typeof NS> & {
  items: SecurityDelegation[]
  view: WorkbenchView
  openChild(this: void, address: NonNullable<SecurityDelegation['child']>): void
}

const roles: Record<SecurityDelegation['role'], SecurityKey> = {
  reconnaissance: 'delegationReconnaissance', 'reverse-analyst': 'delegationReverseAnalyst',
  'web-analyst': 'delegationWebAnalyst', researcher: 'delegationResearcher', reviewer: 'delegationReviewer',
}
const tasks: Record<SecurityDelegation['task'], SecurityKey> = {
  inventory: 'delegationInventory', surface: 'delegationSurface', assessment: 'delegationAssessment', review: 'delegationReview',
}
const states: Record<SecurityDelegation['status'], SecurityKey> = {
  pending: 'delegationPending', running: 'running', completed: 'delegationReturned',
  failed: 'failed', cancelled: 'activityCancelled', interrupted: 'delegationInterrupted',
}
const decisions: Record<NonNullable<SecurityDelegation['disposition']>['decision'], SecurityKey> = {
  accepted: 'delegationAccepted', 'needs-more': 'delegationNeedsMore', rejected: 'delegationRejected',
}

/** Render recorded work without treating a returned or accepted report as a confirmed finding.
 * @param props - scoped records, localized copy and addressed child-history navigation.
 * @returns child questions with reports and expandable assignment details.
 */
export function DelegationList({ items, view, openChild, t }: Props) {
  return <section className={css.delegations} aria-label={t('delegationTitle')}>
    <span className={css.briefLabel}>{t('delegationTitle')}</span>
    {!items.length && <p className={css.emptyActivity}>{t('delegationEmpty')}</p>}
    {items.map(item => <article className={css.delegation} key={item.id} aria-label={item.question}>
      <div className={css.delegationHeader}>
        <strong>{item.question}</strong>
        <span className={css.delegationState} data-state={item.status}>{t(states[item.status])}</span>
      </div>
      <p className={css.delegationRole}>{t(roles[item.role])} · {t(tasks[item.task])}</p>
      {item.report && <p>{item.report.summary}</p>}
      {item.disposition ? <div className={css.delegationDecision}>
        <span>{t(decisions[item.disposition.decision])}</span><p>{item.disposition.reason}</p>
      </div> : item.report && <p className={css.delegationRole}>{t('delegationAwaitingDecision')}</p>}
      {item.timedOut && <p className={css.delegationRole}>{t('delegationTimedOut')}</p>}
      {item.detail && <p>{item.detail}</p>}
      <details>
        <summary>{t('delegationDetails')}</summary>
        <dl className={css.delegationFacts}>
          <dt>{t('delegationReason')}</dt><dd>{item.reason || t('delegationNotRecorded')}</dd>
          <dt>{t('delegationCriterion')}</dt><dd>{item.criterion}</dd>
          {item.report && <><dt>{t('delegationUncertainty')}</dt><dd>{item.report.uncertainty || t('delegationNotRecorded')}</dd>
            <dt>{t('delegationNextSteps')}</dt><dd>{item.report.nextSteps.length
              ? <ul>{item.report.nextSteps.map((step, index) => <li key={index}>{step}</li>)}</ul>
              : t('delegationNotRecorded')}</dd>
            <dt>{t('delegationEvidence')}</dt><dd>{item.report.evidenceIds.length
              ? <ul>{item.report.evidenceIds.map((id) => {
                const evidence = view.records.find(record => record.kind === 'evidence' && record.value.id === id)
                return <li key={id}>
                  {evidence?.kind === 'evidence'
                    ? <><strong>{evidence.value.title}</strong><p>{evidence.value.summary}</p></>
                    : <p>{t('unavailableReference')}</p>}
                  <TechnicalDetails t={t} value={{ evidenceId: id }} />
                </li>
              })}</ul> : t('delegationNoEvidence')}</dd></>}
        </dl>
        {item.child && <button onClick={() => { if (item.child) openChild(item.child) }}>{t('delegationOpenChild')}</button>}
      </details>
    </article>)}
  </section>
}
