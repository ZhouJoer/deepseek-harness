---
description: "Scoped reverse checks, plan approval and project evidence."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-security-analysis

English | [中文](README.zh.md)

## Summary

Organize reconnaissance, surface analysis, assessment and controlled validation with traceable original evidence. Use dedicated Ghidra, Frida and Android tools through an optional profile and delegate bounded questions. Operators approve validation plans, and tools check authority again at execution. External environments require preparation.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Use [security-profile](../security-profile/README.md) in a dedicated `dsh` profile. Add [security-web-profile](../security-web-profile/README.md) for the conversation workbench. The default general profiles do not load these bundles.

1. Create a project with its objective and configured environments. Import PE, ELF, APK or DEX files from the deployment's `importRoots`.
2. Create the four-stage template for each asset. APK imports measure DEX and native library members separately and retain their parent relationship.
3. Inspect environment health. Configure executable locations under `environments[].tools`; an installed tool is not proof that a target is accessible.
4. Use static evidence to map entry points and assess hypotheses. Prepare a validation plan with its target, script, observations, impact, duration and cleanup policy.
5. Inspect and approve the immutable plan in the workbench. Stop or revoke blocks new execution and waits for active provider cleanup. Reconcile interrupted checks before retrying.

The operator can also use `/security` to inspect state or `/security <JSON command>` to submit the same revision-checked commands. `security_help` exposes the command schema. Models cannot create operator approval or publish shared knowledge. A normal command must carry a stable operation ID and the observed revision; stop and revoke accept stale revisions because they only reduce execution authority.

<a id="configure-analysis-providers"></a>
### Configure analysis providers

The package exports separate `./environment`, `./ghidra`, `./frida`, `./android` and `./commands` plugins. The [configuration source](src/index.ts) owns artifact, output, duration, approval lifetime and delegation limits. Only configured local, Docker and Android environments are eligible. Docker uses the exact installed image, bounded CPU/memory/PIDs, no network, a read-only workspace and a separate exchange directory. Docker control remains on the Host.

