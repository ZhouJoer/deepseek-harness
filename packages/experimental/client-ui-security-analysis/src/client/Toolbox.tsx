/** Environment-specific installation directory, independent of project selection. @module */
import { useEffect, useState } from 'react'
import type { ToolboxDirectory } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import css from './Workbench.module.css'

/** Read-only inventory actions supplied by the authenticated Host. */
export interface ToolboxActions {
  toolboxInventory(this: void, environmentId?: string): Promise<ToolboxDirectory>
}

/** Render measured tool availability and manual installation references.
 * @param props - inventory reader and localized labels.
 * @returns environment selector and categorized installations.
 */
export function Toolbox({ toolboxInventory, t }: ToolboxActions & PropsLocale<typeof NS>) {
  const [environment, setEnvironment] = useState<string>()
  const [revision, setRevision] = useState(0)
  const [directory, setDirectory] = useState<ToolboxDirectory>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let current = true
    setBusy(true); setError('')
    void toolboxInventory(environment).then((value) => { if (current) setDirectory(value) },
      (error: unknown) => { if (current) setError(error instanceof Error ? error.message : String(error)) })
      .finally(() => { if (current) setBusy(false) })
    return () => { current = false }
  }, [environment, revision, toolboxInventory])
  const inventory = directory?.inventory
  const states = { available: 'toolAvailable', missing: 'toolMissing', error: 'toolProbeError', 'not-checked': 'toolUnchecked' } as const
  const categories = { runtime: 'toolRuntime', reverse: 'toolReverse', device: 'toolDevice', web: 'toolWeb', utility: 'toolUtility', custom: 'toolCustom' } as const
  const invocations = { shell: 'toolViaShell', plugin: 'toolViaPlugin', python: 'toolViaPython', provider: 'toolViaProvider' } as const
  return <section aria-label={t('toolbox')}>
    <p>{t('toolboxHelp')}</p>
    <label className={css.field}>{t('toolEnvironment')}
      <select disabled={busy} value={environment ?? inventory?.environmentId ?? ''} onChange={(event) => { setEnvironment(event.target.value) }}>
        {!directory && <option value="">{t('toolUnchecked')}</option>}
        {directory?.environments.map(item => <option key={item.id} value={item.id}>{item.label} · {item.kind}</option>)}
      </select>
    </label>
    <button disabled={busy} onClick={() => { setRevision(value => value + 1) }}>{t('refresh')}</button>
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
          {tool.installUrl && <a href={tool.installUrl} target="_blank" rel="noreferrer">{t('toolInstallGuide')}</a>}
        </article>)}
      </section>)}
    </>}
  </section>
}
