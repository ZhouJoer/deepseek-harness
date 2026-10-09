---
kind: upgrade-guide
description: "Security asset consumers must handle operator-registered external HTTP targets."
---

# Handle external HTTP security assets

English | [中文](guide.zh.md)

## Change

The security `Asset` union includes `kind: 'external-web'` for operator-registered HTTP targets. Consumers that treated every non-file asset as a managed Docker laboratory or source snapshot must handle this variant. HTTP plans can declare `approvalUse: 'single-execution'`; executing a consumed plan under another execution ID is rejected.

## Migration

1. Upgrade the security Host and client together. Custom asset consumers must use the target's `origin`, `pathPrefix`, `allowedAddresses` and local `environmentId`; external targets have no artifact hash or laboratory instance ID.
2. Keep the same execution ID for retries. To repeat an HTTP verification, prepare and approve a new plan. Do not turn task restoration or Host restart into request replay.
3. Open existing project history and verify it remains readable. Existing journal records require no rewrite; the HTTP evidence summary, step references and approval marker are optional. See the [security package](../../../../packages/experimental/security-analysis/README.md) for authentication and transport limits.
