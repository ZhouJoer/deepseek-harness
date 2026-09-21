# 安全工作台

[English](security-workbench.md) | 中文

实验性[安全领域服务](../../packages/experimental/security-analysis/README.zh.md)管理项目、实测资产、检查依赖、明确的 Session 角色和不可变计划授权。分析与环境 provider 注册能力；工具和生成的 Remote 方法共用领域控制器。

## 持久化记录

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

/**
 * Read selected project state for an authenticated Web session.
 * @param agent - carrier-resolved agent.
 * @returns authoritative view; reconnecting clients reload it.
 */
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
 * Read a verified artifact belonging to the selected project.
 * @param agent - authenticated session.
 * @param sha256 - evidence or script digest.
 * @returns bounded preview with a completeness flag.
 */
@Remote('artifact') async artifact(agent: Agent, sha256: string): Promise<string>
```

Types: [Agent](core.zh.md)

Source: [`packages/experimental/security-analysis/src/index.ts`](../../packages/experimental/security-analysis/src/index.ts)
<!-- END GENERATED cordis-surface -->
