---
description: "Security Agent composition, authority, evidence flow and extension points."
---

# Security Agent architecture

English | [中文](security-architecture.zh.md)

> [!IMPORTANT]
>
> This is an experimental extension. The [feature TODO](roadmaps/security-analysis.md) tracks incomplete work. A successful tool call or a generated report does not establish a verified vulnerability.

## Contents

- [Composition](#composition)
- [Checks and evidence](#checks-and-evidence)
- [Roles and authority](#roles-and-authority)
- [Execution and recovery](#execution-and-recovery)
- [Extension points](#extension-points)

<a id="composition"></a>
## Composition

The security profile adds plugins to the existing DSH Host, Session and Web application. `pnpm security` selects that profile and defaults to port 3081; the ordinary Web profile defaults to 3080. The [user guide](user/guide/security-analysis.md) owns setup and environment configuration. The agent loop remains unchanged.

```mermaid
flowchart TD
  Profile[Security profile and presets] --> UI[Web workbench and chat]
  Profile --> Roles[Coordinator and fresh child Sessions]
  UI --> Remote[Generated Remote methods]
  Roles --> Tools[Role-scoped domain tools]
  Remote --> Domain[Security domain controller]
  Tools --> Guard[Execution guard]
  Guard --> Domain
  Domain --> Registry[Provider registry and leases]
  Registry --> Static[Binary / Ghidra / Android]
  Registry --> Dynamic[Frida helper]
  Registry --> Environment[Local / Docker / Android environments]
  Domain --> Journal[SQLite append-only domain journal]
  Domain --> Artifacts[Immutable evidence and script artifacts]
  Journal --> Index[Rebuildable FTS index]
  Roles --> Sessions[DSH Session log and jobs]
```

| Module | Responsibility | Implementation |
|---|---|---|
| Security domain | Projects, identities, checks, permissions, evidence, plans and knowledge | [security-analysis](../packages/experimental/security-analysis/README.md) |
| Providers | Tool capability discovery, environment checks, bounded execution and cleanup | Separate exports of the security-analysis package; they are not separate packages |
| Host profile and presets | Plugin composition, role prompts and restricted tools | [security-profile](../packages/experimental/security-profile/README.md) |
| Web composition | Security preset, workbench registration and distinct default port | [security-web-profile](../packages/experimental/security-web-profile/README.md) |
| Workbench | Project selection, evidence search and operator approval | [client-ui-security-analysis](../packages/experimental/client-ui-security-analysis/README.md) |

<a id="checks-and-evidence"></a>
## Checks and evidence

Each asset follows reconnaissance → surface analysis → assessment → controlled validation. Check dependencies, attempts, completion evidence and interruption status are domain records. Project completion cannot be inferred from one successful observation. Reopening a check records a reason.

Raw artifacts are persisted before their evidence references. Evidence links observations to the sample identity, tool invocation and completeness state; hypotheses and knowledge remain distinct records. SQLite stores append-only commands with operation IDs and expected revisions. The FTS index is derived and rebuildable. The [domain API reference](subsystems/security-workbench.md) owns record and Remote details.

The Session log stores model interaction and tool results. The domain journal stores project state; jobs represent live work. They have different recovery responsibilities. Knowledge proposals remain local until an operator publishes them. Shared experience is reference material, not evidence collected from the current sample.

<a id="roles-and-authority"></a>
## Roles and authority

| Role | Assigned work | Tool authority |
|---|---|---|
| Coordinator | Decompose checks, delegate and assemble conclusions | Domain commands, observations, jobs and execution of approved plans |
| Reconnaissance | Inventory one assigned asset | Binary observations and restricted Ghidra/Android inventory |
| Reverse analyst | Examine entry points and weakness hypotheses | Approved static query operations, including decompilation |
| Web analyst | Analyze assigned HTTP evidence and entry points | Evidence reads; request plans are executed by the coordinator after approval |
| Researcher | Retrieve project evidence and public references | Evidence retrieval and Web research; no provider execution |
| Reviewer | Check supporting and opposing evidence | Read existing evidence and return a structured assessment |

Roles are bound to a project, Session and allowed assets. Children use fresh Sessions and return a summary, evidence references, uncertainty and next steps. Detailed interaction remains in the child Session. [Role/tool assignments and task prompts](../packages/experimental/security-analysis/src/workbench/roles.ts) define the current fixed roles; configurable role registration is future work.

Tool restrictions and `tools.guard()` complement checks at the domain execution entry. Children cannot approve plans, change environments or delegate again. The security composition disables general shell and PTC entry points; hidden tool cards alone are not authorization. Driver-owned `structured_output` is admitted in the child scope without adding it to the inherited-tool restriction list.

<a id="execution-and-recovery"></a>
## Execution and recovery

Validation requires an immutable plan describing target, operation, script, expected observation, impact, duration and cleanup. The operator approves its version through the workbench. Execution checks approval freshness and target identity; changed scripts or scope require another plan. Revocation and project stop prevent new work and cancel active execution.

Ghidra queries require an explicitly bound program and managed authentication patch. Frida uses an independent Python helper with identity checks, structured events and cleanup. Arbitrary script text cannot establish read-only behavior. Tool presence does not establish environment readiness; the package reference maintains the actual compatibility limits.

After restart, unfinished execution requires reconciliation rather than automatic replay of injection or process creation. Leases serialize conflicting resources. Per-operation time/output limits and child concurrency bounds exist; a project-wide cumulative delegation/token budget remains a TODO. Complete crash recovery and raw-output retention under all failure paths still require acceptance testing.

<a id="extension-points"></a>
## Extension points

Future Web and IoT projects should add asset/check definitions, provider operations, environment requirements, role policies, prompts and evidence consumers together. An execution adapter alone is insufficient. Keep Host credentials and environment management outside the analyzed target. Reuse DSH Session, jobs, subprocess, storage and Remote services instead of changing the loop.

Start with the [feature TODO](roadmaps/security-analysis.md). ELF/PE structured parsing, real Ghidra binding and reliable review are the next priorities; Web/IoT expansion follows a working reverse-analysis baseline.

## Web targets, reviews and laboratories

Web targets record the operator-selected lab instance, origin and path prefix. The HTTP provider resolves method, path, tool image and instance before approval. Execution checks current Docker ownership, image identities, the two-container internal isolated network and the target address. Requests connect to that measured address and never follow redirects. File providers reject Web assets; existing file records remain readable without a journal version bump.

The web-analyst role reads assigned evidence and proposes entry-point analysis. A separate reviewer Session records supporting/opposing evidence and uncertainty against the finding content hash. Conclusive status requires complete same-target evidence from a completed validation plan; revisions reset the finding and reject stale reviews. Reports snapshot one project revision and remain accessible through operator-level Remote reads independent of Session selection.

Laboratory ownership is saved before resource creation. Restart marks unsettled generations interrupted; cleanup verifies each resource label before removal. Reset removes owned containers and networks; the next start changes instance identity. Build and lifecycle commands are operator-only. The roadmap distinguishes implemented controls from real container/model acceptance and deferred scanning providers.

## Source analysis and isolated simulation

A source directory is one immutable asset. Its manifest owns member paths and hashes, so cross-file observations share one asset identity. Source tools read only artifact bytes and return bounded line-addressed evidence. File, Web and source providers reject incompatible asset kinds.

Offline Python and browser validation reuse plan approval, subprocess supervision, execution records and cleanup. Each plan pins its script, source manifest, image ID and resource limits. A disposable container has no network or device access; its browser runner serves snapshot files through request interception. Reports identify these observations as simulations and preserve failures rather than treating them as hardware results.

Source reads can run concurrently. External providers name actual shared instances for leases, while environment lifecycle actions reject admission while that environment has active runs. Model-facing project pages and mutation receipts are bounded independently from the durable project. Child summaries are persisted on existing Session bindings after evidence scope checks.
