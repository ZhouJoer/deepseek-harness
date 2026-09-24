---
description: "Optional security workbench composition."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-security-profile

English | [中文](README.zh.md)

## Summary

View security projects, checks, environments and evidence inside the conversation. This optional extension retains ordinary chat and tool cards. The security domain checks authority for every action. External tools require separate configuration.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

This bundle ships disabled and must be selected explicitly. Compose `@deepseek-ai/dsh-base`, an application bundle, and `@deepseek-ai/dsh-experimental-security-profile` in a dedicated profile. For Web, append `@deepseek-ai/dsh-experimental-security-web-profile`. Launch through `dsh --profile <name>`. The Web conversation automatically starts tasks for the launch directory with the configured `local` environment; customize `taskIntake` for other workspace mappings. See [security analysis](../security-analysis/README.md).

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation details</summary>

The Host patch mounts domain services and dedicated providers. The exported plugin supplies the Web profile with a security-only preset roster: jobs, goal, todo, on-demand security methods, web lookup and compaction accompany domain tools, while shell, filesystem mutation, PTC and arbitrary MCP tools are absent. Role permissions remain in the domain service. Default profiles and agent-loop are unchanged. No invariant companion is published because this package owns disposable composition registrations; the domain owns business state.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Experimental packages](../README.md)
- [Architecture](../../../docs/architecture.md)

-----

<a id="model-experience"></a>
## Model Experience

### Security context

#### What the model sees

The preset exposes the shared `skill` loader. Security method summaries enter the logged skill catalog; selected method bodies are loaded as tool results. `security_scope` belongs to the domain service and records project state in the Session.

#### Token effect

Method summaries, loaded bodies, domain tool schemas and retrieved evidence consume context according to their configured limits. This profile sets `analysisTurnTokens` to 360,000 cumulative provider-reported tokens per analysis turn, including repeated cache reads; it is not an output-token or context-window limit. The service default remains 120,000. Adjust the profile limit to the model and task; this package does not change token accounting.

#### KV Cache effect

Tool definitions and workflow guidance remain stable. Project state enters context through logged tool results.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The panel reloads on open, connection reset, refresh and mutations; provider progress still requires refresh. Use ordinary jobs and Session navigation for child details. Tool availability and outstanding environment acceptance are documented in [security analysis](../security-analysis/README.md).

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer working notes (non-authoritative)</summary>

None.

</details>
