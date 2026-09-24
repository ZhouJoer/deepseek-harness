---
description: "Scoped reverse checks, plan approval and project evidence."
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-security-analysis

English | [中文](README.zh.md)

## Summary

Investigate owned source, binary and Web targets with independent providers and reviewer-bound conclusions. Select checks and validation depth from the security question rather than a fixed sequence. Operators approve execution plans, and tools check authority again at execution. The human report is a short security brief; original evidence remains available for deeper analysis.

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

1. Create a project with its objective and configured environments. Import PE, ELF, APK or DEX files, or an immutable source directory, from the deployment’s `importRoots`.
2. Choose the next analysis question and provider for each asset. APK imports measure DEX and native library members separately and retain their parent relationship.
3. Inspect environment health. Configure executable locations under `environments[].tools`; an installed tool is not proof that a target is accessible.
4. Use implementation evidence to assess hypotheses. When runtime validation is needed, prepare a plan with its target, script, observations, impact, duration and cleanup policy.
5. Inspect and approve the immutable plan in the workbench. Stop or revoke blocks new execution and waits for active provider cleanup. Reconcile interrupted checks before retrying.

The operator can also use `/security` to inspect state or `/security <JSON command>` to submit the same revision-checked commands. `security_help` exposes the command schema. Models cannot create operator approval or publish shared knowledge. A normal command must carry a stable operation ID and the observed revision; stop and revoke accept stale revisions because they only reduce execution authority.

<a id="configure-analysis-providers"></a>
### Configure analysis providers

The package exports separate `./offline`, `./web`, `./laboratory`, `./environment`, `./ghidra`, `./frida`, `./android` and `./commands` plugins. The [configuration source](src/index.ts) owns artifact, output, duration, approval lifetime and delegation limits. Only configured local, Docker and Android environments are eligible. Docker control remains on the Host.

