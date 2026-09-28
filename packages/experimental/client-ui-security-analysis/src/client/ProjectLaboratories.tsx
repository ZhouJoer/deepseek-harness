/** Project laboratory operations remain available without a conversation. @module */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkbenchView } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import type { NS } from './locales.ts'
import css from './Dashboard.module.css'
/** Render recorded laboratory generations and explicit lifecycle actions.
 * @param props - project records and operator actions.
 * @returns laboratory panel. */
export function ProjectLaboratories(props: PropsLocale<typeof NS> & {
  view: WorkbenchView
  busy: boolean
  run(action: string, id: string): Promise<void>
}) {
  const { t } = props
  const states = { preparing: 'labPreparing', ready: 'labReady', running: 'labRunning',
    stopped: 'labStopped', interrupted: 'labInterrupted', failed: 'labFailed' } as const
  return <section className={css.panel}><h3>{t('laboratories')}</h3><p>{t('toolLimit')}</p><p>{t('labResetHelp')}</p><p>{t('reuseToolboxHelp')}</p>
    <div className={css.actions}><button disabled={props.busy} onClick={() => void props.run('reuse', '')}>{t('reuseToolbox')}</button><button disabled={props.busy} onClick={() => void props.run('prepare', '')}>{t('buildToolbox')}</button></div>
    {props.view.records.filter(item => item.kind === 'laboratory').map(item => <article key={item.value.id} className={css.record}>
      <h3>{item.value.recipe} · {t(states[item.value.state])}</h3><p>{item.value.detail}</p>
      <code>{item.value.imageId}</code><p>{item.value.targetImage}</p>
      <details><summary>{t('toolHistoricalInventory')}</summary><pre className={css.artifact}>{JSON.stringify(item.value.tools, null, 2)}</pre></details>
      {item.value.browserUrl && <a href={item.value.browserUrl} target="_blank" rel="noreferrer">{t('openLab')}</a>}
      <div className={css.actions}>{(['start', 'inspect', 'stop', 'reset'] as const).map(action => <button disabled={props.busy} key={action} onClick={() => void props.run(action, item.value.id)}>{t(({ start: 'labStart', inspect: 'labInspect', stop: 'labStop', reset: 'labReset' } as const)[action])}</button>)}</div>
    </article>)}
  </section>
}
