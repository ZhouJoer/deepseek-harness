/** Bounded Host-owned HTTP evidence browsing and explicit comparison. @module */
import { useEffect, useRef, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { HttpHistoryItem, HttpHistoryPage, HttpExchangePage } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import type { NS } from './locales.ts'
import css from './Workbench.module.css'

/** Project-scoped evidence reads supplied by the Host Remote. */
export interface HttpReadActions {
  httpHistory(this: void, project: string, input: string): Promise<HttpHistoryPage>
  httpExchange(this: void, project: string, evidence: string, step: string, part: HttpExchangePage['part'], offset: number): Promise<HttpExchangePage>
}
function Exchange({ row, project, httpExchange, t }: PropsLocale<typeof NS> & Pick<HttpReadActions, 'httpExchange'> & { row: HttpHistoryItem; project: string }) {
  const [part, setPart] = useState<HttpExchangePage['part']>('body')
  const [page, setPage] = useState<HttpExchangePage>()
  const [error, setError] = useState('')
  const [offset, setOffset] = useState(0)
  useEffect(() => {
    let active = true; setPage(undefined); setError('')
    void httpExchange(project, row.evidenceId, row.stepId, part, offset).then((value) => { if (active) setPage(value) })
      .catch((error: unknown) => { if (active) setError(String(error)) })
    return () => { active = false }
  }, [project, row.evidenceId, row.stepId, part, offset, httpExchange])
  return <section><h4>{row.method} {row.path} · {row.status ?? t(row.outcome === 'skipped' ? 'httpSkipped' : row.outcome === 'failed' ? 'httpFailed' : 'httpObserved')}</h4>
    <nav className={css.taskActions}>{(['request', 'headers', 'body'] as const).map(key => <button key={key} aria-pressed={key === part} onClick={() => { setPart(key); setOffset(0) }}>{t(key === 'request' ? 'httpRequest' : key === 'headers' ? 'httpResponseHeaders' : 'httpResponseBody')}</button>)}</nav>
    {error && <p role="alert">{error}</p>}{page && <>
      {(page.incomplete || page.bodyOmitted) && <p>{t(page.bodyOmitted ? 'httpOmitted' : 'httpIncomplete')}</p>}
      <pre>{page.text}</pre><p>{page.offset}–{page.next ?? page.totalBytes} / {page.totalBytes}</p>
      {offset > 0 && <button onClick={() =>{  setOffset(0) }}>{t('dashboardBack')}</button>}
      {page.next !== null && <button onClick={() =>{  setOffset(page.next ?? 0) }}>{t('httpMore')}</button>}
    </>}
  </section>
}
/** Read sanitized HTTP records and compare only the content actually loaded.
 * @param props - bounded readers, scope and optional draft replay callback.
 * @returns filterable request list and response panels. */
export function HttpHistory(props: PropsLocale<typeof NS> & HttpReadActions & {
  project: string
  assetId?: string | undefined
  evidenceId?: string | undefined
  revision: number
  replay?: ((row: HttpHistoryItem) => void) | undefined
  associate?: ((row: HttpHistoryItem) => void) | undefined
}) {
  const { t } = props
  const [method, setMethod] = useState(''); const [query, setQuery] = useState(''); const [status, setStatus] = useState('')
  const [page, setPage] = useState<HttpHistoryPage>(); const [offset, setOffset] = useState(0)
  const [through, setThrough] = useState<number>()
  const [selected, setSelected] = useState<HttpHistoryItem[]>([]); const [error, setError] = useState('')
  const [comparison, setComparison] = useState('')
  const comparisonEpoch = useRef(0)
  useEffect(() => { comparisonEpoch.current++; return () => { comparisonEpoch.current++ } }, [selected, props.project])
  useEffect(() => { setOffset(0); setThrough(undefined); setSelected([]); setComparison('') }, [props.project, props.assetId, props.evidenceId, props.revision, method, query, status])
  useEffect(() => {
    let active = true; setError(''); setPage(undefined)
    void props.httpHistory(props.project, JSON.stringify({ ...(props.assetId ? { assetId: props.assetId } : {}),
      ...(props.evidenceId ? { evidenceId: props.evidenceId } : {}),
      ...(method ? { method } : {}), ...(query ? { query } : {}), ...(status ? { status: Number(status) } : {}),
      offset, through }))
      .then((value) => { if (active) setPage(value) }).catch((error: unknown) => { if (active) setError(String(error)) })
    return () => { active = false }
  }, [props.project, props.assetId, props.evidenceId, props.revision, method, query, status, offset, through, props.httpHistory])
  const compare = async () => {
    const epoch = ++comparisonEpoch.current
    setComparison(''); setError('')
    try {
      const pairs = await Promise.all(selected.map(async row => ({ row, parts: await Promise.all((['headers', 'body'] as const).map(part => props.httpExchange(props.project, row.evidenceId, row.stepId, part, 0))) })))
      if (pairs.length !== 2 || epoch !== comparisonEpoch.current) return
      const [a, b] = pairs
      if (!a || !b) return
      const incomplete = pairs.some(pair => pair.row.incomplete || pair.parts.some(part => part.incomplete || part.bodyOmitted || part.next !== null || part.text.includes('[redacted]')))
      const different = a.row.status !== b.row.status || a.parts.some((part, index) => part.text !== b.parts[index]?.text)
      setComparison(t(different ? 'httpDifferent' : incomplete ? 'httpCompareUnknown' : 'httpSame') + (different && incomplete ? ' · ' + t('httpCompareUnknown') : ''))
    } catch (error) { if (epoch === comparisonEpoch.current) setError(String(error)) }
  }
  return <section><h3>{t('httpHistory')}</h3><div className={css.taskActions}>
    <select aria-label={t('httpMethod')} value={method} onChange={(event) =>{  setMethod(event.target.value) }}><option value="">{t('httpAllMethods')}</option>{['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'].map(value => <option key={value}>{value}</option>)}</select>
    <input aria-label={t('httpPath')} placeholder={t('httpPath')} value={query} onChange={(event) =>{  setQuery(event.target.value) }} />
    <input aria-label={t('httpStatusFilter')} placeholder={t('httpStatusFilter')} type="number" value={status} onChange={(event) =>{  setStatus(event.target.value) }} />
  </div>{error && <p role="alert">{error}</p>}
  {page?.items.filter(row => !props.evidenceId || row.evidenceId === props.evidenceId).map(row => <div className={css.taskActions} key={row.evidenceId + ':' + row.stepId}>
    <label><input type="checkbox" checked={selected.some(item => item.evidenceId === row.evidenceId && item.stepId === row.stepId)} onChange={(event) => { setComparison(''); setSelected(previous => event.target.checked ? [...previous.slice(-1), row] : previous.filter(item => item.evidenceId !== row.evidenceId || item.stepId !== row.stepId)) }} />{t('httpSelectCompare')}</label>
    <button onClick={() => { setSelected([row]); setComparison('') }}>{row.method} {row.path} · {row.status ?? t(row.outcome === 'skipped' ? 'httpSkipped' : row.outcome === 'failed' ? 'httpFailed' : 'httpObserved')} · {row.durationMs.toFixed(0)} {t('httpMilliseconds')}</button>
    {props.replay && <button onClick={() =>{  props.replay?.(row) }}>{t('httpReplay')}</button>}
    {props.associate && <button onClick={() =>{  props.associate?.(row) }}>{t('httpLinkFinding')}</button>}
  </div>)}{page?.items.length === 0 && <p>{t('httpNoHistory')}</p>}
  {offset > 0 && <button onClick={() =>{  setOffset(0) }}>{t('dashboardBack')}</button>}
  {page && page.next !== null && <button onClick={() => { setThrough(page.through); setOffset(page.next ?? 0) }}>{t('httpMore')}</button>}
  {selected.length === 2 && <button onClick={() => void compare()}>{t('httpCompare')}</button>}{comparison && <p role="status">{comparison}</p>}
  {selected.map(row => <Exchange key={row.evidenceId + ':' + row.stepId} {...props} row={row} />)}
  </section>
}
