---
kind: upgrade-guide
description: "安全资产消费者必须处理操作者登记的外部 HTTP 目标。"
---

# 处理外部 HTTP 安全资产

[English](guide.md) | 中文

## 变更

安全 `Asset` 联合类型包含用于操作者登记 HTTP 目标的 `kind: 'external-web'`。将所有非文件资产视为受管理 Docker 靶场或源码快照的消费者必须处理此变体。HTTP 计划可声明 `approvalUse: 'single-execution'`；使用另一执行 ID 执行已消费计划会被拒绝。

## 迁移

1. 同步升级安全 Host 和客户端。自定义资产消费者必须使用目标的 `origin`、`pathPrefix`、`allowedAddresses` 和本地 `environmentId`；外部目标没有 artifact 哈希或靶场实例 ID。
2. 重试时保持相同执行 ID。重复 HTTP 验证需要准备并审批新计划。不得在恢复任务或重启 Host 时重放请求。
3. 打开已有项目历史并确认仍可读取。已有 journal 记录无需重写；HTTP 证据摘要、步骤引用和审批标记均为可选字段。认证与传输限制见[安全包](../../../../packages/experimental/security-analysis/README.zh.md)。
