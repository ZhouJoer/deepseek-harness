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

This bundle ships disabled and must be selected explicitly. Compose `@deepseek-ai/dsh-base`, an application bundle, and `@deepseek-ai/dsh-experimental-security-profile` in a dedicated profile. For Web, append `@deepseek-ai/dsh-experimental-security-web-profile`. Launch through `dsh --profile <name>`. Web conversations automatically start tasks with the configured `local` environment, including workspaces outside the launch directory. Exact `taskIntake.workspaces` mappings and saved workspace selections override this default. See [security analysis](../security-analysis/README.md).

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation details</summary>

The Host patch mounts domain services and dedicated providers. The bundle registers the declarative security preset with `agent-preset-registry`; the Web patch selects it as the default. The security preset includes native file reading, writing, editing and search, PowerShell on Windows or Bash on POSIX, jobs, goal, todo, security methods, web lookup and compaction. The coordinator and collecting roles can run workspace scripts under inherited DSH permissions; research and reviewer roles retain evidence-only access. Delegation composes the parent's preset before applying the child's role filter. Default profiles and agent-loop are unchanged. No invariant companion is published because this package owns disposable composition registrations; the domain owns business state.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Experimental packages](../README.md)
- [Architecture](../../../docs/architecture.md)

-----


This profile enables automatic [continuous improvement](../security-analysis/README.md#continuous-improvement) after five minutes of task inactivity. The analysis uses a separate model Session and adds model usage; set `security-workbench.config.evolution.auto` to false in an overlay to keep manual analysis only.

<a id="model-experience"></a>

## Model Experience

### Security context

#### What the model sees

The preset exposes the shared `skill` loader. Security method summaries enter the logged skill catalog; selected method bodies are loaded as tool results. `security_scope` belongs to the domain service and records project state in the Session.

#### Token effect

Method summaries, loaded bodies, domain tool schemas and retrieved evidence consume context according to their configured limits. This profile sets `analysisTurnTokens` to 360,000 exploration tokens per Session turn; the service default is 120,000. Uncached input, cache writes and output count by default. Set `analysisCountCacheReads: true` to include repeated cache reads. Complete provider usage remains logged, so this allowance is not a billing total or context-window limit. The [analysis service](../security-analysis/README.md#model-experience) provides a final checkpoint when exploration reaches its allowance.

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
