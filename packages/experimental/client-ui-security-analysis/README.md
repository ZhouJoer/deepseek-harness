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

The **Analysis toolbox** offers All, Reverse engineering, Web, IoT and General tools filters for browsing; filters do not select a task's analysis route. New analysis keeps optional session tool preferences under **More options**. Apply edited preferences or restore automatic selection before starting; pending or failed saves retain the draft and prevent submission. Existing tasks retain their session preference editor. Analysis progress shows the saved selection rationale beside recorded tool activity. The [domain package](../security-analysis/README.md#use-this-package) owns content-based method and tool selection.

**Check coverage** in Overview lists execution states, completion conditions, unresolved dependencies and explicitly linked observations. It separates inventory, implementation, failure, incompleteness and current accepted static/runtime reviews. Materials without checks and observations without check links remain visible. **Resolve blocker** opens the existing advanced check form at that record; enter a reason and reconcile it to planned without starting execution. Project changes clear the target, and a removed target reports that it is unavailable. Coverage waits when its revision differs from the visible records.

Evidence opened from Investigation, Findings or Evidence shares the source preview with paths, line numbers and code; original output remains expandable and copyable. Beside the report revision selector, **Export evidence archive** starts an authenticated ZIP download for that saved revision. The [domain package](../security-analysis/README.md#source-snapshots-and-offline-checks) defines contents, omissions, checksums and limits. The notification confirms download handoff, not successful disk storage; retain only a completed download that passes its checksums.

New analysis requires a workspace attempt limit from saved resource settings or Host `taskIntake.maxAttempts`. When it is missing, the creation page opens the workspace resource form and keeps Start analysis disabled until the settings are saved. The advanced workbench uses the same form and limit.

Select multiple files at once or add files in batches before starting; the selection lists every filename and shares one upload budget. Drag the assistant's left edge or use the focused divider's arrow keys to change its width. **Expand to full page** and **Restore split view** retain the conversation draft. The task's **Plan approvals** button opens saved validation plans directly; pending plans show a notice. Review the operation, impact and cleanup, choose **Approve this version**, then **Execute plan**. An empty list means the assistant must first save a validation plan.

Approval cards label the hypothesis, expected observation, actual execution location, impact and cleanup. Parameters, version hashes and complete execution records are expandable. Approval and execution status remain separate; a failed execution refreshes its saved result. Offline Python runs in a Linux container even when the selected environment is local. It reads imported snapshots under `/input/source`, not Host Windows paths, and cannot natively load Windows DLLs. A failed plan must be corrected for its actual runtime before another approval; approval alone does not repair missing files. Manual plan preparation remains under **Findings**.

Native Python plans display the Host platform, pinned interpreter/version, working directory and Host permission scope before approval. Choose this provider for local Windows validation; supply complete Python code. Native plans use live Host files and do not provide Docker isolation. Changing from offline to native requires a new plan and approval.

Compose `@deepseek-ai/dsh-base`, an application bundle, and `@deepseek-ai/dsh-experimental-security-profile` in a dedicated profile. For Web, append `@deepseek-ai/dsh-experimental-security-web-profile`. Launch through `dsh --profile <name>`. See [security analysis](../security-analysis/README.md).

The Toolbox's **Analysis scripts** tab lists built-in packet, MQTT and native-process observation scripts. Search names, purposes or dependencies, filter categories, and expand a script for its method, parameters, installed path, example, output and limitations. Browsing needs no project or environment and does not probe or execute tools. The associated skill supplies the Agent with the same resources; [the script library](../security-analysis/README.md#use-this-package) owns execution and output rules.

Open **Security analysis** from the sidebar or the compact **Security workspace** composer entry. The Dashboard shows task counts, name/objective search and status filters. **New analysis** selects a workspace, stages optional files, folders, text or a Host path, and sends the objective through a new native Session after saving the task and materials. **More options** selects the environment. A failed send retries only sending. Task details open **Investigation**, with Overview, Assets, Findings, Evidence and Reports available alongside it; evidence previews retain their search on return, and saved Markdown reports render with version and format selectors. **Analysis assistant** opens the native conversation in the right pane; collapsing it retains its draft, while switching tasks or leaving the panel releases its reference. Historical browsing creates no Session and changes no task binding. If no accessible coordinator Session remains, **Continue analysis** explicitly creates and associates one. Stopped tasks require explicit resumption, and restoring a removed task keeps it stopped. Refresh is available manually and after reconnects, operations and assistant turns.

**Investigation** connects saved materials, checks, research directions, child tasks, observations, findings, validation plans and reviews. Cards show titles, summaries and states. Switch between the graph and **List**, search questions or results, filter running work or records needing attention, and focus a branch. Narrow screens initially use the list. Linked observations are folded by default; **Expand observations** or a search reveals them. The graph uses only saved relationships: unrelated historical records remain unlinked, and missing referenced records are reported without invented nodes or connections.

Select a record to read its result, conditions and related work. Select a related observation by title to read its original saved output; failed or incomplete collection, observation method and cleanup remain visible. Identifiers, hashes and complete record metadata are folded under copyable **Technical details**. A saved review is historical; the finding's state carries the current conclusion. Validation plans link to the existing **Plan approvals** controls for reviewing impact and approving the displayed version.

-----

Source file or directory assets provide file inventory, line reads and literal searches from the conversation workbench. Evidence cards label static observations, offline simulations and device validation, with failure and cleanup details. Each research direction lists recorded child questions, roles, execution states, returned summaries and the coordinator's report decisions. Expand a child task for its dispatch reason, completion criterion, evidence references, uncertainty and suggested next steps; **Open child conversation** opens its original one-shot history. Accepting a child report does not confirm a finding. Directions without saved assignments say that no child tasks are recorded; older child summaries remain in the advanced workbench history.

The Toolbox's **Devices** tab reads cached observations on opening. **Inspect devices** explicitly inspects the selected environment; failures retain previous interfaces with observation times. Serial cards show COM/PnP and available USB identifiers without authenticating Tufty or opening ports. In task materials, choose Wi-Fi or BLE and a local environment, then **Analyze capture** or **Inspect frames**. A stopped task must be resumed; a task without an accessible conversation needs **Continue analysis** first. Results enter the existing evidence and progress views. File sizes remain visible and technical details retain hashes; raw capture bytes are not rendered as text.

**Web targets** in New analysis accepts an authorized site origin, path prefix and IP/CIDR ranges. In task details, **HTTP validation** provides target registration, private identity configuration, login recipes and structured request editing. Connect an analysis conversation before preparing a plan, inspect the expanded login and test requests, then use the existing approval and execution controls. Used approvals remain visible with execution results and cannot execute again.

**Request history** filters by target, method, path and status. Select a request to read its Host-paged template, response headers or text body; select two to compare their displayed status and content. Missing, redacted, omitted or truncated content prevents an equality conclusion. **Create replay draft** copies testing steps into an editable draft; it sends no request. **Link finding** records the HTTP step and its baseline, verification or supporting role and returns the claim to independent review.

The task list uses one Host directory subscription for live running, stopping, paused, interrupted, approval, attention and idle states. Running tasks can also need approval. Idle does not mean complete. **Resume** releases a pause, **Resolve blocker** records reconciliation, **Continue analysis** opens or explicitly creates a conversation, and a fresh validation plan controls repeated HTTP requests. Evidence and findings in the activity timeline open their saved details.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation details</summary>

This package composes capabilities through a profile patch or input dock slot. It changes neither default profiles nor agent-loop. The browser calls the domain through generated Remote methods and uses bilingual dictionaries. Security tool cards show preparation and execution as running; result details and error status appear only after a result is logged. A successful delegation receipt says **Dispatched**; the activity view follows the child's saved execution and report decisions. No invariant companion is published because this package owns disposable composition/UI registrations; the domain owns business state.

The investigation graph is a read-only projection of the current WorkbenchView. It shares the Dashboard's existing project activity subscription with the execution timeline, and loads artifact previews only when selected. Graph navigation creates no model turn or persistent relationship. Existing domain methods continue to own approval and execution.

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

The main chat keeps a compact **Tools** count badge above the composer. Click it to open **Tools & progress** in the native right sidebar; the badge updates even while the sidebar is closed. An unlinked chat shows an explicit empty state in the sidebar. It follows Session selection and project activity through separate disposable streams. Task details retain a **Tools & progress** tab for the execution timeline. Both timeline surfaces show three lines per direction: tools, current conclusion, and next action or blocker. Repeated rounds update one direction; returning to reconnaissance creates a distinct direction when the question changes. Tool names and counts are references, with same-name counts combined and no execution-verification badges. Execution failures and incomplete output remain visible. Expand a direction for bounded invocation pages and evidence titles; call identifiers and parameters remain under technical details. Empty states distinguish missing saved records from conversation summaries. Reconnection restores a project-scoped baseline. The sidebar is read-only. The native composer keeps its existing stop control; pausing the entire project remains a workbench management action. Enter additions or corrections directly in the native composer; explicitly resume a paused project before continuing its analysis.


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
