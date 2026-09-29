/** A concise research timeline backed by committed project and invocation streams. @module */
import { useEffect, useRef, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SecurityActivityBrief, SecurityActivityFrame, SecurityActivityPage, SecurityToolUsage, WorkbenchView } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import type { NS } from './locales.ts'
import css from './Dashboard.module.css'

/** Project-scoped activity reads shared by the dashboard and embedded workbench. */
export interface ActivityActions {
  followActivity(project: string, signal: AbortSignal): AsyncIterable<SecurityActivityFrame>
  activityDetails(project: string, checkpoint: string, offset: number, through?: number): Promise<SecurityActivityPage>
  subscribeReset(this: void, listener: () => void): () => void
}
type Props = ActivityActions & PropsLocale<typeof NS> & {
  project: string
  view: WorkbenchView
  changed(view: WorkbenchView): void
}

/** Render research directions without adding a new milestone for every call or turn.
 * @param props - localized project data, streaming reads and committed-view consumer.
 * @returns three-line briefs with on-demand execution and evidence details.
 */
export function ActivityPanel(props: Props) {
  const { t, project } = props
  const markdownLabels = { code: { copyLabel: t('markdownCopy'), copiedLabel: t('markdownCopied') }, footnotes: t('markdownFootnotes') }
  const [usage, setUsage] = useState<SecurityToolUsage[]>([])
  const [briefs, setBriefs] = useState<SecurityActivityBrief[]>([])
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState('')
  const [epoch, setEpoch] = useState(0)
  const [pages, setPages] = useState<Record<string, SecurityActivityPage>>({})
  const [loading, setLoading] = useState<string>()
  const current = useRef(props)
  const generation = useRef(0)
  current.current = props
  useEffect(() => props.subscribeReset(() => { setEpoch(value => value + 1) }), [props.subscribeReset])
  useEffect(() => {
    const abort = new AbortController()
    generation.current++
    setUsage([]); setBriefs([]); setPages({}); setLoading(undefined); setConnected(false); setError('')
    void (async () => {
      try {
        for await (const frame of current.current.followActivity(project, abort.signal)) {
          if (abort.signal.aborted) break
          if (frame.type === 'snapshot' || frame.type === 'activity') setUsage(frame.usage)
          if (frame.type === 'snapshot' || frame.type === 'activity') setBriefs(frame.briefs)
          if (frame.type === 'snapshot' || frame.type === 'project') current.current.changed(frame.view)
          setConnected(true)
        }
        if (!abort.signal.aborted) setConnected(false)
      } catch (error) {
        if (!abort.signal.aborted) { setError(String(error)); setConnected(false) }
      }
    })()
    return () => { generation.current++; abort.abort() }
  }, [project, epoch])
  const read = async (id: string, more = false) => {
    const token = generation.current
    setLoading(id); setError('')
    try {
      const previous = more ? pages[id] : undefined
      const next = await props.activityDetails(project, id, previous?.next ?? 0, previous?.through)
      if (token === generation.current) setPages(value => ({ ...value, [id]: {
        ...next, items: previous ? [...previous.items, ...next.items] : next.items,
      } }))
    } catch (error) { if (token === generation.current) setError(String(error)) }
    finally { if (token === generation.current) setLoading(undefined) }
  }
  const checkpoints = props.view.records.filter(item => item.kind === 'checkpoint').map(item => item.value)
  const directions = [
    ...(!checkpoints.length || usage.some(item => !item.checkpointId) || briefs.some(item => !item.checkpointId) ? [{ id: '', title: t('activityCurrent'), phase: undefined,
      updatedAt: 0, reason: '', summary: '', next: '', evidenceIds: [] as string[], findings: [] as (typeof checkpoints)[number]['findings'] }] : []),
    ...checkpoints,
  ]
  return <section className={css.timeline} aria-label={t('activityTitle')}>
    <div className={css.timelineHeader}><h3>{t('activityTitle')}</h3><span className={css.connection} data-live={connected} role="status">{t(connected ? 'activityLive' : 'activityDisconnected')}</span>
      {!connected && <button onClick={() => { setEpoch(value => value + 1) }}>{t('dashboardRetry')}</button>}</div>
    {error && <p role="alert" className={css.error}>{error}</p>}
    {directions.map((direction, index) => {
      const tools = usage.filter(item => item.checkpointId === direction.id)
      const page = pages[direction.id]
      const brief = briefs.find(item => item.checkpointId === direction.id)
      const summary = brief && brief.updatedAt > direction.updatedAt ? brief.text : direction.summary
      const next = brief && brief.updatedAt > direction.updatedAt && brief.next ? brief.next : direction.next
      return <article className={css.stage} key={direction.id}>
        <header className={css.stageHeader}><span className={css.stageNumber} aria-hidden="true">{index + 1}</span><div>
          {direction.phase && <span className={css.phase}>{t(direction.phase)}</span>}<h4>{direction.title}</h4>
        </div></header>
        <div className={css.toolGrid} aria-label={t('activityTools')}>
          {tools.length ? tools.map(item => <div className={css.toolCard} key={item.tool + String(item.verified)} role="group"
            aria-label={`${item.tool === 'script' ? t('activityScriptShort') : item.tool} ×${item.total}`}>
            <div className={css.toolName}><strong>{item.tool === 'script' ? t('activityScriptShort') : item.tool}</strong><span className={css.toolCount}>×{item.total}</span></div>
            <span className={css.verification} data-verified={item.verified}>{t(item.verified ? 'activityVerified' : 'activityUnverified')}</span>
            <div className={css.toolStates}>
              {item.running > 0 && <span data-state="running">{t('running')} <b>{item.running}</b></span>}
              {item.completed > 0 && <span data-state="completed">{t('completed')} <b>{item.completed}</b></span>}
              {item.failed > 0 && <span data-state="failed">{t('failed')} <b>{item.failed}</b></span>}
              {item.cancelled > 0 && <span>{t('activityCancelled')} <b>{item.cancelled}</b></span>}
              {item.unknown > 0 && <span>{t('activityUnknown')} <b>{item.unknown}</b></span>}
              {item.incomplete > 0 && <span>{t('activityPartial')} <b>{item.incomplete}</b></span>}
            </div>
          </div>) : <span className={css.emptyActivity}>{t('activityNoRecords')}</span>}
        </div>
        <div className={css.brief}><span className={css.briefLabel}>{t('activityConclusion')}</span>
          {direction.findings.length ? direction.findings.map(item => <p key={item.id}>
            <span className={css.badge}>{t(item.status)}</span> {item.title}</p>)
            : summary ? <><span className={css.observation}>{t('activityObservation')}</span><MarkdownText text={summary} labels={markdownLabels} /></> : <p className={css.emptyActivity}>{t('activityNoConclusion')}</p>}
        </div>
        <div className={css.nextAction}><span className={css.briefLabel}>{t('activityNext')}</span><MarkdownText text={next || t('activityPending')} labels={markdownLabels} /></div>
        <details onToggle={(event) => { if (event.currentTarget.open) void read(direction.id) }}>
          <summary>{t('activityDetails')}</summary>
          {direction.reason && <p>{t('activityReason')}: {direction.reason}</p>}
          {direction.evidenceIds.map((id) => {
            const evidence = props.view.records.find(item => item.kind === 'evidence' && item.value.id === id)
            return <p key={id}>{id} · {evidence?.kind === 'evidence' ? evidence.value.summary : t('activityNoRecords')}</p>
          })}
          {page?.items.map(item => <article className={css.record} key={item.id}>
            <strong>{item.tools.join(', ')} · {t(item.status === 'cancelled' ? 'activityCancelled' : item.status === 'unknown' ? 'activityUnknown' : item.status)}</strong>
            {!item.verified && <p>{t('activityUnverifiedHint')}</p>}
            {item.incomplete && <p>{t('activityIncomplete')}</p>}
            <pre className={css.artifact}>{item.parameters}</pre><pre className={css.artifact}>{item.detail}</pre>
            <p>{t('activityCall')}: {item.sessionId} / {item.callId}</p>
            {props.view.records.filter(record => record.kind === 'evidence' && record.value.source.sessionId === item.sessionId
              && record.value.source.callId === item.callId).map(record => record.kind === 'evidence'
              ? <p key={record.value.id}>{record.value.id} · {record.value.summary}</p> : null)}
          </article>)}
          {loading === direction.id && <p role="status">{t('dashboardLoading')}</p>}
          {page?.next !== null && page?.next !== undefined && <button disabled={loading === direction.id} onClick={() => void read(direction.id, true)}>{t('activityMore')}</button>}
          <button disabled={loading === direction.id} onClick={() => void read(direction.id)}>{t('activityRefresh')}</button>
        </details>
      </article>
    })}
  </section>
}