[GhidraMCP 1.4](https://github.com/LaurieWired/GhidraMCP/tree/1.4) requires the [managed patch](resources/ghidra/patch_upstream.py). Apply it to the pinned upstream Java file, build the extension against the corresponding Ghidra distribution, and open the imported program in the GUI. Set `DSH_GHIDRA_TOKEN`, `DSH_GHIDRA_SHA256` `DSH_GHIDRA_PROGRAM` and `DSH_GHIDRA_PORT` before launch; port 0 selects an available port. Optional `DSH_GHIDRA_READY` names a new file that receives the actual port. Configure the same token, measured hash and domain-file path under the Ghidra provider's `programs`. The patch binds a stable program, listens on loopback, authenticates every request and refuses a closed or mismatched program. GUI selection does not retarget queries. Queries, rename, comment and prototype operations use the dedicated adapter; database writes require a plan.

Frida uses official Python bindings through Harness subprocess. Configure a Python installation that contains Frida. Attach requests identify PID, name and start identity; the helper also verifies the executable hash or Android package identity. Custom scripts and spawn require a validation check. The helper unloads and detaches; it terminates only processes it spawned. A configured, hashed Java bridge bundle can be prepended before approval using `javaBridge: true`; [the entry source](resources/java_bridge_entry.js) must be bundled with `frida-compile` and `frida-java-bridge` before configuring its path, hash and version. The approved artifact contains the final script bytes.

JADX accepts APK/DEX assets and reports incomplete decompilation explicitly. adb operations select a configured device and expose only fixed package/device queries. Android validation verifies the installed base APK before instrumentation. Root, Frida server/Gadget, USB authorization and compatible versions remain operator prerequisites. Register `fastboot` and `john` with version arguments to inspect installation; no execution provider exposes their device-writing or audit operations.

### Tool inventory and acceptance

| Tool | Operations and impact | Execution and cleanup | Verified combination |
|---|---|---|---|
| Built-in binary | Measured identity, bounded hex and ASCII/UTF-16LE strings | Immutable artifact reads; bounded output, no target execution | PE/ELF headers and byte-page fixtures |
| GhidraMCP 1.4 | Bound program queries; database writes require a plan | Authenticated loopback, bounded HTTP; database mutations are not replayed | Extension built against Ghidra 11.3.2; independent ARM ELF import completed; DSH queries blocked after GUI closure |
| Frida 17.18.0 | Process/module/export enumeration, trace, approved custom scripts and spawn | Python helper; configured duration/output bounds; unload, detach, stop owned processes | Windows local owned Python executable: normal completion and cancellation |
| JADX | APK/DEX decompilation and source/resource extraction | Managed subprocess; bounded output and temporary-directory cleanup | Integration unverified; partial decompilation is marked incomplete |
| Docker 29.7.2 | Start, inspect and stop an owned environment | Exact image digest, resource limits, no network, remove owned container | Local Docker Desktop with existing Kali ARM64 image: lifecycle and Python command |
| adb | Selected device state, package listing/details, base APK identity read | Fixed argv through subprocess; no arbitrary shell commands | No connected Android device; unverified |
| fastboot / john | Version inventory; fixed John yescrypt acceptance in the managed toolbox | Operator queries and isolated fixture test | Device writes and password audit providers unavailable |

<a id="roles-tasks-and-tool-management"></a>
### Roles, tasks and tool management

The Host operator adds or removes installations in `environments[].tools` in the [example overlay](../../../apps/cli/config/examples/security-analysis/cordis.yml), then restarts the security profile. Each environment rejects duplicate tool IDs. Commands, version arguments and installation sources remain Host configuration; agents cannot install tools or choose arbitrary executables. Removing an installation makes its provider fail explicitly. `security_capabilities` reports role permissions, provider input guidance and installation declarations; `security_environment` checks versions and readiness without provisioning. The workbench environment panel provides operator health and lifecycle actions.

| Role | Task | Available analysis capabilities |
|---|---|---|
| `coordinator` | Plan, integrate and validate | All domain tools, web references, jobs/goal/todo; approved validation execution |
| `reconnaissance` | `inventory` | Binary identity/hex/strings, Ghidra identity/functions/imports/exports/strings, fixed adb queries, environment health, evidence search |
| `reverse-analyst` | `surface`, `assessment` | Binary inspection, all read-only Ghidra queries, JADX and fixed adb queries, environment health, evidence search |
| `web-analyst` | `surface`, `assessment` | Assigned HTTP evidence and immutable source reads/search; no unapproved execution |
| `researcher` | `assessment` | Project evidence, reviewed knowledge, public web search/fetch; no sample execution or static provider calls |
| `reviewer` | `review` | Assigned evidence and knowledge retrieval; no collection, web lookup or validation execution |

Structured reports use the in-process driver’s child-scoped `structured_output` tool. The startup allowlist contains global and inherited tools, excluding the child-local report tool; execution guards still admit the child-scoped report tool.

Each child receives a fresh Session with role-specific instructions and a compatible task. The [prompt and permission definitions](src/workbench/roles.ts) require one asset, a question, completion criteria, time/output limits, evidence references, uncertainty and next steps. Role admission is checked on every tool execution and again on static collection in the domain; hiding schemas alone does not authorize operations. Children cannot delegate, execute plans, approve or publish. The coordinator submits candidate records from their reports. Research prompts exclude private sample content from public queries; network data-loss prevention is not implemented.

The built-in `binary` provider needs no external installation. Call `security_static` with `provider: "binary"`, the assigned asset/environment and `operation: "identity"`, `"hex"` or `"strings"`. Identity reports measured SHA-256 and selected PE/ELF header fields. Hex/string parameters accept byte `offset` and `length`; strings also accept `minLength` and `encoding` (`ascii` or `utf16le`, printable ASCII characters only). Omitted length is one eighth of the output budget. Partial pages retain offsets and incompleteness; overlap pages to inspect strings crossing a page edge. These observations do not establish full file validity, reachability or a vulnerability.

### Evidence and recovery

Raw provider output is saved before its evidence reference. Evidence records retain the sample, tool version, parameters, originating Session/call, completeness and approved plan. `security_evidence` reads bounded original-byte slices. Search rebuilds SQLite FTS from project records and original evidence, with Chinese segmentation and identifiers. Shared knowledge requires a user review and remains reference material, never project evidence.

Retrospectives and experience use the `remember` command with `category`, `title`, `summary`, `conditions`, `actions`, `pitfalls` and `tags`. Entries describe target weaknesses, applicable conditions and practices that improve future identification, validation or prevention. Tool errors and formatting repairs are not reusable security lessons. Legacy free-text notes remain readable by the refinement worker and appear in the UI only after refinement.

Knowledge refinement runs every `knowledgeIntervalMs` (default 3,600,000 ms; zero disables automatic runs) while the Host is running when `knowledgeProvider` and `knowledgeModel` select a dedicated route. The workbench also offers manual refinement, which can use the initiating Agent model when no dedicated route is configured. A fresh tool-free Agent Session logs the complete model request and response. `knowledgeInputBytes` defaults to 131,072 bytes, `knowledgeOutputTokens` to 8,192 tokens; `maxOutputBytes` bounds the complete response and `delegationTimeoutMs` bounds the run.

Refinement skips unchanged inputs and works within one project. Every source entry must be retained, merged or excluded exactly once; a project may have no useful entries. Excluded operational notes leave reports, search, sharing and normal knowledge views while remaining in the journal. Invalid, oversized, cancelled or concurrently edited results cannot replace notes. Changed shared entries require another operator review. A failed attempt can be retried manually or at the next interval. Stopping a project cancels active refinement.

The journal appends one complete command per storage-domain record. A dedicated SQLite ownership lock permits one Host per security root. Restart revokes approvals and marks unfinished executions for reconciliation; it never replays injection or process creation. Exact operation retries do not execute a second time. Use `import-legacy` to preserve a prototype JSON archive as an immutable, operator-declared record. Import the actual sample separately to obtain a measured identity; the archive is not promoted into verified evidence.

-----

### Source snapshots and offline checks

`import-source` saves one directory asset with relative paths, SHA-256 hashes, immutable content artifacts and explicit link exclusions. `maxDerivedAssets` bounds visited entries; `maxArtifactBytes` bounds cumulative source bytes. The `source` provider offers bounded `list`, `read` and literal `search` operations. Results retain file hashes, line numbers and continuation positions. Old file assets remain readable.

The `./offline` plugin accepts Python or browser scripts only through immutable approved plans. Configure a local `docker` installation and an existing image with Python, Node, Playwright and Chromium; the [image recipe](resources/offline/Dockerfile) and [browser runner](resources/offline/browser.mjs) define the runtime layout. Preparation pins the installed image ID. The provider never pulls images. Its configurable limits are `image`, `memoryMb`, `cpus`, `pids`, `temporaryMb` and `graceMs`.

Each execution uses a fresh unprivileged container with no network, no devices, a read-only root and source mount, and bounded temporary storage. Browser requests are intercepted from the snapshot at `http://localhost`. Scripts inject simulated hardware, print runtime versions, events and assertions, and fail on rejected assertions. Evidence records distinguish simulation from static and device observations and retain failure and cleanup details. Container tests exercise Python and Chromium; they do not establish firmware or radio behavior. Host crashes still require operator reconciliation of remaining offline containers.

Model scope and search results show short record summaries, including source evidence paths and read ranges; `security_scope` reads revision-bound record details by byte offset, and `security_evidence` pages original observations by byte offset or selects saved source read lines by line number. `modelResultBytes` defaults to 16,384 bytes for complete model tool responses, while `maxOutputBytes` remains the analysis collection limit. Commands return bounded receipts. Exact observation retries return the stored evidence ID. Child summaries remain on their Session bindings and do not become original evidence or report prose.

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation details</summary>

Tools and generated Remote methods share the [controller](src/workbench/controller.ts). Provider registrations return disposers and compose through the existing Loader. The service adds guidance and executor guards without changing `agent-loop`. Explicit Session bindings determine coordinator, reconnaissance, reverse-analyst, web-analyst, researcher and reviewer authority. Fresh delegated Sessions return evidence IDs and uncertainty; ordinary job results preserve their Session links.

The [journal](src/workbench/journal.ts) owns durable checks and attempts. Jobs, goal and todo coordinate live work but do not replace it. The artifact store publishes complete content by hash; the rebuildable search index cannot delete journal evidence. A corrupt derived index is quarantined and rebuilt from committed records; permission and I/O errors remain visible. No invariant companion is published: journal projections have one writer and are validated on reopen, while provider execution checks current identities and permissions at admission.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Security roadmap](../../../docs/roadmaps/security-analysis.md)
- [Experimental packages](../README.md)
- [Architecture](../../../docs/architecture.md)

