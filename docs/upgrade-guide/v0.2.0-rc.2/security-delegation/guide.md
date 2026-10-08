---
kind: upgrade-guide
description: "Security workbench records add delegation outcomes and move new child reports out of Session bindings."
---

# Security delegation records

English | [中文](guide.zh.md)

## Change

The experimental security workbench adds `kind: "delegation"` to its public `SecurityRecord` union and stored project journal. New child reports are attached to these records instead of `binding.report`. Existing projects and historical binding reports remain readable. Session log format and the storage-domain version are unchanged; older workbench builds cannot read journal entries containing the new record kind.

Web and reverse analyst roles also receive `web_search` and `web_fetch` for focused public technical research. Reviewer authority and validation approval requirements remain unchanged.

The controller removes `bindChild` and `saveChildReport`. Custom integrations use the same delegation lifecycle as the workbench; historical `binding.report` values remain readable.

## Migration

1. Update custom project readers and exhaustive `SecurityRecord` switches to handle delegation records. Read new reports from `delegation.report`; keep `binding.report` support for historical data. Refresh generated clients with the matching Host package.
2. Distinguish an assignment's execution status from its coordinator disposition. `accepted` means that the report was adopted, not that a vulnerability was confirmed. Use the saved child address to open its history.
3. Read assignment details through `security_scope` with `kind: "delegation"`. Verify that a settled task shows its report or failure and that an interrupted task is not restarted automatically. A historical job ID alone is not a live job reference.
4. Keep deployment restrictions on public research in the existing tool/provider configuration. Method instructions do not provide network data-loss prevention. Preserve a backup made before new delegation records if testing an older build against the same data.
5. Replace direct `bindChild` and `saveChildReport` calls with `admitDelegation`, `bindDelegationChild` and `settleDelegation`. Verify evidence scope and terminal outcomes through the resulting delegation record.
