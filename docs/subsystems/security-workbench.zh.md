# 安全工作台

[English](security-workbench.md) | 中文

实验性[安全领域服务](../../packages/experimental/security-analysis/README.zh.md)管理项目、实测资产、检查依赖、明确的 Session 角色和不可变计划授权。分析与环境 provider 注册能力；工具和生成的 Remote 方法共用领域控制器。

## 持久化记录

`WorkbenchConfiguration` 是 `configuration` 与 `configureWorkspace` 返回的对象，包含材料限制、项目、provider、环境和经验整理间隔。没有工作区时，其 workspace 值为 null；尝试次数在配置前缺省。[配置类型](../../packages/experimental/security-analysis/src/workbench-configuration-types.ts)定义浏览器可用字段。

`ToolboxDirectory` 包含已配置的环境选项和一份实测或显式未检测的 `ToolboxInventory`。其中的 `ToolboxTool` 条目分别描述可用性、调用方式和可选 provider 集成。可用 Docker 工具提供宿主 `command` 和 `prefixArgs`，并在 `installation` 中保留原始容器可执行文件与参数，供配置持久化使用。这些只读观察不属于项目证据或执行权限；字段定义见[工具箱类型](../../packages/experimental/security-analysis/src/toolbox-types.ts)。

`DeviceDirectory` 包含已配置的环境选项和缓存或未检测的 `DeviceInventory`。独立前提检查与 branded `RadioDeviceId` 描述软件、驱动及可见接口；观测时间用于区分保留数据和失败的刷新。这些值仅保存在内存中，不代表抓包权限或无线采集就绪。参见[设备类型](../../packages/experimental/security-analysis/src/device-types.ts)。

[记录 schema](../../packages/experimental/security-analysis/src/workbench/model.ts)定义项目、资产、检查、证据、发现、计划、执行、委派和已审核经验。每个命令向 storage-domain 日志追加一个修订，制品字节先于引用发布。Session 日志保留模型可见的工具结果；领域日志负责检查和委派恢复。`SecurityDelegation` 记录分配的问题、固定的项目和资产范围、执行结果、子报告及协调者处理意见。Jobs 管理运行中的执行；采纳报告不代表确认发现。

`ToolCatalogSnapshot` 保存解析后的工具定义、集合、工具包与导入修订版本。`ToolPackPreview` 在显式导入前列出冲突。`ToolPreferences` 包含活跃会话的软偏好，会记录到模型上下文，但不写入项目持久化记录。导入、检测和生命周期语义见[工具配置](../../packages/experimental/security-analysis/README.zh.md)。

## Cordis API 参考

`EvolutionRun` 描述排队或已结束的独立分析。`EvolutionSource` 标识所属任务及准确 Session 事件或带哈希的领域记录，包含摘录截断信息。`EvolutionProposal` 汇总功能改动、验收场景、任务来源和人工进度。`EvolutionReceipt` 保存外部实施及测试声明；`EvolutionView.revision` 独立于安全命令校验人工写操作。这些浏览器可用值定义于[演进 schema](../../packages/experimental/security-analysis/src/evolution-model.ts)。`security_evolution` 存储域保存其版本化状态，不修改 Session 事件或格式。

`analyzeImprovements` 使用 `operationId` 和 `expectedRevision` 提交项目请求。`improvements` 与 `followImprovements` 返回统一改进池；`updateImprovement` 接受校验修订号的 `status` 或 `receipt` 动作。重用操作标识必须提交相同输入。`exportImprovement` 返回选定编码任务与回执模板。导入回执可标记已修改，但不能标记已验证。这些方法需要操作者 Remote 访问，不是模型工具。

`AnalysisScript` 描述内置分析脚本的稳定 ID、分类、技能、资源路径、依赖、参数和示例。只读清单不要求项目或环境，不触发工具检测，也不授予执行权限。字段定义见[分析脚本类型](../../packages/experimental/security-analysis/src/analysis-script-types.ts)。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxsecurityexternalweb--securityexternalweb"></a>

### `ctx.securityExternalWeb` — `SecurityExternalWeb`

Optional Host owner for external HTTP execution and target credentials.

Source: [`packages/experimental/security-analysis/src/external-web-provider.ts`](../../packages/experimental/security-analysis/src/external-web-provider.ts)

<a id="ctxsecurityworkbench--securityworkbench"></a>

### `ctx.securityWorkbench` — `SecurityWorkbench`

Optional security profile service; default application compositions remain independent.

