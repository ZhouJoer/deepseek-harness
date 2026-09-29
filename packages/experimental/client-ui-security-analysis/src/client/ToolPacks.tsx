/** Tool definition forms and reviewed JSON imports; probes are separate gestures. @module */
import { useEffect, useRef, useState } from 'react'
import type { ToolCatalogSnapshot, ToolDefinition, ToolPackPreview } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import css from './Workbench.module.css'
/** Authenticated definition management independent of execution authority. */
export interface ToolPackActions {
  toolCatalog(this: void): Promise<ToolCatalogSnapshot>
  previewToolPack(this: void, input: string): Promise<ToolPackPreview>
  importToolPack(this: void, input: string, revision: string, replace: boolean): Promise<ToolCatalogSnapshot>
  exportToolPack(this: void, id: string): Promise<string>
}
/** Edit definitions or preview imports before committing them.
 * @param props - current catalog, authenticated actions and refresh callback.
 * @returns a localized definition editor and import conflict preview.
 */
export function ToolPacks(props: ToolPackActions & PropsLocale<typeof NS> & {
  catalog: ToolCatalogSnapshot
  changed(): void
}) {
  const { t, catalog } = props
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [draft, setDraft] = useState<Partial<ToolDefinition>>({ id: '', label: '', commands: [], args: ['--version'], tags: [] })
  const [preview, setPreview] = useState<ToolPackPreview>(), [replace, setReplace] = useState(false), [message, setMessage] = useState('')
  const [packId, setPackId] = useState('operator'), [json, setJson] = useState('')
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const perform = async (action: () => Promise<void>) => {
    setBusy(true); setError(''); setMessage('')
    try { await action() } catch (error) { if (mounted.current) setError(String(error)) }
    finally { if (mounted.current) setBusy(false) }
  }
  const review = async (input: string) => {
    setPreview(undefined); setReplace(false)
    const result = await props.previewToolPack(input)
    if (mounted.current) { setPreview(result); setReplace(false) }
  }
  const edit = (id: string) => {
    const tool = catalog.tools.find(tool => tool.id === id)
    setDraft(tool ? structuredClone(tool) : { id: '', label: '', commands: [], args: ['--version'], tags: [] })
    setPackId(catalog.packs.findLast(pack => pack.id !== 'builtin' && pack.tools.some(tool => tool.id === id))?.id ?? 'operator')
    setPreview(undefined)
  }
  return <section>
    <button onClick={() => { setOpen(!open) }}>{t('toolPackManage')}</button>
    {open && <div className={css.form}>
      <p>{t('toolPackHelp')}</p>
      <fieldset disabled={busy}>
        <label className={css.field}>{t('toolPackExport')}<select value="" onChange={(event) => {
          const id = event.target.value
          if (id) void perform(async () => {
            const text = await props.exportToolPack(id), url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
            const link = document.createElement('a'); link.href = url; link.download = id + '.tools.json'; link.click(); URL.revokeObjectURL(url)
          })
        }}><option value="">{t('toolChooseType')}</option>{catalog.packs.map(pack => <option key={pack.id} value={pack.id}>{pack.label}</option>)}</select></label>
        {catalog.editable && <>
          <label className={css.field}>{t('toolPackImport')}<input type="file" accept=".json,application/json" onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void perform(async () => { await review(await file.text()) })
            event.target.value = ''
          }} /></label>
          <label className={css.field}>{t('toolDefinitionEdit')}<select value="" onChange={(event) => { edit(event.target.value) }}>
            <option value="">{t('toolDefinitionNew')}</option>{catalog.tools.map(tool => <option key={tool.id} value={tool.id}>{tool.label}</option>)}
          </select></label>
          <button onClick={() => { edit('') }}>{t('toolDefinitionNew')}</button>
          <label className={css.field}>{t('toolPackId')}<input value={packId} onChange={(event) => { setPackId(event.target.value); setPreview(undefined) }} /></label>
          <label className={css.field}>{t('toolIdentifier')}<input value={draft.id ?? ''} onChange={(event) => { setDraft({ ...draft, id: event.target.value }); setPreview(undefined) }} /></label>
          <label className={css.field}>{t('toolDefinitionLabel')}<input value={draft.label ?? ''} onChange={(event) => { setDraft({ ...draft, label: event.target.value }); setPreview(undefined) }} /></label>
          <label className={css.field}>{t('toolDefinitionDescription')}<input value={draft.description ?? ''} onChange={(event) => { setDraft({ ...draft, description: event.target.value }); setPreview(undefined) }} /></label>
          <label className={css.field}>{t('toolTags')}<input value={(draft.tags ?? []).join(',')} onChange={(event) => { setDraft({ ...draft, tags: event.target.value.split(',').map(tag => tag.trim()).filter(Boolean) }); setPreview(undefined) }} /></label>
          <label className={css.field}>{t('toolProbeKind')}<select value={draft.probe?.kind ?? 'command'} onChange={(event) => {
            const kind = event.target.value as ToolDefinition['probe']['kind']
            setDraft({ ...draft, invocation: kind === 'python-module' ? 'python' : kind === 'json-plugin' ? 'plugin' : 'shell',
              probe: kind === 'python-module' ? { kind, module: '', distribution: '' } : kind === 'json-plugin' ? { kind, name: '' } : { kind } }); setPreview(undefined)
          }}>{(['command', 'identity', 'python-module', 'json-plugin'] as const).map(kind => <option key={kind} value={kind}>{kind}</option>)}</select></label>
          {(['python-module', 'json-plugin'].includes(draft.probe?.kind ?? '')) && <label className={css.field}>{t('toolDependency')}<select value={draft.dependency ?? ''} onChange={(event) => { setDraft({ ...draft, dependency: event.target.value }); setPreview(undefined) }}>
            <option value="">{t('toolChooseType')}</option>{catalog.tools.map(tool => <option key={tool.id} value={tool.id}>{tool.label}</option>)}
          </select></label>}
          {draft.probe?.kind === 'python-module' && <>
            <label className={css.field}>{t('toolModule')}<input value={draft.probe.module} onChange={(event) => { if (draft.probe?.kind === 'python-module') setDraft({ ...draft, probe: { ...draft.probe, module: event.target.value } }); setPreview(undefined) }} /></label>
            <label className={css.field}>{t('toolDistribution')}<input value={draft.probe.distribution} onChange={(event) => { if (draft.probe?.kind === 'python-module') setDraft({ ...draft, probe: { ...draft.probe, distribution: event.target.value } }); setPreview(undefined) }} /></label>
          </>}
          {draft.probe?.kind === 'json-plugin' && <label className={css.field}>{t('toolPluginName')}<input value={draft.probe.name} onChange={(event) => { if (draft.probe?.kind === 'json-plugin') setDraft({ ...draft, probe: { ...draft.probe, name: event.target.value } }); setPreview(undefined) }} /></label>}
          <label className={css.field}>{t('toolCommandNames')}<textarea value={(draft.commands ?? []).join('\n')} onChange={(event) => { setDraft({ ...draft, commands: event.target.value.split('\n').filter(Boolean) }); setPreview(undefined) }} /></label>
          <label className={css.field}>{t('toolVersionArgs')}<textarea value={(draft.args ?? []).join('\n')} onChange={(event) => { setDraft({ ...draft, args: event.target.value.split('\n').filter(Boolean) }); setPreview(undefined) }} /></label>
          <label className={css.field}>{t('toolGuide')}<textarea value={draft.guide ?? ''} onChange={(event) => { setDraft({ ...draft, guide: event.target.value }); setPreview(undefined) }} /></label>
          <button onClick={() => void perform(async () => {
            const pack = catalog.packs.find(pack => pack.id === packId)
            await review(JSON.stringify({ version: 1, id: packId, label: pack?.label ?? packId,
              tools: [...(pack?.tools ?? []).filter(tool => tool.id !== draft.id), draft], collections: pack?.collections ?? [] }))
          })}>{t('toolPackPreview')}</button>
          <details><summary>{t('toolPackJson')}</summary>
            <textarea aria-label={t('toolPackJson')} value={json} onChange={(event) => { setJson(event.target.value); setPreview(undefined) }} />
            <button onClick={() => void perform(() => review(json))}>{t('toolPackPreview')}</button>
          </details>
          {preview && <section aria-label={t('toolPackPreview')}>
            <p>{preview.pack.label} · {preview.pack.tools.map(tool => tool.id).join(', ')}</p>
            <pre>{preview.conflicts.join('\n')}</pre>
            {preview.conflicts.length > 0 && <label><input type="checkbox" checked={replace} onChange={(event) => { setReplace(event.target.checked) }} />{t('toolPackReplace')}</label>}
            <button disabled={preview.conflicts.length > 0 && !replace} onClick={() => void perform(async () => {
              await props.importToolPack(JSON.stringify(preview.pack), preview.revision, replace)
              if (mounted.current) { setPreview(undefined); setMessage(t('toolPackSaved')); props.changed() }
            })}>{t('toolPackConfirm')}</button>
          </section>}
        </>}
      </fieldset>
      {busy && <p role="status">{t('toolPackWorking')}</p>}
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </div>}
  </section>
}
