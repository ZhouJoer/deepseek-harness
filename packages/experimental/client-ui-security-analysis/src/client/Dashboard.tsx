/** Task-centered security analysis workspace with read-only historical browsing. @module */
import { useEffect, useRef, useState } from 'react'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type { SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DeviceDirectory, WorkbenchView } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import { CaptureControls } from './CaptureControls.tsx'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { ProjectManagement } from './ProjectManagement.tsx'
import { Improvements, type ImprovementActions } from './Improvements.tsx'
import { ProjectDeletion } from './ProjectDeletion.tsx'
import type { ProjectActions } from './project-actions.tsx'
import { ProjectLaboratories } from './ProjectLaboratories.tsx'
import { Toolbox } from './Toolbox.tsx'
import { ActivityTimeline, type ActivityActions } from './ActivityPanel.tsx'
import type { NS } from './locales.ts'
import css from './Dashboard.module.css'
import { useProjectActivity } from './useProjectActivity.ts'
import { InvestigationGraph } from './InvestigationGraph.tsx'
import { TechnicalDetails } from './TechnicalDetails.tsx'
import { EvidencePreview } from './EvidencePreview.tsx'
import { CoveragePanel } from './CoveragePanel.tsx'
import { ReportExportButton } from './ReportExportButton.tsx'
import { HttpWorkbench, type HttpActions } from './HttpWorkbench.tsx'
import { HttpHistory } from './HttpHistory.tsx'
import type { SecurityProjectSummary } from '@deepseek-ai/dsh-experimental-security-analysis/client'

type Project = Extract<WorkbenchView['records'][number], { kind: 'engagement' }>['value']
type Tab = 'graphTitle' | 'overview' | 'activityEntry' | 'assets' | 'findings' | 'evidence' | 'reports' | 'laboratories' | 'improvements' | 'httpTitle'
/** Native Session ownership and project-scoped reads injected by the plugin. */
export interface DashboardActions extends ProjectActions, ActivityActions, ImprovementActions, HttpActions {
  followProjects(this: void, signal: AbortSignal): AsyncIterable<SecurityProjectSummary[]>
  observe(id: SessionId, input: string): Promise<WorkbenchView>
  projectArtifact(projectId: string, hash: string): Promise<string>
  findSession(projectId: string): Promise<SessionId | undefined>
  createSession(workspaceId: WorkspaceId): Promise<SessionId>
  retainSession(id: SessionId): SessionReference
  associateSession(id: SessionId, projectId: string): Promise<void>
  stopProject(id: SessionId): Promise<void>
  resumeProject(id: SessionId): Promise<void>
  createWorkspace(path: string): Promise<WorkspaceId>
}
type Props = DashboardActions & PropsLocale<typeof NS> & PropsRuntime<'main'> & PropsRenderSlots<'security.workbench.session'>
/** Render project facts and explicit analysis actions.
 * @param props - project reads, retained Session lifecycle and framework slots.
 * @returns responsive security dashboard. */
