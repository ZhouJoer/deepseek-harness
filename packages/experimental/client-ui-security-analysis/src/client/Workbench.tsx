/** Security project workbench presented inside the existing conversation shell. @module */
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import { useEffect, useRef, useState } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SecurityCommand, WorkbenchView } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import type { NS, SecurityKey } from './locales.ts'
import css from './Workbench.module.css'
import { KnowledgePanel } from './KnowledgePanel.tsx'

/** Service actions injected by the Cordis browser plugin. */
export interface WorkbenchActions {
  /** Re-pull authoritative records after a new connection generation. */
  subscribeReset(this: void, listener: () => void): () => void
  load(sessionId: SessionId): Promise<WorkbenchView>
  refine(sessionId: SessionId): Promise<WorkbenchView>
  command(sessionId: SessionId, command: string): Promise<WorkbenchView>
  configuration(sessionId: SessionId): Promise<string>
  environment(sessionId: SessionId, id: string, action: 'inspect' | 'start' | 'stop'): Promise<string>
  execute(sessionId: SessionId, planId: string, operationId: string, revision: number): Promise<WorkbenchView>
  search(sessionId: SessionId, query: string, shared: boolean): Promise<WorkbenchView>
  artifact(sessionId: SessionId, sha256: string): Promise<string>
}
/** Framework-derived input dock props. */
export type WorkbenchProps = Pick<PropsRuntime<'conversation.input.dock'>, 'sessionId'> &
  PropsLocale<typeof NS> &
  WorkbenchActions
type Tab = 'overview' | 'assets' | 'checks' | 'findings' | 'environments' | 'knowledge' | 'evidence'
interface Configuration {
  knowledgeIntervalMs?: number
  projects?: { id: string; title: string }[]
  environments: { id: string; kind: string; label: string; tools: string[] }[]
  providers: { id: string; operations: string[] }[]
}
const tabKeys: Tab[] = ['overview', 'assets', 'checks', 'findings', 'knowledge', 'evidence', 'environments']
const ids = (text: string): string[] =>
  text
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)

