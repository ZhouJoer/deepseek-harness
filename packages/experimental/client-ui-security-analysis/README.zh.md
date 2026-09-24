---
description: "安全工作台的可选组合。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-client-ui-security-analysis

[English](README.md) | 中文

## 概述

在对话中描述安全任务，查看发现、证据和报告。每个工作区配置一次可用资源。这个可选面板保留普通对话和工具卡片；需要时可展开资产、检查、环境与复核控制。所有操作经安全领域服务核对权限。外部工具需要单独配置。

## 目录

- [使用](#use-this-package)
- [实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

在任务首页使用**添加材料**选择文件、文件夹，粘贴文字或导入本机路径，系统会自动识别类型。首次导入可根据已保存的工作区资源创建项目，首页列出已添加的材料。**管理项目**支持改名和移除；移除会停止工作并隐藏项目，同时保留证据和报告，可在侧栏的**已移除项目**中恢复。恢复后需明确恢复运行才会继续。列表中的长名称会缩短显示，悬停可查看完整名称。

-----

<a id="use-this-package"></a>
## 使用

在专用 profile 中按顺序组合 `@deepseek-ai/dsh-base`、应用 bundle、`@deepseek-ai/dsh-experimental-security-profile`。Web 还需在最后加入 `@deepseek-ai/dsh-experimental-security-web-profile`。使用 `dsh --profile <name>` 启动。详见[安全分析](../security-analysis/README.zh.md)。

在消息输入框上方点击“安全分析”，新建空会话中也可打开。选择并保存工作区资源，然后在对话中描述任务。默认页签展示任务总览、发现、证据和报告；总览区分已确认发现、待复核项与阻塞事项。展开详细控制后可手动选择项目、查看资产、检查、环境、复核与知识。退出项目会保留记录，并停止该 Session 的自动任务初始化。项目停止会等待清理；断线后点击刷新重新读取权威状态。

-----

源码文件或目录资产支持在会话工作台清点文件、按行读取和字面文本搜索。证据卡片标记静态观察、离线模拟及设备验证，并显示失败与清理详情。项目总览和报告保留已完成子 Session 摘要；原始子任务交互仍通过 Session 导航查看。

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

## 持久安全项目

侧栏安全分析面板无需选择聊天即可列出项目、目标、检查、发现、复核、报告和靶场实例。工具箱页提供显式复用本地镜像和构建新镜像操作，两者都保留已有靶场的镜像标识。聊天工作台可登记已启动 Web 目标、应用独立复核和生成修订报告。两个项目视图均直接排版展示已保存的 Markdown 简报及可选发现附表。[Web 指南](../../../docs/user/guide/security-analysis.zh.md#local-web-laboratory) 说明操作流程与当前 provider 限制。

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

- 界面在打开、连接重置、刷新、操作后，以及保持打开的当前会话轮次结束时重新读取状态；provider 的中间进度仍需刷新。子 Session 的详细过程通过原有 jobs 和会话导航查看。实际工具可用性及尚未完成的环境验收以[安全分析说明](../security-analysis/README.zh.md)为准。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作记录（非规范）</summary>

无。

</details>