```ts cordis-catalog
/** Read engineering suggestions without loading an analysis Agent.
 * @param projectId - optional task filter.
 * @returns the independent improvement revision and visible records. */
@Remote('improvements') async improvements(projectId?: string): Promise<EvolutionView>

/** Queue a revision-checked operator request for idle-time improvement analysis.
 * @param input - operation ID, task and observed improvement revision.
 * @returns the saved request and current suggestions. */
@Remote('analyzeImprovements') async analyzeImprovements(input: string): Promise<EvolutionView>

/** Save operator progress or a coding AI's implementation receipt.
 * @param input - revision-checked status or receipt command.
 * @returns current improvement records. */
@Remote('updateImprovement') async updateImprovement(input: string): Promise<EvolutionView>

/** Export a selected source-code improvement for an external coding AI.
 * @param proposalId - operator-selected suggestion.
 * @returns bounded source excerpts and portable implementation files. */
@Remote('exportImprovement') async exportImprovement(proposalId: string): Promise<EvolutionBundle>

/** Follow independent improvement commits without polling.
 * @param signal - authenticated connection lifetime.
 * @returns coalesced current views. */
@Remote({ mode: 'stream' }) async *followImprovements(signal: AbortSignal): AsyncIterable<EvolutionView>

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

/** Follow all task summaries over one disposable subscription.
 * @param signal - connection lifetime.
 * @returns complete lightweight baselines after committed or runtime changes. */
@Remote({ mode: 'stream' }) async *followProjects(signal: AbortSignal): AsyncIterable<SecurityProjectSummary[]>

/** List target authentication descriptions without revealing secret values.
 * @param projectId - owning project.
 * @param targetId - registered external target.
 * @returns configured identities. */
@Remote('httpIdentities') async httpIdentities(projectId: string, targetId: string): Promise<HttpIdentityDescription[]>

/** Save secret input through the authenticated operator connection, outside the journal.
 * @param projectId - owning project.
 * @param targetId - registered external target.
 * @param input - JSON authentication configuration.
 * @returns the new version description, never its values. */
@Remote('configureHttpIdentity') async configureHttpIdentity(projectId: string, targetId: string, input: string): Promise<HttpIdentityDescription>

/** Remove one authentication profile; future execution must prepare a new identity version.
 * @param projectId - owning project.
 * @param targetId - registered external target.
 * @param identityId - profile to remove. */
@Remote('removeHttpIdentity') async removeHttpIdentity(projectId: string, targetId: string, identityId: HttpIdentityId): Promise<void>

/** Read bounded HTTP metadata without loading response bodies.
 * @param projectId - selected project.
 * @param input - JSON filters and pagination offset.
 * @returns linked request history. */
@Remote('httpHistory') async httpHistory(projectId: string, input: string): Promise<HttpHistoryPage>

/** Read one sanitized request or response field by byte window.
 * @param projectId - selected project.
 * @param evidenceId - saved evidence.
 * @param stepId - request step.
 * @param part - request template, headers or body.
 * @param offset - byte offset.
 * @returns bounded field content. */
@Remote('httpExchange') async httpExchange(projectId: string, evidenceId: string, stepId: string, part: 'request' | 'headers' | 'body', offset: number): Promise<HttpExchangePage>

/** Read current definitions without probing installations.
 * @returns the catalog with legacy installation definitions and import revision.
 */
@Remote('toolCatalog') toolCatalog(): ToolCatalogSnapshot

/** Read the bundled script library without selecting a project or probing tools.
 * @returns script parameters, dependencies and installed resource paths.
 */
@Remote('scriptCatalog') scriptCatalog(): AnalysisScript[]

/** Validate an operator-selected pack without executing its commands.
 * @param input - JSON tool pack.
 * @returns import preview and identity conflicts.
 */
@Remote('previewToolPack') previewToolPack(input: string): ToolPackPreview

/** Register a reviewed pack without installing software or running probes.
 * @param input - JSON tool pack.
 * @param revision - preview revision.
 * @param replace - explicit approval of all displayed conflicts.
 * @returns updated definitions.
 */
@Remote('importToolPack') importToolPack(input: string, revision: string, replace: boolean): ToolCatalogSnapshot

/** Export a shareable pack without local paths or measured results.
 * @param id - registered pack identity.
 * @returns formatted versioned JSON.
 */
@Remote('exportToolPack') exportToolPack(id: string): string

/** Read or update soft preferences for the authenticated active session only.
 * @param agent - carrier-resolved session; caller cannot nominate another agent.
 * @param input - optional JSON selection; empty arrays restore automatic discovery.
 * @returns the current session selection.
 */
@Remote('toolPreferences') toolPreferences(agent: Agent, input?: string): ToolPreferences

/** Read unmeasured inventory rows for immediate operator display.
 * @param environmentId - selected environment, defaulting to the first local environment.
 * @returns declared installations, with every observation marked not checked.
 */
@Remote('toolboxDirectory') toolboxDirectory(environmentId?: string): ToolboxDirectory

/** Inspect installed tools without selecting a project or starting an environment.
 * @param environmentId - configured environment; omission selects the first local environment.
 * @param toolIds - selected definitions and their dependencies; omitted checks all.
 * @returns environment choices and current optional-tool observations.
 */
@Remote('toolboxInventory') async toolboxInventory(environmentId?: string, toolIds?: string[]): Promise<ToolboxDirectory>

/** Read the last device inspection without touching hardware or selecting a project.
 * @param environmentId - selected environment; omission selects the first local environment.
 * @returns environment choices and unchecked or previously measured interfaces.
 */
@Remote('deviceDirectory') deviceDirectory(environmentId?: string): DeviceDirectory

/** Explicitly inspect Windows prerequisites; enumeration does not validate radio capture.
 * @param environmentId - configured local environment.
 * @returns settled observations; failed inspections leave the previous directory intact.
 */
@Remote('deviceInventory') async deviceInventory(environmentId?: string): Promise<DeviceDirectory>

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
@Remote('configuration') async configuration(agent: Agent): Promise<WorkbenchConfiguration>

/**
 * Save resources explicitly selected by a user for future tasks in this workspace.
 * @param agent - authenticated Web session identifying the workspace.
 * @param input - JSON containing environmentIds, maxAttempts, and expectedRevision.
 * @returns refreshed configuration; existing project permissions are unchanged.
 */
@Remote('configureWorkspace') async configureWorkspace(agent: Agent, input: string): Promise<WorkbenchConfiguration>

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
