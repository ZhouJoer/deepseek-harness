/** Environment-specific installation directory, independent of project selection. @module */
import { useEffect, useState } from 'react'
import type { ToolboxDirectory, ToolboxConfiguration } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { ToolSettings, type ToolConfigurationActions } from './ToolSettings.tsx'
import type { NS } from './locales.ts'
import css from './Workbench.module.css'

/** Inventory and configuration actions supplied by the authenticated Host. */
export interface ToolboxActions extends ToolConfigurationActions {
  toolboxInventory(this: void, environmentId?: string): Promise<ToolboxDirectory>
}

/** Render measured tool availability and manual installation references.
 * @param props - inventory reader and localized labels.
 * @returns environment selector and categorized installations.
 */
export function Toolbox({ toolboxInventory, toolboxConfiguration, configureTool, toolboxFiles, t }:
  ToolboxActions & PropsLocale<typeof NS>) {
  const [environment, setEnvironment] = useState<string>()
  const [revision, setRevision] = useState(0)
  const [directory, setDirectory] = useState<ToolboxDirectory>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [configuration, setConfiguration] = useState<ToolboxConfiguration>()
  const [editing, setEditing] = useState<string>()
  useEffect(() => {
    let current = true
    setBusy(true); setError('')
    void toolboxInventory(environment).then(async (value) => {
      const settings = await toolboxConfiguration(value.inventory.environmentId)
      if (current) { setDirectory(value); setConfiguration(settings) }
    }).catch(
      (error: unknown) => { if (current) setError(error instanceof Error ? error.message : String(error)) })
      .finally(() => { if (current) setBusy(false) })
    return () => { current = false }
  }, [environment, revision, toolboxInventory, toolboxConfiguration])
  const inventory = directory?.inventory
  const states = { available: 'toolAvailable', missing: 'toolMissing', error: 'toolProbeError', 'not-checked': 'toolUnchecked' } as const
  const categories = { runtime: 'toolRuntime', reverse: 'toolReverse', device: 'toolDevice', web: 'toolWeb', utility: 'toolUtility', custom: 'toolCustom' } as const
  const invocations = { shell: 'toolViaShell', plugin: 'toolViaPlugin', python: 'toolViaPython', provider: 'toolViaProvider' } as const
  return <section aria-label={t('toolbox')}>
    <p>{t('toolboxHelp')}</p>
    <label className={css.field}>{t('toolEnvironment')}
      <select disabled={busy || editing !== undefined} value={environment ?? inventory?.environmentId ?? ''} onChange={(event) => { setEnvironment(event.target.value) }}>
        {!directory && <option value="">{t('toolUnchecked')}</option>}
        {directory?.environments.map(item => <option key={item.id} value={item.id}>{item.label} · {item.kind}</option>)}
      </select>
    </label>
    <button disabled={busy || editing !== undefined} onClick={() => { setRevision(value => value + 1) }}>{t('refresh')}</button>
    {configuration?.editable && <button disabled={busy || editing !== undefined} onClick={() => { setEditing('') }}>{t('toolAddInstallation')}</button>}
    {editing !== undefined && configuration && inventory && <ToolSettings key={inventory.environmentId + ':' + editing}
      environmentId={inventory.environmentId} configuration={configuration} selectedId={editing}
      configureTool={configureTool} toolboxFiles={toolboxFiles} t={t} onClose={() => { setEditing(undefined) }}
      onResult={(result) => {
        setConfiguration(result.configuration)
        if (result.tool) {
          const tool = result.tool
          setDirectory(value => value && ({ ...value, inventory: { ...value.inventory, checkedAt: Date.now(),
            tools: [...value.inventory.tools.filter(item => item.id !== tool.id).map(item => item.dependency === tool.id
              ? { ...item, status: 'not-checked' as const, command: '', location: '', version: '', detail: '' } : item), tool] } }))
          setRevision(value => value + 1)
        } else { setEditing(undefined); setRevision(value => value + 1) }
      }} />}
    {busy && <p role="status">{t('toolInspecting')}</p>}
    {error && <p role="alert">{error}</p>}
    {inventory && (!environment || environment === inventory.environmentId) && <>
      <p>{t(inventory.runtime === 'ready' ? 'toolRuntimeReady' : inventory.runtime === 'stopped' ? 'toolRuntimeStopped' : 'toolRuntimeUnavailable')}</p>
      <p>{t('toolCheckedAt')} {new Date(inventory.checkedAt).toLocaleString()}</p>
      <code>{inventory.containerId ?? inventory.workdir}</code>
      {inventory.detail && <p>{inventory.detail}</p>}
      {Object.entries(categories).map(([category, label]) => <section key={category} aria-label={t(label)}>
        <h3>{t(label)}</h3>
        {inventory.tools.filter(tool => tool.category === category).map(tool => <article key={tool.id} className={css.card}>
          <strong>{tool.id} · {t(states[tool.status])}</strong>
          <p>{t(invocations[tool.invocation])}</p>
          {tool.provider && <p>{t('toolDedicatedInterface')} {tool.provider}</p>}
          {tool.command && <p><code>{tool.command}</code></p>}
          {tool.location && tool.location !== tool.command && <p><code>{tool.location}</code></p>}
          {tool.version && <pre>{tool.version.split(/\r?\n/u)[0]}</pre>}
          {tool.dependency && <p>{t('toolDependency')} {tool.dependency}</p>}
          {tool.detail === 'dependency-unavailable' && <p>{t('toolDependencyMissing')}</p>}
          {tool.detail === 'configuration-required' && <p>{t('toolConfigurationRequired')}</p>}
          {(tool.version.includes('\n') || (tool.detail && !['dependency-unavailable', 'configuration-required'].includes(tool.detail))) &&
            <details><summary>{t('toolDiagnostics')}</summary><pre>{tool.version}{'\n'}{tool.detail}</pre></details>}
          {configuration?.editable && tool.invocation !== 'provider' &&
            <button disabled={busy || editing !== undefined} onClick={() => { setEditing(tool.dependency ?? tool.id) }}>{t('toolConfigure')}{tool.dependency ? ' · ' + tool.dependency : ''}</button>}
          {tool.installUrl && <a href={tool.installUrl} target="_blank" rel="noreferrer">{t('toolInstallGuide')}</a>}
        </article>)}
      </section>)}
    </>}
  </section>
}
