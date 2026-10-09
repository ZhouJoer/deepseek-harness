/** Readable investigation graph and accessible list over the same committed records. @module */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Graph, layout } from '@dagrejs/dagre'
import { ReactFlow, ReactFlowProvider, Background, Handle, Position, MarkerType, useReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkbenchView } from '@deepseek-ai/dsh-experimental-security-analysis/client'
import type { ActivityActions } from './ActivityPanel.tsx'
import type { ProjectActivity } from './useProjectActivity.ts'
import { investigation, visibleInvestigation, type InvestigationNode } from './investigation.ts'
import { TechnicalDetails } from './TechnicalDetails.tsx'
import { EvidencePreview } from './EvidencePreview.tsx'
import { HttpHistory, type HttpReadActions } from './HttpHistory.tsx'
import type { NS, SecurityKey } from './locales.ts'
import css from './InvestigationGraph.module.css'

type ArtifactPreview = { text: string; truncated: boolean; binary?: boolean }
type Props = PropsLocale<typeof NS> & Pick<ActivityActions, 'openChild'> & {
  view: WorkbenchView
  activity: ProjectActivity
  project: string
  projectArtifact(project: string, hash: string): Promise<string>
  openPlans(this: void): void
  httpRead?: HttpReadActions
}
const kinds: Record<InvestigationNode['record']['kind'], SecurityKey> = {
  asset: 'graphMaterial', check: 'graphCheck', checkpoint: 'graphDirection', delegation: 'graphDelegation',
  evidence: 'graphEvidence', finding: 'graphFinding', plan: 'graphPlan', review: 'graphReview',
}
type CardNode = Node<{ title: string; summary: string; kind: string; state: string; attention: boolean; select: () => void }, 'investigation'>
function Card({ data }: NodeProps<CardNode>) {
  return <><Handle type="target" position={Position.Left} /><button className={css.card} data-attention={data.attention}
    onClick={data.select} aria-label={`${data.kind}: ${data.title}`}>
    <span className={css.kind}>{data.kind}</span><strong>{data.title}</strong><span className={css.summary}>{data.summary}</span>
    {data.state && <span className={css.state}>{data.state}</span>}
  </button><Handle type="source" position={Position.Right} /></>
}
const nodeTypes = { investigation: Card }
function positions(topology: string) {
  const input = JSON.parse(topology) as { ids: string[]; edges: { source: string; target: string }[] }
  const graph = new Graph().setGraph({ rankdir: 'LR', nodesep: 28, ranksep: 90 }).setDefaultEdgeLabel(() => ({}))
  for (const id of input.ids) graph.setNode(id, { width: 240, height: 150 })
  for (const edge of input.edges) graph.setEdge(edge.source, edge.target)
  layout(graph)
  return new Map(input.ids.map((id) => {
    const node = graph.node(id) as { x: number; y: number }
    return [id, { x: node.x - 120, y: node.y - 75 }]
  }))
}
type CanvasProps = PropsLocale<typeof NS> & {
  navigation: string
  nodes: CardNode[]
  edges: Edge[]
}
function Canvas(props: CanvasProps) {
  const flow = useReactFlow<CardNode>()
  useEffect(() => {
    const frame = requestAnimationFrame(() => { void flow.fitView({ padding: .15 }) })
    return () => { cancelAnimationFrame(frame) }
  }, [props.navigation])
  return <div className={css.canvas}>
    <ReactFlow<CardNode> nodes={props.nodes} edges={props.edges} nodeTypes={nodeTypes} nodesDraggable={false}
      nodesConnectable={false} nodesFocusable={false} edgesFocusable={false} deleteKeyCode={null} fitView minZoom={0.15} maxZoom={1.5}
      defaultEdgeOptions={{ markerEnd: { type: MarkerType.ArrowClosed } }}
      onlyRenderVisibleElements aria-label={props.t('graphTitle')}>
      <Background />
    </ReactFlow>
    <div className={css.zoom}>
      <button onClick={() => void flow.zoomIn()} aria-label={props.t('graphZoomIn')}>+</button>
      <button onClick={() => void flow.zoomOut()} aria-label={props.t('graphZoomOut')}>−</button>
      <button onClick={() => void flow.fitView({ padding: .15 })}>{props.t('graphFit')}</button>
    </div>
  </div>
}

/** Browse actual relationships without changing the investigation or execution state.
 * @param props - project snapshot, shared activity and explicit detail navigation.
 * @returns graph/list controls and a readable selected-record inspector.
 */
