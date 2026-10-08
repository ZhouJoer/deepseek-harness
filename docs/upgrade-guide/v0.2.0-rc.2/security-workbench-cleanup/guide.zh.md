---
kind: upgrade-guide
description: "安全原型入口被移除，配置 Remote 返回对象，失败的探测和观测会明确拒绝。"
---

# 安全工作台入口与失败处理

[English](guide.md) | 中文

## 变更

实验性安全包移除 `./legacy` 原型入口。当前工作台及其 provider 入口继续可用。已有原型归档不会被重写或删除。

`configuration()` 和 `configureWorkspace()` 返回 `WorkbenchConfiguration` 对象，不再返回 JSON 字符串。创建任务需要工作区已保存设置或 `taskIntake.maxAttempts` 提供尝试次数，客户端不再自行填入三次。

源码清单读取方法接收 `sourceManifest(store, asset)`，不再接收分析上下文。

工具发现仅在候选程序不存在时尝试下一个程序。选定程序的版本查询失败、超时或响应格式错误会报告错误。失败或取消的观测及已批准执行在保存可用证据后拒绝；重复相同操作会报告已保存的失败，不再次执行。没有失败的不完整观测仍可读取。Frida 成功响应必须包含非空版本。

## 迁移

1. 从自定义组合中移除 `@deepseek-ai/dsh-experimental-security-analysis/legacy`，使用当前[安全 profile](../../../../packages/experimental/security-profile/README.zh.md)。保留已有原型 JSON 归档，通过工作台的 `import-legacy` 命令显式导入；另行导入原始样本以建立实测身份。
2. 更新自定义 Remote 客户端，直接使用配置对象并移除 `JSON.parse`。针对匹配的 Host 包重新生成客户端。创建任务前，配置 `taskIntake.maxAttempts` 或在工作区资源表单中保存明确的尝试次数。
3. 修复失败的选定程序，或显式选择其他安装。保存配置前，确认工具检查显示预期的可执行文件和版本。
4. 将被拒绝的采集与执行调用作为失败处理。查看其已保存证据和活动，不要因存在证据记录就推断成功。修复原因后再请求新操作；重试已有标识不会重新执行。
5. 将源码级 `sourceManifest(context)` 调用改为 `sourceManifest(context.artifacts, context.asset)`。
