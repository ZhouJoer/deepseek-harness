# 安全工作台

[English](security-workbench.md) | 中文

实验性[安全领域服务](../../packages/experimental/security-analysis/README.zh.md)管理项目、实测资产、检查依赖、明确的 Session 角色和不可变计划授权。分析与环境 provider 注册能力；工具和生成的 Remote 方法共用领域控制器。

## 持久化记录

`ToolboxDirectory` 包含已配置的环境选项和一份实测 `ToolboxInventory`。其中的 `ToolboxTool` 条目分别描述可用性、调用方式和可选 provider 集成。这些只读观察不属于项目证据或执行权限；字段定义见[工具箱类型](../../packages/experimental/security-analysis/src/toolbox-types.ts)。

[记录 schema](../../packages/experimental/security-analysis/src/workbench/model.ts)定义项目、资产、检查、证据、发现、计划、执行和已审核经验。每个命令向 storage-domain 日志追加一个修订，制品字节先于引用发布。Session 日志保留模型可见的工具结果；领域日志负责检查恢复。

## Cordis API 参考

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxsecurityworkbench--securityworkbench"></a>

### `ctx.securityWorkbench` — `SecurityWorkbench`

Optional security profile service; default application compositions remain independent.

```ts cordis-catalog
/**
 * Refine and deduplicate the selected project's notes using a logged model Session.
 * @param agent - authenticated coordinating Session.
 * @returns the committed project view after refinement.
 */
@Remote('refineKnowledge') async refineProjectKnowledge(agent: Agent): Promise<WorkbenchView>

/** Update a project from the authenticated project browser.
 * @param projectId - operator-selected project.
 * @param input - revision-checked management request.
 * @returns complete project list, including removed projects.
 */
@Remote('manageProject') async manageProject(projectId: string, input: string): Promise<string>

/** Attach user-selected materials without granting model access to their live paths.
 * @param agent - authenticated top-level conversation.
 * @param input - material selection and current revision.
 * @returns scope containing immutable imported assets.
 */
@Remote('importMaterials') async importMaterials(agent: Agent, input: string): Promise<WorkbenchView>

/** List persistent projects, including removed projects available for restoration.
 * @returns project identities and objectives. */
@Remote('projects') async projects(): Promise<string>

/** Inspect installed tools without selecting a project or starting an environment.
 * @param environmentId - configured environment; omission selects the first local environment.
 * @returns environment choices and current optional-tool observations.
 */
@Remote('toolboxInventory') async toolboxInventory(environmentId?: string): Promise<ToolboxDirectory>

/** Read editable tool settings independently of a project or conversation.
 * @param environmentId - selected environment.
 * @returns saved values and the revision required for edits.
 */
@Remote('toolboxConfiguration') toolboxConfiguration(environmentId: string): ToolboxConfiguration

/** Probe or save a tool selected by the authenticated operator.
 * @param environmentId - configured local environment.
 * @param input - JSON action, tool ID, executable, argv and observed revision.
 * @returns measured status and committed settings; failed probes never save.
 */
@Remote('configureTool') async configureTool(environmentId: string, input: string): Promise<ToolboxConfigurationResult>

/** Browse files on the Host for an explicit tool-selection gesture.
 * @param environmentId - editable local environment.
 * @param directory - absolute directory; omission opens the environment working directory.
 * @returns bounded file choices; choosing a file does not execute or upload it.
 */
@Remote('toolboxFiles') async toolboxFiles(environmentId: string, directory?: string): Promise<ToolboxFiles>

/** Read a project from the authenticated operator panel.
 * @param projectId - selected project.
 * @returns project records without Session authority. */
@Remote('project') async project(projectId: string): Promise<WorkbenchView>

/** Manage a project laboratory from an explicit operator gesture.
 * @param projectId - owning project.
 * @param action - prepare, start, inspect, stop or reset.
 * @param laboratoryId - existing generation, or empty for prepare.
 * @returns settled project records. */
@Remote('laboratory') async laboratory(projectId: string, action: string, laboratoryId: string): Promise<WorkbenchView>

/** Read a report after reopening its project without a chat Session.
 * @param projectId - owning project.
 * @param reportId - saved report.
 * @param format - Markdown or JSON.
 * @returns complete immutable report text. */
@Remote('report') async report(projectId: string, reportId: string, format: 'markdown' | 'json' | 'findingsMarkdown'): Promise<string>

/** Read selected project state for an authenticated Web session.
 * @param agent - carrier-resolved agent.
 * @returns project state. */
@Remote('view') async view(agent: Agent): Promise<WorkbenchView>

/** Follow the project selected by this Session, including selection during a running turn.
 * @param agent - carrier-resolved agent.
 * @param signal - connection lifetime.
 * @returns initial selection and committed selection changes.
 */
@Remote({ mode: 'stream' }) async *followSessionView(agent: Agent, signal: AbortSignal): AsyncIterable<WorkbenchView>

/**
 * Apply a user-authored command including approval gestures.
 * @param agent - carrier-resolved agent.
 * @param command - JSON command prepared by the workbench.
 * @returns committed project state.
 */
@Remote('command') async command(agent: Agent, command: string): Promise<WorkbenchView>

/** Follow committed activity and research directions for an authenticated operator.
 * @param projectId - selected project.
 * @param signal - subscription cancellation.
 * @returns baseline and project-scoped activity increments.
 */
@Remote({ mode: 'stream' }) async *followActivity(projectId: string, signal: AbortSignal): AsyncIterable<SecurityActivityFrame>

/** Read invocation details within one research direction.
 * @param projectId - selected project.
 * @param checkpointId - direction identity, or empty for unclassified work.
 * @param offset - page position.
 * @param through - initial page cutoff, if continuing.
 * @returns bounded invocation details and continuation.
 */
@Remote('activityDetails') async activityDetails(projectId: string, checkpointId: string, offset: number, through?: number): Promise<SecurityActivityPage>

/**
 * Search material visible to this session.
 * @param agent - carrier-resolved agent.
 * @param query - plain search terms.
 * @param shared - include published local experience.
 * @returns matching committed records and the observed revision.
 */
@Remote('search') async search(agent: Agent, query: string, shared: boolean): Promise<WorkbenchView>

/**
 * List operator-configured environments before project creation.
 * @param agent - authenticated Web session.
 * @returns environment labels, tool identities and registered operations.
 */
@Remote('configuration') async configuration(agent: Agent): Promise<string>

/**
 * Save resources explicitly selected by a user for future tasks in this workspace.
 * @param agent - authenticated Web session identifying the workspace.
 * @param input - JSON containing environmentIds, maxAttempts, and expectedRevision.
 * @returns refreshed configuration; existing project permissions are unchanged.
 */
@Remote('configureWorkspace') async configureWorkspace(agent: Agent, input: string): Promise<string>

/**
 * Inspect or manage one configured environment from an operator gesture.
 * @param agent - authenticated Web session.
 * @param environmentId - exact configured world.
 * @param action - explicit lifecycle action.
 * @returns health details or completion metadata.
 */
@Remote('environment') async environment(agent: Agent, environmentId: string, action: 'inspect' | 'start' | 'stop'): Promise<string>

/**
 * Execute an approved plan from the workbench.
 * @param agent - authenticated coordinating session.
 * @param planId - approved plan.
 * @param operationId - stable execution identity.
 * @param revision - state observed before starting.
 * @returns settled project state.
 */
@Remote('execute') async execute(agent: Agent, planId: string, operationId: string, revision: number): Promise<WorkbenchView>

/**
 * Collect bounded static observations through the same authority as model tools.
 * @param agent - authenticated project session.
 * @param input - serialized analysis operation.
 * @returns the committed project view.
 */
@Remote('observe') async observe(agent: Agent, input: string): Promise<WorkbenchView>

/**
 * Preview an artifact belonging to the selected project.
 * @param agent - authenticated session.
 * @param sha256 - content digest.
 * @returns bounded bytes rendered as text.
 */
@Remote('artifact') async artifact(agent: Agent, sha256: string): Promise<string>

/** Read coordinator references without changing project or Session state.
 * @param projectId - existing project identifier.
 * @returns active coordinator IDs, subject to the client's accessible Session directory. */
@Remote('projectSessions') async projectSessions(projectId: string): Promise<SessionId[]>

/** Read project-owned artifact content for the authenticated operator.
 * @param projectId - project whose records establish artifact ownership.
 * @param sha256 - digest of a referenced artifact.
 * @returns digest-verified text with the configured output limit. */
@Remote('projectArtifact') async projectArtifact(projectId: string, sha256: string): Promise<string>
```

Types: [Agent](core.zh.md) · [SessionId](core.zh.md)

Source: [`packages/experimental/security-analysis/src/index.ts`](../../packages/experimental/security-analysis/src/index.ts)
<!-- END GENERATED cordis-surface -->
