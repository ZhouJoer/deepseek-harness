/** Current check facts and explicit gaps, independent of finding counts. @module */
import { useState } from 'react'
import type { ProjectCoverage, SecurityRecord } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import css from './Dashboard.module.css'

/** Display coverage from the same revision as the visible project.
 * @param props - authoritative coverage and existing evidence/check navigation.
 * @returns coverage with actionable blocked checks and unchanged evidence access.
 */
export function CoveragePanel({ coverage, revision, evidence, disabled, openCheck, openEvidence, t }: PropsLocale<typeof NS> & {
  coverage?: ProjectCoverage | undefined
  evidence: Extract<SecurityRecord, { kind: 'evidence' }>[]
  revision: number
  disabled: boolean
  openCheck: (id: string) => void
  openEvidence: (id: string) => void
}) {
  const [blockedOnly, setBlockedOnly] = useState(false)
  return <section className={css.panel}>
    <h3 id="security-check-coverage" tabIndex={-1}>{t('coverageTitle')}</h3>
    {!coverage || coverage.revision !== revision ? <p role="status">{t('coverageUpdating')}</p> : <>
      <label><input type="checkbox" checked={blockedOnly} onChange={(event) =>{  setBlockedOnly(event.target.checked) }} />{t('coverageBlockedOnly')}</label>
      {coverage.checks.filter(check => !blockedOnly || ['blocked', 'interrupted'].includes(check.status)).map(check => <article className={css.record} key={check.checkId}>
        <h4>{check.title}</h4><p>{coverage.assets.find(asset => asset.assetId === check.assetId)?.label}</p>
        <p>{check.criterion}</p><span className={css.badge}>{t(check.status)}</span>
        {check.rationale && <p>{check.rationale}</p>}
        {!check.evidenceIds.length && <p>{t('coverageNoEvidence')}</p>}
        <ul>
          {check.inventory > 0 && <li>{t('coverageInventory')}: {check.inventory}</li>}
          {check.implementation > 0 && <li>{t('coverageImplementation')}: {check.implementation}</li>}
          {check.other > 0 && <li>{t('coverageOther')}: {check.other}</li>}
          {check.failed > 0 && <li>{t('failed')}: {check.failed}</li>}
          {check.incomplete > 0 && <li>{t('incomplete')}: {check.incomplete}</li>}
          {check.missingEvidenceIds.length > 0 && <li>{t('unavailableReference')}: {check.missingEvidenceIds.length}</li>}
          {check.unmetDependencies.length > 0 && <li>{t('coverageDependencies')}: {check.unmetDependencies
            .map(id => coverage.checks.find(item => item.checkId === id)?.title ?? t('unavailableReference')).join(', ')}</li>}
          {check.methods.map(method => <li key={method}>{t(method === 'static' ? 'coverageStatic' : method === 'simulation' ? 'coverageSimulation'
            : method === 'device' ? 'coverageDevice' : 'coverageUnknownMethod')}</li>)}
          {check.reviews.map(review => <li key={review.findingId}>{review.title} · {t(review.verdict)} · {t(review.basis === 'static' ? 'coverageStaticReview' : 'coverageRuntimeReview')}</li>)}
        </ul>
        <div className={css.actions}>{check.evidenceIds.map(id => <button key={id} onClick={() => { openEvidence(id) }}>
          {evidence.find(item => item.value.id === id)?.value.title ?? t('evidence')}</button>)}
        {['blocked', 'interrupted'].includes(check.status) && <button disabled={disabled} onClick={() =>{  openCheck(check.checkId) }}>{t('coverageResolve')}</button>}
        </div>
      </article>)}
      {!blockedOnly && coverage.assets.filter(asset => !asset.hasChecks || asset.unlinkedEvidenceIds.length > 0)
        .map(asset => <article className={css.record} key={asset.assetId}>
          <h4>{asset.label}</h4>{!asset.hasChecks && <p>{t('coverageNoChecks')}</p>}
          {asset.unlinkedEvidenceIds.length > 0 && <p>{t('coverageUnlinked')}: {asset.unlinkedEvidenceIds.length}</p>}
          <div className={css.actions}>{asset.unlinkedEvidenceIds.map(id => <button key={id} onClick={() => { openEvidence(id) }}>
            {evidence.find(item => item.value.id === id)?.value.title ?? t('evidence')}</button>)}</div>
        </article>)}
    </>}
  </section>
}
