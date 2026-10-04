/** Live tool-count entry and Session-selected progress in the native right sidebar. @module */
import { useEffect, useRef, useState } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkbenchView } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import { ActivityPanel, type ActivityActions } from './ActivityPanel.tsx'
import type { NS } from './locales.ts'
import css from './Dashboard.module.css'

/** Read-only Session selection and workbench navigation injected by the plugin. */
export interface ConversationProgressActions extends ActivityActions {
  followSessionView(session: SessionId, signal: AbortSignal): AsyncIterable<WorkbenchView>
  openDashboard(): void
}

type Props = ConversationProgressActions & PropsLocale<typeof NS> & { sessionId: SessionId }
type SelectionProps = Pick<Props, 'sessionId' | 'followSessionView' | 'subscribeReset' | 't'>

function useSelection(props: SelectionProps) {
  const { sessionId, t } = props
  const [view, setView] = useState<WorkbenchView>({ revision: 0, records: [] })
  const [loaded, setLoaded] = useState(false)
  const [epoch, setEpoch] = useState(0)
  const [error, setError] = useState('')
  const current = useRef(props)
  current.current = props
  useEffect(() => props.subscribeReset(() => { setEpoch(value => value + 1) }), [props.subscribeReset])
  useEffect(() => {
    const abort = new AbortController()
    setLoaded(false); setError('')
    void (async () => {
      try {
        for await (const next of current.current.followSessionView(sessionId, abort.signal)) {
          if (abort.signal.aborted) break
          setView(previous => next.revision >= previous.revision ? next : previous)
          setLoaded(true)
        }
        if (!abort.signal.aborted) setError(t('activityDisconnected'))
      } catch (error) { if (!abort.signal.aborted) setError(String(error)) }
    })()
    return () => { abort.abort() }
  }, [sessionId, epoch])
  return { view, setView, loaded, epoch, setEpoch, error, setError }
}

/** Read-only tool-count streams and sidebar navigation for the compact chat entry. */
export interface ConversationProgressEntryActions extends Pick<ConversationProgressActions, 'followSessionView' | 'subscribeReset' | 'followActivity' | 'openDashboard'> {
  openProgress(): void
}
type EntryProps = ConversationProgressEntryActions & PropsLocale<typeof NS> & { sessionId: SessionId }

/** Compact live tool-count entry that opens the native sidebar.
 * @param props - Session selection and read-only activity subscriptions.
 * @returns a small badge without occupying transcript space.
 */
export function ConversationProgressEntry(props: EntryProps) {
  const { view, epoch, error } = useSelection(props)
  const project = view.records.find(item => item.kind === 'engagement')?.value.id
  const [count, setCount] = useState<number>()
  const [running, setRunning] = useState(false)
  const childRunning = view.records.some(item => item.kind === 'delegation' && (item.value.status === 'pending' || item.value.status === 'running'))
  const current = useRef(props)
  current.current = props
  useEffect(() => {
    const abort = new AbortController()
    setCount(project ? undefined : 0); setRunning(false)
    if (project) void (async () => {
      try {
        for await (const frame of current.current.followActivity(project, abort.signal)) {
          if (abort.signal.aborted) break
          if (frame.type === 'project') continue
          setCount(frame.usage.reduce((sum, row) => sum + row.total, 0))
          setRunning(frame.usage.some(row => row.running > 0))
        }
        if (!abort.signal.aborted) setCount(undefined)
      } catch (_error) { if (!abort.signal.aborted) { setCount(undefined); setRunning(false) } }
    })()
    return () => { abort.abort() }
  }, [project, epoch])
  return <div className={css.progressLauncher}>
    <button title={props.t('activityEntry')} onClick={() => { props.openProgress() }}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 12V8m5 4V3m5 9V6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
      {props.t('activityTools')} <span className={css.countBadge}>{error ? '—' : count ?? '—'}</span>
      {(running || childRunning) && <span className={css.runningDot} role="img" aria-label={props.t('running')} />}
    </button>
    <button onClick={() => { props.openDashboard() }}>{props.t('dashboardEntry')} ↗</button>
  </div>
}

/** Keep a visible chat entry outside the workbench's embedded assistant.
 * @param props - session-scoped framework seats and security actions.
 * @returns a compact tool-count entry outside the embedded workbench assistant.
 */
export function ConversationProgressLauncher(props: ConversationProgressEntryActions & PropsLocale<typeof NS> & PropsRuntime<'conversation.input.dock'>) {
  const panel = props.usePanelInfo(value => value.activePanelId)
  return panel === 'security-projects' ? null : <ConversationProgressEntry key={props.sessionId} {...props} />
}

/** Localized title of the Session's progress tab.
 * @param props - namespace-bound translator.
 * @returns the tab label.
 */
export function ConversationProgressTitle(props: PropsLocale<typeof NS>) { return <>{props.t('activityEntry')}</> }

/** Isolate sidebar state when its owning Session changes.
 * @param props - Session-selected activity actions.
 * @returns the current Session's progress.
 */
export function ConversationProgressTab(props: Props) { return <ConversationProgress key={props.sessionId} {...props} /> }

/** Follow selection before subscribing to project activity; keep the native input mounted.
 * @param props - localized actions for the currently displayed Session.
 * @returns a read-only sidebar timeline.
 */
export function ConversationProgress(props: Props) {
  const { t } = props
  const { view, setView, loaded, setEpoch, error } = useSelection(props)
  const project = view.records.find(item => item.kind === 'engagement')?.value
  return <section className={css.progressDock} aria-label={t('activityEntry')}>
    <div className={css.progressControls}>
      {project && <span className={css.progressName} title={project.title}>{project.title}</span>}
      {!project && <button onClick={() => { props.openDashboard() }}>{t('dashboardEntry')} ↗</button>}
    </div>
    {error && <p role="alert">{error} <button onClick={() => { setEpoch(value => value + 1) }}>{t('dashboardRetry')}</button></p>}
    <div className={css.progressBody}>
      {project ? <ActivityPanel key={project.id} {...props} project={project.id} view={view}
        changed={(next) => { setView(previous => next.revision >= previous.revision ? next : previous) }} />
        : !error && <p className={css.muted}>{t(loaded ? 'activityNoProject' : 'dashboardLoading')}</p>}
    </div>
  </section>
}
