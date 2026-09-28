/** Mouse-driven local tool selection with bounded Host probes and immediate save feedback. @module */
import { useEffect, useRef, useState } from 'react'
import type { ToolboxConfiguration, ToolboxConfigurationResult, ToolboxFiles, ToolboxInstallation } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import css from './Workbench.module.css'

/** Authenticated operator configuration actions; model tools cannot invoke these methods. */
export interface ToolConfigurationActions {
  toolboxConfiguration(this: void, environmentId: string): Promise<ToolboxConfiguration>
  configureTool(this: void, environmentId: string, input: string): Promise<ToolboxConfigurationResult>
  toolboxFiles(this: void, environmentId: string, directory?: string): Promise<ToolboxFiles>
}

/** Edit one local installation and report its measured version before applying changes.
 * @param props - selected environment, known settings, Host actions and localized labels.
 * @returns executable picker, optional argument fields and probe feedback.
 */
export function ToolSettings({ environmentId, configuration, selectedId, configureTool, toolboxFiles, onResult, onClose, t }:
  Pick<ToolConfigurationActions, 'configureTool' | 'toolboxFiles'> & PropsLocale<typeof NS> & {
    environmentId: string
    configuration: ToolboxConfiguration
    selectedId: string
    onResult(this: void, result: ToolboxConfigurationResult): void
    onClose(this: void): void
  }) {
  const initial = configuration.tools.find(tool => tool.id === selectedId)
  const [settings, setSettings] = useState(configuration)
  const [id, setId] = useState(selectedId)
  const [custom, setCustom] = useState(!initial)
  const [command, setCommand] = useState(initial?.command ?? '')
  const [prefix, setPrefix] = useState(initial?.prefixArgs.join('\n') ?? '')
  const [version, setVersion] = useState(initial?.versionArgs.join('\n') ?? '--version')
  const [busy, setBusy] = useState(false)
  const [files, setFiles] = useState<ToolboxFiles>()
  const [feedback, setFeedback] = useState('')
  const [error, setError] = useState('')
  const [result, setResult] = useState<ToolboxConfigurationResult>()
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  function select(tool: ToolboxInstallation | undefined) {
    setId(tool?.id ?? ''); setCustom(!tool); setCommand(tool?.command ?? '')
    setPrefix(tool?.prefixArgs.join('\n') ?? ''); setVersion(tool?.versionArgs.join('\n') ?? '--version')
    setResult(undefined); setFeedback(''); setError(''); setFiles(undefined)
  }
  async function browse(directory?: string) {
    setBusy(true); setError('')
    try {
      const next = await toolboxFiles(environmentId, directory)
      if (mounted.current) setFiles(next)
    }
    catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  async function run(action: 'probe' | 'save' | 'remove') {
    setBusy(true); setError(''); setFeedback(t(action === 'remove' ? 'toolRemoving' : 'toolCheckingSelection'))
    setResult(undefined)
    try {
      const next = await configureTool(environmentId, JSON.stringify({ action, id, command,
        prefixArgs: prefix.split('\n').filter(Boolean), versionArgs: version.split('\n').filter(Boolean), revision: settings.revision }))
      if (!mounted.current) return
      setResult(next); setSettings(next.configuration)
      setFeedback(next.saved ? t(action === 'remove' ? 'toolRemoved' : 'toolApplied')
        : t(next.tool?.status === 'available' ? 'toolCheckPassed' : 'toolCheckFailed'))
      if (next.tool?.status === 'available') setCommand(next.tool.command)
      if (next.saved) onResult(next)
    } catch (error) { setError(error instanceof Error ? error.message : String(error)); setFeedback('') }
    finally { setBusy(false) }
  }
  return <section className={css.form} aria-label={t('toolConfigure')}>
    <header className={css.header}><strong>{t('toolConfigure')}</strong>
      <button disabled={busy} onClick={onClose}>{t('toolCloseEditor')}</button></header>
    <fieldset disabled={busy} className={css.toolFields}>
      <label className={css.field}>{t('toolChooseType')}
        <select value={custom ? '__custom__' : id} onChange={(event) => { select(settings.tools.find(tool => tool.id === event.target.value)) }}>
          {settings.tools.map(tool => <option key={tool.id} value={tool.id}>{tool.id}</option>)}
          <option value="__custom__">{t('toolCustom')}</option>
        </select>
      </label>
      {custom && <label className={css.field}>{t('toolIdentifier')}<input value={id} onChange={(event) => { setId(event.target.value); setFeedback(''); setResult(undefined) }} /></label>}
      <label className={css.field}>{t('toolExecutable')}<input value={command} onChange={(event) => { setCommand(event.target.value); setFeedback(''); setResult(undefined) }} /></label>
      <p>{t('toolExecutableHint')}</p>
      <button onClick={() => void browse()}>{t('toolBrowseExecutable')}</button>
      {files && <section className={css.toolFilePicker} aria-label={t('toolBrowseExecutable')}>
        <p><code>{files.directory}</code></p>
        <div className={css.tabs}>
          {files.roots.map(root => <button key={root} onClick={() => void browse(root)}>{root}</button>)}
          <button disabled={files.parent === files.directory} onClick={() => void browse(files.parent)}>{t('toolParentDirectory')}</button>
          <button onClick={() => { setFiles(undefined) }}>{t('toolClosePicker')}</button>
        </div>
        <div className={css.toolFileList}>
          {files.entries.map(entry => <button key={entry.path} title={entry.path} onClick={() => {
            if (entry.directory) void browse(entry.path)
            else { setCommand(entry.path); setFiles(undefined); setResult(undefined); setFeedback('') }
          }}><span aria-hidden="true">{entry.directory ? '📁' : '📄'}</span> {entry.name}</button>)}
        </div>
        {files.truncated && <p role="status">{t('toolFilesTruncated')}</p>}
      </section>}
      <details><summary>{t('toolAdvancedArguments')}</summary>
        <p>{t('toolArgumentsHint')}</p>
        <label className={css.field}>{t('toolPrefixArgs')}<textarea value={prefix} onChange={(event) => { setPrefix(event.target.value); setFeedback(''); setResult(undefined) }} /></label>
        <label className={css.field}>{t('toolVersionArgs')}<textarea value={version} onChange={(event) => { setVersion(event.target.value); setFeedback(''); setResult(undefined) }} /></label>
      </details>
      <div className={css.tabs}>
        <button disabled={!id} onClick={() => void run('probe')}>{t('toolCheckSelection')}</button>
        <button disabled={!id} onClick={() => void run('save')}>{t('toolCheckAndSave')}</button>
        {settings.tools.find(tool => tool.id === id)?.saved &&
          <button onClick={() => void run('remove')}>{t('toolRemoveOverride')}</button>}
      </div>
    </fieldset>
    {busy && <p role="status">{t('toolOperationPending')}</p>}
    {feedback && <p role="status">{feedback}</p>}
    {error && <p role="alert">{error}</p>}
    {result?.tool && <div className={css.card}>
      <strong>{result.tool.id} · {t(result.tool.status === 'available' ? 'toolAvailable' : 'toolProbeError')}</strong>
      <p><code>{result.tool.command}</code></p>
      {result.tool.version && <pre>{result.tool.version}</pre>}
      {result.tool.detail && <pre role="alert">{result.tool.detail}</pre>}
    </div>}
  </section>
}
