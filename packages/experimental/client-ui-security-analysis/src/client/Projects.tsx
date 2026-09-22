/** Persistent operator project browser, independent of conversation selection. @module */
import { useEffect, useRef, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { WorkbenchView } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import type { NS, SecurityKey } from './locales.ts'
import css from './Workbench.module.css'

/** Authenticated project reads and explicit laboratory gestures. */
export interface ProjectActions {
  projects(): Promise<string>
  project(id: string): Promise<WorkbenchView>
  laboratory(projectId: string, action: string, id: string): Promise<WorkbenchView>
  report(projectId: string, reportId: string, format: 'markdown' | 'json'): Promise<string>
  subscribeReset(this: void, listener: () => void): () => void
}
/** Sidebar glyph; the shell owns its accessible label.
 * @param props - requested icon size.
 * @returns decorative shield glyph. */
export function ProjectIcon({ size }: PropsRuntime<'sidebar.panellist'>) {
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6Z" fill="none" stroke="currentColor" strokeWidth="2" /></svg>
}
/** Render durable projects, saved reports and owned lab resources.
 * @param props - operator actions and localized copy.
 * @returns project panel. */
export function Projects(props: ProjectActions & PropsLocale<typeof NS>) {
  const { t } = props
  const [projects, setProjects] = useState<{ id: string; title: string }[]>([])
  const [selected, setSelected] = useState('')
  const [view, setView] = useState<WorkbenchView>({ revision: 0, records: [] })
  const [tab, setTab] = useState<SecurityKey>('overview')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState('')
  const generation = useRef(0)
  const perform = async (action: () => Promise<void>) => {
    setBusy(true); setError('')
    try { await action() } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  const refresh = async () => {
    const current = ++generation.current
    const items = JSON.parse(await props.projects()) as { id: string; title: string }[]
    const next = selected ? await props.project(selected) : { revision: 0, records: [] }
    if (generation.current === current) { setProjects(items); setView(next) }
  }
  useEffect(() => { setReport(''); void perform(refresh); return () => { generation.current++ } }, [selected])
  useEffect(() => props.subscribeReset(() => { generation.current++; setView({ revision: 0, records: [] }); setReport(''); void perform(refresh) }), [selected, props.subscribeReset])
  const lifecycle = (action: string, id = '') => perform(async () => {
    const current = ++generation.current
    const next = await props.laboratory(selected, action, id)
    if (generation.current === current) setView(next)
  })
  const labState = { preparing: 'labPreparing', ready: 'labReady', running: 'labRunning', stopped: 'labStopped', interrupted: 'labInterrupted', failed: 'labFailed' } as const
  const project = view.records.find(item => item.kind === 'engagement')
  return <section role="region" className={css.projectPanel} aria-label={t('title')}>
    <header className={css.header}><strong>{t('title')}</strong><button disabled={busy} onClick={() => void perform(refresh)}>{t('refresh')}</button></header>
    <div className={css.body}>
      <label className={css.field}>{t('project')}<select disabled={busy} value={selected} onChange={(event) => { generation.current++; setView({ revision: 0, records: [] }); setSelected(event.target.value) }}>
        <option value="">{t('notSelected')}</option>{projects.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
      </select></label>
      <p>{t('projectEntryHelp')}</p>
      {error && <p role="alert">{error}</p>}
      <nav className={css.tabs}>{(['overview', 'assets', 'checks', 'findings', 'reviews', 'reports', 'laboratories'] as const).map(key => <button key={key} aria-pressed={tab === key} onClick={() =>{  setTab(key) }}>{t(key)}</button>)}</nav>
      {tab === 'overview' && project?.kind === 'engagement' && <article className={css.card}><h2>{project.value.title}</h2><p>{project.value.objective}</p><p>{t('revision')} {view.revision}</p></article>}
      {(['assets', 'checks', 'findings', 'reviews'] as const).includes(tab as 'assets') && view.records.filter(item => item.kind === ({ assets: 'asset', checks: 'check', findings: 'finding', reviews: 'review' } as Record<string, string>)[tab]).map(item => <article className={css.card} key={'id' in item.value ? item.value.id : item.value.sessionId}>
        <pre>{JSON.stringify(item.value, null, 2)}</pre>
      </article>)}
      {tab === 'reports' && <>{view.records.filter(item => item.kind === 'report').map(item => <article key={item.value.id} className={css.card}>
        <strong>{t('revision')} {item.value.revision}</strong>
        {(['markdown', 'json'] as const).map(format => <button disabled={busy} key={format} onClick={() => void perform(async () => { const current = generation.current; const text = await props.report(selected, item.value.id, format); if (current === generation.current) setReport(text) })}>{t(format === 'markdown' ? 'markdownReport' : 'jsonReport')}</button>)}
      </article>)}{report && <pre className={css.report}>{report}</pre>}</>}
      {tab === 'laboratories' && <>
        <p>{t('toolLimit')}</p><p>{t('labResetHelp')}</p>
        <p>{t('reuseToolboxHelp')}</p>
        <button disabled={busy || !selected} onClick={() => void lifecycle('reuse')}>{t('reuseToolbox')}</button>
        <button disabled={busy || !selected} onClick={() => void lifecycle('prepare')}>{t('buildToolbox')}</button>
        {view.records.filter(item => item.kind === 'laboratory').map(item => <article key={item.value.id} className={css.card}>
          <strong>{item.value.recipe} · {t(labState[item.value.state])}</strong>
          <p>{item.value.detail}</p><code>{item.value.imageId}</code>
          <p>{item.value.targetImage}</p>
          <pre>{JSON.stringify(item.value.tools, null, 2)}</pre>
          {item.value.browserUrl && <a href={item.value.browserUrl} target="_blank" rel="noreferrer">{t('openLab')}</a>}
          {(['start', 'inspect', 'stop', 'reset'] as const).map(action => <button disabled={busy} key={action} onClick={() => void lifecycle(action, item.value.id)}>{t(({ start: 'labStart', inspect: 'labInspect', stop: 'labStop', reset: 'labReset' } as const)[action])}</button>)}
        </article>)}
      </>}
    </div>
  </section>
}
