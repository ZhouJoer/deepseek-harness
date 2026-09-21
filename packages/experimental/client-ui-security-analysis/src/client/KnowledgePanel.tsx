/** Structured retrospectives and experience with progressive disclosure. @module */
import { useState } from 'react'
import type { SecurityCommand, WorkbenchView } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import type { WorkbenchProps } from './Workbench.tsx'
import css from './Workbench.module.css'

type Entry = Extract<SecurityCommand['action'], { kind: 'remember' }>['entry']
/** Localized knowledge view and explicit operator mutations. */
export interface KnowledgePanelProps {
  t: WorkbenchProps['t']
  view: WorkbenchView
  busy: boolean
  intervalMs: number
  command(this: void, action: SecurityCommand['action']): Promise<boolean>
  refine(this: void): Promise<void>
}

/** Render concise cards, separate categories and an optional structured editor. */
export function KnowledgePanel({ t, view, busy, intervalMs, command, refine }: KnowledgePanelProps) {
  const [category, setCategory] = useState<Entry['category']>('retrospective')
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({ title: '', summary: '', conditions: '', actions: '', pitfalls: '', tags: '' })
  const notes = view.records.filter(item => item.kind === 'knowledge').filter(item => !item.value.supersededBy)
  const state = view.records.find(item => item.kind === 'knowledge-maintenance')
  const pending = notes.filter(item => !item.value.entry).length
  const visible = notes.filter(item => item.value.entry?.category === category &&
    JSON.stringify(item.value.entry).toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  const lines = (value: string) => value.split('\n').map(line => line.trim()).filter(Boolean)
  const labels: Record<keyof typeof draft, string> = {
    title: t('name'), summary: t(category === 'retrospective' ? 'outcome' : 'lesson'), conditions: t('conditions'),
    actions: t(category === 'retrospective' ? 'improvements' : 'practices'),
    pitfalls: t(category === 'retrospective' ? 'problems' : 'cautions'), tags: t('tags'),
  }
  return <div className={css.knowledge}>
    <div className={css.knowledgeHeader}>
      <div><h2>{t('knowledge')}</h2><p>{t('knowledgeHint')}</p></div>
      <button disabled={busy} onClick={() =>{  setEditing(!editing) }}>{t(editing ? 'cancel' : 'addNote')}</button>
    </div>
    <div className={css.knowledgeToolbar}>
      <div className={css.segments} aria-label={t('category')}>
        {(['retrospective', 'experience'] as const).map(kind => <button key={kind} aria-pressed={category === kind}
          onClick={() => { setCategory(kind); setEditing(false) }}>
          {t(kind)} <span>{notes.filter(item => item.value.entry?.category === kind).length}</span>
        </button>)}
      </div>
      <input type="search" aria-label={t('query')} placeholder={t('searchNotes')} value={query} onChange={(event) =>{  setQuery(event.target.value) }} />
    </div>
    <div className={css.maintenance}>
      <span>{intervalMs > 0 ? t('automaticRefinement') : t('manualRefinement')}
        {state?.kind === 'knowledge-maintenance' && <> · {t(state.value.status === 'failed' ? 'refinementFailed' : 'refinementComplete')}</>}
        {pending > 0 && <> · {t('pendingRefinement')} {pending}</>}
      </span>
      <button disabled={busy || notes.length === 0} onClick={() => void refine()}>{t('refineNow')}</button>
    </div>
    {editing && <form className={css.noteEditor} onSubmit={(event) => {
      event.preventDefault()
      void command({ kind: 'remember', entry: {
        category, title: draft.title, summary: draft.summary, conditions: draft.conditions,
        actions: lines(draft.actions), pitfalls: lines(draft.pitfalls), tags: draft.tags.split(',').map(tag => tag.trim()).filter(Boolean),
      } }).then((saved) => { if (!saved) return; setEditing(false); setDraft({ title: '', summary: '', conditions: '', actions: '', pitfalls: '', tags: '' }) })
    }}>
      <h3>{t(category)}</h3>
      {(Object.keys(draft) as (keyof typeof draft)[]).map(key => <label key={key} className={css.field}>
        {labels[key]}
        {key === 'title' || key === 'tags'
          ? <input required={key === 'title'} maxLength={key === 'title' ? 100 : 320} value={draft[key]} onChange={(event) =>{  setDraft({ ...draft, [key]: event.target.value }) }} />
          : <textarea required={key !== 'pitfalls'} maxLength={key === 'summary' ? 400 : key === 'conditions' ? 300 : 1004}
            placeholder={key === 'actions' || key === 'pitfalls' ? t('onePerLine') : undefined}
            value={draft[key]} onChange={(event) =>{  setDraft({ ...draft, [key]: event.target.value }) }} />}
      </label>)}
      <button disabled={busy} type="submit">{t('saveNote')}</button>
    </form>}
    <div className={css.noteGrid}>
      {visible.map((item) => {
        const entry = item.value.entry
        if (!entry) return null
        return <article key={item.value.id} className={css.noteCard}>
          <div className={css.noteHeading}><h3>{entry.title}</h3><span>{t(item.value.published ? 'published' : 'privateNote')}</span></div>
          <p className={css.noteSummary}>{entry.summary}</p>
          <div className={css.tags}>{entry.tags.map(tag => <span key={tag}>{tag}</span>)}</div>
          <details><summary>{t('noteDetails')}</summary>
            <dl><dt>{t('conditions')}</dt><dd>{entry.conditions}</dd>
              <dt>{t(category === 'retrospective' ? 'improvements' : 'practices')}</dt><dd><ul>{entry.actions.map((action, i) => <li key={i}>{action}</li>)}</ul></dd>
              {entry.pitfalls.length > 0 && <><dt>{t(category === 'retrospective' ? 'problems' : 'cautions')}</dt><dd><ul>{entry.pitfalls.map((pitfall, i) => <li key={i}>{pitfall}</li>)}</ul></dd></>}
            </dl>
            <button disabled={busy || item.value.published} onClick={() => void command({ kind: 'publish', knowledgeId: item.value.id })}>{t(item.value.published ? 'published' : 'publish')}</button>
          </details>
        </article>
      })}
    </div>
    {!visible.length && <div className={css.emptyState}><strong>{t('emptyNotes')}</strong><p>{t('emptyNotesHint')}</p></div>}
  </div>
}
