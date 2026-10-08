/** Shared workspace resource settings for security task creation. @module */
import { useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkbenchConfiguration } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import type { NS } from './locales.ts'
import css from './Workbench.module.css'

/** Render environment selection and an explicit attempt allowance.
 * @param props - resolved workspace, available environments and save action.
 * @returns workspace resource form.
 */
export function WorkspaceResources({ workspace, environments, disabled, save, t }: PropsLocale<typeof NS> & {
  workspace: NonNullable<WorkbenchConfiguration['workspace']>
  environments: WorkbenchConfiguration['environments']
  disabled: boolean
  save(this: void, input: { expectedRevision: number; environmentIds: string[]; maxAttempts: number }): Promise<void>
}) {
  const [environmentIds, setEnvironmentIds] = useState(workspace.environmentIds)
  const [attempts, setAttempts] = useState(workspace.maxAttempts === undefined ? '' : String(workspace.maxAttempts))
  const maxAttempts = Number(attempts)
  const unavailable = environmentIds.filter(id => !environments.some(environment => environment.id === id))
  return <div className={css.resourceForm}>
    <fieldset>
      <legend>{t('workspaceResources')}</legend>
      {environments.map(environment => <label key={environment.id} className={css.resourceOption}>
        <input type="checkbox" checked={environmentIds.includes(environment.id)} disabled={disabled}
          onChange={(event) => { setEnvironmentIds(event.target.checked
            ? [...environmentIds, environment.id] : environmentIds.filter(id => id !== environment.id)) }} />
        <span>{environment.label}</span>
      </label>)}
      {unavailable.map(id => <label key={id} className={css.resourceOption}>
        <input type="checkbox" checked disabled={disabled}
          onChange={() => { setEnvironmentIds(environmentIds.filter(selected => selected !== id)) }} />
        <span>{id} · {t('unavailableEnvironment')}</span>
      </label>)}
      {environments.length === 0 && <p>{t('noWorkspaceResources')}</p>}
    </fieldset>
    <details open={workspace.maxAttempts === undefined}>
      <summary>{t('executionLimits')}</summary>
      <label className={css.field}>{t('attemptLimit')}
        <input type="number" min={1} step={1} disabled={disabled} value={attempts}
          onChange={(event) => { setAttempts(event.target.value) }} />
      </label>
    </details>
    <p className={css.summaryHint}>{t('workspaceResourcesHint')}</p>
    <button disabled={disabled || !Number.isSafeInteger(maxAttempts) || maxAttempts < 1}
      onClick={() => void save({ expectedRevision: workspace.revision, environmentIds, maxAttempts })}>
      {t('saveWorkspaceResources')}
    </button>
  </div>
}
