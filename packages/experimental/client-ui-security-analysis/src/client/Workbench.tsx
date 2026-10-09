import { CaptureControls } from './CaptureControls.tsx'
/** Security project workbench presented inside the existing conversation shell. @module */
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { useEffect, useRef, useState } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SecurityCommand, WorkbenchView, WorkbenchConfiguration } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import type { NS, SecurityKey } from './locales.ts'
import css from './Workbench.module.css'
import { ToolPreferences, type ToolPreferenceActions } from './ToolPreferences.tsx'
import { AnalysisStart } from './AnalysisStart.tsx'
import { WorkspaceResources } from './WorkspaceResources.tsx'
import { MaterialPanel } from './MaterialPanel.tsx'
import { ProjectManagement, projectLabel } from './ProjectManagement.tsx'
import { KnowledgePanel } from './KnowledgePanel.tsx'
import { ActivityPanel, type ActivityActions } from './ActivityPanel.tsx'
import { PlanReview } from './PlanReview.tsx'
import { TechnicalDetails } from './TechnicalDetails.tsx'

/** Service actions injected by the Cordis browser plugin. */
export interface WorkbenchActions extends ActivityActions, ToolPreferenceActions {
  sendAnalysis(sessionId: SessionId, objective: string): Promise<void>
  /** Re-pull authoritative records after a new connection generation. */
  subscribeReset(this: void, listener: () => void): () => void
  manageProject(projectId: string, input: string): Promise<string>
  importMaterials(sessionId: SessionId, input: string): Promise<WorkbenchView>
  observe(sessionId: SessionId, input: string): Promise<WorkbenchView>
  load(sessionId: SessionId): Promise<WorkbenchView>
  refine(sessionId: SessionId): Promise<WorkbenchView>
  command(sessionId: SessionId, command: string): Promise<WorkbenchView>
  configuration(sessionId: SessionId): Promise<WorkbenchConfiguration>
  configureWorkspace(sessionId: SessionId, input: string): Promise<WorkbenchConfiguration>
  environment(sessionId: SessionId, id: string, action: 'inspect' | 'start' | 'stop'): Promise<string>
  execute(sessionId: SessionId, planId: string, operationId: string, revision: number): Promise<WorkbenchView>
  search(sessionId: SessionId, query: string, shared: boolean): Promise<WorkbenchView>
  artifact(sessionId: SessionId, sha256: string): Promise<string>
  report(projectId: string, reportId: string, format: 'markdown' | 'json' | 'findingsMarkdown'): Promise<string>
}
/** Framework-derived input dock props. */
export type WorkbenchProps = Pick<PropsRuntime<'conversation.input.dock'>, 'sessionId' | 'useSession'> &
  PropsLocale<typeof NS> &
  WorkbenchActions & { autoOpen?: boolean; initialTab?: 'overview' | 'planApprovals' }
type Tab = 'overview' | 'assets' | 'checks' | 'findings' | 'environments' | 'knowledge' | 'evidence' | 'reviews' | 'reports' | 'planApprovals'
const tabKeys: Tab[] = ['overview', 'findings', 'evidence', 'reports', 'planApprovals']
const advancedTabKeys: Tab[] = ['assets', 'checks', 'environments', 'reviews', 'knowledge']
const ids = (text: string): string[] =>
  text
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)