/** Render project facts and explicit operator actions; provider output remains escaped text. */
export function Workbench(props: WorkbenchProps) {
  const { sessionId, t } = props
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('overview')
  const [view, setView] = useState<WorkbenchView>({ revision: 0, records: [] })
  const [configuration, setConfiguration] = useState<Configuration>({ environments: [], providers: [] })
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [detail, setDetail] = useState('')
  const [busy, setBusy] = useState(0)
  const [shared, setShared] = useState(false)
  const [searchResults, setSearchResults] = useState<WorkbenchView | undefined>()
  const generation = useRef(0)
  const activeSession = useRef(sessionId)
  activeSession.current = sessionId
  useEffect(() => {
    generation.current++
    setOpen(false)
    setView({ revision: 0, records: [] })
    setDraft({})
    setError('')
    setDetail('')
    setSearchResults(undefined)
    setTab('overview')
    setShared(false)
  }, [sessionId])
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
      setConfiguration(JSON.parse(config) as Configuration)
    }
  }
  useEffect(() => props.subscribeReset(() => {
    generation.current++
    setView({ revision: 0, records: [] })
    setDetail('')
    setSearchResults(undefined)
    if (open) void perform(load)
  }), [props.subscribeReset, sessionId, open])
  const command = async (action: SecurityCommand['action']) => {
    generation.current++
    const next = await props.command(
      sessionId,
      JSON.stringify({ operationId: randomUUID(), expectedRevision: view.revision, action }),
    )
    if (activeSession.current === sessionId) { setView(next); setSearchResults(undefined) }
  }
  const preview = async (request: Promise<string>) => {
    const detail = await request
    if (activeSession.current === sessionId) setDetail(detail)
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
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </select>
    </label>
  )
  const assets = view.records.filter(item => item.kind === 'asset')
  const checks = view.records.filter(item => item.kind === 'check')
  const project = view.records.find(item => item.kind === 'engagement')
  const statuses = new Set<SecurityKey>([
    'planned',
    'running',
    'completed',
    'blocked',
    'interrupted',
    'skipped',
    'draft',
    'approved',
    'revoked',
    'suspected',
    'confirmed',
    'refuted',
    'inconclusive',
    'failed',
  ])
  return (
    <>
      <div className={css.launcher}>
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
        <span className={css.launchHint}>{t('workflowHint')}</span>
      </div>
      {open && (
        <section className={css.panel} role="dialog" aria-label={t('title')}>
          <header className={css.header}>
            <strong>
              {t('title')}
              {project?.kind === 'engagement' ? ' · ' + project.value.title : ''}
            </strong>
            <button onClick={() => void perform(load)}>{t('refresh')}</button>
            {project?.kind === 'engagement' && (
              <button
                className={css.stop}
                onClick={() => void perform(() => command({ kind: project.value.stopped ? 'resume' : 'stop' }))}
              >
                {t(project.value.stopped ? 'resume' : 'stop')}
              </button>
            )}
            <button
              onClick={() => {
                setOpen(false)
              }}
            >
              {t('close')}
            </button>
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
            </nav>
            <div className={css.main}>
              {error && (
                <p role="alert" className={css.error}>
                  {error}
                </p>
              )}
              {busy > 0 && <p role="status">{t('loading')}</p>}
              <div className={css.body}>
                {tab === 'overview' && (
                  <>
                    <div className={css.form}>
                      {select(
                        'project',
                        (configuration.projects ?? []).map(item => ({ id: item.id, label: item.title })),
                      )}
                      <button
                        disabled={busy > 0 || !draft.project}
                        onClick={() => void perform(() => command({ kind: 'select', engagementId: draft.project ?? '' }))}
                      >
                        {t('selectProject')}
                      </button>
                    </div>
                    {project?.kind === 'engagement' ? (
                      <p>{project.value.objective}</p>
                    ) : (
                      <div className={css.form}>
                        {field('name')}
                        {field('objective', true)}
                        {select(
                          'environment',
                          configuration.environments.map(item => ({ id: item.id, label: item.label })),
                        )}
                        <button
                          disabled={busy > 0}
                          onClick={() =>
                            void perform(() =>
                              command({
                                kind: 'create',
                                title: draft.name ?? '',
                                objective: draft.objective ?? '',
                                environmentIds: [draft.environment ?? ''],
                                maxAttempts: 3,
                              }),
                            )
                          }
                        >
                          {t('create')}
                        </button>
                      </div>
                    )}
                    <div className={css.metrics}>
                      {['recon', 'surface', 'assessment', 'validation'].map(phase => (
                        <article key={phase}>
                          <strong>{t(phase as SecurityKey)}</strong>
                          <p>
                            {
                              checks.filter(item => item.value.phase === phase && item.value.status === 'completed')
                                .length
                            }{' '}
                            / {checks.filter(item => item.value.phase === phase).length}
                          </p>
                        </article>
                      ))}
                    </div>
                  </>
                )}
                {tab === 'assets' && (
                  <>
                    <div className={css.form}>
                      {field('name')}
                      {field('path')}
                      <button
                        disabled={busy > 0 || !project}
                        onClick={() =>
                          void perform(() => command({ kind: 'import', label: draft.name ?? '', path: draft.path ?? '' }))
                        }
                      >
                        {t('import')}
                      </button>
                    </div>
                    {assets.map(item => (
                      <article key={item.value.id} className={css.card}>
                        <strong>{item.value.label}</strong>
                        <p>
                          {item.value.format} · {item.value.identity === 'measured' ? t('measured') : item.value.identity}
                        </p>
                        <code>{item.value.artifact.sha256}</code>
                        <small>{item.value.id}</small>
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
                        <small>{item.value.id}</small>
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
                {tab === 'findings' && (
                  <>
                    <details className={css.form}>
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
                        ['suspected', 'confirmed', 'refuted', 'inconclusive'].map(id => ({
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
                    </details>
                    <details className={css.form}>
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
                        configuration.providers.map(item => ({ id: item.id, label: item.id })),
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
                    </details>
                    {view.records
                      .filter(item => item.kind === 'finding' || item.kind === 'plan')
                      .map(item => (
                        <article key={item.value.id} className={css.card}>
                          <strong>{item.kind === 'finding' ? item.value.title : item.value.hypothesis}</strong>
                          <p>{statuses.has(item.value.status) ? t(item.value.status as SecurityKey) : item.value.status}</p>
                          {item.kind === 'finding' ? (
                            <>
                              <p>{item.value.explanation}</p>
                              <p>{item.value.conditions}</p>
                              <p>{item.value.review}</p>
                            </>
                          ) : (
                            <>
                              <p>{item.value.expectedObservation}</p>
                              <p>{item.value.impact}</p>
                              <p>{item.value.cleanup}</p>
                              <pre>{JSON.stringify(item.value.operation, null, 2)}</pre>
                              <code>{item.value.hash}</code>
                              {item.value.operation.script && (
                                <button
                                  onClick={() =>
                                    void perform(async () => {
                                      const script = item.value.operation.script
                                      if (script) await preview(props.artifact(sessionId, script.sha256))
                                    })
                                  }
                                >
                                  {t('preview')}
                                </button>
                              )}
                              <button
                                disabled={busy > 0 || item.value.status === 'approved'}
                                onClick={() => void perform(() => command({ kind: 'approve', planId: item.value.id }))}
                              >
                                {t('approve')}
                              </button>
                              <button
                                onClick={() => void perform(() => command({ kind: 'revoke', planId: item.value.id }))}
                              >
                                {t('revoke')}
                              </button>
                              <button
                                disabled={busy > 0 || item.value.status !== 'approved'}
                                onClick={() =>
                                  void perform(async () => {
                                    const next = await props.execute(
                                      sessionId,
                                      item.value.id,
                                      randomUUID(),
                                      view.revision,
                                    )
                                    if (activeSession.current === sessionId) { setView(next); setSearchResults(undefined) }
                                  })
                                }
                              >
                                {t('execute')}
                              </button>
                            </>
                          )}
                        </article>
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
                  key={project.value.id} t={t} view={view} busy={busy > 0} intervalMs={configuration.knowledgeIntervalMs ?? 0}
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
                      .filter(item => item.kind === 'evidence' || (item.value.published && item.value.entry && !item.value.supersededBy))
                      .map(item => (
                        <article key={item.value.id} className={css.card}>
                          <strong>{item.value.title}</strong>
                          <small>{item.value.id}</small>
                          {item.kind === 'evidence' ? (
                            <>
                              <p>{item.value.summary}</p>
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
                        </article>
                      ))}
                  </>
                )}
                {detail && <pre className={css.detail}>{detail}</pre>}
              </div>
            </div>
          </div>
        </section>
      )}
    </>
  )
}
