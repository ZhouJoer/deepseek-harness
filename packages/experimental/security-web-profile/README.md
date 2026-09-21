---
description: "Optional security workbench composition."
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-security-web-profile

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

Compose `@deepseek-ai/dsh-base`, an application bundle, and `@deepseek-ai/dsh-experimental-security-profile` in a dedicated profile. For Web, append `@deepseek-ai/dsh-experimental-security-web-profile`. Launch through `dsh --profile <name>`. See [security analysis](../security-analysis/README.md).

The security Web profile listens on `127.0.0.1:3081` by default; the ordinary Web profile uses port `3080`. An explicit `--port` overrides the security default, including `--port 0` for an allocated port. A busy port fails at bind; the profile does not silently switch ports.

-----

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

- The panel reloads on open, connection reset, refresh and mutations; provider progress still requires refresh. Use ordinary jobs and Session navigation for child details. Tool availability and outstanding environment acceptance are documented in [security analysis](../security-analysis/README.md).

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer working notes (non-authoritative)</summary>

None.

</details>
