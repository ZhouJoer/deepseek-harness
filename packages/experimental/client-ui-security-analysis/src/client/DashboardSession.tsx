/** Native Session content owned by the security Dashboard. @module */
import { useEffect, useRef, useState } from 'react'
import type { PropsLocale, PropsRenderFactories, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConversationViewsProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { WorkbenchView } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import { AnalysisStart } from './AnalysisStart.tsx'
import { Workbench, type WorkbenchActions } from './Workbench.tsx'
import type { NS } from './locales.ts'
import css from './Dashboard.module.css'

/** Owner inputs for the workbench's retained Session occurrence. */
export interface DashboardSessionInput {
  creating: boolean
  assistantOpen: boolean
  advancedOpen: boolean
  changed(): void
  started(projectId: string): void
}
function ChatView(props: ConversationViewsProps) {
  return <>{props.renderSlot('conversation.session', { view: 'chat' })}</>
}
/** Render the creation flow and the native conversation for one retained Session.
 * @param props - Session scope, operator actions and dashboard navigation.
 * @returns creation form or embedded conversation. */
export function DashboardSession(props: PropsRuntime<'security.workbench.session'> & PropsRenderFactories & PropsLocale<typeof NS> & WorkbenchActions) {
  const { t, sessionId } = props
  const session = props.useSession(value => value)
  const conversation = props.useConversation(value => value)
  const [configuration, setConfiguration] = useState<{
    environments: { id: string; label: string; kind: string }[]
    materialLimits?: { bytes: number; entries: number }
    workspace?: { maxAttempts?: number }
  }>()
  const [error, setError] = useState('')
  const prepared = useRef<WorkbenchView>()
  const priorRunning = useRef(session.running)
  const generation = useRef(0)
  const load = async () => {
    const current = ++generation.current
    setError('')
    try {
      const value = JSON.parse(await props.configuration(sessionId)) as NonNullable<typeof configuration>
      if (generation.current === current) setConfiguration(value)
    } catch (error) { if (generation.current === current) setError(String(error)) }
  }
  useEffect(() => { if (props.creating) void load(); return () => { generation.current++ } }, [sessionId, props.creating])
  useEffect(() => {
    if (priorRunning.current && !session.running) props.changed()
    priorRunning.current = session.running
  }, [session.running])
  const active = conversation.activeTargets.size > 0 || (!session.blank && !session.awaitingFirstTurn) || session.running
  const hero = !active && !session.promptAttempted
  return <>
    {props.creating && <div className={css.creation}>
      {error && <p role="alert">{error}<button onClick={() => void load()}>{t('refresh')}</button></p>}
      <AnalysisStart t={t} disabled={!configuration} environments={configuration?.environments ?? []} limits={configuration?.materialLimits}
        prepare={async (input) => {
          const generationAtStart = generation.current
          const current = await props.load(sessionId)
          if (generationAtStart !== generation.current) throw new Error(t('analysisSessionChanged'))
          prepared.current = await props.importMaterials(sessionId, JSON.stringify({
            operationId: input.operationId, expectedRevision: current.revision, material: input.material,
            title: input.title, objective: input.objective,
            resources: { environmentIds: [input.environmentId], maxAttempts: configuration?.workspace?.maxAttempts ?? 3 },
          }))
          if (generationAtStart !== generation.current) throw new Error(t('analysisSessionChanged'))
        }}
        send={objective => props.sendAnalysis(sessionId, objective)}
        started={() => {
          const project = prepared.current?.records.find(item => item.kind === 'engagement')
          if (project) props.started(project.value.id)
        }} />
    </div>}
    {props.advancedOpen && <div className={css.advanced}><Workbench {...props} autoOpen /></div>}
    <div className={css.conversation} hidden={!props.assistantOpen || props.creating}>
      {props.renderFactorySlot('conversation.content', { variant: 'embedded', phase: hero ? 'hero' : 'active', hero }, { slots: { views: ChatView } })}
    </div>
  </>
}
