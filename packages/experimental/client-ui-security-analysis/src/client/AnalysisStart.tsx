/** Stage an analysis request before saving materials and submitting the user's objective. @module */
import { useRef, useState } from 'react'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { MaterialPanel, type MaterialSelection } from './MaterialPanel.tsx'
import type { NS } from './locales.ts'
import css from './Workbench.module.css'

/** Task preparation and native conversation submission are separate retry steps. */
export interface AnalysisStartProps extends PropsLocale<typeof NS> {
  disabled: boolean
  environments: { id: string; label: string; kind: string }[]
  limits: { bytes: number; entries: number } | undefined
  prepare(input: {
    operationId: string
    material?: MaterialSelection
    title: string
    objective: string
    environmentId: string
  }): Promise<void>
  send(objective: string): Promise<void>
  started(): void
}

/** Render the material, objective and start flow, retaining a prepared task on send failure.
 * @param props - configured environments and authenticated task actions.
 * @returns analysis entry form. */
export function AnalysisStart(props: AnalysisStartProps) {
  const { t } = props
  const [selection, setSelection] = useState<{ material: MaterialSelection; title: string }>()
  const [objective, setObjective] = useState('')
  const [environment, setEnvironment] = useState<string>()
  const [prepared, setPrepared] = useState(false)
  const [busy, setBusy] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [error, setError] = useState('')
  const attempt = useRef<{ payload: string; operationId: string }>()
  const environmentId = environment ?? props.environments.find(item => item.kind === 'local')?.id ?? ''
  const locked = props.disabled || busy || prepared
  const start = async () => {
    setBusy(true); setError('')
    try {
      if (!prepared) {
        const input = { ...selection, title: selection?.title ?? objective.trim().split('\n').slice(0, 1).join(''),
          objective: objective.trim(), environmentId }
        const payload = JSON.stringify(input)
        if (attempt.current?.payload !== payload) attempt.current = { payload, operationId: randomUUID() }
        await props.prepare({ ...input, operationId: attempt.current.operationId })
        setPrepared(true)
      }
      await props.send(objective.trim())
      props.started()
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  return <section className={css.taskSummary}>
    <h2>{t('newAnalysis')}</h2><p>{t('simpleStartHint')}</p>
    <p className={css.summaryHint}>{t('analysisRecordHint')}</p>
    <label className={css.field}>{t('analysisRequest')}<textarea rows={3} value={objective} disabled={locked}
      placeholder={t('analysisRequestHint')} onChange={(event) => { setObjective(event.target.value) }} /></label>
    {selection ? <p role="status">{t('selectedMaterial')} {selection.title}
      <button disabled={locked} onClick={() => { setSelection(undefined) }}>{t('removeSelection')}</button></p>
      : <MaterialPanel t={t} disabled={locked} limits={props.limits} onBusyChange={setSelecting}
        submit={(material, title) => { setSelection({ material, title }); return Promise.resolve() }} />}

    {props.environments.length === 0 ? !props.disabled && <p role="alert" className={css.error}>{t('noAnalysisEnvironment')}</p> : <>
      <p className={css.summaryHint}>{environmentId
        ? `${t('runOn')} ${props.environments.find(item => item.id === environmentId)?.label ?? environmentId}` : t('chooseAnalysisEnvironment')}</p>
      <details open={!environmentId}><summary>{t('analysisOptions')}</summary>
        <label className={css.field}>{t('environment')}<select value={environmentId} disabled={locked}
          onChange={(event) => { setEnvironment(event.target.value) }}><option value="">{t('notSelected')}</option>
          {props.environments.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      </details></>}
    {prepared && <p>{t('analysisPrepared')}</p>}
    {error && <p role="alert" className={css.error}>{error}</p>}
    <div className={css.taskActions}><button className={css.primaryAction}
      disabled={props.disabled || busy || selecting || !objective.trim() || !props.environments.some(item => item.id === environmentId)}
      onClick={() => void start()}>{t(prepared ? 'retryAnalysis' : 'startAnalysis')}</button></div>
  </section>
}
