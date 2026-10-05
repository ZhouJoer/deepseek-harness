/** Lightweight engineering suggestions and portable coding-AI handoff. @module */
import { useEffect, useState, useSyncExternalStore } from 'react'
import { zipSync, strToU8 } from 'fflate/browser'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { Button, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { EvolutionView, EvolutionBundle } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import type { NS, SecurityKey } from './locales.ts'
import css from './Improvements.module.css'

/** Operator-only improvement RPCs and shell-hosted notifications. */
export interface ImprovementActions {
  improvements(projectId?: string): Promise<EvolutionView>
  analyzeImprovements: (input: string) => Promise<EvolutionView>
  updateImprovement(input: string): Promise<EvolutionView>
  exportImprovement(id: string): Promise<EvolutionBundle>
  followImprovements: (signal: AbortSignal) => AsyncIterable<EvolutionView>
  notifyImprovement: (text: string) => void
}
/** Create notification state that outlasts panel navigation.
 * @returns controller shared by actions and the shell overlay. */
export function improvementNotifications() {
  let current: { id: number; text: string } | null = null
  let serial = 0
  const listeners = new Set<() => void>()
  return {
    read: () => current,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    push: (text: string) => { current = { id: ++serial, text }; for (const listener of listeners) listener() },
    dismiss: () => { current = null; for (const listener of listeners) listener() },
  }
}
/** Render feedback outside the navigable panel.
 * @param props - plugin-owned notification controller.
 * @returns shared toast after an operation settles. */
export function ImprovementToast({ notifications }: { notifications: ReturnType<typeof improvementNotifications> }) {
  const value = useSyncExternalStore(notifications.subscribe, notifications.read)
  return value ? <Toast key={value.id} text={value.text} onDone={notifications.dismiss} /> : null
}
const progressLabels = { open: 'evoOpen', modified: 'evoModified', verified: 'evoVerified', ignored: 'evoIgnored' } as const
const runLabels = { queued: 'evoQueued', running: 'evoRunning', completed: 'evoCompleted', failed: 'evoFailed', cancelled: 'evoCancelled', interrupted: 'evoInterrupted' } as const

/** Render the global pool or one task's suggestions without creating analysis Sessions.
 * @param props - authenticated operations, task filter and localized copy.
 * @returns suggestions, evidence, coding tasks and explicit progress controls. */
export function Improvements(props: ImprovementActions & PropsLocale<typeof NS> & {
  projectId?: string
  disabled?: boolean
  tasks?: { id: string; title: string }[]
}) {
  const { t, projectId } = props
  const [view, setView] = useState<EvolutionView>()
  const [failed, setFailed] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [taskFilter, setTaskFilter] = useState('')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState('')
  const [draft, setDraft] = useState({ summary: '', reference: '', command: '', result: '', remaining: '' })
  const [receipt, setReceipt] = useState('')
  const [validation, setValidation] = useState('')
  useEffect(() => {
    const abort = new AbortController()
    setFailed(false)
    void (async () => {
      try { for await (const next of props.followImprovements(abort.signal)) { if (abort.signal.aborted) break; setView(next) } }
      catch { if (!abort.signal.aborted) setFailed(true) }
    })()
    return () => { abort.abort() }
  }, [props.followImprovements, refresh])
  const perform = async (action: () => Promise<unknown>, success: SecurityKey = 'evoSaved') => {
    setBusy(true)
    try { await action(); props.notifyImprovement(t(success)) }
    catch { props.notifyImprovement(t('evoActionFailed')) }
    finally { setBusy(false) }
  }
  const update = (action: object) => perform(async () => {
    if (view) setView(await props.updateImprovement(JSON.stringify({ operationId: randomUUID(), expectedRevision: view.revision, action })))
  })
  const filter = projectId ?? taskFilter
  const proposals = view?.proposals.filter(item => (!filter || item.occurrences.some(source => source.projectId === filter))
    && (!status || item.status === status) && [item.title, item.component, item.problem, item.change].join(' ').toLowerCase().includes(query.toLowerCase())) ?? []
  const tasks = [...new Set(view?.proposals.flatMap(item => item.occurrences.map(source => source.projectId)) ?? [])]
  const run = view?.runs.filter(item => item.projectId === projectId).at(-1)
  const download = async (id: string) => {
    const bundle = await props.exportImprovement(id)
    const bytes = zipSync({ 'TASK.md': strToU8(bundle.markdown), 'proposal.json': strToU8(bundle.proposal), 'result.template.json': strToU8(bundle.receipt) })
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'application/zip' }))
    const anchor = document.createElement('a')
    anchor.href = url; anchor.download = `improvement-${id}.zip`; anchor.click(); URL.revokeObjectURL(url)
  }
  const fields = [['summary', 'evoSummary'], ['reference', 'evoReference'], ['command', 'evoTestCommand'],
    ['result', 'evoTestResult'], ['remaining', 'evoRemaining']] as const
  return <section className={css.root} aria-label={t('evoTitle')}>
    <header className={css.header}><div><h2>{t('evoTitle')}</h2><p>{t('evoHint')}</p></div>
      {projectId && <Button disabled={busy || props.disabled || !view || run?.status === 'queued' || run?.status === 'running'} onClick={() => void perform(async () => {
        if (view) setView(await props.analyzeImprovements(JSON.stringify({
          projectId, operationId: randomUUID(), expectedRevision: view.revision,
        })))
      }, 'evoRequested')}>{t('evoAnalyze')}</Button>}
    </header>
    {projectId && <p role="status">{run ? t(runLabels[run.status]) : t('evoIdle')}{run?.status === 'completed' && run.proposalIds.length === 0 ? ` · ${t('evoNoNew')}` : ''}</p>}
    {run?.detail && <details><summary>{t('evoRunDetail')}</summary><p>{run.detail}</p></details>}
    {!!run?.gaps?.length && <details><summary>{t('evoEvidence')}</summary>{run.gaps.map(gap => <p key={gap}>{gap}</p>)}</details>}
    {failed && <div role="alert">{t('evoLoadFailed')} <Button onClick={() => { setRefresh(value => value + 1) }}>{t('refresh')}</Button></div>}
    {!view && !failed && <div className={css.skeleton} aria-label={t('loading')}><div /><div /><div /></div>}
    {view && <>
      <div className={css.filters}>
        <label>{t('query')}<input value={query} onChange={(event) => { setQuery(event.target.value) }} /></label>
        <label>{t('evoProgress')}<select value={status} onChange={(event) => { setStatus(event.target.value) }}>
          <option value="">{t('dashboardAll')}</option>{Object.entries(progressLabels).map(([key, label]) => <option key={key} value={key}>{t(label)}</option>)}
        </select></label>
        {!projectId && <label>{t('evoSourceTask')}<select value={taskFilter} onChange={(event) => { setTaskFilter(event.target.value) }}><option value="">{t('dashboardAll')}</option>
          {tasks.map(id => <option key={id} value={id}>{props.tasks?.find(task => task.id === id)?.title ?? id}</option>)}</select></label>}
      </div>
      {!proposals.length && <p className={css.empty}>{t('evoEmpty')}</p>}
      {proposals.map(item => <article key={item.id} className={css.card}>
        <button className={css.title} aria-expanded={selected === item.id} onClick={() => {
          setSelected(selected === item.id ? '' : item.id); setValidation(''); setReceipt(''); setDraft({ summary: '', reference: '', command: '', result: '', remaining: '' })
        }}><span>{item.title}</span><span>{t(progressLabels[item.status])}</span></button>
        <p>{item.problem}</p><p className={css.meta}>{t('evoSourceTask')} {new Set(item.occurrences.map(source => source.projectId)).size} · {t('evoObservations')} {item.occurrences.length}</p>
        {item.needsReview && <p>{t('evoReviewAgain')}</p>}
        {selected === item.id && <div className={css.detail}>
          <h3>{t('conditions')}</h3><p>{item.conditions}</p><h3>{t('evoChange')}</h3><p>{item.change}</p>
          <p>{t('evoComponent')} {item.component}</p>{item.uncertainty && <p>{t('evoUncertainty')} {item.uncertainty}</p>}
          <h3>{t('evoAcceptance')}</h3><ul>{item.acceptance.map((line, index) => <li key={index}>{line}</li>)}</ul>
          <details><summary>{t('evoEvidence')}</summary>{item.occurrences.map(source => <div key={source.projectId + source.source.id}>
            <p>{source.projectId} · {source.source.id} · {source.version}{source.source.truncated ? ` · ${t('evoClipped')}` : ''}</p><pre>{source.source.excerpt}</pre>
          </div>)}</details>
          <div className={css.actions}>
            <Button disabled={busy} onClick={() => void perform(async () => { await navigator.clipboard.writeText((await props.exportImprovement(item.id)).markdown) }, 'evoCopied')}>{t('evoCopy')}</Button>
            <Button disabled={busy} onClick={() => void perform(() => download(item.id), 'evoDownloaded')}>{t('evoDownload')}</Button>
            {(['open', 'modified', 'verified', 'ignored'] as const).filter(value => value !== item.status).map(value => <Button key={value} disabled={busy}
              onClick={() => void update({ kind: 'status', proposalId: item.id, status: value })}>{t(value === 'open' ? 'evoRestore' : value === 'verified' ? 'evoConfirmVerified' : value === 'ignored' ? 'evoIgnore' : 'evoMarkModified')}</Button>)}
          </div>
          <details><summary>{t('evoReceipt')}</summary><p>{t('evoReceiptHint')}</p>
            <form className={css.form} onSubmit={(event) => {
              event.preventDefault()
              void update({ kind: 'receipt', receipt: { version: 1, proposalId: item.id, proposalRevision: item.revision, summary: draft.summary,
                references: draft.reference ? [draft.reference] : [],
                tests: draft.command ? [{ command: draft.command, result: draft.result }] : [],
                remaining: draft.remaining ? [draft.remaining] : [] } })
            }}>
              {fields.map(([key, label]) => <label key={key}>{t(label)}<textarea required={key === 'summary' || key === 'result' && !!draft.command}
                value={draft[key]} onChange={(event) => { setDraft({ ...draft, [key]: event.target.value }) }} /></label>)}
              <Button type="submit" disabled={busy}>{t('evoSaveReceipt')}</Button>
            </form>
            <label className={css.import}>{t('evoImport')}<input type="file" accept=".json,application/json" onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void file.text().then(setReceipt).catch(() => { setValidation(t('evoInvalidReceipt')) })
            }} /><textarea value={receipt} onChange={(event) => { setReceipt(event.target.value); setValidation('') }} /></label>
            {validation && <p role="alert">{validation}</p>}
            <Button disabled={busy || !receipt.trim()} onClick={() => {
              let value: unknown
              try { value = JSON.parse(receipt) } catch { setValidation(t('evoInvalidReceipt')); return }
              void update({ kind: 'receipt', receipt: value })
            }}>{t('evoImport')}</Button>
          </details>
          {!!item.receipts.length && <details><summary>{t('evoHistory')} {item.receipts.length}</summary>{item.receipts.map((entry, index) => <div key={index}><p>{entry.summary}</p>
            {entry.tests.map((test, i) => <pre key={i}>{test.command}{'\n'}{test.result}</pre>)}</div>)}</details>}
        </div>}
      </article>)}
    </>}
  </section>
}
