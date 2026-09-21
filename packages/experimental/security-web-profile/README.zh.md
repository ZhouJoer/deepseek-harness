---
description: "安全工作台的可选组合。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-security-web-profile

[English](README.md) | 中文

## 概述

在现有聊天界面中查看安全项目、检查、环境与证据，并审核验证计划。这个可选扩展保留原有聊天和工具卡片。所有操作经安全领域服务核对权限。外部工具需要单独配置。

## 目录

- [使用](#use-this-package)
- [实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用

在专用 profile 中按顺序组合 `@deepseek-ai/dsh-base`、应用 bundle、`@deepseek-ai/dsh-experimental-security-profile`。Web 还需在最后加入 `@deepseek-ai/dsh-experimental-security-web-profile`。使用 `dsh --profile <name>` 启动。详见[安全分析](../security-analysis/README.zh.md)。

安全 Web profile 默认监听 `127.0.0.1:3081`，普通 Web profile 使用 `3080`。显式 `--port` 覆盖安全默认值，包括使用 `--port 0` 分配端口。端口被占用时绑定失败，不会静默切换端口。

-----

<a id="understand-the-implementation"></a>
## 实现

<details>
<summary>实现细节</summary>

此包通过 profile patch 或消息输入框的 dock slot 组合能力，不修改默认 profile 或 agent-loop。浏览器通过生成的 Remote 调用领域服务，文案由双语字典提供。不发布 invariant companion，因为包只有可撤销的组合或 UI 注册，业务状态由领域服务持有。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [实验性插件](../README.zh.md)
- [架构](../../../docs/architecture.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

### 安全上下文

#### 模型看到的内容

此包不直接提供模型输入；`security_scope` 由领域服务提供。领域工具把模型可见结果记录在 Session 中。

#### Token 影响

领域工具定义和检索到的证据按配置的输出限额占用上下文。此包不改变 token 统计。

#### KV Cache effect

固定工具定义和工作流指引保持稳定；项目状态通过已记录的工具结果进入上下文。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 界面在打开、连接重置、刷新及操作后重新读取状态；provider 进度仍需刷新。子 Session 的详细过程通过原有 jobs 和会话导航查看。实际工具可用性及尚未完成的环境验收以[安全分析说明](../security-analysis/README.zh.md)为准。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作记录（非规范）</summary>

无。

</details>
