/** Environment-specific installation directory, independent of project selection. @module */
import { useEffect, useId, useRef, useState } from 'react'
import { SegmentedTabs } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AnalysisScript } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import { ScriptLibrary } from './ScriptLibrary.tsx'
import type { ToolboxDirectory, ToolboxConfiguration, ToolCatalogSnapshot } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { ToolSettings, type ToolConfigurationActions } from './ToolSettings.tsx'
import { ToolPacks, type ToolPackActions } from './ToolPacks.tsx'
import type { NS } from './locales.ts'
import css from './Workbench.module.css'

/** Inventory and configuration actions supplied by the authenticated Host. */
export interface ToolboxActions extends ToolConfigurationActions, ToolPackActions {
  scriptCatalog(this: void): Promise<AnalysisScript[]>
  toolboxDirectory(this: void, environmentId?: string): Promise<ToolboxDirectory>
  toolboxInventory(this: void, environmentId?: string, toolIds?: string[]): Promise<ToolboxDirectory>
}

/** Render measured tool availability and manual installation references.
 * @param props - inventory reader and localized labels.
 * @returns environment selector and categorized installations.
 */
export function Toolbox(props: ToolboxActions & PropsLocale<typeof NS>) {
  const [tab, setTab] = useState<'tools' | 'scripts'>('tools')
  const id = useId()
  return <section aria-label={props.t('toolbox')}>
    <SegmentedTabs value={tab} onChange={setTab} label={props.t('toolbox')} items={[
      { value: 'tools', label: props.t('scriptToolsTab'), id: id + '-tools', panelId: id + '-tools-panel' },
      { value: 'scripts', label: props.t('scriptLibraryTab'), id: id + '-scripts', panelId: id + '-scripts-panel' },
    ]} />
    <div role="tabpanel" id={id + '-' + tab + '-panel'} aria-labelledby={id + '-' + tab}>
      {tab === 'tools' ? <ToolInstallations {...props} /> : <ScriptLibrary scriptCatalog={props.scriptCatalog} t={props.t} />}
    </div>
  </section>
}

