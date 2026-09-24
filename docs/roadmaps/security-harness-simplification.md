---
description: "Implementation plan and ordered acceptance steps for natural-language security work, tool selection, agent collaboration and a simpler DSH interface."
---

# General-purpose DSH with stronger security analysis: implementation plan

English | [中文](security-harness-simplification.zh.md)

## Summary

This plan guides contributors extending the existing security packages so users can configure a workspace, describe an objective and receive evidence-backed results. It covers security reasoning, tool use, delegation and the interface together. Status: in progress; unchecked steps are implementation work, not delivered capabilities. This document owns the refactoring order; the [security roadmap](security-analysis.md) retains the specialist-tool backlog, and the [package reference](../../packages/experimental/security-analysis/README.md) owns current behavior.

## Contents

- [Outcome and first release](#outcome)
- [Reuse and proposed responsibilities](#responsibilities)
- [Delegation driven by missing evidence](#delegation-design)
- [Implementation steps](#steps)
- [Dependencies and change ownership](#dependencies)
- [Acceptance scenarios](#acceptance)
- [Compatibility and validation](#validation)
- [First implementation action](#first-action)
- [Dev Note](#dev-note)

<a id="outcome"></a>
## Outcome and first release

The intended user path is workspace configuration → natural-language task → concise progress → findings and deliverables → follow-up in the same conversation. Users can name files, environments, devices, constraints and output requirements. The system asks only for information that prevents useful progress or for authority the current request does not provide.

The first complete example uses Web source and a local test application. The next examples cover firmware with an embedded Web component and IoT protocol documents or offline captures. Real-device checks require their own verified environment; offline success does not establish hardware support. Ordinary development, file analysis and research remain part of the same harness experience.

The initial implementation stays in the existing experimental security composition. It reuses the DSH agent loop, Session, subagents, jobs, tools, skills, sandbox and web search. New general-purpose execution, scheduling, search or mandatory vector-storage services are outside this plan.

<a id="responsibilities"></a>
## Reuse and proposed responsibilities

The [security workbench](../subsystems/security-workbench.md) owns the existing domain records. Its journal, immutable artifacts, provider lifecycle, resource exclusion, reviews and reports are the starting point. Workbench phases classify individual checks; they do not imply a mandatory four-stage workflow. Implementation must distinguish this path from legacy prompts and tests.

| Responsibility | Planned treatment | Owning implementation |
|---|---|---|
| Workspace defaults | Associate reusable environment and material references; keep credentials as references | Security domain and existing workspace APIs |
| Task context | Record objective, requested scope, inputs, resources, limits, deliverables and revision; bind them to the initiating Session | Existing controller and domain journal |
| Investigation | Extend checks only where needed for facts, hypotheses, alternative explanations, validation and stopping conditions | Existing check and finding records |
| Tool guidance | Extend guidance with applicability, prerequisites, permitted impact, result interpretation and failure handling | Existing provider definitions and skills |
| Delegation | Separate analytical expertise from execution authority; resolve allowed assets and capabilities before creating a child | Existing delegation and Session bindings |
| Evidence and delivery | Retain raw observations, artifact identity, review fingerprints and revision reports; derive views from committed records | Existing artifacts, journal, reviews and report generation |

The domain journal remains authoritative for security records. Session logs retain the context and tool results the model actually saw, with stable references to the relevant domain revision. The UI derives its view from committed data. This plan does not introduce a second independently writable copy of either state.

<a id="delegation-design"></a>
## Delegation driven by missing evidence

This is the proposed design for stage 4, not implemented scheduling behavior. The supplied comparison table motivates preferring new observations over repeated discussion; it does not establish a measured benefit for DSH. Delegate only when a child can resolve a named uncertainty, cover a distinct part of the task, or perform a justified independent review. Keep the parent responsible for the objective, scope, evidence integration and final answer.

### Admission and choice of feedback

Before creating a child, state what is unknown, what observation could distinguish competing explanations, which available capability can obtain it, and how the result changes the next decision. First search existing project evidence. Reuse an applicable observation instead of recollecting it; freshness, a changed target or an explicit repeatability experiment can justify another measurement. A timestamp, another summary or agreement from another model is not new target evidence.

| Work | Useful input or feedback | Scheduling decision |
|---|---|---|
| Re-read the author's answer or debate the same summary | No additional observation | Keep local; do not create a child solely for agreement |
| Investigate independent components or trust boundaries | Different source paths, binary functions, callers or protocol stages | Parallelize distinct questions against immutable inputs |
| Check a suspected implementation defect | Target code, execution logs, assertions and negative controls | Run a discriminating check, then evaluate its result |
| Check a rendered page or interaction | Actual screenshot, DOM state and interaction trace | Verify the requested behavior; a screenshot alone cannot establish server authorization |
| Check an external fact | Primary documentation, affected versions and configured tool observations | Use DSH web search or the applicable provider; external references do not demonstrate a target vulnerability |
| Review a consequential conclusion | Exact claim plus original supporting and opposing evidence | Use a separate review context; request a specific missing observation instead of another debate |

Use Web, firmware and IoT as expertise and method hints, not mandatory teams. A firmware task with an embedded Web application can split its native request handler and Web authorization path, then join the results at the shared input. A small source question stays with the parent when delegation cannot justify its context and coordination cost. Model diversity is optional and does not itself satisfy the evidence requirement.

### Investigation, verification and review

These are work purposes, not three new permission roles. Reuse compatible existing task and role bindings first. The current [reviewer](../../packages/experimental/security-analysis/src/workbench/roles.ts) reads evidence and records a verdict but cannot collect observations or execute validation. Preserve that restriction. Analysts can propose and perform permitted static collection; the coordinator routes runtime checks through existing plan approval, execution and cleanup. A browser or device check requires an actually available provider and the applicable authorization, even if the child calls it verification.

When a test, scan or render already has a resolved specification, execute it through the existing tool/job path without allocating an LLM child for the call. Create a child when selecting a method, investigating a distinct scope or independently interpreting evidence requires substantial reasoning. The coordinator can consume direct tool feedback and finish a small task itself.

An investigation produces a hypothesis and its conditions. Verification obtains the observation needed to test that hypothesis. Review checks whether the exact conclusion follows from original observations, considers alternatives and names missing proof. The reviewer receives the claim and references needed to find relevant artifacts, without inheriting the author's discussion or confidence rating. Re-reading raw evidence can expose a reasoning error, but that is an analytical correction, not an additional measurement. Preserve useful static review while reporting that distinction.

The closed loop is question → existing evidence → missing observation → authorized collection → evidence integration → review when warranted → conclusion. If a review identifies a gap, create a check for that gap. If no relevant capability is available, retain an explicit unknown. Do not start another identical review to turn an inconclusive result into agreement. Independent review remains required wherever the existing conclusion policy requires it; inexpensive informational tasks do not gain a mandatory reviewer.

### Task inputs and durable results

Extend the existing delegation request only with information that the current question, criterion, asset binding and budget do not express. The resolved task needs its purpose, known evidence references, expected feedback, completion criterion, dependencies, assigned assets/resources and claim or task revision. Missing or inaccessible input references reject before allocating a child. Expertise hints cannot add capabilities, assets or approval.

Keep the current summary, evidence references, uncertainty and next steps. Add only the result distinctions needed to identify newly collected observations, corrections supported by existing evidence, contradictions, blocked capabilities and requested checks. The Host validates references and target identity; the parent assesses what the result actually resolves. Child claims of novelty or confidence are not authoritative. Keep raw bytes, collection parameters, environment identity and completion state with existing evidence records, and record model-visible context in the Session log.

Evaluate progress by a resolved question, a supported or refuted hypothesis, newly covered scope, or a concrete capability blocker that prevents repeated futile work. Evidence count and tool-call count are not quality scores. A repeated observation can strengthen a predefined repeatability test; otherwise merge equivalent results while retaining their original records. A new interpretation may justify correcting a conclusion without pretending new bytes were collected.

### Dependencies, budgets and stopping

Use existing checks, jobs and subagents to admit ready work whose dependencies are satisfied. Start independent ready checks when capacity permits; serialize access to shared devices, debuggers and mutable environments through resource ownership. Prioritize questions that affect the final security decision and can be answered with available resources. Cancellation settles provider cleanup and resource release before reassignment; a blocked branch need not stall independent branches.

Add task-wide accounting across the parent and all children, including tokens, execution time and repeated unsuccessful work. Reserve capacity before admission, settle actual usage afterward and reserve enough capacity for integration and the final answer. Reuse existing concurrency and duration configuration; make any additional deployment-varying limits configurable. Enforce resource and budget admission in the Host rather than only in prompts. Account for in-flight work and document any unavoidable cancellation or token overshoot.

Stop when the question is answered to its requested evidence standard, no feasible observation can resolve the remaining gap, or the task budget is exhausted. Repeated no-progress work reaches a configured limit instead of spawning more children. Changes to the claim, input identity or scope invalidate dependent pending decisions; retain historical observations, cancel incompatible work and recheck admissibility before using completed results. Never reuse a stale review as approval for a changed finding.

### User experience and acceptance

Keep agent selection and internal task graphs out of the required user path. Show outcome-oriented progress such as source inspection complete, checking the failure condition, or device validation unavailable. Present conclusions with evidence, applicable conditions, limitations and remediation; put child activity and tool details behind an optional view. Ask the user only for missing information or authority that prevents the next useful action.

For a Web ownership-check example, first inspect the handler and caller paths. If runtime verification is needed and an authorized local target exists, compare owner and non-owner requests against the same object and retain the request/response records; a failed setup or an unrelated HTTP error is not evidence that access is denied. A reviewer then checks the claim against both responses and source locations. Without the target, retain a static conclusion and leave runtime reachability unverified. For firmware or IoT, substitute the relevant function, parser, capture or device observation while preserving the same decision process.

Acceptance must compare equal-model, equal-input and equal-budget runs: parent only, repeated-summary review, and observation-driven delegation. Include both gains and cases where delegation should be declined. Measure supported conclusions, false positives, resolved questions, duplicate collection, review corrections, latency, total parent/child usage and user interventions. Fix thresholds only after the baseline; this plan makes no numerical improvement claim.

<a id="steps"></a>
## Implementation steps

Each stage closes with its own behavior evidence and documentation update. Check a step only after its stated result is observed. An unavailable external environment remains a recorded acceptance gap.

### 1. Establish the baseline and executable examples

Dependency: none. Primary locations: [security tests](../../packages/experimental/security-analysis/tests), [security preset](../../packages/experimental/security-profile/presets/security/agent.cordis.yml), [roles](../../packages/experimental/security-analysis/src/workbench/roles.ts) and [domain types](../../packages/experimental/security-analysis/src/workbench/model.ts).

- [x] S1.1 Inspect the active profile, tool composition, execution guards, operator-only actions, delegation and persistence; classify behavior as retained, changed or deferred.
- [ ] S1.2 Prepare reproducible Web, firmware/embedded-Web and IoT-offline examples with known findings, negative cases, input identities and environment requirements.
- [ ] S1.3 Run generic DSH and the current security composition with the same model, inputs and budget; record finding quality, tool failures, repeated work, cost and user interventions.
- [ ] S1.4 Add ordinary file/development tasks and known analysis mistakes, including unsupported ELF conclusions, to the comparison set.

Deliverable: a bounded example set and baseline measurements. Acceptance: implementation gaps are distinguished from unavailable tools or environments; a structured response alone does not count as correct analysis.

### 2. Complete one natural-language Web task

Dependency: stage 1. Primary locations: [security entry](../../packages/experimental/security-analysis/src/index.ts), [controller](../../packages/experimental/security-analysis/src/workbench/controller.ts), the security preset and the [UI plugin](../../packages/experimental/client-ui-security-analysis/src/client/index.ts).

- [ ] S2.1 Define task-context fields and workspace association; resolve files and environments, record defaults explicitly and reject missing referents.
- [x] S2.2 Connect authenticated user input to project selection, task creation and resource association. Distinguish explicit user instructions and existing configuration from model inference; model proposals cannot supply the operator flag or manufacture approval.
- [ ] S2.3 Add needed general-purpose file, skill and execution tools to the fixed composition. Apply task restrictions at execution; exposing a tool or removing a role filter is not sufficient.
- [ ] S2.4 Support task revisions from follow-up messages. Scope reductions constrain new calls and cancel or reconcile incompatible active work; a revision never silently expands permission.
- [x] S2.5 Deliver minimal workspace configuration, a conversation entry and a result view together with the path from Web input through collection, evidence and a report.

Deliverable: one real end-to-end task through the supported DSH launcher. Acceptance: users do not manually create check templates or select agents; ordinary tasks still work; alternate shell, PTC or MCP routes cannot bypass applicable execution policy.

### 3. Strengthen security reasoning and tool use

Dependency: stage 2 task and resource fields. Primary locations: [provider definitions](../../packages/experimental/security-analysis/src/workbench/providers.ts), [model records](../../packages/experimental/security-analysis/src/workbench/model.ts), [role guidance](../../packages/experimental/security-analysis/src/workbench/roles.ts), and skill content added to the security composition.

- [ ] S3.1 Add composable Web, firmware, embedded-Web and IoT methods. Classify from the objective and observed materials, retain uncertainty and update labels when evidence changes the analysis.
- [x] S3.2 Guide each investigation through facts, a hypothesis, alternative explanations, a discriminating check and a stopping condition; reuse records that already express these facts.
- [ ] S3.3 Extend provider guidance with supported inputs, prerequisites, resources, impact, useful result fields, limitations and failure recovery; distinguish installation, readiness and target access.
- [ ] S3.4 Select tools by missing evidence. Preserve raw output and incomplete results; distinguish a refuted hypothesis from an inapplicable method or unavailable resource.
- [ ] S3.5 Use existing evidence retrieval and DSH web search for specific knowledge gaps. Retain source and version applicability; reference material must not become evidence about the target.
- [ ] S3.6 Complete firmware/embedded-Web and IoT-offline examples. Add an adapter only where an example demonstrates a missing operation; include its execution, cleanup and evidence behavior.

Deliverable: reusable analytical methods and explicit tool-use guidance. Acceptance: scanner matches, inventory strings and version matches remain leads until supported; unchanged failing calls stop; missing capabilities produce an applicable alternative or an accurate limitation.

### 4. Improve delegation and independent validation

Dependency: stage 2 task revisions; stage 3 supplies method and tool guidance. Primary locations: the security entry, role definitions, [controller](../../packages/experimental/security-analysis/src/workbench/controller.ts), [assessment helpers](../../packages/experimental/security-analysis/src/workbench/assessment.ts) and existing subagent services.

- [ ] S4.1 Separate expertise labels from capability admission. Use investigation, verification and review as work purposes while preserving existing role permissions; runtime verification stays on approved execution paths.
- [ ] S4.2 Extend the resolved delegation with known evidence, expected feedback, dependencies and input/claim revision; validate references and allowed assets/resources before creating a child.
- [ ] S4.3 Add missing-evidence admission, equivalent-work detection and ready-check selection to existing checks/jobs/subagents. Keep inexpensive work with the parent; admit parallel work only when dependencies and resource ownership permit it.
- [ ] S4.4 Reuse resource keys and exclusion for shared devices and mutable environments; isolate scratch outputs and handle cancellation, cleanup and restart without repeating side effects.
- [ ] S4.5 Account for parent and child work together; reserve admission capacity and final-answer capacity, settle actual usage, and enforce configurable no-progress and failure limits.
- [ ] S4.6 Integrate new observations, analytical corrections and contradictions separately; bind reviews to exact claims and inputs. A missing observation schedules a concrete check or remains an explicit limitation.
- [ ] S4.7 Deliver the smallest authorized Web verification loop with positive and negative controls. Keep static-only and unavailable-target paths explicit, then extend the same workflow to firmware and IoT examples.
- [ ] S4.8 Add regressions for repeated-summary delegation, false novelty, unavailable capabilities, stale evidence/reviews, resource conflicts, concurrent budget reservation and cancellation. Complete the equal-budget comparison in S6.3 before claiming an improvement.

Deliverable: bounded collaboration with traceable child results. Acceptance: simple tasks avoid unnecessary delegation; independent work can proceed despite a blocked sibling; scope changes, stale reviews and resource conflicts are handled through the real execution entry.

### 5. Finish the workspace, conversation and result interface

Dependency: stage 2; can proceed alongside stages 3 and 4 after task and result fields settle. Primary locations: [Workbench](../../packages/experimental/client-ui-security-analysis/src/client/Workbench.tsx), [Projects](../../packages/experimental/client-ui-security-analysis/src/client/Projects.tsx), [UI registration](../../packages/experimental/client-ui-security-analysis/src/client/index.ts), locale dictionaries and the security Web composition.

- [ ] S5.1 Consolidate workspace materials, environments and resources into reusable configuration; remove duplicate project setup from the routine task path.
- [ ] S5.2 Use one conversation for task creation, clarification, new resources, scope changes, pause and continuation; keep technical controls in an optional detail view.
- [ ] S5.3 Describe progress through completed investigation, current work and blockers. Show a concrete action when the user can unblock work.
- [ ] S5.4 Present findings, evidence, conditions, remediation, deliverables and uncovered areas. Preserve distinctions between static, simulated and device observations.
- [ ] S5.5 Derive live updates and reconnect behavior from authoritative state; verify that refreshing or opening a completed task preserves findings and evidence links.
- [ ] S5.6 Validate Chinese and English copy, keyboard operation, narrow layouts and the ordinary conversation experience. Replace prototype sample data with real domain results.

Deliverable: the path defined under [Outcome](#outcome), using existing Slots and Remote integration. Acceptance: users can finish and follow up without selecting roles, providers or internal check phases; important conclusions remain independently inspectable.

### 6. Complete cross-domain acceptance and delivery

Dependency: stages 2–5. Primary locations: owning package tests, real-profile examples, Session snapshots, user documentation and this checklist.

- [ ] S6.1 Run the acceptance scenarios below through real Loader/profile composition, including unsuccessful and interrupted tasks.
- [ ] S6.2 Compare the enhanced composition with the baseline under equal conditions; record valid findings, false positives, unsupported confirmations, invalid/repeated calls, time, cost and user interventions.
- [ ] S6.3 Compare single-agent and delegated runs for suitable tasks; retain collaboration only where its quality or time benefit justifies its overhead.
- [ ] S6.4 Verify available real tools and devices separately from mocks, recorded sessions and offline simulations; publish only combinations actually exercised.
- [ ] S6.5 Update bilingual package/user documentation, snapshots and persistence acknowledgements; record a real-server, real-model UI GIF for product-visible changes.
- [ ] S6.6 Record actual validation and remaining limits, mark only completed steps, and review whether the experimental composition is ready for wider use.

Deliverable: a tested security-enhanced harness and a reproducible comparison report. Acceptance: evidence explains improvement over generic DSH, ordinary task capability is preserved, and unavailable hardware is not reported as validated.

<a id="dependencies"></a>
## Dependencies and change ownership

The order is 1 → 2 → {3, 4, 5} → 6. Stage 4 can begin delegation and permission work after stage 2, then consume stage 3 guidance. The minimal UI belongs to stage 2; the complete UI is not a prerequisite for the first real task.

Keep independently reviewable changes separate: baseline fixtures; task/resource and permission changes; methods and tool guidance; delegation and review; UI; final acceptance and documentation. Update tests and documentation with each behavior change. Coordinate edits to the security entry, controller and model records because several work streams share them.

Toolbox expansion, full Android automation, deep device integration, remote laboratory provisioning and semantic search remain in the [specialist backlog](security-analysis.md#tool-and-environment-expansion). They enter this implementation only when a selected example requires them and the matching environment can be verified.

<a id="acceptance"></a>
## Acceptance scenarios

These are planned checks. Their presence here does not claim they have run.

| Scenario | Required observation |
|---|---|
| Ordinary development task | File, skill and allowed execution tools work without forcing security project steps |
| Natural-language Web task | Workspace selection and one request reach a report with verifiable evidence |
| Firmware with embedded Web | Methods combine; asset relationships and conclusion limitations remain explicit |
| IoT materials without a device | Offline work completes; unavailable device behavior stays unverified |
| Missing tool or incompatible version | The agent chooses an applicable available method or reports the blocker without pretending success |
| Scanner or inventory clue | A clue cannot become a confirmed finding without adequate implementation or runtime evidence |
| Simple versus parallel task | Simple work avoids delegation; independent work improves time or quality without duplicate investigation |
| Shared mutable resource | Conflicting operations cannot overlap; cancellation settles ownership and cleanup |
| Scope reduction during work | Parent and children cannot start disallowed actions; incompatible active work is cancelled or reconciled, with unavoidable delay shown to the user |
| Alternate execution route | Direct provider, shell, PTC and MCP calls enforce the same applicable limits |
| Untrusted content | Pages, tool output and child reports cannot create authority or expand task scope |
| Conflicting evidence or changed finding | Contrary evidence remains visible; an earlier review cannot validate a changed claim |
| Restart or reconnect | Saved evidence and reports remain accessible; mutations are not blindly replayed |
| Historical project and Session | Read, write, recovery and export preserve old data; new defaults do not reclassify findings |

<a id="validation"></a>
## Compatibility and validation

Task fields, role bindings, capability rules and result projections are proposed changes until their owning implementation is updated. Keep existing evidence immutable. Update consumers together when public types change, acknowledge declared persistence-type changes, and follow released-format migration rules where applicable. Session event changes must include required TypeScript and Python SDK projections and expected outputs.

Use focused behavior tests for changed packages, non-unit real Loader/profile tests for product-visible composition, and keyless recorded-session snapshots for model-visible behavior. Add lifecycle and concurrent-resource cases when the implementation owns asynchronous resources. Use real-provider tests for external-tool claims; UI tests and the real-model GIF establish the actual user path.

Select outgoing commands through [dsh-pre-push-checks](../../.agents/skills/dsh-pre-push-checks/SKILL.md). Documentation follows [the documentation standard](../AGENTS.md), including paired translations, links and documentation checks. Build, type, packaging and consumer checks follow changed files; exhaustive repository coverage stays with CI unless scope makes a full local run necessary.

Quantitative acceptance thresholds follow baseline measurements and known example outcomes. Report model variability and unsuccessful attempts; do not select only favorable runs. Runtime claims require environment evidence, not simulated results or report appearance.

<a id="first-action"></a>
## First implementation action

Start with S1.1: map the active composition's tool admission and operator actions to the natural-language task path, then define the smallest Web example for S1.2. The first implementation change must include a generic-task regression and an execution-denial case alongside the first successful security task.

<a id="dev-note"></a>
## Dev Note

S1.1 is verified against the current composition: preserve journal evidence, immutable artifacts, operator approval, resource leases and independent review; revise manual project setup, fixed role routing and tool selection; defer external-device expansion until usable environments exist. The original focused baseline passed 58 tests across four files.

The initial implementation adds persisted workspace resource selection, natural-language Web task intake and four methods loaded through the existing skill service. The panel defaults to task, findings, evidence and reports, with detailed controls folded away. Execution guards remain active; method bodies and project scope use ordinary logged tool results. Stages 2, 3 and 5 are partially implemented: generic execution policy, task revisions, multi-asset delegation and cross-domain comparisons remain open.

The configured local 3081 service completed a real natural-language Web source task: saved workspace resources, method loading, automatic task admission, single-file import, original evidence, independent review, a persisted conclusion and a Chinese final reply. The [synthetic Web input](../../packages/experimental/security-analysis/tests/fixtures/web-intake/invoices.js) preserves the exact 613-byte input used by the browser run. The result contains one statically confirmed finding and two evidence records; reachability, design intent and runtime exploitability remain unverified. The final build generated and saved the Markdown and JSON reports through the real browser UI. A fresh browser connection reopened both report formats and the same evidence IDs. The latest report distinguishes an accepted static review from unverified runtime reachability.

The successful main conversation, excluding separate report generation, took 2 minutes 17 seconds, 27 model steps and 30 tool calls, including two review children after a finding revision. The UI recorded about 370,000 cumulative tokens with 95% cache hits. The security profile sets a 360,000-token per-turn threshold, including cache reads, checked before each model step; the last request can exceed that threshold. Earlier runs at 120,000 tokens stopped after saving conclusions but before the final reply; the service default is unchanged. This measurement does not establish an efficiency improvement; the same-input generic-harness comparison and simpler delegation remain open.

Focused regressions cover intake overlay composition, single-file import, evidence-only review, revision receipts, command guidance, denied-tool admission, fenced report JSON and accepted-review context. An earlier report incorrectly treated the conditional review requirement from the request as missing review; the new revision preserves the completed static review, while the original artifact remains unchanged. The panel keeps detailed controls collapsed, refreshes after a turn, and supports keyboard tab selection and a 390-pixel viewport. Workspace navigation can briefly show a pending workspace name before the new Session is selected; automated callers must not treat that name as a completed switch. Firmware, IoT, generic execution policy and external-tool support remain unverified. The keyless recorded-session scenario includes the separate tool-free report Session and persisted artifacts; its normal replay and the focused empty-schema checks pass. The final Host build and full lint pass. Documentation checks retain an existing event-document pairing mismatch and an unfinished repository-reference scan.
