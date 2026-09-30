---
description: "Records a persistence type transition and its compatibility acknowledgement."
kind: persistence-change
---

# 2026-09-30-security-budget-source

English | [中文](2026-09-30-security-budget-source.zh.md)

## Summary

Declares the security analysis budget wrap-up message source.

## Table of Contents

- [Declaration](#declaration)
- [Compatibility](#compatibility)
- [Verification](#verification)
- [Dev Note](#dev-note)

<a id="declaration"></a>
## Declaration

```yaml persistence-change
schemaVersion: 1
id: 2026-09-30-security-budget-source
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-09-21-user-question-reply"
    after: "a8bf1fa121716764c26bd9d02a688401c22ac2ed5e27ee782a934d5e34484d6c"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-09-21-user-question-reply"
    after: "ac77cca11a41b9c82a539619a37c2769b1e2d5946f9c45461c243417a0ddeac1"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-09-21-user-question-reply"
    after: "2e5046778ca1ba4f64778f7ea04b8a29140d993d25458477814d24e24fa5282b"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-09-21-user-question-reply"
    after: "4e6d9862f5b87dda883b9cecaac6d0528e92218bd32ea35af7bce688eeed5c20"
    decision: same-version
```

<a id="compatibility"></a>
## Compatibility

The source is attribution only. Readers preserve its kind and recorded content without the security plugin. Released V3 plugin attribution migrates to the same plugin:security-analysis-budget kind; no source fields or historical generations are removed.

<a id="verification"></a>
## Verification

The focused Vitest run passed 628 tests across 38 files, including analysis result capture, budget wrap-up, delegated lifecycle, and tool preparation. Backup-copy migration converted 75 existing V3 Sessions; one unrelated incomplete-tool Session was refused without modifying its V3 artifact.

<a id="dev-note"></a>
## Dev Note

None.
