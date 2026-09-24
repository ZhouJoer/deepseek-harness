/** User-selected materials shared by task overview and asset details. @module */
import { useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import css from './Workbench.module.css'

/** Explicit browser selection sent through the authenticated operator Remote. */
export type MaterialSelection = { kind: 'text'; name: string; text: string }
  | { kind: 'path'; path: string }
  | { kind: 'files'; directory: boolean; files: { name: string; base64: string }[] }

/** Render file, folder and paste entry points with deployment-owned upload limits.
 * @param props - localized copy, capacity and authenticated importer.
 * @returns material input panel. */
export function MaterialPanel(props: PropsLocale<typeof NS> & {
  disabled: boolean
  limits: { bytes: number; entries: number } | undefined
  submit(material: MaterialSelection, title: string): Promise<void>
}) {
  const { t } = props
  const [mode, setMode] = useState<'files' | 'text' | 'path'>('files')
  const [name, setName] = useState('')
  const [text, setText] = useState('')
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const disabled = props.disabled || busy
  type Prepared = { material: MaterialSelection; title: string }
  const submit = async (prepare: () => Prepared | Promise<Prepared>) => {
    setBusy(true); setError('')
    try {
      const selected = await prepare()
      await props.submit(selected.material, selected.title)
      setText(''); setPath(''); setName('')
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  const upload = (files: File[], directory: boolean) => submit(async () => {
    const limits = props.limits
    if (!limits || !files[0] || files.length > limits.entries || files.reduce((sum, file) => sum + file.size, 0) > limits.bytes)
      throw new Error(t('materialTooLarge'))
    const entries = await Promise.all(files.map(async file => ({
      name: directory ? file.webkitRelativePath : file.name,
      base64: await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onerror = () => { reject(new Error(t('materialReadFailed'))) }
        reader.onload = () => {
          if (typeof reader.result !== 'string') { reject(new Error(t('materialReadFailed'))); return }
          resolve(reader.result.slice(reader.result.indexOf(',') + 1))
        }
        reader.readAsDataURL(file)
      }),
    })))
    return { material: { kind: 'files', directory, files: entries },
      title: directory ? files[0].webkitRelativePath.split('/').shift() || files[0].name : files[0].name }
  })
  return <section className={css.materialPanel}>
    <h3>{t('addMaterials')}</h3><p>{t('materialsHint')}</p>
    <div className={css.taskActions}>
      {(['files', 'text', 'path'] as const).map(key => <button key={key} disabled={disabled} aria-pressed={mode === key}
        onClick={() => { setMode(key); setError('') }}>{t(key === 'files' ? 'chooseFiles' : key === 'text' ? 'pasteText' : 'hostPath')}</button>)}
    </div>
    {mode === 'files' && <div className={css.uploadChoices}>
      {[false, true].map(directory => <label key={String(directory)} className={css.field}>{t(directory ? 'chooseFolder' : 'chooseFiles')}
        <input type="file" multiple disabled={disabled || !props.limits} {...(directory ? { webkitdirectory: '' } : {})}
          onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ''; if (files.length) void upload(files, directory) }} />
      </label>)}
    </div>}
    {mode === 'text' && <div className={css.form}>
      <label className={css.field}>{t('materialName')}<input value={name} disabled={disabled} placeholder={t('materialNameHint')} onChange={(event) => { setName(event.target.value) }} /></label>
      <label className={css.field}>{t('materialText')}<textarea rows={7} value={text} disabled={disabled} placeholder={t('materialTextHint')} onChange={(event) => { setText(event.target.value) }} /></label>
      <button disabled={disabled || !text.trim()} onClick={() => void submit(() => ({ material: { kind: 'text', name: name.trim() || 'notes.txt', text }, title: name.trim() || t('pastedMaterial') }))}>{t('addText')}</button>
    </div>}
    {mode === 'path' && <div className={css.form}><p>{t('hostPathHint')}</p>
      <label className={css.field}>{t('materialPath')}<input disabled={disabled} value={path} onChange={(event) => { setPath(event.target.value) }} /></label>
      <button disabled={disabled || !path.trim()} onClick={() => void submit(() => ({ material: { kind: 'path', path: path.trim() }, title: path.trim().split(/[\\/]/).filter(Boolean).at(-1) || t('materialObjective') }))}>{t('addMaterials')}</button>
    </div>}
    {busy && <p role="status">{t('loading')}</p>}{error && <p role="alert" className={css.error}>{error}</p>}
  </section>
}
