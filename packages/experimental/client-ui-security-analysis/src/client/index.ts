/** Mount the generated security Remote contribution and localized workbench. @module */
import securityRemote from '@deepseek-ai/dsh-experimental-security-analysis/remote'
import type {} from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { ProjectIcon, type ProjectActions } from './project-actions.tsx'
import { SecurityToolRow, securityToolNames } from './SecurityToolRow.tsx'
import type { WorkbenchActions } from './Workbench.tsx'
import { selectCoordinator } from './session-selection.ts'
import { Dashboard, type DashboardActions } from './Dashboard.tsx'
import { ImprovementToast, improvementNotifications } from './Improvements.tsx'
import { ConversationProgressLauncher, ConversationProgressTab, ConversationProgressTitle, type ConversationProgressActions, type ConversationProgressEntryActions } from './ConversationProgress.tsx'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { DashboardSession, type DashboardSessionInput } from './DashboardSession.tsx'
import { randomUUID } from '@deepseek-ai/dsh-util-crypto'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import { NS, zh, en, type SecurityKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Retained coordinator Session hosted within the security task detail. */
    'security.workbench.session': { kind: 'single'; scope: 'session'; owner: DashboardSessionInput }
  }
  interface LocaleNamespaceMap {
    /** Security workbench operator-facing copy. */
    'security-workbench': SecurityKey
  }
}
declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap { securityWorkbench: unknown }
}
/** Services required to mount security RPC and the input dock. */
export const inject = ['remote', 'slots', 'locale', 'sessions', 'layout', 'workspaces', 'uiWorkspace', 'sidebarRight', 'sidebarRightTabs']