-----

## Web laboratory support

The ./web and ./laboratory plugins provide approved HTTP evidence collection and explicit operator-owned lab lifecycle. Use the [Web lab guide](../../../docs/user/guide/security-analysis.md#local-web-laboratory) for setup and the [delivery scope](../../../docs/roadmaps/security-analysis.md#web-delivery-scope-2026-09-22) for unverified or deferred work. The versioned recipe uses official Kali, records installed packages and gates the build on a known yescrypt test vector. The operator can reuse `existingImage` (default `vxcontrol/kali-linux:latest`) from the local Docker image store without a toolbox pull or build. Reuse pins its image ID, measures tools in an owned network-disabled container and records yescrypt failure without blocking HTTP; a missing Python runtime rejects registration. Every reuse or build creates a separate generation, preserving existing labs during upgrades. Nuclei and Metasploit installation does not expose their execution.

Independent reviews bind finding content, same-target evidence and a reviewer Session. A complete static implementation observation can support a reviewed confirmed or refuted result; identity, version and string inventory alone cannot. Runtime conclusions require a completed approved validation plan. Report generation uses one isolated, tool-free model pass over judgments and coverage, then validates every finding's disposition. Markdown contains a short security brief, with excess target findings in an optional appendix; JSON retains the project records. `reportMaxChars` is a soft writing target of 1,200 characters, `reportInputBytes` to 131,072, `reportOutputTokens` to 4,096, `reportMaxFindings` to five and `reportMaxLessons` to three. Without a dedicated route, the report uses the initiating Agent model. Failed or over-budget generation publishes no report.

<a id="model-experience"></a>

## Model Experience

### Security context

#### What the model sees

The coordinator uses `security_scope` and other domain tools to plan checks, search evidence, prepare plans and review conclusions. Children see assigned assets and return summaries, evidence references, uncertainty and next steps. External output, shared knowledge and child reports are untrusted data and cannot expand authority.

#### Token effect

Domain tool schemas and retrieved evidence consume context according to `modelResultBytes`; original collection uses `maxOutputBytes`. `analysisTurnTokens` defaults to 120,000 provider-reported tokens, including cache reads, per project analysis turn. After the limit, the next model step is rejected; saved evidence remains available for a narrower follow-up. The package does not change token accounting.

#### KV Cache effect

Tool definitions and workflow guidance remain stable. Project state enters context through logged tool results.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- Ghidra installation, extension compilation, GUI launch and sample import require operator preparation. DSH function/decompilation/cross-reference acceptance remains pending; a successful import or operator probe does not establish DSH query capability.
- Real Frida 17.18.0 observations and cleanup have been exercised on an owned Windows process. No Android device is available. The installed Kali image lacks Frida, JADX and Ghidra; its presence is not a supported analysis combination.
- Real DeepSeek tutorial analysis exercised static evidence and child report collection, but produced incorrect ELF interpretations. Structured format parsing remains incomplete; the new brief still needs a real-model run and GUI GIF. Keyless tests and simulated external responses are separate evidence.
- Immutable source and binary reads run independently. Providers identify shared external instances for exclusive leases; Ghidra leases use the actual loopback origin. Automatic GUI provisioning, rich component/JNI linking, remote labs, semantic search, device-specific IoT validation, fastboot writes and John password auditing remain unavailable.
- Android split APK validation is refused because one imported base APK cannot establish the complete installed package identity. Local attach refuses platforms that cannot provide a start identity or executable identity.
- Refinement processes a complete project knowledge set; exceeding `knowledgeInputBytes` fails without truncation. Automatic runs require a running Host and a configured model. Semantic equivalence is model-assessed; shared results still require operator review.
- `/legacy` retains the isolated prototype for its recorded Sessions. Do not load it together with the workbench; both register security tool names.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Maintainer working notes (non-authoritative)</summary>

None.

</details>
