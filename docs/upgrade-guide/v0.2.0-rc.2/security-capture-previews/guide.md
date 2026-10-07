---
kind: upgrade-guide
description: "Security Remote capture previews return binary metadata instead of UTF-8 text."
---

# Handle binary capture previews

English | [中文](guide.zh.md)

## Change

Security `artifact` and `projectArtifact` Remote responses identify PCAP/PCAPNG signatures with `binary: true` and return an empty `text` field. Previously these methods decoded capture bytes as UTF-8. Custom clients that render every artifact as text are affected. Hashes, sizes, original assets and saved evidence remain unchanged.

## Migration

1. In custom Remote clients, parse the JSON response and check `binary === true` before rendering `text`. Display `sha256` and `size` for binary captures.
2. Import a PCAP or PCAPNG and confirm that its preview shows metadata without decoded bytes. Use the [offline analysis workflow](../../../user/guide/security-analysis.md#windows-wireless) for protocol observations. Existing text evidence previews continue to use `text`; no stored-data migration is required.
