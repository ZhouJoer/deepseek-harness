/** Inline confirmation for reversible and permanent task deletion. @module */
import { useRef, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'
import css from './ProjectDeletion.module.css'

/** Confirm a task deletion and keep failed requests available for retry.
 * @param props - task label and revision-checked deletion returning whether it succeeded.
 * @returns localized confirmation with keyboard focus restoration. */
export function ProjectDeletion(props: PropsLocale<typeof NS> & {
  title: string
  disabled: boolean
  remove(): Promise<boolean>
  deleted?(): void
  permanent?: boolean
}) {
  const { t } = props
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const cancel = () => { setOpen(false); trigger.current?.focus() }
  const confirmation = props.permanent ? 'purgeProjectConfirm' : 'deleteProjectConfirm'
  return <div className={css.root}>
    <button ref={trigger} className={css.danger} disabled={props.disabled || pending} aria-expanded={open}
      onClick={() => { setOpen(value => !value) }}>{t(props.permanent ? 'purgeProject' : 'removeProject')}</button>
    <div className={css.expansion} data-open={open} ref={(node) => { node?.toggleAttribute('inert', !open) }} aria-hidden={!open}>
      <div className={css.clip}><div className={css.confirmation} role="group" aria-label={t(confirmation)}
        aria-busy={pending} onKeyDown={(event) => { if (event.key === 'Escape' && !pending) { event.stopPropagation(); cancel() } }}>
        <strong>{t(confirmation)} · {props.title}</strong><p>{t(props.permanent ? 'purgeProjectHint' : 'removeProjectHint')}</p>
        <div className={css.actions}><button disabled={pending} onClick={cancel}>{t('cancel')}</button>
          <button className={css.danger} disabled={props.disabled || pending} onClick={() => {
            setPending(true)
            void props.remove().then((success) => { if (success) { setOpen(false); props.deleted?.() } })
              .finally(() => { setPending(false) })
          }}>{t(pending ? 'deleteProjectPending' : confirmation)}</button></div>
      </div></div>
    </div>
  </div>
}
