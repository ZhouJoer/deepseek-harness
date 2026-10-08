---
kind: upgrade-guide
description: "安全工作台新增委派结果记录，并将新的子报告移出 Session 绑定。"
---

# 安全委派记录

[English](guide.md) | 中文

## 变更

实验性安全工作台在公开的 `SecurityRecord` 联合类型及持久化项目日志中增加 `kind: "delegation"`。新的子报告保存在这些记录中，不再写入 `binding.report`。已有项目和历史绑定报告仍然可读。Session 日志格式与 storage-domain 版本保持不变；旧工作台构建不能读取包含新记录种类的日志条目。

Web 和逆向分析员角色还获得 `web_search` 与 `web_fetch`，用于有明确问题的公开技术资料研究。复核者权限和验证审批要求保持不变。

控制器移除 `bindChild` 与 `saveChildReport`。自定义集成使用与工作台相同的委派生命周期；历史 `binding.report` 值仍然可读。

## 迁移

1. 更新自定义项目读取器及穷尽处理 `SecurityRecord` 的分支，支持委派记录。从 `delegation.report` 读取新报告，并保留对历史 `binding.report` 的支持。使用匹配的 Host 包刷新生成的客户端。
2. 区分任务执行状态与协调者处理意见。`accepted` 代表采纳报告，不代表确认漏洞。使用保存的子会话地址打开历史记录。
3. 通过 `security_scope` 的 `kind: "delegation"` 读取委派详情。确认已终结任务显示报告或失败原因，中断任务不会自动重启。历史 job ID 本身不代表当前存在的任务。
4. 在既有工具/provider 配置中保留部署所需的公开研究限制。方法指令不提供网络数据防泄漏能力。需要用旧构建测试同一数据时，保留写入新委派记录之前的备份。
5. 将直接调用 `bindChild` 和 `saveChildReport` 的代码改为使用 `admitDelegation`、`bindDelegationChild` 与 `settleDelegation`。通过生成的委派记录验证证据范围和终态。
