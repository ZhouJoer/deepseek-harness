/** Project labels and operator task management. @module */
import { useState } from 'react'
import { ProjectDeletion } from './ProjectDeletion.tsx'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import css from './Workbench.module.css'
/** Operator actions; archive preserves records and purge permanently removes them. */
export type ProjectAction = { kind: 'rename'; title: string } | { kind: 'archive' } | { kind: 'restore' } | { kind: 'purge' }
/** Keep native option labels within the selection control.
 * @param title - complete project name retained in its tooltip.
 * @param id - stable identity distinguishing shortened labels.
 * @returns compact display label. */
export function projectLabel(title: string, id: string): string {
  return title.length <= 48 ? title : title.slice(0, 40) + '… · ' + id.slice(-6)
}
/** Render rename, reversible deletion and permanent deletion confirmation.
 * @param props - selected project and authenticated management action.
 * @returns project controls. */
export function ProjectManagement(props: PropsLocale<typeof NS> & {
  title: string
  archived?: boolean | undefined
  disabled: boolean
  manage(action: ProjectAction): Promise<boolean>
}) {
  const { t } = props
  const [title, setTitle] = useState(props.title)
  return <details className={css.secondaryDetails}><summary>{t('manageProject')}</summary>
    <div className={css.form}><label className={css.field}>{t('projectName')}<input value={title} disabled={props.disabled} onChange={(event) => { setTitle(event.target.value) }} /></label>
      <button disabled={props.disabled || !title.trim() || title.trim() === props.title} onClick={() => void props.manage({ kind: 'rename', title: title.trim() })}>{t('renameProject')}</button>
      {props.archived ? <><p>{t('restoreProjectHint')}</p><button disabled={props.disabled} onClick={() => void props.manage({ kind: 'restore' })}>{t('restoreProject')}</button>
        <ProjectDeletion t={t} title={props.title} disabled={props.disabled} permanent remove={() => props.manage({ kind: 'purge' })} /></>
        : <ProjectDeletion t={t} title={props.title} disabled={props.disabled} remove={() => props.manage({ kind: 'archive' })} />}
    </div>
  </details>
}
