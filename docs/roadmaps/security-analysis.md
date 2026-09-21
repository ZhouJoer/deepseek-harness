---
description: "Security harness delivery priorities, dependencies and acceptance criteria."
---

# Security harness roadmap

English | [中文](security-analysis.zh.md)

## Summary

This roadmap tracks the optional DeepSeek Harness security extension as of 2026-09-21. It is a delivery plan, not a support claim. The objective is a recoverable long-running security check: reconnaissance → surface analysis → assessment and retrieval → controlled validation. The [package reference](../../packages/experimental/security-analysis/README.md) owns current runtime behavior and the tool compatibility matrix; the [user guide](../user/guide/security-analysis.md) owns setup.

## Contents

- [Feature TODO](#feature-todo)
- [Baseline](#baseline)
- [Delivery milestones](#delivery-milestones)
- [Tool and environment expansion](#tool-and-environment-expansion)
- [Release acceptance](#release-acceptance)

<a id="feature-todo"></a>
## Feature TODO

These items describe product capabilities, not a test checklist. Existing implementation is summarized under Baseline; unchecked items remain incomplete even where an adapter or UI skeleton exists.

### P0: usable reverse-analysis agent

- [ ] **Project home and recap**: expose persistent projects outside the chat composer; show assets, coverage, blockers and the latest recap; open a readable report with linked evidence and child summaries without searching knowledge manually.
- [ ] **Structured ELF/PE analysis**: parse headers, sections, segments, symbols, imports and relative addresses with a maintained library; let the model reason over parsed fields instead of calculating offsets from hex dumps.
- [ ] **Managed Ghidra workflow**: launch the configured GUI, import and bind a sample, expose analysis progress, then browse decompilation, assembly, cross-references and permitted database edits from the project.
- [ ] **Evidence-backed review**: persist review decisions, supporting/opposing evidence and unresolved claims; associate corrections with the original finding and expose them in the recap.
- [ ] **Long-running check orchestration**: turn dependencies into runnable work, assign bounded child tasks, continue independent checks when one blocks, and resume after explicit state reconciliation.
- [ ] **Project budgets**: enforce cumulative delegation attempts, token/cost limits and repeated-failure limits; display consumption and let the operator pause or adjust limits.
- [ ] **Usable controlled dynamic analysis**: preview versioned observation/validation scripts, explain exact targets and effects, stream bounded event summaries, and show cleanup outcomes with static/dynamic location links.

### P1: tools, knowledge and Android workflow

- [ ] **Tool and environment management page**: configure tool paths and versions, show role permissions and readiness, manage local Docker/Kali environments and expose resource occupancy; distinguish installed tools from executable capabilities.
- [ ] **Android analysis workflow**: connect an authorized device or emulator, import APK/DEX/SO, correlate Manifest components, Java/Kotlin methods and JNI entry points, and guide the user through Frida prerequisites.
- [ ] **Knowledge workflow**: turn project findings and recaps into reviewable reusable methods; add structured relationship filters, applicability/version fields and navigation between knowledge, findings and source evidence.
- [ ] **Operator workflow**: offer clear plan approval/revocation, project stop/resume, live task progress and reconnection recovery; preserve chat while making domain actions discoverable.
- [ ] **Extensible role and task templates**: register role tool policies, task prompts, completion conditions and environment needs without editing the fixed built-in role tables.

### P2: additional security projects

- [ ] **Web security projects**: authorized target inventory, exposed-entry mapping, session/browser environments and controlled validation templates using the same evidence and approval services.
- [ ] **IoT and firmware projects**: firmware composition and filesystem inventory, architecture identification, service/configuration analysis, and device-specific environments with explicit recovery plans.
- [ ] **Additional tool providers**: read-only fastboot inventory and authorized offline john audits with resource limits; keep device writes as a separately authorized capability.
- [ ] **Remote laboratories and semantic retrieval**: add remote environment ownership/cleanup and semantic knowledge search while preserving project isolation and exact evidence retrieval.

<a id="baseline"></a>
## Baseline

The workspace includes optional Host/Web profiles, an evidence journal and FTS index, immutable artifacts, four-stage checks, validation-plan authorization, interruption reconciliation, and dedicated Ghidra/Frida/Android adapters. Built-in binary inspection, role-scoped tools and task prompts support coordinator, reconnaissance, reverse-analyst, researcher and reviewer Sessions. The security Web default port is separate from the general Web profile. This baseline remains experimental.

PentAGI informs specialist delegation, reference retrieval and concise result reports. This extension keeps explicit project/Session roles, evidence references, user-owned approval and independent review. No prompt treats all future operations as pre-authorized; a child's report cannot enlarge its scope or impersonate the user. Implementation details remain in [role and prompt definitions](../../packages/experimental/security-analysis/src/workbench/roles.ts).

Real Windows Frida completion/cancellation and local Docker lifecycle have been exercised. A real DeepSeek run on the tutorial hello_world AArch64 sample exercised import, static evidence, retrieval and fresh child reports, but exposed incorrect model interpretations of ELF offsets and symbols. Ghidra GUI integration, Android device analysis, full four-stage acceptance and a model-driven GIF remain incomplete. No Android device is available. Simulations and keyless replay do not substitute for those checks.

<a id="delivery-milestones"></a>
## Delivery milestones

| Priority | Deliverable | Dependency | Exit criterion |
|---|---|---|---|
| P0 | Managed Ghidra GUI startup, import and program binding | Compatible Ghidra/JDK and compiled managed extension | Import owned PE/ELF/SO; verify actual hash, program switching rejection, concurrent read/write leases, timeout and GUI closure |
| P0 | Android static and dynamic closure | Authorized device/emulator, adb, JADX and Frida prerequisites | Link Manifest components, Java/Kotlin methods and JNI modules; exercise device loss, module mismatch and incomplete decompilation; complete four stages for an owned APK |
| P0 | Durable independent review and delegation acceptance | Existing role bindings and evidence records | Persist review decisions linked to evidence/version; execute fresh children through the real preset; reject foreign evidence, role escalation and incompatible tasks; retain reviewer Session links |
| P0 | Complete evidence and recovery lifecycle | Provider lifecycle hooks and artifact storage | Preserve raw observations during helper failure/output floods; reconcile persisted process/container ownership; never replay spawn/injection after restart; prove cancellation leaves external processes running |
| P1 | Rich tool management in the workbench | Host inventory and capability/health results | Display install declarations, measured versions, role permissions, readiness failures and lease ownership separately; add reviewed installation recipes and compatibility checks without arbitrary model shell |
| P1 | Workbench completion and usability | Authoritative domain state and generated Remote | Show delegation summaries, evidence offsets, reference links, review status and live progress; test stop/reconnect/reconcile; record GIF from real service and model |
| P1 | Knowledge quality and retrieval | Project evidence and reviewed shared experience | Add structured relation filters, multilingual identifier/address cases, scoped rebuild tests and source-version review; shared experience cannot become project evidence implicitly |
| P2 | Web security project extension | Reusable provider/role/task registration and isolated environment | Deliver allowlisted target import, entry-point mapping and approved bounded verification in an owned test application; reuse evidence and approval lifecycle |
| P2 | IoT project extension | Device leases, image identities and reset/cleanup plans | Deliver firmware inventory and read-only image analysis first; add device-specific validation only after reproducible environment and cleanup acceptance |

P0 completes the first reverse-analysis release. P1 improves operation and maintainability after that closure. P2 introduces new project types; it does not expand first-release authorization. Dependencies determine scheduling; no date promises precede the required environments.

<a id="tool-and-environment-expansion"></a>
## Tool and environment expansion

| Area | First-release handling | Next admission requirement |
|---|---|---|
| Binary triage | Built-in identity/hex/string observations | Add richer format parsing through a maintained parser when section/import metadata needs it; retain incomplete-result semantics |
| Ghidra, JADX, Frida, adb | Dedicated adapters and fixed operation sets | Complete the P0 real-environment matrix before declaring supported combinations |
| Kali/Docker | Operator-selected local image, owned lifecycle and resource limits | Pin tested image digests and tool versions; persist ownership and diagnostics; never silently choose another image |
| fastboot | Installation/version inventory only | Separate read-only inventory from device-writing provider; require device identity, explicit plans and recovery acceptance before writes |
| john | Installation/version inventory only | Add an authorized offline audit provider with immutable input, CPU/time limits, output handling and cleanup before enabling audit execution |
| Web/IoT specialist tools | No execution providers in this release | Register asset types, tool capabilities, role policies, prompts, environment needs and evidence adapters together |
| Remote laboratories and VM orchestration | Deferred | Define credentials, transport trust, ownership reconciliation, cancellation and cleanup before provisioning |
| Semantic search | Deferred | Evaluate retrieval quality and project isolation while retaining rebuildable exact full-text search |

Tool additions must include a consumer-visible capability, bounded execution, environment checks, evidence capture, role denial tests and cleanup. Provider registration alone does not mean a tool is installed or ready. Installation, system privilege elevation and device modification remain explicit operator actions. Public-source research prompts exclude private sample data; enforceable network egress/data-loss controls remain future work.

<a id="release-acceptance"></a>
## Release acceptance

1. Complete the four stages for owned Android APK/DEX/JNI, Windows PE and Linux ELF samples, including confirmed, refuted and inconclusive findings. Record exact tool/runtime versions and raw evidence.
2. Reject program switching, PID reuse, stale approval, changed scripts, foreign assets, child escalation and raw shell/PTC/MCP bypass through actual execution entry points.
3. Exercise disconnects, target exit, script errors, cancellation, floods, cleanup failure and Host restart. Verify no side-effect replay and visible uncertainty after failed cleanup.
4. Run real Loader/profile tests, keyless Session snapshots, persistence-type checks, build/type/document checks, and browser workflows. Report external-tool simulation separately from real-environment results.
5. Publish only environment combinations actually exercised; list outstanding limitations and attach a real-service, real-model Web GIF to any GUI PR.