function ToolInstallations(props: ToolboxActions & PropsLocale<typeof NS>) {
  const { toolboxDirectory, toolboxInventory, toolboxConfiguration, configureTool, toolboxFiles, t } = props
  const [environment, setEnvironment] = useState<string>()
  const [revision, setRevision] = useState(0)
  const [directory, setDirectory] = useState<ToolboxDirectory>()
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState('')
  const [error, setError] = useState('')
  const [configuration, setConfiguration] = useState<ToolboxConfiguration>()
  const [editing, setEditing] = useState<string>()
  const [catalog, setCatalog] = useState<ToolCatalogSnapshot>()
  const [tag, setTag] = useState(''), [pack, setPack] = useState(''), [query, setQuery] = useState('')
  const generation = useRef(0)
  useEffect(() => {
    let current = true
    generation.current++
    setBusy(true); setError('')
    void toolboxDirectory(environment).then(async (value) => {
      const [settings, definitions] = await Promise.all([toolboxConfiguration(value.inventory.environmentId), props.toolCatalog()])
      if (current) { setDirectory(value); setConfiguration(settings); setCatalog(definitions) }
    }).catch(
      (error: unknown) => { if (current) setError(error instanceof Error ? error.message : String(error)) })
      .finally(() => { if (current) setBusy(false) })
    return () => { current = false; generation.current++ }
  }, [environment, revision, toolboxDirectory, toolboxConfiguration, props.toolCatalog])
  const inventory = directory?.inventory
  const visible = inventory?.tools.filter((tool) => {
    const definition = catalog?.tools.find(item => item.id === tool.id)
    return (!tag || definition?.tags.includes(tag))
      && (!pack || catalog?.packs.find(item => item.id === pack)?.tools.some(item => item.id === tool.id))
      && (!query || [tool.id, definition?.label, definition?.description].join(' ').toLowerCase().includes(query.toLowerCase()))
  }) ?? []
  const check = async (ids: string[]) => {
    const current = generation.current
    setBusy(true); setError('')
    try {
      for (const id of ids) {
        if (generation.current !== current) return
        setChecking(id)
        const result = await toolboxInventory(inventory?.environmentId, [id])
        if (generation.current === current) setDirectory(value => value && ({ ...result, inventory: { ...result.inventory,
          tools: value.inventory.tools.map(tool => result.inventory.tools.find(item => item.id === tool.id) ?? tool) } }))
      }
    } catch (error) { if (generation.current === current) setError(String(error)) }
    finally { if (generation.current === current) { setBusy(false); setChecking('') } }
  }
  const states = { available: 'toolAvailable', missing: 'toolMissing', error: 'toolProbeError', 'not-checked': 'toolUnchecked' } as const
  const categories = { runtime: 'toolRuntime', reverse: 'toolReverse', device: 'toolDevice', web: 'toolWeb', utility: 'toolUtility', custom: 'toolCustom' } as const
  const invocations = { shell: 'toolViaShell', plugin: 'toolViaPlugin', python: 'toolViaPython', provider: 'toolViaProvider' } as const
  return <section aria-label={t('toolbox')}>
    <p>{t('toolboxHelp')}</p>
    {catalog && <ToolPacks {...props} catalog={catalog} changed={() => { setRevision(value => value + 1) }} />}
    <label className={css.field}>{t('toolPurposeSearch')}<input value={query} onChange={(event) => { setQuery(event.target.value) }} /></label>
    <label className={css.field}>{t('toolTagFilter')}<select value={tag} onChange={(event) => { setTag(event.target.value) }}><option value="">{t('toolAll')}</option>
      {[...new Set(catalog?.tools.flatMap(tool => tool.tags))].sort().map(tag => <option key={tag} value={tag}>{tag}</option>)}
    </select></label>
    <label className={css.field}>{t('toolPackFilter')}<select value={pack} onChange={(event) => { setPack(event.target.value) }}><option value="">{t('toolAll')}</option>
      {catalog?.packs.map(pack => <option key={pack.id} value={pack.id}>{pack.label}</option>)}
    </select></label>
    <button disabled={busy || !visible.length} onClick={() => void check(visible.map(tool => tool.id))}>{t('toolCheckFiltered')}</button>
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
        } else { setEditing(undefined); setRevision(value => value + 1) }
      }} />}
    {busy && <p role="status">{t('toolInspecting')} <code>{checking}</code></p>}
    {error && <p role="alert">{error}</p>}
    {inventory && (!environment || environment === inventory.environmentId) && <>
      <p>{t(inventory.runtime === 'unchecked' ? 'toolUnchecked' : inventory.runtime === 'ready' ? 'toolRuntimeReady' : inventory.runtime === 'stopped' ? 'toolRuntimeStopped' : 'toolRuntimeUnavailable')}</p>
      {inventory.checkedAt > 0 && <p>{t('toolCheckedAt')} {new Date(inventory.checkedAt).toLocaleString()}</p>}
      <code>{inventory.containerId ?? inventory.workdir}</code>
      {inventory.detail && <p>{inventory.detail}</p>}
      {Object.entries(categories).filter(([category]) => visible.some(tool => tool.category === category))
        .map(([category, label]) => <section key={category} aria-label={t(label)}>
          <h3>{t(label)}</h3>
          {visible.filter(tool => tool.category === category).map(tool => <article key={tool.id} className={css.card}>
            <strong>{tool.id} · {t(states[tool.status])}</strong>
            <p>{catalog?.tools.find(item => item.id === tool.id)?.description}</p>
            <p>{t(invocations[tool.invocation])}</p>
            <button disabled={busy} onClick={() => void check([tool.id])}>{t('toolCheckSelection')}</button>
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
