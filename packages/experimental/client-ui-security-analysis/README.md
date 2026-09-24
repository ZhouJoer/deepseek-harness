---
description: "Optional security workbench composition."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-security-analysis

English | [中文](README.zh.md)

## Summary

Describe a security task in chat and review its findings, evidence and reports. Configure resources once per workspace. The optional panel retains ordinary conversation and tool cards; detailed assets, checks, environments and review controls are available when needed. The security domain checks authority for every action. External tools require separate configuration.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Compose `@deepseek-ai/dsh-base`, an application bundle, and `@deepseek-ai/dsh-experimental-security-profile` in a dedicated profile. For Web, append `@deepseek-ai/dsh-experimental-security-web-profile`. Launch through `dsh --profile <name>`. See [security analysis](../security-analysis/README.md).

Open Security analysis above the message composer, including in a new empty Session. Select the workspace resources and save them, then describe the task in chat. The default tabs show the task overview, findings, evidence and reports. The overview distinguishes confirmed findings, pending review and blocked work. Expand detailed controls for manual project selection, assets, checks, environments, reviews and knowledge. Leaving a project preserves its records and disables automatic intake for that Session. Project stop waits for cleanup; refresh after a disconnect to reload authoritative state.

-----

Source file or directory assets provide file inventory, line reads and literal searches from the conversation workbench. Evidence cards label static observations, offline simulations and device validation, with failure and cleanup details. Project overviews and reports retain completed child Session summaries; original child interaction remains in Session navigation.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation details</summary>

This package composes capabilities through a profile patch or input dock slot. It changes neither default profiles nor agent-loop. The browser calls the domain through generated Remote methods and uses bilingual dictionaries. No invariant companion is published because this package owns disposable composition/UI registrations; the domain owns business state.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Experimental packages](../README.md)
- [Architecture](../../../docs/architecture.md)

-----

## Persistent security projects

The sidebar Security analysis panel lists projects, targets, checks, findings, reviews, reports and laboratory generations without requiring a selected conversation. The toolbox page offers explicit local-image reuse and new-image builds; both preserve existing laboratory image identities. The conversation workbench registers running Web targets, applies independent reviews and generates revision reports. Both project views render saved Markdown briefs and optional findings appendices directly. The [Web guide](../../../docs/user/guide/security-analysis.md#local-web-laboratory) describes the workflow and current provider limits.

<a id="model-experience"></a>

## Model Experience

### Security context

#### What the model sees

This package supplies no direct model input; `security_scope` belongs to the domain service. Domain tools record model-visible results in the Session.

#### Token effect

Domain tool schemas and retrieved evidence consume context according to the configured output limit. This package does not change token accounting.

#### KV Cache effect

Tool definitions and workflow guidance remain stable. Project state enters context through logged tool results.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The panel reloads on open, connection reset, refresh, mutations and the end of the current turn while open; intermediate provider progress requires refresh. Use ordinary jobs and Session navigation for child details. Tool availability and outstanding environment acceptance are documented in [security analysis](../security-analysis/README.md).

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer working notes (non-authoritative)</summary>

None.

</details>
