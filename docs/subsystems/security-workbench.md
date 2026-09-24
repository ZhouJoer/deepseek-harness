# Security workbench

English | [中文](security-workbench.zh.md)

The experimental [security domain](../../packages/experimental/security-analysis/README.md) owns projects, measured assets, check dependencies, explicit Session roles and immutable plan approval. Analysis and environment providers register capabilities; tools and generated Remote methods share the domain controller.

## Durable records

[Record schemas](../../packages/experimental/security-analysis/src/workbench/model.ts) define project, asset, check, evidence, finding, plan, execution and reviewed knowledge values. Each command appends one revision to the storage-domain journal. Artifact bytes are published before references. Session logs retain model-visible tool results; the domain journal owns check recovery.

## Cordis API reference

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

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

/**
 * Apply a user-authored command including approval gestures.
 * @param agent - carrier-resolved agent.
 * @param command - JSON command prepared by the workbench.
 * @returns committed project state.
 */
@Remote('command') async command(agent: Agent, command: string): Promise<WorkbenchView>

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
```

Types: [Agent](core.md)

Source: [`packages/experimental/security-analysis/src/index.ts`](../../packages/experimental/security-analysis/src/index.ts)
<!-- END GENERATED cordis-surface -->
