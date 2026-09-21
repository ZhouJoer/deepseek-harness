---
description: "Start an isolated security workbench and prepare an approved reverse-analysis check."
---

# Reverse-analysis workbench

English | [中文](security-analysis.zh.md)

Use a separate security profile for authorized samples. This guide assumes a built source checkout, Node and pnpm, and external reverse tools installed by the operator. A DeepSeek model key is needed for agent work; project setup and evidence review can be performed before configuring a model. The complete external-tool acceptance matrix is in the [security package](../../../packages/experimental/security-analysis/README.md#known-limitations-and-deferred-work).

## 1. Prepare the profile

From the repository root, build the checkout with `pnpm run build`. Edit the [example overlay](../../../apps/cli/config/examples/security-analysis/cordis.yml) to point to your actual Python, JADX and Android platform tools. `python` must have the official Frida bindings installed. Paths and tool availability are checked separately from target readiness. The example registers fastboot and john for version inspection only.

Launch through the existing Web application with the security layers:

```sh
pnpm security
```

Run this command from the repository root. The first launch creates the `security` profile from the Web template; subsequent launches reuse it. Every launch applies the security Host, Web and tool configuration overlays. Use `pnpm security --port 4081` to change the port, or `pnpm security --dump-config` to inspect composition without starting services. The shortcut launches the application through the native `dsh` profile entry.

Open `http://127.0.0.1:3081` using the authenticated link printed by DSH. The [security Web profile](../../../packages/experimental/security-web-profile/README.md) owns the default port and `--port` override. For role selection and installation management, see [roles and tools](../../../packages/experimental/security-analysis/README.md#roles-tasks-and-tool-management); planned work and acceptance criteria are in the [roadmap](../../roadmaps/security-analysis.md).

## 2. Set the scope

Choose a workspace and open a Session, then open **Security analysis** above the message composer. Create a project with its objective and allowed configured environments. Import an absolute sample path inside `importRoots`, and create the four-stage check template for that asset. APK members receive their own measured identities and parent links.

Open **Environments and tools** and inspect the selected environment. Missing installations and disconnected devices are shown as diagnostics. Configure Android device IDs and Docker images explicitly in the Host overlay; the default example creates only a local environment. Read the [provider setup](../../../packages/experimental/security-analysis/README.md#configure-analysis-providers) before using Ghidra or a device.

## 3. Collect and evaluate evidence

Use chat to ask for sample inventory, exposed entry points and evidence-backed hypotheses. The coordinator can delegate one bounded static question or independent review. Children receive only the selected asset; their detailed Session remains available through ordinary job results. Browse original evidence and search before repeating analysis.

Each check has dependencies, a completion criterion and supporting evidence. Complete checks separately. If new evidence invalidates an earlier result, reopen that check with a reason; dependent checks reopen and their approvals are revoked. Interrupted work requires reconciliation of the actual process, device and script state before retrying.

## 4. Approve and stop validation

Inspect the exact target, script, hash, expected observations, impact, duration and cleanup in **Findings and validation**. Approve the displayed plan version. Changing the target, script or environment requires another plan; approval also expires. **Stop project** blocks new operations and cancels active provider and delegated work. Resume does not replay unfinished injection or process creation.

Keep suspected, confirmed, refuted and inconclusive findings distinct. A successful tool execution alone does not demonstrate a vulnerability. Shared experience requires operator review and remains reference material rather than project evidence.

## Verify without an Android device

The security profile keeps DSH chat and adds a **Security analysis** entry above the message composer. Select a workspace and open a Session; the entry is visible before the first message. If it is missing, check that you opened the authenticated link from `pnpm security` on port 3081, restart after building the changed client package, and refresh the browser.

1. Open the workbench and create a project named `Demo`, with objective `Inspect the owned static fixture` and environment `local`. Project creation does not require a model key.
2. In **Assets**, import the absolute path of [static-demo.txt](../../../packages/experimental/security-analysis/tests/fixtures/static-demo.txt). Use `Resolve-Path packages/experimental/security-analysis/tests/fixtures/static-demo.txt` in PowerShell to obtain it. The asset should show a measured SHA-256; this inert text fixture contains no executable code or demonstrated vulnerability.
3. Click **Create four-stage check plan**, then open **Checks**. Expect four planned checks with dependencies. Creating a plan does not complete analysis. Try **Stop project** and **Resume project**; the state should survive refresh.
4. Open **Environments and tools** and inspect `local`. Missing external installations should produce explicit diagnostics. This does not prevent the built-in binary provider from reading the imported fixture.
5. After configuring the model, send the following request in chat. Inspect actual tool cards and evidence IDs rather than accepting a prose claim that a tool ran.

```text
Read security_scope and security_capabilities. For the imported static-demo.txt asset, use security_static with provider binary, operation strings and parameters {}. Do not run external tools or dynamic validation. Report the sample SHA-256, the saved evidence ID and the observed DSH_SECURITY_DEMO_V1 and DEMO_PARSER_ENTRY strings. Do not infer a vulnerability from this fixture.
```

Search `DEMO_PARSER_ENTRY` under **Knowledge** to find the collected project evidence and open its original artifact. To check delegation, ask the coordinator to delegate inventory of this same asset to `reconnaissance` with task `inventory`, collect `job_output`, then delegate evidence review to `reviewer` with task `review`. Expected results include child Session links, evidence references and uncertainty; children cannot execute or approve validation plans.

Ghidra GUI analysis, JADX and Frida require their configured external tools. A configured Python executable alone does not establish Frida bindings or device readiness. No Android device is needed for the steps above; passing them does not establish the external-tool acceptance matrix.

## Current acceptance limits

Windows Frida success/cancellation and Docker lifecycle have real local integration tests. No Android device is available for acceptance. Ghidra GUI integration, three-target four-stage analysis and a real-model Web recording still require their external environments. The package README records remaining implementation limits; this experimental version is not a claim that the full planned release has passed acceptance.
