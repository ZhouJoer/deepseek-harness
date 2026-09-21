---
description: "安全工作台的可选组合。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-experimental-security-profile

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

此 bundle 随安装提供，默认关闭，需要显式选择。在专用 profile 中按顺序组合 `@deepseek-ai/dsh-base`、应用 bundle、`@deepseek-ai/dsh-experimental-security-profile`。Web 还需在最后加入 `@deepseek-ai/dsh-experimental-security-web-profile`。使用 `dsh --profile <name>` 启动。详见[安全分析](../security-analysis/README.zh.md)。

-----

<a id="understand-the-implementation"></a>
## 实现

<details>
<summary>实现细节</summary>

Host patch 挂载领域服务和专用 provider。导出的插件为 Web profile 提供仅含安全分析的 preset：领域工具配合 jobs、goal、todo、网页检索和 compaction，不装配 shell、文件修改、PTC 或任意 MCP 工具。角色权限仍由领域服务检查。默认 profile 和 agent-loop 保持不变。不发布 invariant companion，因为此包拥有可撤销的组合注册，业务状态由领域服务持有。

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