async function unwrap<T>(pending: Promise<RemoteResult<T>>): Promise<T> {
  const result = await pending
  if (!result.ok) throw result.error
  return result.value
}
/**
 * Mount the generated namespace before registering its consumer.
 * @param ctx - browser context with Remote, slots and locale.
 * @returns disposer that awaits both UI and Remote teardown.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(securityRemote)
  const ui = ctx.inject(['remote.securityWorkbench', 'slots', 'locale'], (scoped) => {
    scoped.effect(() => scoped.locale.register(NS, { zh, en }))
    for (const key of securityToolNames) scoped.slots.inject('tool.call.toolview', () =>
      scoped.slots.register({ name: 'tool.call.toolview', key, locale: NS }, SecurityToolRow))
    const remote = scoped.remote.securityWorkbench
    const notifications = improvementNotifications()
    scoped.slots.inject('shell.overlay', () => scoped.slots.register({ name: 'shell.overlay', id: 'security-improvements-toast',
      inject: () => ({ notifications }) }, ImprovementToast))
    const projectActions: ProjectActions = {
      deviceDirectory: id => unwrap(remote.deviceDirectory(id)),
      deviceInventory: id => unwrap(remote.deviceInventory(id)),
      toolboxConfiguration: id => unwrap(remote.toolboxConfiguration(id)),
      configureTool: (id, input) => unwrap(remote.configureTool(id, input)),
      toolboxFiles: (id, directory) => unwrap(remote.toolboxFiles(id, directory)),
      toolboxInventory: (id, tools) => unwrap(remote.toolboxInventory(id, tools)),
      toolboxDirectory: id => unwrap(remote.toolboxDirectory(id)),
      toolCatalog: () => unwrap(remote.toolCatalog()),
      scriptCatalog: () => unwrap(remote.scriptCatalog()),
      previewToolPack: input => unwrap(remote.previewToolPack(input)),
      importToolPack: (input, revision, replace) => unwrap(remote.importToolPack(input, revision, replace)),
      exportToolPack: id => unwrap(remote.exportToolPack(id)),
      manageProject: (id, input) => unwrap(remote.manageProject(id, input)),
      projects: () => unwrap(remote.projects()), project: id => unwrap(remote.project(id)),
      laboratory: (project, action, id) => unwrap(remote.laboratory(project, action, id)),
      report: (project, id, format) => unwrap(remote.report(project, id, format)),
      subscribeReset: listener => scoped.on('connection/reset', listener),
    }
    const panel = 'security-projects' as MainPanelId
    scoped.slots.inject('sidebar.panellist', () => scoped.slots.register({ name: 'sidebar.panellist', id: panel, order: 30, label: () => scoped.locale.bind(NS)('title'), locale: NS }, ProjectIcon))
    const actions: WorkbenchActions = {
      openChild: (address) => { scoped.uiWorkspace.openSession(address) },
      toolCatalog: projectActions.toolCatalog,
      toolPreferences: (id, input) => unwrap(remote.toolPreferences(id, input)),
      followActivity: (id, signal) => remote.followActivity(id, signal),
      activityDetails: (id, checkpoint, offset, through) => unwrap(remote.activityDetails(id, checkpoint, offset, through)),
      sendAnalysis: async (id, objective) => {
        const session = scoped.sessions.binding(id)?.session
        if (!session) throw new Error(scoped.locale.bind(NS)('analysisSessionChanged'))
        await unwrap(session.prompt([{ type: 'text', text: objective }], 'queue'))
      },
      manageProject: projectActions.manageProject,
      importMaterials: (id, input) => unwrap(remote.importMaterials(id, input)),
      subscribeReset: projectActions.subscribeReset,
      load: id => unwrap(remote.view(id)),
      observe: (id, input) => unwrap(remote.observe(id, input)),
      refine: id => unwrap(remote.refineKnowledge(id)),
      command: (id, command) => unwrap(remote.command(id, command)),
      configuration: id => unwrap(remote.configuration(id)),
      configureWorkspace: (id, input) => unwrap(remote.configureWorkspace(id, input)),
      environment: (id, environment, action) => unwrap(remote.environment(id, environment, action)),
      execute: (id, plan, operation, revision) => unwrap(remote.execute(id, plan, operation, revision)),
      search: (id, query, shared) => unwrap(remote.search(id, query, shared)),
      artifact: (id, hash) => unwrap(remote.artifact(id, hash)),
      report: projectActions.report,
    }
    const changeProjectState = async (id: SessionId, kind: 'stop' | 'resume') => {
      await scoped.sessions.using(id, { source: 'securityWorkbench' }, async () => {
        const view = await actions.load(id)
        await actions.command(id, JSON.stringify({ operationId: randomUUID(), expectedRevision: view.revision, action: { kind } }))
      })
    }
    const dashboardActions: DashboardActions = {
      followProjects: signal => remote.followProjects(signal),
      httpHistory: (project, input) => unwrap(remote.httpHistory(project, input)),
      httpExchange: (project, evidence, step, part, offset) => unwrap(remote.httpExchange(project, evidence, step, part, offset)),
      httpIdentities: (project, target) => unwrap(remote.httpIdentities(project, target)),
      configureHttpIdentity: (project, target, input) => unwrap(remote.configureHttpIdentity(project, target, input)),
      removeHttpIdentity: (project, target, identity) => unwrap(remote.removeHttpIdentity(project, target, identity)),
      configuration: session => actions.configuration(session),
      command: (session, input) => actions.command(session, input),
      execute: (session, plan, operation, revision) => actions.execute(session, plan, operation, revision),
      observe: (id, input) => scoped.sessions.using(id, { source: 'securityWorkbench' }, () => unwrap(remote.observe(id, input))),
      analyzeImprovements: input => unwrap(remote.analyzeImprovements(input)),
      updateImprovement: input => unwrap(remote.updateImprovement(input)),
      exportImprovement: id => unwrap(remote.exportImprovement(id)),
      followImprovements: signal => remote.followImprovements(signal),
      notifyImprovement: notifications.push,
      ...projectActions,
      openChild: actions.openChild,
      followActivity: actions.followActivity,
      activityDetails: actions.activityDetails,
      projectArtifact: (id, hash) => unwrap(remote.projectArtifact(id, hash)),
      findSession: async (projectId) => {
        const [ids] = await Promise.all([unwrap(remote.projectSessions(projectId)), scoped.sessions.refresh()])
        const directory = scoped.sessions.list.getSnapshot()
        const archived = scoped.workspaces.list.getSnapshot().archivedSessionIds
        return selectCoordinator(ids, directory, archived)
      },
      createSession: workspaceId => scoped.sessions.create({ workspaceId }),
      retainSession: id => scoped.sessions.retain(id, { source: 'securityWorkbench' }),
      associateSession: async (id, projectId) => {
        await scoped.sessions.using(id, { source: 'securityWorkbench' }, async () => {
          const view = await unwrap(remote.project(projectId))
          await unwrap(remote.command(id, JSON.stringify({ operationId: randomUUID(), expectedRevision: view.revision,
            action: { kind: 'select', engagementId: projectId } })))
        })
      },
      stopProject: id => changeProjectState(id, 'stop'),
      resumeProject: id => changeProjectState(id, 'resume'),
      createWorkspace: async path => (await scoped.workspaces.create({ path })).workspaceId,
    }
    scoped.slots.inject('main', () => scoped.slots.register({
      name: 'main', key: panel, locale: NS,
      children: { 'security.workbench.session': { kind: 'single', scope: 'session' } },
      inject: () => dashboardActions,
    }, Dashboard))
    scoped.slots.inject('security.workbench.session', () => scoped.slots.register({
      name: 'security.workbench.session', locale: NS, inject: () => actions,
    }, DashboardSession))
    const progressId = '@deepseek-ai/dsh-experimental-client-ui-security-analysis/progress'
    scoped.effect(() => scoped.sidebarRightTabs.register({ id: progressId, kind: 'security-progress', priority: 'builtin',
      title: () => scoped.locale.bind(NS)('activityEntry'),
      guide: [{ id: 'security-progress', order: 30, title: () => scoped.locale.bind(NS)('activityEntry') }],
    }))
    scoped.slots.inject('sidebar.right.pane.tab', () => scoped.slots.register({
      name: 'sidebar.right.pane.tab', key: progressId, locale: NS,
      inject: (): ConversationProgressActions => {
        return { ...dashboardActions,
          followSessionView: (id, signal) => remote.followSessionView(id, signal),
          openDashboard: () => { scoped.layout.selectPanel(panel) },
        }
      },
    }, ConversationProgressTab))
    scoped.slots.inject('sidebar.right.pane.tab.title', () => scoped.slots.register({
      name: 'sidebar.right.pane.tab.title', key: progressId, locale: NS,
    }, ConversationProgressTitle))
    scoped.slots.inject('conversation.input.dock', () => scoped.slots.register({
      name: 'conversation.input.dock', id: 'security-workbench', order: 30, locale: NS,
      inject: (): ConversationProgressEntryActions => ({ followSessionView: (id, signal) => remote.followSessionView(id, signal),
        followActivity: (id, signal) => actions.followActivity(id, signal), subscribeReset: actions.subscribeReset,
        openProgress: () => { scoped.sidebarRight.openTab('security-progress') },
        openDashboard: () => { scoped.layout.selectPanel(panel) } }),
    }, ConversationProgressLauncher))
  })
  try {
    await ui
  } catch (error) {
    await ui.dispose()
    await disposeRemote()
    throw error
  }
  return async () => {
    await ui.dispose()
    await disposeRemote()
  }
}
