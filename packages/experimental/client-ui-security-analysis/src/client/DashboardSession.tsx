/** Native Session content owned by the security Dashboard. @module */
import { useEffect, useRef, useState } from 'react'
import type { PropsLocale, PropsRenderFactories, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConversationViewsProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { WorkbenchView, WorkbenchConfiguration } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import { AnalysisStart } from './AnalysisStart.tsx'
import { WorkspaceResources } from './WorkspaceResources.tsx'
import { Workbench, type WorkbenchActions } from './Workbench.tsx'
import type { NS } from './locales.ts'
import css from './Dashboard.module.css'

/** Owner inputs for the workbench's retained Session occurrence. */
export interface DashboardSessionInput {
  creating: boolean
  assistantOpen: boolean
  advancedOpen: boolean
  reviewOpen?: boolean
  focusCheckId?: string | undefined
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
  const [configuration, setConfiguration] = useState<WorkbenchConfiguration>()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const prepared = useRef<WorkbenchView>()
  const priorRunning = useRef(session.running)
  const generation = useRef(0)
  const load = async () => {
    const current = ++generation.current
    setError('')
    try {
      const value = await props.configuration(sessionId)
      if (generation.current === current) setConfiguration(value)
    } catch (error) { if (generation.current === current) setError(String(error)) }
  }
  useEffect(() => {
    setConfiguration(undefined); setSaving(false)
    if (props.creating) void load()
    return () => { generation.current++ }
  }, [sessionId, props.creating])
  useEffect(() => {
    if (priorRunning.current && !session.running) props.changed()
    priorRunning.current = session.running
  }, [session.running])
  const active = conversation.activeTargets.size > 0 || (!session.blank && !session.awaitingFirstTurn) || session.running
  const hero = !active && !session.promptAttempted
  const workspace = configuration?.workspace
  const maxAttempts = workspace?.maxAttempts
  return <>
    {props.creating && <div className={css.creation}>
      {error && <p role="alert">{error}<button onClick={() => void load()}>{t('refresh')}</button></p>}
      {configuration && maxAttempts === undefined && <>
        <p role="alert">{t(workspace ? 'missingAttemptLimit' : 'missingAnalysisWorkspace')}</p>
        {workspace && <WorkspaceResources key={`${workspace.cwd}:${workspace.revision}`}
          t={t} workspace={workspace} environments={configuration.environments} disabled={saving}
          save={async (input) => {
            const current = generation.current
            setSaving(true); setError('')
            try {
              const next = await props.configureWorkspace(sessionId, JSON.stringify(input))
              if (current === generation.current) setConfiguration(next)
            } catch (error) { if (current === generation.current) setError(String(error)) }
            finally { if (current === generation.current) setSaving(false) }
          }} />}
      </>}
      <AnalysisStart t={t} disabled={!configuration || maxAttempts === undefined || saving}
        environments={configuration?.environments ?? []} limits={configuration?.materialLimits}
        prepare={async (input) => {
          if (maxAttempts === undefined) throw new Error(t(workspace ? 'missingAttemptLimit' : 'missingAnalysisWorkspace'))
          const generationAtStart = generation.current
          const current = await props.load(sessionId)
          if (generationAtStart !== generation.current) throw new Error(t('analysisSessionChanged'))
          prepared.current = await props.importMaterials(sessionId, JSON.stringify({
            operationId: input.operationId, expectedRevision: current.revision,
            material: input.material, target: input.target ? { ...input.target,
              environmentId: input.environmentId, label: input.title } : undefined,

            title: input.title, objective: input.objective,
            resources: { environmentIds: [input.environmentId], maxAttempts },
          }))
          if (generationAtStart !== generation.current) throw new Error(t('analysisSessionChanged'))
        }}
        send={objective => props.sendAnalysis(sessionId, objective)}
        started={() => {
          const project = prepared.current?.records.find(item => item.kind === 'engagement')
          if (project) props.started(project.value.id)
        }} />
    </div>}
    {props.advancedOpen && <div className={css.advanced}><Workbench {...props} autoOpen initialTab={props.reviewOpen ? 'planApprovals' : props.focusCheckId ? 'checks' : 'overview'} /></div>}
    <div className={css.conversation} hidden={!props.assistantOpen || props.creating}>
      {props.renderFactorySlot('conversation.content', { variant: 'embedded', phase: hero ? 'hero' : 'active', hero }, { slots: { views: ChatView } })}
    </div>
  </>
}