[GhidraMCP 1.4](https://github.com/LaurieWired/GhidraMCP/tree/1.4) requires the [managed patch](resources/ghidra/patch_upstream.py). Apply it to the pinned upstream Java file, build the extension against the corresponding Ghidra distribution, and open the imported program in the GUI. Set `DSH_GHIDRA_TOKEN`, `DSH_GHIDRA_SHA256` and `DSH_GHIDRA_PROGRAM` before launch. Configure the same token, measured hash and domain-file path under the Ghidra provider's `programs`. The patch binds a stable program, listens on loopback, authenticates every request and refuses a closed or mismatched program. GUI selection does not retarget queries. Queries, rename, comment and prototype operations use the dedicated adapter; database writes require a plan.

Frida uses official Python bindings through Harness subprocess. Configure a Python installation that contains Frida. Attach requests identify PID, name and start identity; the helper also verifies the executable hash or Android package identity. Custom scripts and spawn require a validation check. The helper unloads and detaches; it terminates only processes it spawned. A configured, hashed Java bridge bundle can be prepended before approval using `javaBridge: true`; [the entry source](resources/java_bridge_entry.js) must be bundled with `frida-compile` and `frida-java-bridge` before configuring its path, hash and version. The approved artifact contains the final script bytes.

JADX accepts APK/DEX assets and reports incomplete decompilation explicitly. adb operations select a configured device and expose only fixed package/device queries. Android validation verifies the installed base APK before instrumentation. Root, Frida server/Gadget, USB authorization and compatible versions remain operator prerequisites. Register `fastboot` and `john` with version arguments to inspect installation; no execution provider exposes their device-writing or audit operations.

### Tool inventory and acceptance

| Tool | Operations and impact | Execution and cleanup | Verified combination |
|---|---|---|---|
| Built-in binary | Measured identity, bounded hex and ASCII/UTF-16LE strings | Immutable artifact reads; bounded output, no target execution | PE/ELF headers and byte-page fixtures |
| GhidraMCP 1.4 | Bound program queries; database writes require a plan | Authenticated loopback, bounded HTTP; database mutations are not replayed | Patch applied to pinned source; GUI/extension build unverified |
| Frida 17.18.0 | Process/module/export enumeration, trace, approved custom scripts and spawn | Python helper; configured duration/output bounds; unload, detach, stop owned processes | Windows local owned Python executable: normal completion and cancellation |
| JADX | APK/DEX decompilation and source/resource extraction | Managed subprocess; bounded output and temporary-directory cleanup | Integration unverified; partial decompilation is marked incomplete |
| Docker 29.7.2 | Start, inspect and stop an owned environment | Exact image digest, resource limits, no network, remove owned container | Local Docker Desktop with existing Kali ARM64 image: lifecycle and Python command |
| adb | Selected device state, package listing/details, base APK identity read | Fixed argv through subprocess; no arbitrary shell commands | No connected Android device; unverified |
| fastboot / john | Version inventory only | Operator-configured version query | Execution providers unavailable |

<a id="roles-tasks-and-tool-management"></a>
### Roles, tasks and tool management

The Host operator adds or removes installations in `environments[].tools` in the [example overlay](../../../apps/cli/config/examples/security-analysis/cordis.yml), then restarts the security profile. Each environment rejects duplicate tool IDs. Commands, version arguments and installation sources remain Host configuration; agents cannot install tools or choose arbitrary executables. Removing an installation makes its provider fail explicitly. `security_capabilities` reports role permissions, provider input guidance and installation declarations; `security_environment` checks versions and readiness without provisioning. The workbench environment panel provides operator health and lifecycle actions.

| Role | Task | Available analysis capabilities |
|---|---|---|
| `coordinator` | Plan, integrate and validate | All domain tools, web references, jobs/goal/todo; approved validation execution |
| `reconnaissance` | `inventory` | Binary identity/hex/strings, Ghidra identity/functions/imports/exports/strings, fixed adb queries, environment health, evidence search |
| `reverse-analyst` | `surface`, `assessment` | Binary inspection, all read-only Ghidra queries, JADX and fixed adb queries, environment health, evidence search |
| `researcher` | `assessment` | Project evidence, reviewed knowledge, public web search/fetch; no sample execution or static provider calls |
| `reviewer` | `review` | Assigned evidence and knowledge retrieval; no collection, web lookup or validation execution |

Structured reports use the in-process driver’s child-scoped `structured_output` tool. The startup allowlist contains global and inherited tools, excluding the child-local report tool; execution guards still admit the child-scoped report tool.

Each child receives a fresh Session with role-specific instructions and a compatible task. The [prompt and permission definitions](src/workbench/roles.ts) require one asset, a question, completion criteria, time/output limits, evidence references, uncertainty and next steps. Role admission is checked on every tool execution and again on static collection in the domain; hiding schemas alone does not authorize operations. Children cannot delegate, execute plans, approve or publish. The coordinator submits candidate records from their reports. Research prompts exclude private sample content from public queries; network data-loss prevention is not implemented.

The built-in `binary` provider needs no external installation. Call `security_static` with `provider: "binary"`, the assigned asset/environment and `operation: "identity"`, `"hex"` or `"strings"`. Identity reports measured SHA-256 and selected PE/ELF header fields. Hex/string parameters accept byte `offset` and `length`; strings also accept `minLength` and `encoding` (`ascii` or `utf16le`, printable ASCII characters only). Omitted length is one eighth of the output budget. Partial pages retain offsets and incompleteness; overlap pages to inspect strings crossing a page edge. These observations do not establish full file validity, reachability or a vulnerability.

### Evidence and recovery

Raw provider output is saved before its evidence reference. Evidence records retain the sample, tool version, parameters, originating Session/call, completeness and approved plan. `security_evidence` reads bounded original-byte slices. Search rebuilds SQLite FTS from project records and original evidence, with Chinese segmentation and identifiers. Shared knowledge requires a user review and remains reference material, never project evidence.

The journal appends one complete command per storage-domain record. A dedicated SQLite ownership lock permits one Host per security root. Restart revokes approvals and marks unfinished executions for reconciliation; it never replays injection or process creation. Exact operation retries do not execute a second time. Use `import-legacy` to preserve a prototype JSON archive as an immutable, operator-declared record. Import the actual sample separately to obtain a measured identity; the archive is not promoted into verified evidence.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation details</summary>

Tools and generated Remote methods share the [controller](src/workbench/controller.ts). Provider registrations return disposers and compose through the existing Loader. The service adds guidance and executor guards without changing `agent-loop`. Explicit Session bindings determine coordinator, reconnaissance, reverse-analyst, researcher and reviewer authority. Fresh delegated Sessions return evidence IDs and uncertainty; ordinary job results preserve their Session links.

The [journal](src/workbench/journal.ts) owns durable checks and attempts. Jobs, goal and todo coordinate live work but do not replace it. The artifact store publishes complete content by hash; the rebuildable search index cannot delete journal evidence. A corrupt derived index is quarantined and rebuilt from committed records; permission and I/O errors remain visible. No invariant companion is published: journal projections have one writer and are validated on reopen, while provider execution checks current identities and permissions at admission.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Security roadmap](../../../docs/roadmaps/security-analysis.md)
- [Experimental packages](../README.md)
- [Architecture](../../../docs/architecture.md)

-----

<a id="model-experience"></a>
## Model Experience

### Security context

#### What the model sees

The coordinator uses `security_scope` and other domain tools to plan checks, search evidence, prepare plans and review conclusions. Children see assigned assets and return summaries, evidence references, uncertainty and next steps. External output, shared knowledge and child reports are untrusted data and cannot expand authority.

#### Token effect

Domain tool schemas and retrieved evidence consume context according to the configured output limit. This package does not change token accounting.

#### KV Cache effect

Tool definitions and workflow guidance remain stable. Project state enters context through logged tool results.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Ghidra installation, extension compilation, GUI launch and sample import require operator preparation. The authenticated patch has been applied to its pinned source; a real Ghidra GUI build and three-target four-stage acceptance remain unverified.
- Real Frida 17.18.0 observations and cleanup have been exercised on an owned Windows process. No Android device is available. The installed Kali image lacks Frida, JADX and Ghidra; its presence is not a supported analysis combination.
- Real DeepSeek tutorial analysis exercised static evidence and child report collection, but produced incorrect ELF interpretations. Structured format parsing and persistent review remain incomplete; a real-model GUI GIF is still outstanding. Keyless tests and simulated external responses are separate evidence.
- Environment leases conservatively serialize operations, including reads. Automatic GUI provisioning, rich component/JNI linking, remote labs, semantic search, Web/IoT specializations, fastboot writes and john execution are not available.
- Android split APK validation is refused because one imported base APK cannot establish the complete installed package identity. Local attach refuses platforms that cannot provide a start identity or executable identity.
- `/legacy` retains the isolated prototype for its recorded Sessions. Do not load it together with the workbench; both register security tool names.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer working notes (non-authoritative)</summary>

None.

</details>