export function InvestigationGraph(props: Props) {
  const { t } = props
  const graph = useMemo(() => {
    const value = investigation(props.view)
    for (const node of value.nodes) {
      if (node.record.kind !== 'checkpoint') continue
      const brief = props.activity.briefs.find(item => item.checkpointId === node.record.value.id)
      if (brief && brief.updatedAt > node.record.value.updatedAt) node.summary = brief.text
      node.running = props.activity.usage.some(item => item.checkpointId === node.record.value.id && item.running > 0)
      if (node.running) node.state = 'running'
    }
    return value
  }, [props.view, props.activity.briefs, props.activity.usage])
  const [selected, setSelected] = useState('')
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')
  const [expanded, setExpanded] = useState(false)
  const [focus, setFocus] = useState('')
  const [mode, setMode] = useState(() => typeof matchMedia === 'function' && matchMedia('(max-width: 800px)').matches ? 'list' : 'graph')
  const [preview, setPreview] = useState<ArtifactPreview>()
  const [error, setError] = useState('')
  const [reading, setReading] = useState(false)
  const [retry, setRetry] = useState(0)
  const chosen = graph.nodes.find(node => node.id === selected)
  const evidence = chosen?.record.kind === 'evidence' ? chosen.record.value : undefined
  const inspector = useRef<HTMLElement>(null)
  const select = (id: string) => { setSelected(id) }
  useEffect(() => { if (selected) inspector.current?.focus({ preventScroll: true }) }, [selected])
  useEffect(() => {
    let active = true
    setPreview(undefined); setError(''); setReading(Boolean(evidence && !evidence.http))
    if (evidence && !evidence.http) void props.projectArtifact(props.project, evidence.artifact.sha256).then((value) => {
      if (active) setPreview(JSON.parse(value) as ArtifactPreview)
    }).catch((_error: unknown) => { if (active) setError(t('dashboardReadFailed')) })
      .finally(() => { if (active) setReading(false) })
    return () => { active = false }
  }, [props.project, evidence?.artifact.sha256, retry])
  const shown = visibleInvestigation(graph, expanded || Boolean(query) || focus.startsWith('evidence:'))
  const branch = new Set<string>(focus ? [focus] : shown.nodes.map(node => node.id))
  if (focus) {
    const queue = [focus]
    for (const id of queue) for (const edge of shown.edges) {
      if (edge.source === id && !branch.has(edge.target)) { branch.add(edge.target); queue.push(edge.target) }
    }
  }
  const visible = shown.nodes.filter(node => branch.has(node.id)
    && (filter === 'all' || (filter === 'running' ? node.running : node.attention))
    && `${node.title} ${node.summary}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  const visibleIds = new Set(visible.map(node => node.id))
  const edges = shown.edges.filter(edge => visibleIds.has(edge.source) && visibleIds.has(edge.target))
  const topology = JSON.stringify({ ids: visible.map(node => node.id), edges: edges.map(({ source, target }) => ({ source, target })) })
  const placed = useMemo(() => positions(topology), [topology])
  const title = (node: InvestigationNode) => node.title || t('unavailableReference')
  const nodes: CardNode[] = visible.map((node) => {
    const position = placed.get(node.id)
    if (!position) throw new Error('Missing investigation node layout')
    return { id: node.id, type: 'investigation', position,
      selected: selected === node.id, data: { title: title(node), summary: node.summary, kind: t(kinds[node.record.kind]),
        state: node.state ? t(node.state) : !graph.edges.some(edge => edge.source === node.id || edge.target === node.id) ? t('graphUnlinked') : '',
        attention: node.attention, select: () => { select(node.id) } } }
  })
  const adjacent = chosen ? graph.edges.filter(edge => edge.source === chosen.id || edge.target === chosen.id) : []
  const related = adjacent.flatMap((edge) => {
    const node = graph.nodes.find(node => node.id === (edge.source === selected ? edge.target : edge.source))
    return node ? [{ edge, node }] : []
  })
  return <section className={css.root} aria-label={t('graphTitle')}>
    <header className={css.toolbar}>
      <div className={css.modes}><button aria-pressed={mode === 'graph'} onClick={() =>{  setMode('graph') }}>{t('graphTitle')}</button>
        <button aria-pressed={mode === 'list'} onClick={() =>{  setMode('list') }}>{t('graphList')}</button></div>
      <input type="search" aria-label={t('graphSearch')} placeholder={t('graphSearch')} value={query} onChange={(event) =>{  setQuery(event.target.value) }} />
      <select aria-label={t('graphFilter')} value={filter} onChange={(event) =>{  setFilter(event.target.value) }}>
        <option value="all">{t('toolAll')}</option><option value="running">{t('running')}</option><option value="attention">{t('graphAttention')}</option>
      </select>
      <button aria-pressed={expanded} onClick={() =>{  setExpanded(value => !value) }}>{t(expanded ? 'graphFold' : 'graphExpand')}</button>
      {focus && <button onClick={() =>{  setFocus('') }}>{t('graphAllBranches')}</button>}
      <span role="status">{t(props.activity.connected ? 'activityLive' : 'activityDisconnected')}</span>
      {!props.activity.connected && <button onClick={props.activity.retry}>{t('dashboardRetry')}</button>}
    </header>
    {props.activity.error && <p role="alert">{t('graphConnectionFailed')}</p>}
    <div className={css.workspace}>
      <div className={css.visual}>
        {!visible.length ? <p className={css.empty}>{t(graph.nodes.length ? 'graphNoMatches' : 'graphEmpty')}</p>
          : mode === 'graph' ? <ReactFlowProvider><Canvas navigation={JSON.stringify([query, filter, focus, expanded])} nodes={nodes} edges={edges.map(edge => ({ ...edge,
            ariaLabel: `${graph.nodes.find(node => node.id === edge.source)?.title || t('unavailableReference')} · ${t(edge.relation)} · ${graph.nodes.find(node => node.id === edge.target)?.title || t('unavailableReference')}`,
            style: edge.relation === 'graphOpposes' ? { stroke: 'var(--dsw-alias-state-error-primary)', strokeDasharray: '5 4' } : {},
            label: edge.source === selected || edge.target === selected || edge.relation === 'graphOpposes' ? t(edge.relation) : undefined }))} t={t} /></ReactFlowProvider>
            : <div className={css.list}>{visible.map(node => <button key={node.id} aria-pressed={selected === node.id}
              onClick={() => { select(node.id) }}>
              <span className={css.kind}>{t(kinds[node.record.kind])}{node.state && <> · {t(node.state)}</>}</span>
              <strong>{title(node)}</strong><span>{node.summary}</span>
              {!graph.edges.some(edge => edge.source === node.id || edge.target === node.id) && <small>{t('graphUnlinked')}</small>}
            </button>)}</div>}
      </div>
      {chosen && <aside ref={inspector} tabIndex={-1} className={css.inspector} aria-label={t('graphDetails')}
        onKeyDown={(event) => { if (event.key === 'Escape') { setSelected(''); event.stopPropagation() } }}>
        <header><span className={css.kind}>{t(kinds[chosen.record.kind])}</span><button onClick={() =>{  setSelected('') }}>{t('close')}</button></header>
        <h3>{title(chosen)}</h3>{chosen.state && <p className={css.state}>{t(chosen.state)}</p>}
        <h4>{t('graphResult')}</h4><p>{chosen.summary || t('activityNoConclusion')}</p>
        {chosen.record.kind === 'checkpoint' && <><h4>{t('activityNext')}</h4><p>{chosen.record.value.next}</p><p>{chosen.record.value.reason}</p></>}
        {chosen.record.kind === 'finding' && <><h4>{t('graphConditions')}</h4><p>{chosen.record.value.conditions}</p></>}
        {chosen.record.kind === 'review' && <><p>{t('graphHistoricalReview')}</p><p>{chosen.record.value.uncertainty}</p></>}
        {chosen.record.kind === 'delegation' && <>
          <p>{chosen.record.value.disposition?.reason}</p><p>{chosen.record.value.report?.uncertainty}</p>
          <h4>{t('activityNext')}</h4>{chosen.record.value.report?.nextSteps.map((step, index) => <p key={index}>{step}</p>)}
          {chosen.record.value.child && <button onClick={() => { if (chosen.record.kind === 'delegation' && chosen.record.value.child) props.openChild(chosen.record.value.child) }}>{t('delegationOpenChild')}</button>}
        </>}
        {chosen.record.kind === 'plan' && <button onClick={props.openPlans}>{t('planApprovals')}</button>}
        {evidence && <>
          <p>{evidence.provider} · {t(evidence.method === 'simulation' ? 'graphSimulation' : evidence.method === 'device' ? 'graphDevice' : evidence.method === 'static' ? 'graphStatic' : 'graphMethodUnknown')}</p>
          {evidence.failure && <p role="alert">{evidence.failure}</p>}{evidence.incomplete && <p>{t('incomplete')}</p>}
          {evidence.cleanup && <p>{t('dashboardCleanup')}: {evidence.cleanup}</p>}
          {reading && <div role="status" aria-label={t('dashboardLoading')} className={css.loading} />}
          {error && <p role="alert">{error} <button onClick={() =>{  setRetry(value => value + 1) }}>{t('dashboardRetry')}</button></p>}
          {evidence.http && props.httpRead && <HttpHistory {...props.httpRead} t={t} project={props.project}
            evidenceId={evidence.id} revision={props.view.revision} />}
          {preview && <>{preview.truncated && <p>{t('dashboardTruncated')}</p>}{preview.binary ? <p>{t('graphBinary')}</p>
            : <EvidencePreview text={preview.text} provider={evidence.provider} t={t} />}</>}
        </>}
        <h4>{t('graphRelated')}</h4>
        {!related.length && <p>{t('graphUnlinked')}</p>}
        {related.map(({ edge, node }) => <button className={css.reference} key={edge.id} onClick={() =>{  select(node.id) }}>
          <small>{t(edge.source === selected ? 'graphOutgoing' : 'graphIncoming')} · {t(edge.relation)}</small><span>{title(node)}</span></button>)}
        {!!graph.missing.get(chosen.id) && <p>{t('unavailableReference')}</p>}
        <button onClick={() => { setFocus(chosen.id); setQuery(''); setFilter('all') }}>{t('graphFocus')}</button>
        <TechnicalDetails value={chosen.record.value} t={t} />
      </aside>}
    </div>
  </section>
}
