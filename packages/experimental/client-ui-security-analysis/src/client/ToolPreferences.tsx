/** Soft tool selections scoped to the retained active session. @module */
import { useEffect, useState } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ToolCatalogSnapshot, ToolPreferences as Preferences } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import css from './Workbench.module.css'
/** Carrier-authenticated session preference actions. */
export interface ToolPreferenceActions {
  toolCatalog(this: void): Promise<ToolCatalogSnapshot>
  toolPreferences(this: void, sessionId: SessionId, input?: string): Promise<Preferences>
}
/** Render optional tool and collection selections without restricting execution permissions.
 * @param props - active session, actions and locale.
 * @returns preference editor with automatic-discovery reset.
 */
export function ToolPreferences(props: ToolPreferenceActions & PropsLocale<typeof NS> & { sessionId: SessionId }) {
  const { t, sessionId } = props
  const [catalog, setCatalog] = useState<ToolCatalogSnapshot>(), [selection, setSelection] = useState<Preferences>()
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    let active = true
    if (open) {
      setBusy(true)
      void Promise.all([props.toolCatalog(), props.toolPreferences(sessionId)]).then(([catalog, selection]) => {
        if (active) { setCatalog(catalog); setSelection(selection); setSaved(false) }
      }).catch((error: unknown) => { if (active) setError(String(error)) }).finally(() => { if (active) setBusy(false) })
    }
    return () => { active = false }
  }, [sessionId, open, props.toolCatalog, props.toolPreferences])
  const apply = async (value: Preferences) => {
    setBusy(true); setError('')
    try { setSelection(await props.toolPreferences(sessionId, JSON.stringify(value))); setSaved(true) }
    catch (error) { setError(String(error)) }
    finally { setBusy(false) }
  }
  return <details className={css.card} onToggle={(event) => { setOpen(event.currentTarget.open) }}>
    <summary>{t('toolPreferenceTitle')}</summary>
    <p>{t('toolPreferenceHelp')}</p>
    {selection && <fieldset className={css.toolFields} disabled={busy}>
      {catalog?.collections.map(group => <label key={group.id}><input type="checkbox" checked={selection.collectionIds.includes(group.id)} onChange={(event) => {
        setSelection({ ...selection, collectionIds: event.target.checked
          ? [...selection.collectionIds, group.id] : selection.collectionIds.filter(id => id !== group.id) }); setSaved(false)
      }} />{group.label}</label>)}
      <details><summary>{t('toolChooseType')}</summary><div className={css.toolFields}>{catalog?.tools.map(tool => <label key={tool.id}><input type="checkbox" checked={selection.toolIds.includes(tool.id)} onChange={(event) => {
        setSelection({ ...selection, toolIds: event.target.checked
          ? [...selection.toolIds, tool.id] : selection.toolIds.filter(id => id !== tool.id) }); setSaved(false)
      }} />{tool.label}</label>)}</div></details>
      <button onClick={() => void apply(selection)}>{t('toolPreferenceSave')}</button>
      <button onClick={() => void apply({ toolIds: [], collectionIds: [], tags: [] })}>{t('toolPreferenceAuto')}</button>
    </fieldset>}
    {saved && <p role="status">{t('toolPreferenceSaved')}</p>}
    {error && <p role="alert">{error}</p>}
  </details>
}
