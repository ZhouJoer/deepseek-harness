---
description: "Optional security workbench composition."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-security-analysis

English | [中文](README.zh.md)

## Summary

Choose material, describe an objective and start an analysis with the local environment selected. Tasks and submitted findings, evidence and reports persist across restarts. Chat responses and generated files enter these lists only after explicit collection or record submission. The optional panel retains ordinary conversation and tool cards; detailed assets, checks, environments and review controls are available when needed. The security domain checks authority for every action. Configure local external tools from the Toolbox page.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

Choose **Add materials** in the task overview to upload files or a folder, paste text, or import a Host path. Types are detected automatically. New analysis stages the selection until Start analysis creates the task and saves its materials; imported names appear in the overview. **Manage task** renames or removes a project. Removal stops work and hides the project while retaining evidence and reports; the sidebar’s **Removed tasks** list offers restoration. Restored projects remain paused until explicitly resumed. Long selection labels are shortened, with full names retained in tooltips.

-----

<a id="use-this-package"></a>
## Use this package

Compose `@deepseek-ai/dsh-base`, an application bundle, and `@deepseek-ai/dsh-experimental-security-profile` in a dedicated profile. For Web, append `@deepseek-ai/dsh-experimental-security-web-profile`. Launch through `dsh --profile <name>`. See [security analysis](../security-analysis/README.md).

The Toolbox's **Analysis scripts** tab lists built-in packet, MQTT and native-process observation scripts. Search names, purposes or dependencies, filter categories, and expand a script for its method, parameters, installed path, example, output and limitations. Browsing needs no project or environment and does not probe or execute tools. The associated skill supplies the Agent with the same resources; [the script library](../security-analysis/README.md#use-this-package) owns execution and output rules.

Open **Security analysis** from the sidebar or the compact **Security workspace** composer entry. The Dashboard shows task counts, name/objective search and status filters. **New analysis** selects a workspace, stages optional files, folders, text or a Host path, and sends the objective through a new native Session after saving the task and materials. **More options** selects the environment. A failed send retries only sending. Task details provide Overview, Assets, Findings, Evidence and Reports; evidence previews retain their search on return, and saved Markdown reports render with version and format selectors. **Analysis assistant** opens the native conversation in the right pane; collapsing it retains its draft, while switching tasks or leaving the panel releases its reference. Historical browsing creates no Session and changes no task binding. If no accessible coordinator Session remains, **Continue analysis** explicitly creates and associates one. Stopped tasks require explicit resumption, and restoring a removed task keeps it stopped. Refresh is available manually and after reconnects, operations and assistant turns.

-----

Source file or directory assets provide file inventory, line reads and literal searches from the conversation workbench. Evidence cards label static observations, offline simulations and device validation, with failure and cleanup details. Each research direction lists recorded child questions, roles, execution states, returned summaries and the coordinator's report decisions. Expand a child task for its dispatch reason, completion criterion, evidence references, uncertainty and suggested next steps; **Open child conversation** opens its original one-shot history. Accepting a child report does not confirm a finding. Directions without saved assignments say that no child tasks are recorded; older child summaries remain in the advanced workbench history.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation details</summary>

This package composes capabilities through a profile patch or input dock slot. It changes neither default profiles nor agent-loop. The browser calls the domain through generated Remote methods and uses bilingual dictionaries. Security tool cards show preparation and execution as running; result details and error status appear only after a result is logged. A successful delegation receipt says **Dispatched**; the activity view follows the child's saved execution and report decisions. No invariant companion is published because this package owns disposable composition/UI registrations; the domain owns business state.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Experimental packages](../README.md)
- [Architecture](../../../docs/architecture.md)

-----

## Persistent security projects

Task lists expose inline deletion confirmation, a busy state and a collapsing exit animation, with reduced-motion support. Reversible deletion offers undo and recovery under Deleted tasks. Permanent deletion is available there after a second confirmation click; it has no undo. Failed requests keep their confirmation open for retry. Analysis summaries and reports use Simplified Chinese while preserving code identifiers and paths.

The toolbox opens a definition directory without running probes. Search purposes or filter by tag and pack, then check individual tools or filtered results. Definition forms, JSON import previews and pack export work without selecting a project or chat. Imports require explicit conflict confirmation and never install software or execute commands. Editable local environments retain executable browsing, argument fields, version checks and restoring defaults; failed probes preserve saved pins. The active session workbench provides soft tool and collection preferences with an automatic-discovery reset. Preferences apply on the next model request and disappear when that session is disposed. See the [collection guide](../../../docs/user/guide/security-analysis.md).

The sidebar Security analysis panel lists projects, targets, checks, findings, reviews, reports and laboratory generations without requiring a selected conversation. Advanced details in the history page offer explicit local-image reuse and new-image builds; both preserve existing laboratory image identities. The conversation workbench registers running Web targets, applies independent reviews and generates revision reports. Both project views render saved Markdown briefs and optional findings appendices directly. The [Web guide](../../../docs/user/guide/security-analysis.md#local-web-laboratory) describes the workflow and current provider limits.

The main chat keeps a compact **Tools** count badge above the composer. Click it to open **Tools & progress** in the native right sidebar; the badge updates even while the sidebar is closed. An unlinked chat shows an explicit empty state in the sidebar. It follows Session selection and project activity through separate disposable streams. Task details also offer a **Tools & progress** tab. Both surfaces show a chronological timeline with three lines per direction: tools, current conclusion, and next action or blocker. Repeated rounds update one direction; returning to reconnaissance creates a distinct direction when the question changes. Tool names and counts are references, with same-name counts combined and no execution-verification badges. Execution failures and incomplete output remain visible. Expand a direction for bounded invocation pages and evidence references; empty states distinguish missing saved records from conversation summaries. Reconnection restores a project-scoped baseline. The sidebar is read-only. The native composer keeps its existing stop control; pausing the entire project remains a workbench management action. Enter additions or corrections directly in the native composer; explicitly resume a paused project before continuing its analysis.


The **Continuous improvement** page lists suggestions for capabilities, workflows, scripts and methods across tasks, with search, task and progress filters. Task details expose **Improvement suggestions** and **Find improvements now**; active work queues the request. Expand a suggestion to read the problem, cited observations, proposed capability and acceptance criteria. Copy Markdown or download a ZIP containing `TASK.md`, `proposal.json` and `result.template.json`. Enter an implementation receipt or import its JSON, then explicitly confirm verification after checking the result. Imported test claims never verify a suggestion automatically. Ignored suggestions can be restored; new evidence for a verified suggestion is marked for review.

<a id="model-experience"></a>

## Model Experience

### Security context

#### What the model sees

Start analysis submits the user’s objective as a native conversation message; `security_scope` belongs to the domain service. Domain tools record model-visible results in the Session.

#### Token effect

Domain tool schemas and retrieved evidence consume context according to the configured output limit. This package does not change token accounting.

#### KV Cache effect

Tool definitions and workflow guidance remain stable. Project state enters context through logged tool results.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Invocation details are paginated and require refresh to include later calls. Arbitrary script internals remain unverified; background output whose completeness was not observed stays marked incomplete. See [security analysis](../security-analysis/README.md) for external-tool and environment acceptance limits.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer working notes (non-authoritative)</summary>

None.

</details>