/** Render project facts and explicit operator actions; provider output remains escaped text. */
export function Workbench(props: WorkbenchProps) {
  const { sessionId, t } = props
  const running = props.useSession(snapshot => snapshot.running)
  const [open, setOpen] = useState(props.autoOpen ?? false)
  const [tab, setTab] = useState<Tab>(props.initialTab ?? 'overview')
  const [view, setView] = useState<WorkbenchView>({ revision: 0, records: [] })
  const [configuration, setConfiguration] = useState<WorkbenchConfiguration>()
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [detail, setDetail] = useState('')
  const [detailFormat, setDetailFormat] = useState<'raw' | 'markdown'>('raw')
  const [busy, setBusy] = useState(0)
  const [shared, setShared] = useState(false)
  const [searchResults, setSearchResults] = useState<WorkbenchView | undefined>()
  const generation = useRef(0)
  const activeSession = useRef(sessionId)
  const priorActivity = useRef({ sessionId, running, open })
  const refreshPending = useRef(false)
  activeSession.current = sessionId
  useEffect(() => {
    generation.current++
    setOpen(props.autoOpen ?? false)
    setView({ revision: 0, records: [] })
    setConfiguration(undefined)
    setDraft({})
    setError('')
    setDetail('')
    setSearchResults(undefined)
    setTab(props.initialTab ?? 'overview')
    setShared(false)
  }, [sessionId])
  useEffect(() => { setTab(props.initialTab ?? 'overview') }, [props.initialTab])
  const perform = async (action: () => Promise<void>) => {
    setBusy(count => count + 1)
    setError('')
    try {
      await action()
    } catch (error) {
      if (activeSession.current === sessionId) setError(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(count => count - 1)
    }
  }
  const load = async () => {
    const current = ++generation.current
    const [next, config] = await Promise.all([props.load(sessionId), props.configuration(sessionId)])
    if (generation.current === current && activeSession.current === sessionId) {
      setView(next)
      setConfiguration(config)
    }
  }
  useEffect(() => { if (props.autoOpen) void perform(load) }, [sessionId, props.autoOpen])
  useEffect(() => {
    const previous = priorActivity.current
    priorActivity.current = { sessionId, running, open }
    if (previous.sessionId !== sessionId || !open) refreshPending.current = false
    else if (previous.open && previous.running && !running) refreshPending.current = true
    if (refreshPending.current && busy === 0) {
      refreshPending.current = false
      void perform(load)
    }
  }, [sessionId, running, open, busy])
  useEffect(() => props.subscribeReset(() => {
    generation.current++
    setView({ revision: 0, records: [] })
    setConfiguration(undefined)
    setDetail('')
    setSearchResults(undefined)
    if (open) void perform(load)
  }), [props.subscribeReset, sessionId, open])
  const command = async (action: SecurityCommand['action']) => {
    const current = ++generation.current
    const next = await props.command(
      sessionId,
      JSON.stringify({ operationId: randomUUID(), expectedRevision: view.revision, action }),
    )
    if (activeSession.current === sessionId && generation.current === current) {
      setView(next)
      setSearchResults(undefined)
      if (action.kind === 'create' || action.kind === 'select' || action.kind === 'leave') {
        setTab('overview')
        setDraft({})
        setDetail('')
      }
    }
  }
  const preview = async (request: Promise<string>, format: 'raw' | 'markdown' = 'raw') => {
    const detail = await request
    if (activeSession.current === sessionId) { setDetail(detail); setDetailFormat(format) }
  }
  const field = (key: SecurityKey, multiline = false) => (
    <label className={css.field}>
      {t(key)}
      {multiline ? (
        <textarea
          value={draft[key] ?? ''}
          onChange={(event) => {
            setDraft(old => ({ ...old, [key]: event.target.value }))
          }}
        />
      ) : (
        <input
          value={draft[key] ?? ''}
          onChange={(event) => {
            setDraft(old => ({ ...old, [key]: event.target.value }))
          }}
        />
      )}
    </label>
  )
  const select = (key: SecurityKey, options: { id: string; label: string }[]) => (
    <label className={css.field}>
      {t(key)}
      <select
        aria-label={t(key)}
        value={draft[key] ?? ''}
        onChange={(event) => {
          setDraft(old => ({ ...old, [key]: event.target.value }))
        }}
      >
        <option value="">{t('notSelected')}</option>
        {options.map(item => (
          <option key={item.id} value={item.id} title={item.label}>
            {projectLabel(item.label, item.id)}
          </option>
        ))}
      </select>
    </label>
  )
  const workspace = configuration?.workspace
  const maxAttempts = workspace?.maxAttempts
  const workspaceControls = workspace && <WorkspaceResources
    key={`${workspace.cwd}:${workspace.revision}`} workspace={workspace} environments={configuration.environments}
    disabled={busy > 0} t={t} save={input => perform(async () => {
      const current = ++generation.current
      const configured = await props.configureWorkspace(sessionId, JSON.stringify(input))
      if (activeSession.current === sessionId && generation.current === current) setConfiguration(configured)
    })} />
  const assets = view.records.filter(item => item.kind === 'asset')
  const checks = view.records.filter(item => item.kind === 'check')
  const project = view.records.find(item => item.kind === 'engagement')
  const findings = view.records.filter(item => item.kind === 'finding')
  const evidence = view.records.filter(item => item.kind === 'evidence')
  const blockedChecks = checks.filter(item => item.value.status === 'blocked' || item.value.status === 'interrupted')
  const childReports = view.records.filter(item => item.kind === 'binding' && item.value.report)
  return (
    <>
      {!props.autoOpen && <div className={css.launcher}>
        <button
          className={css.launchButton}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => {
            setOpen(true)
            void perform(load)
          }}
        >
          {t('title')}
        </button>
        <button className={css.launchButton} aria-haspopup="dialog" onClick={() => {
          setTab('overview'); setOpen(true); void perform(load)
        }}>{t('startWithMaterials')}</button>
        <span className={css.launchHint}>{t('workflowHint')}</span>
      </div>}
      {open && !configuration && (error ? <p role="alert">{error}
        <button disabled={busy > 0} onClick={() => void perform(load)}>{t('refresh')}</button>
      </p> : <progress aria-label={t('dashboardLoading')} />)}
      {open && configuration && (
        <section className={css.panel} data-embedded={props.autoOpen || undefined} role={props.autoOpen ? 'region' : 'dialog'}
          aria-label={t(props.autoOpen ? 'advancedDetails' : 'title')}>
          <header className={css.header}>
            <strong title={project?.kind === 'engagement' ? project.value.title : undefined}>
              {t('title')}
              {project?.kind === 'engagement' ? ' · ' + project.value.title : ''}
            </strong>
            <button disabled={busy > 0} onClick={() => void perform(load)}>{t('refresh')}</button>
            {project?.kind === 'engagement' && (
              <button disabled={busy > 0} onClick={() => void perform(() => command({ kind: 'leave' }))}>{t('leaveProject')}</button>
            )}
            {project?.kind === 'engagement' && (
              <button
                className={css.stop}
                onClick={() => void perform(() => command({ kind: project.value.stopped ? 'resume' : 'stop' }))}
              >
                {t(project.value.stopped ? 'resume' : 'stop')}
              </button>
            )}
            {!props.autoOpen && <button
              onClick={() => {
                setOpen(false)
              }}
            >
              {t('close')}
            </button>}
          </header>
          <div className={css.workspace}>
            <nav className={css.tabs}>
              {tabKeys.map(item => (
                <button
                  key={item}
                  aria-pressed={tab === item}
                  onClick={() => {
                    setTab(item)
                    setDetail('')
                  }}
                >
                  {t(item)}
                </button>
              ))}
              <details className={css.advancedNavigation}>
                <summary>{t('advancedDetails')}</summary>
                {advancedTabKeys.map(item => (
                  <button key={item} aria-pressed={tab === item} onClick={() => {
                    setTab(item)
                    setDetail('')
                  }}>{t(item)}</button>
                ))}
              </details>
            </nav>
            <div className={css.main}>
              {error && (
                <p role="alert" className={css.error}>
                  {error}
                </p>
              )}
              {busy > 0 && <p role="status">{t('loading')}</p>}
              <div className={css.body}>
                {tab !== 'planApprovals' && <ToolPreferences key={sessionId} {...props} />}
                {project && (tab === 'overview' || tab === 'assets') && <MaterialPanel key={sessionId + project.value.id} t={t}
                  disabled={busy > 0 || project.value.stopped}
                  limits={configuration.materialLimits}
                  submit={async (material, title) => {
                    setBusy(count => count + 1)
                    const current = ++generation.current
                    try {
                      const next = await props.importMaterials(sessionId, JSON.stringify({
                        operationId: randomUUID(), expectedRevision: view.revision,
                        material, title, objective: t('materialObjective') }))
                      if (activeSession.current === sessionId && generation.current === current) { setView(next); await load() }
                    } finally { setBusy(count => count - 1) }
                  }} />}
                {tab === 'overview' && assets.length > 0 && <section className={css.card}><h3>{t('addedMaterials')}</h3>
                  <ul>{assets.map(item => <li key={item.value.id}>{item.value.label}</li>)}</ul>
                </section>}
                {tab === 'overview' && project?.kind === 'engagement' && <ProjectManagement key={project.value.id + project.value.title} t={t}
                  title={project.value.title} disabled={busy > 0} manage={async (action) => {
                    let saved = false
                    await perform(async () => {
                      await props.manageProject(project.value.id, JSON.stringify({
                        operationId: randomUUID(), expectedRevision: view.revision, action }))
                      if (activeSession.current === sessionId) { setDraft({}); await load(); saved = true }
                    })
                    return saved
                  }} />}
                {tab === 'overview' && (
                  <>
                    {project?.kind === 'engagement' && <ActivityPanel key={project.value.id} {...props} project={project.value.id} view={view}
                      changed={(next) =>{  setView(previous => next.revision >= previous.revision ? next : previous) }} />}
                    {project?.kind === 'engagement' ? (
                      <>
                        <section className={css.taskSummary}>
                          <span className={css.eyebrow}>{t('objective')}</span>
                          <h2 className={css.objectiveSummary}>{project.value.objective}</h2>
                          <details className={css.objectiveDetails}>
                            <summary>{t('fullObjective')}</summary>
                            <p>{project.value.objective}</p>
                          </details>
                          <p>{t('taskSummaryHint')}</p>
                          <div className={css.taskActions}>
                            <button className={css.primaryAction} disabled={busy > 0} onClick={() => void perform(async () => {
                              await command({ kind: 'report' })
                              if (activeSession.current === sessionId) setTab('reports')
                            })}>{t('generateReport')}</button>
                            <button onClick={() => { setOpen(false) }}>{t('backToConversation')}</button>
                          </div>
                        </section>
                        <div className={css.metrics}>
                          <article><span>{t('confirmedFindings')}</span><strong>{findings.filter(item => item.value.status === 'confirmed').length}</strong></article>
                          <article><span>{t('pendingFindings')}</span><strong>{findings.filter(item => ['suspected', 'inconclusive'].includes(item.value.status)).length}</strong></article>
                          <article><span>{t('savedEvidence')}</span><strong>{evidence.length}</strong></article>
                          <article><span>{t('blockedChecks')}</span><strong>{blockedChecks.length}</strong></article>
                        </div>
                        <section className={css.resultSection}>
                          <div className={css.sectionHeading}><h3>{t('findingSummary')}</h3>
                            <button onClick={() => { setTab('findings') }}>{t('viewFindings')}</button></div>
                          {findings.length === 0 ? <p className={css.summaryHint}>{t('noFindingsYet')}</p>
                            : findings.slice(0, 3).map(item => (
                              <article className={css.card} key={item.value.id}>
                                <div className={css.sectionHeading}>
                                  <strong>{item.value.title}</strong><span>{t(item.value.status)}</span>
                                </div>
                                <p className={css.findingSummary}>{item.value.explanation}</p>
                              </article>
                            ))}
                        </section>
                        {blockedChecks.length > 0 && <section className={css.resultSection}>
                          <div className={css.sectionHeading}><h3>{t('validationLimits')}</h3></div>
                          {blockedChecks.map(item => <article className={css.blockedCard} key={item.value.id}>
                            <strong>{item.value.title}</strong><span>{t(item.value.status)}</span>
                            <p>{item.value.rationale || item.value.criterion}</p>
                          </article>)}
                        </section>}
                        {childReports.length > 0 && <details className={css.secondaryDetails}>
                          <summary>{t('analysisDetails')}</summary>
                          {childReports.map(item => item.kind === 'binding' && item.value.report && (
                            <article className={css.card} key={item.value.sessionId}>
                              <strong>{t('childSummary')} · {item.value.role}</strong><small>{item.value.sessionId}</small>
                              <p>{item.value.report.summary}</p><p>{item.value.report.uncertainty}</p>
                              <p>{item.value.report.evidenceIds.join(', ')}</p>
                            </article>
                          ))}
                        </details>}
                      </>
                    ) : (
                      <>
                        {maxAttempts === undefined && <p role="alert" className={css.error}>{t(workspace ? 'missingAttemptLimit' : 'missingAnalysisWorkspace')}</p>}
                        <AnalysisStart key={sessionId} t={t} disabled={busy > 0 || running || maxAttempts === undefined}
                          limits={configuration.materialLimits} environments={configuration.environments}
                          prepare={async (input) => {
                            if (maxAttempts === undefined) throw new Error(t(workspace ? 'missingAttemptLimit' : 'missingAnalysisWorkspace'))
                            await props.importMaterials(sessionId, JSON.stringify({
                              operationId: input.operationId, expectedRevision: view.revision,
                              material: input.material, title: input.title, objective: input.objective,
                              resources: { environmentIds: [input.environmentId], maxAttempts },
                            }))
                          }}
                          send={async (objective) => {
                            if (activeSession.current !== sessionId) throw new Error(t('analysisSessionChanged'))
                            await props.sendAnalysis(sessionId, objective)
                          }}
                          started={() => { if (activeSession.current === sessionId) setOpen(false) }} />
                        <button onClick={() => { setOpen(false) }}>{t('backToConversation')}</button>
                      </>
                    )}
                    <details className={css.secondaryDetails} open={maxAttempts === undefined}>
                      <summary>{t('manualSetup')}</summary>
                      <p>{t('leftProjectHint')}</p>
                      {workspace && <details open={maxAttempts === undefined}><summary>{t('editWorkspaceResources')}</summary>
                        {workspace.configured && workspace.environmentIds.length === 0 && <p>{t('workspaceIntakeDisabled')}</p>}
                        {workspaceControls}</details>}
                      <div className={css.form}>
                        {select('project', configuration.projects.map(item => ({ id: item.id, label: item.title })))}
                        <button disabled={busy > 0 || !draft.project}
                          onClick={() => void perform(() => command({ kind: 'select', engagementId: draft.project ?? '' }))}>
                          {t('selectProject')}
                        </button>
                      </div>
                      {project?.kind === 'engagement' ? (
                        <button disabled={busy > 0} onClick={() => void perform(() => command({ kind: 'leave' }))}>{t('newProject')}</button>
                      ) : (
                        <div className={css.form}>
                          {field('name')}
                          {field('objective', true)}
                          {select('environment', configuration.environments.map(item => ({ id: item.id, label: item.label })))}
                          <button
                            disabled={busy > 0 || maxAttempts === undefined
                              || !draft.name?.trim() || !draft.objective?.trim() || !draft.environment}
                            onClick={() => void perform(async () => {
                              if (maxAttempts === undefined) throw new Error(t(workspace ? 'missingAttemptLimit' : 'missingAnalysisWorkspace'))
                              await command({
                                kind: 'create', title: draft.name ?? '', objective: draft.objective ?? '',
                                environmentIds: [draft.environment ?? ''], maxAttempts,
                              })
                            })}>{t('create')}</button>
                        </div>
                      )}
                    </details>
                  </>
                )}
                {tab === 'assets' && (
                  <>
                    <div className={css.form}>
                      {select('environment', configuration.environments.map(item => ({ id: item.id, label: item.label })))}
                      {field('webLabel')}
                      {field('pathPrefix')}
                      <button disabled={busy > 0 || !project} onClick={() => void perform(() => command({ kind: 'web-target', environmentId: draft.environment ?? '', label: draft.webLabel ?? '', pathPrefix: draft.pathPrefix || '/' }))}>{t('registerWeb')}</button>
                    </div>
                    {assets.map(item => (
                      <article key={item.value.id} className={css.card}>
                        <strong>{item.value.label}</strong>
                        <p>
                          {'kind' in item.value ? item.value.kind === 'web' ? item.value.origin + item.value.pathPrefix : t('sourceSnapshot') : item.value.format + ' · ' + t('measured')}
                        </p>
                        <TechnicalDetails t={t} value={item.value} />
                        {!('kind' in item.value) && <>
                          <p>{t('captureFileBytes')} {item.value.artifact.size}</p>
                          {configuration.providers.some(provider => provider.id === 'packet-capture') && <CaptureControls t={t}
                            disabled={busy > 0 || project?.kind !== 'engagement' || project.value.stopped}
                            environments={configuration.environments.filter(environment => project?.kind === 'engagement' && project.value.environmentIds.includes(environment.id))}
                            analyze={async (operation, protocol, environmentId) => { await perform(async () => {
                              const next = await props.observe(sessionId, JSON.stringify({ provider: 'packet-capture', operation,
                                assetId: item.value.id, environmentId, parameters: { protocol }, impact: 'observe' }))
                              if (activeSession.current === sessionId) { setView(previous => next.revision >= previous.revision ? next : previous); setTab('evidence') }
                            }) }} />}
                        </>}
                        {'kind' in item.value && item.value.kind === 'source' && (
                          <div className={css.form}>
                            {field('sourcePath')}
                            {field('sourceLine')}
                            {field('sourceQuery')}
                            {(['list', 'read', 'search'] as const).map(operation => (
                              <button key={operation}
                                disabled={busy > 0 || !draft.environment || (operation === 'read' && !draft.sourcePath) || (operation === 'search' && !draft.sourceQuery)}
                                onClick={() => void perform(async () => {
                                  const parameters = operation === 'list' ? {} : operation === 'read'
                                    ? { path: draft.sourcePath, startLine: Number(draft.sourceLine || 1) }
                                    : { query: draft.sourceQuery, ...(draft.sourcePath ? { path: draft.sourcePath } : {}) }
                                  const next = await props.observe(sessionId, JSON.stringify({
                                    provider: 'source', operation, assetId: item.value.id,
                                    environmentId: draft.environment, parameters, impact: 'observe',
                                  }))
                                  if (activeSession.current === sessionId) { setView(next); setTab('evidence') }
                                })}>{t(operation === 'list' ? 'inspectSource' : operation === 'read' ? 'readSource' : 'searchSource')}</button>
                            ))}
                          </div>
                        )}
                        <button
                          disabled={busy > 0}
                          onClick={() => void perform(() => command({ kind: 'template', assetId: item.value.id }))}
                        >
                          {t('template')}
                        </button>
                      </article>
                    ))}
                  </>
                )}
                {tab === 'reviews' && view.records.filter(item => item.kind === 'review').map(item => (
                  <article key={item.value.id} className={css.card}>
                    <strong>{t(item.value.verdict)}</strong>
                    <p>{item.value.explanation}</p><p>{item.value.uncertainty}</p>
                    <p>{findings.find(finding => finding.value.id === item.value.findingId)?.value.title ?? t('unavailableReference')}</p>
                    <p>{t('supportingEvidence')}: {item.value.supportingEvidenceIds.map(id => evidence.find(entry => entry.value.id === id)?.value.title ?? t('unavailableReference')).join(', ')}</p>
                    <p>{t('opposingEvidence')}: {item.value.opposingEvidenceIds.map(id => evidence.find(entry => entry.value.id === id)?.value.title ?? t('unavailableReference')).join(', ')}</p>
                    <TechnicalDetails t={t} value={item.value} />
                    <button disabled={busy > 0} onClick={() => void perform(() => command({ kind: 'conclude', reviewId: item.value.id }))}>{t('applyReview')}</button>
                  </article>
                ))}
                {tab === 'reports' && <>
                  <button disabled={busy > 0 || !project} onClick={() => void perform(() => command({ kind: 'report' }))}>{t('generateReport')}</button>
                  {view.records.filter(item => item.kind === 'report').map(item => <article key={item.value.id} className={css.card}>
                    <strong>{t('revision')} {item.value.revision}</strong>
                    <button onClick={() => void perform(() => preview(props.report(item.value.engagementId, item.value.id, 'markdown'), 'markdown'))}>{t('markdownReport')}</button>
                    {item.value.findingsMarkdown && <button onClick={() => void perform(() => preview(props.report(item.value.engagementId, item.value.id, 'findingsMarkdown'), 'markdown'))}>{t('findingsReport')}</button>}
                    <button onClick={() => void perform(() => preview(props.report(item.value.engagementId, item.value.id, 'json')))}>{t('jsonReport')}</button>
                  </article>)}
                </>}
                {tab === 'checks' && (
                  <>
                    <div className={css.form}>
                      {select(
                        'asset',
                        assets.map(item => ({ id: item.value.id, label: item.value.label })),
                      )}
                      {field('name')}
                      {field('criterion', true)}
                      {select(
                        'phase',
                        ['recon', 'surface', 'assessment', 'validation'].map(id => ({ id, label: t(id as SecurityKey) })),
                      )}
                      {field('dependencies')}
                      <button
                        disabled={busy > 0}
                        onClick={() =>
                          void perform(() =>
                            command({
                              kind: 'check',
                              check: {
                                assetId: draft.asset ?? '',
                                title: draft.name ?? '',
                                phase: (draft.phase ?? 'recon') as 'recon',
                                criterion: draft.criterion ?? '',
                                dependencies: ids(draft.dependencies ?? ''),
                                evidenceIds: [],
                              },
                            }),
                          )
                        }
                      >
                        {t('addCheck')}
                      </button>
                    </div>
                    {checks.map(item => (
                      <article className={css.card} key={item.value.id}>
                        <strong>{item.value.title}</strong>
                        <p>
                          {t(item.value.phase)} · {t(item.value.status)}
                        </p>
                        <p>{item.value.criterion}</p>
                        <p>{item.value.rationale}</p>
                        <TechnicalDetails t={t} value={item.value} />
                        {field('rationale', true)}
                        {field('evidenceIds')}
                        <button
                          disabled={busy > 0}
                          onClick={() =>
                            void perform(() =>
                              command({
                                kind: 'finish',
                                checkId: item.value.id,
                                evidenceIds: ids(draft.evidenceIds ?? ''),
                                rationale: draft.rationale ?? '',
                              }),
                            )
                          }
                        >
                          {t('complete')}
                        </button>
                        {item.value.status === 'completed' && (
                          <button disabled={busy > 0} onClick={() => void perform(() => command({ kind: 'reopen', checkId: item.value.id, rationale: draft.rationale ?? '' }))}>{t('reopen')}</button>
                        )}
                        {['blocked', 'interrupted'].includes(item.value.status) && (
                          <button
                            disabled={busy > 0}
                            onClick={() =>
                              void perform(() =>
                                command({ kind: 'reconcile', checkId: item.value.id, rationale: draft.rationale ?? '' }),
                              )
                            }
                          >
                            {t('reconcile')}
                          </button>
                        )}
                      </article>
                    ))}
                  </>
                )}
                {(tab === 'findings' || tab === 'planApprovals') && (
                  <>
                    {tab === 'planApprovals' && !view.records.some(item => item.kind === 'plan') && <p role="status">{t('noPlansHint')}</p>}
                    {tab === 'findings' && <details className={css.form}>
                      <summary>{t('recordFinding')}</summary>
                      {select(
                        'asset',
                        assets.map(item => ({ id: item.value.id, label: item.value.label })),
                      )}
                      {field('name')}
                      {field('explanation', true)}
                      {field('conditions', true)}
                      {field('review', true)}
                      {field('evidenceIds')}
                      {select(
                        'status',
                        ['suspected', 'inconclusive'].map(id => ({
                          id,
                          label: t(id as SecurityKey),
                        })),
                      )}
                      <button
                        disabled={busy > 0}
                        onClick={() =>
                          void perform(() =>
                            command({
                              kind: 'finding',
                              finding: {
                                assetId: draft.asset ?? '',
                                title: draft.name ?? '',
                                explanation: draft.explanation ?? '',
                                conditions: draft.conditions ?? '',
                                review: draft.review ?? '',
                                status: (draft.status ?? 'suspected') as 'suspected',
                                evidenceIds: ids(draft.evidenceIds ?? ''),
                              },
                            }),
                          )
                        }
                      >
                        {t('recordFinding')}
                      </button>
                    </details>}
                    {tab === 'findings' && <details className={css.form}>
                      <summary>{t('prepare')}</summary>
                      {select(
                        'check',
                        checks.map(item => ({ id: item.value.id, label: item.value.title })),
                      )}
                      {select(
                        'environment',
                        configuration.environments.map(item => ({ id: item.id, label: item.label })),
                      )}
                      {select(
                        'provider',
                        configuration.providers.map(item => ({ id: item.id, label: item.id === 'native' ? t('planNativeRuntime') : item.id === 'offline' ? t('planOfflineRuntime') : item.id })),
                      )}
                      {select(
                        'operation',
                        (configuration.providers.find(item => item.id === draft.provider)?.operations ?? []).map(
                          id => ({ id, label: id }),
                        ),
                      )}
                      {field('parameters', true)}
                      {field('script', true)}
                      {field('hypothesis', true)}
                      {field('expected', true)}
                      {field('impact', true)}
                      {field('cleanup', true)}
                      {field('duration')}
                      <button
                        disabled={busy > 0}
                        onClick={() =>
                          void perform(async () => {
                            const check = checks.find(item => item.value.id === draft.check)
                            if (!check) throw new Error(t('notSelected'))
                            await command({
                              kind: 'plan',
                              checkId: check.value.id,
                              operation: {
                                provider: draft.provider ?? '',
                                operation: draft.operation ?? '',
                                environmentId: draft.environment ?? '',
                                assetId: check.value.assetId,
                                parameters: JSON.parse(draft.parameters || '{}') as Record<string, string>,
                                impact: 'observe',
                              },
                              ...(draft.script ? { script: draft.script } : {}),
                              hypothesis: draft.hypothesis ?? '',
                              expectedObservation: draft.expected ?? '',
                              impact: draft.impact ?? '',
                              cleanup: draft.cleanup ?? '',
                              durationMs: Number(draft.duration),
                            })
                          })
                        }
                      >
                        {t('prepare')}
                      </button>
                    </details>}
                    {view.records
                      .filter(item => item.kind === 'finding' || item.kind === 'plan')
                      .filter(item => tab !== 'planApprovals' || item.kind === 'plan')
                      .map(item => (
                        item.kind === 'finding' ? <article key={item.value.id} className={css.card}>
                          <strong>{item.value.title}</strong>
                          <p>{t(item.value.status)}</p>
                          <p>{item.value.explanation}</p>
                          <p>{item.value.conditions}</p>
                          <p>{item.value.review}</p>
                        </article> : <PlanReview key={item.value.id} t={t} plan={item.value} view={view}
                          environment={configuration.environments.find(env => env.id === item.value.operation.environmentId)?.label
                            ?? item.value.operation.environmentId}
                          busy={busy > 0} disabled={Boolean(project?.value.stopped || project?.value.archived)}
                          approve={() => void perform(() => command({ kind: 'approve', planId: item.value.id }))}
                          revoke={() => void perform(() => command({ kind: 'revoke', planId: item.value.id }))}
                          preview={() => void perform(async () => {
                            const script = item.value.operation.script
                            if (script) await preview(props.artifact(sessionId, script.sha256))
                          })}
                          execute={() => void perform(async () => {
                            const operationId = randomUUID()
                            let next: WorkbenchView
                            try { next = await props.execute(sessionId, item.value.id, operationId, view.revision) }
                            catch (error) {
                              const refreshed = await props.load(sessionId)
                              if (activeSession.current === sessionId) setView(refreshed)
                              const execution = refreshed.records.find(record => record.kind === 'execution' && record.value.id === operationId)
                              if (execution?.kind === 'execution' && ['failed', 'interrupted'].includes(execution.value.status))
                                throw new Error(t('planExecutionFailed'), { cause: error })
                              throw error
                            }
                            if (activeSession.current === sessionId) { setView(next); setSearchResults(undefined) }
                          })} />
                      ))}
                  </>
                )}
                {tab === 'environments' &&
              configuration.environments.map(item => (
                <article key={item.id} className={css.card}>
                  <strong>{item.label}</strong>
                  <p>{item.kind}</p>
                  <p>{item.tools.join(', ')}</p>
                  {(['inspect', 'start', 'stop'] as const).map(action => (
                    <button
                      key={action}
                      disabled={busy > 0}
                      onClick={() =>
                        void perform(async () => {
                          await preview(props.environment(sessionId, item.id, action))
                        })
                      }
                    >
                      {t(action === 'stop' ? 'shutdown' : action)}
                    </button>
                  ))}
                </article>
              ))}
                {tab === 'knowledge' && project?.kind === 'engagement' && <KnowledgePanel
                  key={project.value.id} t={t} view={view} busy={busy > 0} intervalMs={configuration.knowledgeIntervalMs}
                  command={async (action) => {
                    let saved = false
                    await perform(async () => { await command(action); saved = true })
                    return saved
                  }}
                  refine={() => perform(async () => {
                    const current = ++generation.current
                    const next = await props.refine(sessionId)
                    if (generation.current === current && activeSession.current === sessionId) {
                      setView(next)
                      setSearchResults(undefined)
                    }
                  })}
                />}
                {tab === 'knowledge' && !project && <p className={css.emptyState}>{t('notSelected')}</p>}
                {tab === 'evidence' && (
                  <>
                    <div className={css.form}>
                      {field('query')}
                      <label>
                        <input
                          type="checkbox"
                          checked={shared}
                          onChange={(event) => {
                            setShared(event.target.checked)
                          }}
                        />
                        {t('shared')}
                      </label>
                      <button
                        disabled={busy > 0}
                        onClick={() =>
                          void perform(async () => {
                            const result = await props.search(sessionId, draft.query ?? '', shared)
                            if (activeSession.current === sessionId) setSearchResults(result)
                          })
                        }
                      >
                        {t('search')}
                      </button>
                    </div>
                    {(searchResults ?? view).records
                      .filter(item => item.kind === 'evidence' || item.kind === 'knowledge')
                      .filter(item => item.kind === 'evidence' || (item.value.published && item.value.entry && !item.value.supersededBy && !item.value.excluded))
                      .map(item => (
                        <article key={item.value.id} className={css.card}>
                          <strong>{item.value.title}</strong>
                          {item.kind === 'evidence' ? (
                            <>
                              <p>{item.value.summary}</p>
                              {item.value.operation === 'analysis-log' && <p>{t('scriptAnalysisLog')}</p>}
                              {item.value.method && <p>{t(item.value.method === 'static' ? 'staticObservation' : item.value.method === 'simulation' ? 'offlineSimulation' : 'deviceObservation')}</p>}
                              {item.value.failure && <p className={css.error}>{item.value.failure}</p>}
                              {item.value.cleanup && <p>{t('cleanup')}: {item.value.cleanup}</p>}
                              {item.value.incomplete && <p className={css.error}>{t('incomplete')}</p>}
                              <button
                                onClick={() =>
                                  void perform(async () => {
                                    await preview(props.artifact(sessionId, item.value.artifact.sha256))
                                  })
                                }
                              >
                                {t('preview')}
                              </button>
                            </>
                          ) : (
                            <>
                              <p>{item.value.entry?.summary}</p>
                              <p>{item.value.entry?.conditions}</p>

                            </>
                          )}
                          <TechnicalDetails t={t} value={item.value} />
                        </article>
                      ))}
                  </>
                )}
                {detail && (detailFormat === 'markdown' ? <div className={css.report}><MarkdownText text={detail} labels={{ code: { copyLabel: t('markdownCopy'), copiedLabel: t('markdownCopied') }, footnotes: t('markdownFootnotes') }} /></div> : <pre className={css.detail}>{detail}</pre>)}
              </div>
            </div>
          </div>
        </section>
      )}
    </>
  )
}
