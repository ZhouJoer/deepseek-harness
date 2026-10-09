# Security workbench

English | [中文](security-workbench.zh.md)

The experimental [security domain](../../packages/experimental/security-analysis/README.md) owns projects, measured assets, check dependencies, explicit Session roles and immutable plan approval. Analysis and environment providers register capabilities; tools and generated Remote methods share the domain controller.

## Durable records

`WorkbenchConfiguration` is the object returned by `configuration` and `configureWorkspace`. It includes material limits, projects, providers, environments and the knowledge interval. Its workspace value is null without a workspace; the attempt limit is absent until configured. The [configuration types](../../packages/experimental/security-analysis/src/workbench-configuration-types.ts) define the browser-safe fields.

`ToolboxDirectory` contains configured environment choices and one measured or explicitly unchecked `ToolboxInventory`. Its `ToolboxTool` entries separate availability, invocation method and optional provider integration. Available Docker tools expose the Host `command` and `prefixArgs`, with the original container executable and arguments in `installation` for configuration persistence. These read-only observations are not project evidence or execution authority; fields are defined in [toolbox types](../../packages/experimental/security-analysis/src/toolbox-types.ts).

`DeviceDirectory` contains configured environment choices and a cached or unchecked `DeviceInventory`. Independent prerequisite checks and branded `RadioDeviceId` values describe software, drivers and visible interfaces; observation timestamps distinguish retained data from failed refreshes. These values are transient and do not establish capture permission or radio readiness. See [device types](../../packages/experimental/security-analysis/src/device-types.ts).

[Record schemas](../../packages/experimental/security-analysis/src/workbench/model.ts) define project, asset, check, evidence, finding, plan, execution, delegation and reviewed knowledge values. Each command appends one revision to the storage-domain journal. Artifact bytes are published before references. Session logs retain model-visible tool results; the domain journal owns check and delegation recovery. `SecurityDelegation` records an assigned question, immutable project and asset scope, execution outcome, child report and coordinator disposition. Jobs own live execution; a report's acceptance does not confirm a finding.

`ToolCatalogSnapshot` holds the resolved tool definitions, collections, packs and import revision. `ToolPackPreview` lists conflicts before an explicit import. `ToolPreferences` contains active-session soft selections, recorded in model context but excluded from project persistence. See [tool configuration](../../packages/experimental/security-analysis/README.md) for import, probing and lifecycle semantics.

## Cordis API reference

`EvolutionRun` describes a queued or settled isolated analysis. `EvolutionSource` identifies the observed task and exact Session event or hashed domain record, including excerpt truncation. `EvolutionProposal` combines a functional change, acceptance scenarios, task occurrences and operator-owned progress. `EvolutionReceipt` stores external implementation and test claims; `EvolutionView.revision` checks operator mutations independently of security commands. These browser-safe values are defined in [evolution schemas](../../packages/experimental/security-analysis/src/evolution-model.ts). The `security_evolution` storage domain persists their versioned state without changing Session events or format.

`analyzeImprovements` queues a project request with `operationId` and `expectedRevision`. `improvements` and `followImprovements` return the shared pool; `updateImprovement` accepts a revision-checked `status` or `receipt` action. Reusing an operation identity requires identical input. `exportImprovement` returns the selected coding task and receipt template. Receipt import can mark work modified but cannot mark it verified. These methods require operator Remote access and are not model tools.

`AnalysisScript` describes a bundled analysis script: its stable ID, category, skill, resource paths, dependencies, parameters and example. The read-only catalog requires no project or environment and performs no tool probes; entries grant no execution authority. Fields are defined in [analysis script types](../../packages/experimental/security-analysis/src/analysis-script-types.ts).

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

Types: [Agent](core.md) · [SessionId](core.md)

Source: [`packages/experimental/security-analysis/src/index.ts`](../../packages/experimental/security-analysis/src/index.ts)
<!-- END GENERATED cordis-surface -->
