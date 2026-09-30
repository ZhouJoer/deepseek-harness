---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-09-30-security-budget-source

[English](2026-09-30-security-budget-source.md) | 中文

## 概述

声明安全分析预算收尾消息来源。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

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
## 兼容性

该来源仅用于归属标记。读取方无需安全插件即可保留其 kind 和已记录内容。已发布 V3 的插件来源迁移为相同的 plugin:security-analysis-budget kind；不删除来源字段或历史代文件。

<a id="verification"></a>
## 验证

针对性 Vitest 检查在 38 个文件中通过 628 项测试，覆盖分析结果捕获、预算收尾、委派生命周期和工具准备阶段。备份副本中 75 个既有 V3 会话迁移成功；另一个无关的工具调用未完成会话被拒绝，其 V3 原件未修改。

<a id="dev-note"></a>
## 开发备注

无。
