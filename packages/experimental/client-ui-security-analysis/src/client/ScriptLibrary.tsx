/** Read-only discovery of packaged analysis scripts, independent of environment probes. @module */
import { useEffect, useState } from 'react'
import type { AnalysisScript } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, IconRefreshOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { NS } from './locales.ts'
import css from './ScriptLibrary.module.css'

const parameterLabels = {
  '--input': 'scriptParamInput', '--output': 'scriptParamOutput', '--tshark': 'scriptParamTshark',
  '--timeout': 'scriptParamTimeout', '--max-packets': 'scriptParamPackets', '--max-output-bytes': 'scriptParamOutputBytes',
  '--max-decode-bytes': 'scriptParamDecodeBytes', '--filter': 'scriptParamFilter', '--stream': 'scriptParamStream',
  '--mqtt-port': 'scriptParamMqttPort', '--field': 'scriptParamField', '--max-events': 'scriptParamEvents',
  '--module': 'scriptParamModule', '--symbol': 'scriptParamSymbol', '--stack-depth': 'scriptParamStack',
  '--protocol': 'captureProtocol', '--mode': 'captureOperation',
} as const

/** Browse built-in scripts and their parameters without executing them.
 * @param props - authenticated catalog reader and localized labels.
 * @returns searchable catalog with expandable script details.
 */
export function ScriptLibrary({ scriptCatalog, t }: PropsLocale<typeof NS> & {
  scriptCatalog: () => Promise<AnalysisScript[]>
}) {
  const [entries, setEntries] = useState<AnalysisScript[]>()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [revision, setRevision] = useState(0)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(true)
  useEffect(() => {
    let current = true
    setBusy(true); setFailed(false)
    void scriptCatalog().then((value) => { if (current) setEntries(value) })
      .catch(() => { if (current) setFailed(true) })
      .finally(() => { if (current) setBusy(false) })
    return () => { current = false }
  }, [scriptCatalog, revision])
  const visible = entries?.filter(entry => (!category || entry.category === category)
    && [entry.id, entry.skill, entry.relativePath, ...entry.toolIds, t(`${entry.kind}Title`), t(`${entry.kind}Purpose`)]
      .join(' ').toLowerCase().includes(query.trim().toLowerCase()))
  return <div className={css.library}>
    <div className={css.filters}>
      <label>{t('scriptSearch')}<input type="search" value={query} onChange={(event) => { setQuery(event.target.value) }} /></label>
      <label>{t('scriptCategory')}<select value={category} onChange={(event) => { setCategory(event.target.value) }}>
        <option value="">{t('toolAll')}</option>
        <option value="tshark">{t('scriptCategoryTshark')}</option>
        <option value="mqtt">{t('scriptCategoryMqtt')}</option>
        <option value="dynamic">{t('scriptCategoryDynamic')}</option>
      </select></label>
    </div>
    {failed && <div role="alert" className={css.failure}>{t('scriptLoadFailed')}
      <Button disabled={busy} onClick={() => { setRevision(value => value + 1) }}>
        <IconRefreshOutlineRegular />{t('scriptRetry')}
      </Button>
    </div>}
    {busy && !entries && <div aria-busy="true" aria-label={t('scriptLibraryTab')} className={css.skeleton}>
      {[0, 1, 2].map(index => <div key={index} />)}
    </div>}
    {!busy && !failed && visible?.length === 0 && <p>{t('scriptEmpty')}</p>}
    {visible?.map(entry => <details key={entry.id} className={css.entry}>
      <summary><span>{t(`${entry.kind}Title`)}</span><code>{entry.id}</code></summary>
      <p>{t(`${entry.kind}Purpose`)}</p>
      <dl>
        <dt>{t('scriptMethod')}</dt><dd>{t(`${entry.kind}Method`)}</dd>
        <dt>{t('scriptDependencies')}</dt><dd>{entry.toolIds.join(', ')}</dd>
        <dt>{t('scriptSkill')}</dt><dd><code>{entry.skill}</code></dd>
        <dt>{t('scriptPath')}</dt><dd><code>{entry.path}</code></dd>
        <dt>{t('scriptParameters')}</dt><dd><ul>{entry.parameters.map(parameter => <li key={parameter.flag}>
          <code>{parameter.flag}</code> {t(parameter.required ? 'scriptRequired' : 'scriptOptional')}
          {' · '}{t(parameterLabels[parameter.flag])}
        </li>)}</ul></dd>
        <dt>{t('scriptExample')}</dt><dd><pre>{entry.example}</pre></dd>
        <dt>{t('scriptOutputs')}</dt><dd>{t(entry.category === 'dynamic' ? 'scriptDynamicOutput' : 'scriptOfflineOutput')}</dd>
        <dt>{t('scriptLimitations')}</dt><dd>{t(entry.category === 'dynamic' ? 'scriptDynamicLimits' : 'scriptOfflineLimits')}</dd>
      </dl>
    </details>)}
  </div>
}