export function Dashboard(props: Props) {
  const { t } = props
  const workspaces = props.useWorkspaces(state => state.items)
  const [projects, setProjects] = useState<Project[]>([])
  const [directory, setDirectory] = useState<SecurityProjectSummary[]>([])
  const [directoryError, setDirectoryError] = useState(false)
  const [directoryEpoch, setDirectoryEpoch] = useState(0)
  const pendingDeletion = useRef('')
  useEffect(() => {
    const controller = new AbortController()
    setDirectoryError(false)
    void (async () => {
      try { for await (const items of props.followProjects(controller.signal)) {
        if (controller.signal.aborted) break
        setDirectory(items)
        if (!pendingDeletion.current) setProjects(items.map(item => item.project))
      } } catch (_error) { if (!controller.signal.aborted) setDirectoryError(true) }
    })()
    return () =>{  controller.abort() }
  }, [props.followProjects, directoryEpoch])
  useEffect(() => props.subscribeReset(() =>{  setDirectoryEpoch(value => value + 1) }), [props.subscribeReset])
  const states = { running: 'taskRunning', stopping: 'taskStopping', stopped: 'taskStopped', interrupted: 'taskInterrupted', approval: 'taskApproval', blocked: 'taskBlocked', idle: 'taskIdle', removed: 'taskRemoved' } as const
  const [selected, setSelected] = useState('')
  const [section, setSection] = useState<'tasks' | 'removed' | 'toolbox' | 'improvements'>('tasks')
  const [tab, setTab] = useState<Tab>('graphTitle')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [evidenceQuery, setEvidenceQuery] = useState('')
  const [evidenceId, setEvidenceId] = useState('')
  const [view, setView] = useState<WorkbenchView>({ revision: 0, records: [] })
  const [captureEnvironments, setCaptureEnvironments] = useState<DeviceDirectory['environments']>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [workspace, setWorkspace] = useState<WorkspaceId>()
  const [path, setPath] = useState('')
  const [sessionId, setSessionId] = useState<SessionId>()
  const [reference, setReference] = useState<SessionReference>()
  const [assistant, setAssistant] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [focusCheckId, setFocusCheckId] = useState<string>()
  const [assistantWidth, setAssistantWidth] = useState(40)
  const [expanded, setExpanded] = useState(false)
  const root = useRef<HTMLElement>(null)
  const drag = useRef<{ x: number; width: number; available: number }>()
  const [missingSession, setMissingSession] = useState(false)
  const [artifact, setArtifact] = useState<{ text: string; size: number; truncated: boolean; binary?: boolean }>()
  const [reportId, setReportId] = useState('')
  const [format, setFormat] = useState<'markdown' | 'json' | 'findingsMarkdown'>('markdown')
  const [report, setReport] = useState('')
  const [readEpoch, setReadEpoch] = useState(0)
  const [reading, setReading] = useState(false)
  const [deleting, setDeleting] = useState('')
  const [deletedProject, setDeletedProject] = useState<Project>()
  const [purgedTitle, setPurgedTitle] = useState('')
  const listHeading = useRef<HTMLHeadingElement>(null)
  const deletedProjects = useRef<Project[]>([])
  const purgeRequests = useRef(new Map<string, string>())
  const generation = useRef(0)
  const readGeneration = useRef(0)
  const refreshGeneration = useRef(0)
  const selectedWorkspace = workspace ?? workspaces[0]?.workspaceId
  const project = view.records.find(item => item.kind === 'engagement')?.value
  const activity = useProjectActivity({ ...props, project: selected, changed: (next) => {
    setView(previous => next.revision >= previous.revision ? next : previous)
  } })
  const findings = view.records.filter(item => item.kind === 'finding')
  const evidence = view.records.filter(item => item.kind === 'evidence')
  const assets = view.records.filter(item => item.kind === 'asset')
  const reports = view.records.filter(item => item.kind === 'report')
  const blocked = view.records.filter(item => item.kind === 'check').filter(item => ['blocked', 'interrupted'].includes(item.value.status))
  const pendingPlans = view.records.filter(item => item.kind === 'plan' && item.value.status === 'draft')
  const chosenEvidence = evidence.find(item => item.value.id === evidenceId)?.value
  const selectedReport = reportId || reports.at(-1)?.value.id || ''
  const perform = async (action: () => Promise<void>) => {
    const current = generation.current
    setBusy(true); setError('')
    try { await action(); return current === generation.current } catch (error) {
      if (current === generation.current) {
        setError(error instanceof Error ? error.message : String(error)); setLoading(false)
      }
      return false
    }
    finally { if (current === generation.current) setBusy(false) }
  }
  const refresh = async () => {
    const current = generation.current
    const request = ++refreshGeneration.current
    const [items, next] = await Promise.all([
      props.projects(), selected ? props.project(selected) : Promise.resolve({ revision: 0, records: [] }),
    ])
    if (current === generation.current && request === refreshGeneration.current) {
      setProjects(JSON.parse(items) as Project[])
      setView(previous => next.revision >= previous.revision ? next : previous)
      setLoading(false); setReadEpoch(value => value + 1)
    }
  }
  useEffect(() => {
    setLoading(true); void perform(refresh)
    return () => { generation.current++; readGeneration.current++ }
  }, [selected])
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { setAssistant(false); setAdvanced(false) } }
    if (assistant || advanced) window.addEventListener('keydown', close)
    return () => { window.removeEventListener('keydown', close) }
  }, [assistant, advanced])
  useEffect(() => props.subscribeReset(() => { readGeneration.current++; void perform(refresh) }), [selected, props.subscribeReset])
  useEffect(() => {
    if (tab !== 'assets') return
    let active = true
    setCaptureEnvironments([])
    void props.deviceDirectory().then((value) => { if (active) setCaptureEnvironments(value.environments) })
      .catch((error: unknown) => { if (active) setError(String(error)) })
    return () => { active = false }
  }, [tab, selected, props.deviceDirectory])
  useEffect(() => {
    if (!sessionId) { setReference(undefined); return }
    let current = true
    const next = props.retainSession(sessionId)
    setReference(next)
    void next.ready.catch((error: unknown) => { if (current) setError(String(error)) })
    return () => { current = false; next.release() }
  }, [sessionId])
  useEffect(() => {
    const current = ++readGeneration.current
    setArtifact(undefined); setReport(''); setReading(false)
    if (!selected || !((tab === 'evidence' && chosenEvidence) || (tab === 'reports' && selectedReport))) return
    setReading(true)
    const pending = tab === 'evidence' && chosenEvidence
      ? (chosenEvidence.http ? Promise.resolve('{}') : props.projectArtifact(selected, chosenEvidence.artifact.sha256)).then((value) => {
        if (current === readGeneration.current) setArtifact(JSON.parse(value) as NonNullable<typeof artifact>)
      })
      : props.report(selected, selectedReport, format).then((value) => { if (current === readGeneration.current) setReport(value) })
    void pending.catch((error: unknown) => { if (current === readGeneration.current) setError(String(error)) })
      .finally(() => { if (current === readGeneration.current) setReading(false) })
    return () => { readGeneration.current++ }
  }, [selected, tab, evidenceId, selectedReport, format, view.revision, readEpoch])
  const navigate = (id = '') => {
    generation.current++; readGeneration.current++
    setSelected(id); setView({ revision: 0, records: [] }); setTab('graphTitle'); setCreating(false)
    setSessionId(undefined); setReference(undefined); setAssistant(false); setAdvanced(false)
    setMissingSession(false); setFocusCheckId(undefined)
    setEvidenceId(''); setEvidenceQuery(''); setReportId(''); setError(''); setBusy(false); setStopping(false)
    setDeleting('')
  }
  const manageDeletion = async (item: Project, revision?: number) => {
    let request = item.archived ? purgeRequests.current.get(item.id) : undefined
    if (!request) {
      const expectedRevision = revision ?? (await props.project(item.id)).revision
      request = JSON.stringify({ operationId: randomUUID(), expectedRevision,
        action: item.archived ? { kind: 'purge' } : { kind: 'archive' } })
      if (item.archived) purgeRequests.current.set(item.id, request)
    }
    try {
      const result = await props.manageProject(item.id, request)
      purgeRequests.current.delete(item.id)
      return result
    } catch (error) {
      if (error instanceof Error && error.message.includes('Security state changed')) purgeRequests.current.delete(item.id)
      throw error
    }
  }
  const removeFromList = (item: Project) => {
    pendingDeletion.current = item.id
    return perform(async () => {
      const current = generation.current
      const items = await manageDeletion(item)
      if (current === generation.current) deletedProjects.current = JSON.parse(items) as Project[]
    }).then((success) => { if (!success) pendingDeletion.current = ''; return success })
  }
  const finishRemoval = (item: Project) => {
    pendingDeletion.current = ''
    setProjects(deletedProjects.current); setDeleting(''); setDeletedProject(item.archived ? undefined : item)
    setPurgedTitle(item.archived ? item.title : ''); listHeading.current?.focus()
  }
  const connect = async (create: boolean, resume = false, showAdvanced = false, showReviews = false,
    checkId?: string, showAssistant = true) => {
    const current = generation.current
    let id = sessionId ?? await props.findSession(selected)
    if (current !== generation.current) return
    if (!id && !create) { setMissingSession(true); return }
    if (!id) {
      if (!selectedWorkspace) { setMissingSession(true); return }
      id = await props.createSession(selectedWorkspace)
      if (current !== generation.current) return
      await props.associateSession(id, selected)
    }
    if (resume) await props.resumeProject(id)
    if (current !== generation.current) return
    setSessionId(id); setAssistant(!resume && !showAdvanced && showAssistant); setAdvanced(showAdvanced); setReviewOpen(showReviews)
    setFocusCheckId(checkId); setMissingSession(false)
    await refresh()
  }
  const visible = projects.filter(item => Boolean(item.archived) === (section === 'removed'))
    .filter(item => (item.title + ' ' + item.objective).toLocaleLowerCase().includes(query.toLocaleLowerCase()))
    .filter(item => status === 'all' || directory.find(entry => entry.project.id === item.id)?.state === status)
  const workspacePicker = <div className={css.workspacePicker}>
    <label>{t('dashboardWorkspace')}<select value={selectedWorkspace ?? ''} disabled={busy || !!sessionId} onChange={(event) => { setWorkspace(event.target.value as WorkspaceId) }}>
      <option value="">{t('notSelected')}</option>{workspaces.map(item => <option key={item.workspaceId} value={item.workspaceId}>{item.title} · {item.path}</option>)}
    </select></label>
    {!workspaces.length && <><p>{t('dashboardNoWorkspace')}</p><label>{t('dashboardWorkspacePath')}<input value={path} onChange={(event) => { setPath(event.target.value) }} /></label>
      <button disabled={busy || !path.trim()} onClick={() => void perform(async () => { setWorkspace(await props.createWorkspace(path.trim())) })}>{t('dashboardAddWorkspace')}</button></>}
  </div>
  return <section ref={root} className={css.root} aria-label={t('title')}>
    <div className={css.main}>
      <header className={css.topbar}><div><span className={css.eyebrow}>{t('dashboardEyebrow')}</span><h1>{t('dashboardTitle')}</h1><p>{t('dashboardSubtitle')}</p></div>
        <div className={css.actions}><button disabled={busy} onClick={() => void perform(refresh)}>{t('refresh')}</button><button className={css.primary} onClick={() => { navigate(); setCreating(true); setSection('tasks') }}>{t('newAnalysis')}</button></div>
      </header>
      <nav className={css.navigation} aria-label={t('dashboardNavigation')}>{(['tasks', 'removed', 'toolbox', 'improvements'] as const).map(key => <button key={key} aria-current={section === key ? 'page' : undefined} onClick={() => { navigate(); setSection(key) }}>{t(key === 'tasks' ? 'dashboardTasks' : key === 'removed' ? 'removedProjects' : key === 'improvements' ? 'evoTitle' : 'toolbox')}</button>)}</nav>
      {directoryError && <p role="status">{t('taskDirectoryUnavailable')}<button onClick={() =>{  setDirectoryEpoch(value => value + 1) }}>{t('dashboardRetry')}</button></p>}
      {error && <div className={css.error} role="alert">{error}<button disabled={busy} onClick={() => void perform(refresh)}>{t('dashboardRetry')}</button></div>}
      {deletedProject && <div className={css.deletionNotice} role="status"><span>{t('deleteProjectDone')} · {deletedProject.title}</span>
        <button disabled={busy} onClick={() => void perform(async () => {
          const snapshot = await props.project(deletedProject.id)
          const items = await props.manageProject(deletedProject.id, JSON.stringify({ operationId: randomUUID(),
            expectedRevision: snapshot.revision, action: { kind: 'restore' } }))
          setProjects(JSON.parse(items) as Project[]); setDeletedProject(undefined)
        })}>{t('deleteProjectUndo')}</button><button onClick={() => { setDeletedProject(undefined) }}>{t('close')}</button></div>}
      {purgedTitle && <div className={css.deletionNotice} role="status"><span>{t('purgeProjectDone')} · {purgedTitle}</span><button onClick={() => { setPurgedTitle('') }}>{t('close')}</button></div>}
      {section === 'improvements' ? <Improvements {...props} tasks={projects} /> : section === 'toolbox' ? <Toolbox {...props} /> : creating ? <>
        <button className={css.back} onClick={() =>{  navigate() }}>{t('dashboardBack')}</button>
        {!sessionId && <section className={css.creation}><h2>{t('newAnalysis')}</h2>{workspacePicker}<button className={css.primary} disabled={busy || !selectedWorkspace} onClick={() => void perform(async () => {
          const current = generation.current
          if (!selectedWorkspace) return
          const id = await props.createSession(selectedWorkspace)
          if (current === generation.current) setSessionId(id)
        })}>{t('dashboardUseWorkspace')}</button></section>}
      </> : !selected ? <>
        <div className={css.stats}>{([['dashboardTotal', projects.length], ['dashboardStopped', projects.filter(item => !item.archived && item.stopped).length], ['dashboardRemoved', projects.filter(item => item.archived).length]] as const).map(([label, count]) => <article key={label}><span>{t(label)}</span><strong>{count}</strong></article>)}</div>
        <section className={css.panel}><div className={css.listHeader}><h2 ref={listHeading} tabIndex={-1}>{t(section === 'removed' ? 'removedProjects' : 'dashboardTasks')} <span>{visible.length}</span></h2><div className={css.filters}><input aria-label={t('dashboardSearch')} placeholder={t('dashboardSearch')} value={query} onChange={(event) => { setQuery(event.target.value) }} /><select aria-label={t('dashboardStatus')} value={status} onChange={(event) => { setStatus(event.target.value) }}><option value="all">{t('dashboardAll')}</option>{Object.entries(states).map(([state, key]) => <option key={state} value={state}>{t(key)}</option>)}</select></div></div>
          {loading ? <p className={css.empty} role="status">{t('dashboardLoading')}</p> : !visible.length ? <div className={css.empty}><span className={css.emptyIcon} aria-hidden="true">◇</span><h3>{t(query || status !== 'all' ? 'dashboardNoResults' : 'dashboardEmpty')}</h3><p>{t(query || status !== 'all' ? 'dashboardFilterHint' : 'dashboardEmptyHint')}</p></div> :
            <div className={css.taskList}>{visible.map(item => <article className={css.taskExit}
              data-deleting={deleting === item.id} key={item.id}
              onAnimationEnd={(event) => { if (event.target === event.currentTarget && deleting === item.id) finishRemoval(item) }}>
              <div className={css.taskClip}><div className={css.taskCard}>
                <button className={css.taskRow} disabled={deleting === item.id} onClick={() => { navigate(item.id) }}><span className={css.taskIcon} aria-hidden="true">◇</span><span className={css.taskText}><strong>{item.title}</strong><span>{item.objective}</span></span><span className={item.stopped ? css.stopped : css.badge}>{directoryError ? t('taskDirectoryUnavailable') : t(states[directory.find(entry => entry.project.id === item.id)?.state ?? (item.stopped ? 'stopped' : 'idle')])}{!!directory.find(entry => entry.project.id === item.id)?.pendingPlanIds.length && <> · {t('taskApproval')}</>}</span><span aria-hidden="true">→</span></button>
                <ProjectDeletion t={t} title={item.title} disabled={busy || !!deleting} permanent={!!item.archived}
                  remove={() => removeFromList(item)} deleted={() => { setDeleting(item.id) }} />
              </div></div>
            </article>)}</div>}
        </section>
      </> : <>
        <button className={css.back} onClick={() =>{  navigate() }}>{t('dashboardBack')}</button>
        {loading && <p role="status">{t('dashboardLoading')}</p>}
        {project && <>
          <header className={css.detailHeader}><div><span className={project.stopped ? css.stopped : css.badge}>{t(states[directory.find(entry => entry.project.id === project.id)?.state ?? (project.stopped ? 'stopped' : 'idle')])}</span><h2 title={project.title}>{project.title}</h2>{project.objective !== project.title && <p title={project.objective}>{project.objective}</p>}</div></header><div className={css.intervention}>
            <button aria-pressed={tab === 'improvements'} onClick={() => { setTab('improvements') }}>{t('evoTitle')}</button>
            {!project.archived && <><button disabled={busy} onClick={() => void perform(() => connect(false, false, true))}>{t('advancedDetails')}</button><button disabled={stopping || project.stopped} onClick={() => {
              const current = generation.current
              setStopping(true)
              void (async () => {
                try { const id = sessionId ?? await props.findSession(selected); if (current !== generation.current) return
                  if (id) { await props.stopProject(id); if (current === generation.current) await refresh() } else setMissingSession(true)
                } catch (error) { if (current === generation.current) setError(String(error)) }
                finally { if (current === generation.current) setStopping(false) }
              })()
            }}>{t(stopping ? 'activityStopping' : 'stop')}</button><button className={css.primary} disabled={busy} onClick={() =>{  if (assistant) setAssistant(false); else void perform(() => connect(false)) }}>{t(assistant ? 'dashboardHideAssistant' : 'dashboardAssistant')}</button></>}
            {!project.archived && <button disabled={busy} onClick={() => void perform(() => connect(false, false, true, true))}>{t('planApprovals')}</button>}
          </div>
          {!project.archived && pendingPlans.length > 0 && <div className={css.notice}>
            <p role="status">{t('pendingPlanHint')} ({pendingPlans.length})</p>
          </div>}
          {project.stopped && !project.archived && <div className={css.notice}><p>{t('dashboardStoppedHint')}</p><button disabled={busy} onClick={() => void perform(() => connect(true, true))}>{t('resume')}</button></div>}
          {missingSession && <div className={css.notice}><p>{t('dashboardMissingSession')}</p>{workspacePicker}<button className={css.primary} disabled={busy || !selectedWorkspace} onClick={() => void perform(() => connect(true, project.stopped))}>{t('dashboardContinue')}</button></div>}
          <nav className={css.detailTabs} aria-label={t('dashboardDetailNavigation')}>{(['graphTitle', 'overview', 'activityEntry', 'assets', 'httpTitle', 'findings', 'evidence', 'reports'] as const).map(key => <button key={key} aria-pressed={tab === key} onClick={() => { setTab(key); setEvidenceId('') }}>{t(key === 'overview' ? 'dashboardOverview' : key === 'assets' ? 'dashboardMaterials' : key)}</button>)}<button aria-pressed={tab === 'laboratories'} onClick={() =>{  setTab('laboratories') }}>{t('laboratories')}</button></nav>
          {tab === 'httpTitle' && <HttpWorkbench key={project.id} {...props} project={selected} session={sessionId} view={view} disabled={project.stopped || !!project.archived} connect={() => void perform(() => connect(false, false, false, false, undefined, false))} changed={setView} />}
          {tab === 'laboratories' && <ProjectLaboratories t={t} view={view} busy={busy} run={async (action, id) => { await perform(async () => { const current = generation.current; const next = await props.laboratory(selected, action, id); if (current === generation.current) setView(next) }) }} />}
          <div hidden={tab !== 'graphTitle'}><button onClick={() => { setTab('overview'); requestAnimationFrame(() => root.current?.querySelector<HTMLElement>('#security-check-coverage')?.focus()) }}>{t('coverageTitle')}</button><InvestigationGraph key={project.id} {...props} httpRead={props} view={view} activity={activity} project={project.id}
            openPlans={() => { void perform(() => connect(false, false, true, true)) }} /></div>
          {tab === 'activityEntry' && <ActivityTimeline key={project.id} {...props} activity={activity} project={project.id} view={view}
            openEvidence={(id) => { setEvidenceId(id); setTab('evidence') }} openFinding={() =>{  setTab('findings') }} openPlans={() => void perform(() => connect(false, false, true, true))}
            changed={(next) =>{  setView(previous => next.revision >= previous.revision ? next : previous) }} />}
          {tab === 'improvements' && <Improvements key={project.id} {...props} projectId={project.id} disabled={project.stopped || !!project.archived} />}
          {tab === 'overview' && <>
            <div className={css.stats}>{([['confirmedFindings', findings.filter(item => item.value.status === 'confirmed').length], ['pendingFindings', findings.filter(item => ['suspected', 'inconclusive'].includes(item.value.status)).length], ['evidence', evidence.length], ['blockedChecks', blocked.length]] as const).map(([label, count]) => <article key={label}><span>{t(label)}</span><strong>{count}</strong></article>)}</div>
            <div className={css.overviewGrid}><section className={css.panel}><h3>{t('findings')}</h3>{findings.length ? findings.slice(0, 5).map(item => <button className={css.summaryRow} key={item.value.id} onClick={() =>{  setTab('findings') }}><strong>{item.value.title}</strong><span className={css.badge}>{t(item.value.status)}</span></button>) : <p className={css.muted}>{t('dashboardNoFindings')}</p>}</section><CoveragePanel t={t} evidence={evidence} coverage={activity.coverage} revision={view.revision} disabled={busy || !!project.archived}
              openCheck={(id) => { void perform(() => connect(false, false, true, false, id)) }}
              openEvidence={(id) => { setTab('evidence'); setEvidenceId(id) }} /></div>
            <div className={css.panel}><ProjectManagement key={project.id + project.title} t={t} title={project.title}
              archived={project.archived} disabled={busy} manage={action => perform(async () => {
                const current = generation.current
                const items = action.kind === 'purge' ? await manageDeletion(project, view.revision)
                  : await props.manageProject(selected,
                    JSON.stringify({ operationId: randomUUID(), expectedRevision: view.revision, action }))
                if (current !== generation.current) return
                if (action.kind === 'archive' || action.kind === 'purge') {
                  setDeletedProject(action.kind === 'archive' ? project : undefined); setPurgedTitle(action.kind === 'purge' ? project.title : '')
                  setProjects(JSON.parse(items) as Project[]); navigate()
                }
                else await refresh()
              })} /></div>
          </>}
          {tab === 'assets' && <section className={css.panel}>{assets.length ? assets.map(item => <article className={css.record} key={item.value.id}>
            <h3>{item.value.label}</h3><span className={css.muted}>{'format' in item.value ? item.value.format : item.value.kind}</span>
            {'artifact' in item.value && <><p>{item.value.artifact.size} {t('dashboardBytes')}</p><TechnicalDetails value={item.value.artifact} t={t} /></>}
            {!('kind' in item.value) && <CaptureControls t={t} disabled={busy || project.stopped || Boolean(project.archived)}
              environments={captureEnvironments.filter(environment => project.environmentIds.includes(environment.id))}
              analyze={async (operation, protocol, environmentId) => { await perform(async () => {
                const current = generation.current
                const id = sessionId ?? await props.findSession(selected)
                if (current !== generation.current) return
                if (!id) { setMissingSession(true); return }
                const next = await props.observe(id, JSON.stringify({ provider: 'packet-capture', operation,
                  assetId: item.value.id, environmentId, parameters: { protocol }, impact: 'observe' }))
                if (current === generation.current) { setView(previous => next.revision >= previous.revision ? next : previous); setTab('evidence'); setEvidenceId('') }
              }) }} />}
          </article>) : <p className={css.empty}>{t('dashboardNoMaterials')}</p>}</section>}
          {tab === 'findings' && <section className={css.panel}>{findings.length ? findings.map(item => <article className={css.record} key={item.value.id}><span className={css.badge}>{t(item.value.status)}</span><h3>{item.value.title}</h3><p>{item.value.explanation}</p><details><summary>{t('advancedDetails')}</summary><p>{item.value.conditions}</p><p>{item.value.review}</p><div className={css.actions}>{item.value.evidenceIds.map(id => <button key={id} onClick={() => { setTab('evidence'); setEvidenceId(id) }}>{evidence.find(entry => entry.value.id === id)?.value.title ?? t('unavailableReference')}</button>)}</div></details></article>) : <p className={css.empty}>{t('dashboardNoFindings')}</p>}</section>}
          {tab === 'evidence' && <section className={css.panel}>{chosenEvidence ? <>
            <button className={css.back} onClick={() =>{  setEvidenceId('') }}>{t('dashboardBackEvidence')}</button><h2>{chosenEvidence.title}</h2><p>{chosenEvidence.summary}</p><dl className={css.metadata}><dt>{t('dashboardSource')}</dt><dd>{chosenEvidence.provider} · {chosenEvidence.operation}</dd><dt>{t('dashboardMethod')}</dt><dd>{chosenEvidence.method ?? t('incomplete')}</dd><dt>{t('dashboardToolVersion')}</dt><dd>{chosenEvidence.toolVersion}</dd></dl>
            {chosenEvidence.failure && <p className={css.error}>{t('failed')}: {chosenEvidence.failure}</p>}{chosenEvidence.cleanup && <p>{t('dashboardCleanup')}: {chosenEvidence.cleanup}</p>}{chosenEvidence.incomplete && <p className={css.notice}>{t('incomplete')}</p>}
            {chosenEvidence.http ? <HttpHistory {...props} project={selected} evidenceId={chosenEvidence.id} revision={view.revision} /> : artifact ? <>{artifact.truncated && <p role="status">{t('dashboardTruncated')}</p>}<>{artifact.binary ? <p>{t('graphBinary')}</p> : <EvidencePreview text={artifact.text} provider={chosenEvidence.provider} t={t} />}</></> : <p role="status">{t(reading ? 'dashboardLoading' : 'dashboardReadFailed')}</p>}
          </> : <><div className={css.listHeader}><h3>{t('evidence')}</h3><input aria-label={t('dashboardEvidenceSearch')} placeholder={t('dashboardEvidenceSearch')} value={evidenceQuery} onChange={(event) => { setEvidenceQuery(event.target.value) }} /></div>{evidence.filter(item => (item.value.title + item.value.summary).toLowerCase().includes(evidenceQuery.toLowerCase())).map(item => <button className={css.evidenceRow} key={item.value.id} onClick={() =>{  setEvidenceId(item.value.id) }}><strong>{item.value.title}</strong><span>{item.value.summary}</span><small>{item.value.provider} · {item.value.method ?? t('incomplete')}</small></button>)}{!evidence.length && <p className={css.empty}>{t('dashboardNoEvidence')}</p>}</>}</section>}
          {tab === 'reports' && <section className={css.panel}>{reports.length ? <><div className={css.listHeader}><label>{t('revision')}<select value={selectedReport} onChange={(event) =>{  setReportId(event.target.value); setFormat('markdown') }}>{reports.map(item => <option value={item.value.id} key={item.value.id}>{t('revision')} {item.value.revision}</option>)}</select></label><select aria-label={t('dashboardReportFormat')} value={format} onChange={(event) =>{  setFormat(event.target.value as typeof format) }}><option value="markdown">{t('markdownReport')}</option><option value="json">{t('jsonReport')}</option>{reports.find(item => item.value.id === selectedReport)?.value.findingsMarkdown && <option value="findingsMarkdown">{t('findingsReport')}</option>}</select><ReportExportButton projectId={selected} reportId={selectedReport} t={t} notify={props.notifyImprovement} /></div><div className={css.report}>{reading ? <p role="status">{t('dashboardLoading')}</p> : format === 'json' ? <pre>{report}</pre> : <MarkdownText text={report} labels={{ code: { copyLabel: t('markdownCopy'), copiedLabel: t('markdownCopied') }, footnotes: t('markdownFootnotes') }} />}</div></> : <p className={css.empty}>{t('dashboardNoReports')}</p>}</section>}
        </>}
      </>}
      {reference && reference.sessionId === sessionId && creating && <props.SessionProvider session={reference}>{props.renderSlot('security.workbench.session', { creating: true, assistantOpen: false, advancedOpen: false, changed: () => void perform(refresh), started: (id) => { setCreating(false); setSelected(id); setAssistant(true) } })}</props.SessionProvider>}
    </div>
    {reference && reference.sessionId === sessionId && !creating && <aside className={css.assistant} data-expanded={expanded}
      style={{ width: `${expanded ? 100 : assistantWidth}%` }} hidden={!assistant && !advanced} aria-label={t('dashboardAssistant')}>
      {!expanded && <div className={css.assistantResize} role="separator" tabIndex={0} aria-orientation="vertical"
        aria-label={t('resizeAssistant')} aria-valuemin={25} aria-valuemax={85} aria-valuenow={assistantWidth}
        onPointerDown={(event) => {
          if (event.button !== 0 || !root.current) return
          event.preventDefault()
          drag.current = { x: event.clientX, width: assistantWidth, available: root.current.getBoundingClientRect().width }
          event.currentTarget.setPointerCapture(event.pointerId)
        }}
        onPointerMove={(event) => {
          if (!drag.current || !event.currentTarget.hasPointerCapture(event.pointerId) || !drag.current.available) return
          const width = drag.current.width + (drag.current.x - event.clientX) / drag.current.available * 100
          setAssistantWidth(Math.min(85, Math.max(25, width)))
        }}
        onPointerUp={(event) => {
          drag.current = undefined
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
        }}
        onPointerCancel={() => { drag.current = undefined }} onLostPointerCapture={() => { drag.current = undefined }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
          event.preventDefault(); setAssistantWidth(value => Math.min(85, Math.max(25, value + (event.key === 'ArrowLeft' ? 5 : -5))))
        }} />}
      <header><strong>{t(reviewOpen && advanced ? 'planApprovals' : advanced ? 'advancedDetails' : 'dashboardAssistant')}</strong>
        <div className={css.actions}><button onClick={() => { setExpanded(value => !value) }}>{t(expanded ? 'restoreAssistant' : 'expandAssistant')}</button>
          <button onClick={() => { setAssistant(false); setAdvanced(false); void perform(refresh) }}>{t('close')}</button></div></header>
      <props.SessionProvider session={reference}>{props.renderSlot('security.workbench.session', { creating: false, assistantOpen: assistant, advancedOpen: advanced, reviewOpen, focusCheckId, changed: () => void perform(refresh), started: () => {} })}</props.SessionProvider></aside>}
  </section>
}
