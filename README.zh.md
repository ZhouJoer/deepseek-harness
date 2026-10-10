---
description: "以 DSH 为底座的安全分析工作台，介绍逆向、Web 与 IoT 研究中的证据、复核和受控验证。"
---

# 智能化安全分析工作台

[English](README.md) | 中文

**以 DeepSeek Harness（DSH）为底座的智能化安全分析工作台。**

本项目将源码、二进制、固件、Android 应用和抓包材料纳入统一的调查工作区。agent（智能体）围绕研究问题选择方法、收集证据、委派专门任务，形成可复核的发现和报告。工作台连接材料、问题、观察与结论，让分析者能够查看结果依据，并随时引导下一步调查。

本仓库基于 DeepSeek AI 开发的开源 agent harness（智能体框架）[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 构建。DSH 与 Cordis 提供插件组合、模型接入、Session、工具和任务执行；本项目在其上实现安全领域模型、调查方法、执行控制与工作台界面。

[安全架构](docs/security-architecture.zh.md) · [使用指南](docs/user/guide/security-analysis.zh.md) · [能力与限制](packages/experimental/security-analysis/README.zh.md) · [路线图](docs/roadmaps/security-analysis.zh.md)

> [!IMPORTANT]
>
> 安全扩展目前处于实验阶段，工具可用性与验证覆盖取决于具体环境。工具调用成功或生成报告不代表漏洞成立；发现必须保留证据、复核依据和不确定性。

## 界面预览

以下为开发环境中的工作台截图，使用演示数据展示界面，不代表已完成的漏洞评估；截图中的界面语言为英文。

### 分析工具箱

按逆向、Web 和 IoT 浏览分析能力，选择环境并检查已配置工具。

![分析工具箱中的领域筛选与环境选择](docs/images/security-workbench/analysis-toolbox.png)

### 验证计划审批

批准具体计划版本前，查看执行位置、预期观察、影响和清理方式。

![验证计划面板中的执行详情与操作者审批控制](docs/images/security-workbench/validation-approval.png)

## 项目特色

- **围绕问题与证据推进分析。** 根据材料和待解决的不确定性组合逆向、Web 与 IoT 方法。侦察、攻击面分析、评估和验证用于描述单项检查，不要求每次调查按固定顺序执行。
- **按需协作，独立复核。** 协调者在有收益时，将范围明确的问题委派给侦察、逆向、Web、研究或复核角色。子 Session 返回证据引用、结论和不确定性；发现被确认前，需要针对其确切内容进行独立复核。
- **可查看依据的调查链路。** 在工作台关联材料、检查、子任务、观察、发现、验证计划与复核。不可变产物和目标身份支持证据核查；对应项目修订的报告与证据导出保留交付依据。
- **受控的运行时验证。** 专用验证 provider 执行操作者批准的不可变计划，固定目标、脚本、预期观察、限制与清理方式。原生分析脚本使用已有 DSH 权限，属于独立执行路径。停止项目会取消其跟踪的工作，中断的验证不会自动重放。
- **统一管理工具与环境。** 在本机、Docker 和 Android 环境中发现已配置能力、检测安装并管理工具定义。复用方法 skill（技能）和分析脚本，同时区分工具安装、目标就绪与执行授权。
- **从实际分析中沉淀经验与改进。** 保存可复用知识，供操作者审核和发布。将实际遇到的流程问题转为改进建议和可导出的实施任务，由人工确认验证结果；工作台不会自动启动编码 agent。

## 分析场景

工作台可跨材料组合方法。每类场景均依赖已配置工具与可访问目标；[provider 参考](packages/experimental/security-analysis/README.zh.md#configure-analysis-providers)说明支持的操作及其验证限制。

| 场景 | 材料与分析方式 |
|---|---|
| 逆向与 Android | 二进制身份、字符串和字节检查；通过已配置的 Ghidra、JADX、Frida 集成进行静态分析或经批准的运行时观察。 |
| Web 安全 | 源码检查、已采集的 HTTP 证据与显式登记的目标；对发现进行复核，并开展受控 HTTP 或离线验证。 |
| 固件与 IoT | 固件组件、嵌入式 Web 源码和离线抓包；根据证据组合二进制、源码、MQTT、Wi-Fi 与 BLE 分析。离线观察不能证明设备行为。 |

## 架构：DSH 底座、安全领域、分析工作台

安全能力通过插件与 profile 组合到现有 DSH agent loop（智能体循环）上。[安全架构](docs/security-architecture.zh.md)解释数据流与扩展位置，包级参考维护具体行为。

| 层次 | 职责 |
|---|---|
| DSH 与 Cordis 底座 | 模型接入、Session 日志、工具、jobs、子进程监督、存储与 Host/Client 通信。 |
| 安全领域与方法 | 项目和资产身份、检查、证据、受角色约束的委派、provider 执行、审批、复核、报告与可复用知识。 |
| 分析工作台 | 任务创建、对话、调查链路、工具与环境管理、进展、证据查看及报告交付。 |

Session 日志保留模型交互与工具结果，独立的项目日志保留领域状态，不可变产物保存导入材料和采集证据。分析者可据此回看调查过程，项目记录不依赖仅从聊天历史中还原。

## Run

使用本仓库包含安全扩展的源码版本。按[开发指南](docs/development.zh.md)安装声明的 Node.js 与 pnpm 版本、安装依赖并构建工作区。[安全使用指南](docs/user/guide/security-analysis.zh.md)维护模型凭据和外部工具配置方式；agent 分析需要已配置的模型，外部工具需单独安装。

### Run from source

在已完成构建的仓库根目录启动安全 profile：

```sh
pnpm security --no-open
```

打开启动器输出的认证链接，安全 profile 默认端口为 `3081`。从 **安全分析** 创建分析任务，选择工作区与材料，描述要研究的问题。在工作台查看进展与证据，审阅验证计划后决定是否批准，并阅读或导出最终报告。

源码启动器加载已构建的工作区插件。修改 Host 或 Client 代码后，需重新构建再重启。上游 `@deepseek-ai/dsh` npm 包与通用 Web profile 提供 DSH 底座；本文介绍的工作台使用本仓库的安全 profile。

## 当前限制

本项目及 DSH 底座处于开发者预览阶段，可能出现破坏兼容性的变更。使用前请阅读[安全说明](SAFETY.zh.md)，仅分析授权范围内的材料与目标。

外部工具支持取决于具体环境：Ghidra 需要准备相应集成，Android 运行时观察需要就绪设备，工具箱中列出的工具可能只支持发现而没有专用执行 provider。静态、模拟与运行时观察具有不同的证据效力。[已知限制](packages/experimental/security-analysis/README.zh.md#known-limitations-and-deferred-work)与[路线图](docs/roadmaps/security-analysis.zh.md)维护具体缺口和待完成的验收。

## 文档与开发

- [安全使用指南](docs/user/guide/security-analysis.zh.md)：任务创建、工具、证据、报告与环境。
- [安全架构](docs/security-architecture.zh.md)与[领域参考](docs/subsystems/security-workbench.zh.md)：插件组合、权限与持久化项目记录。
- [开发指南](docs/development.zh.md)与[DSH 架构](docs/architecture.zh.md)：源码开发与底座服务。
- [参与贡献](CONTRIBUTING.zh.md)与 [AGENTS.md](AGENTS.md)：仓库贡献规范和 agent 指引。

## 上游与致谢

DeepSeek AI 开发了上游 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)，其[文档站](https://deepseek-harness.github.io/deepseek-harness/)介绍通用底座能力。Cordis 提供插件框架。专职委派、资料研究与精简报告借鉴了 PentAGI，具体取舍见[安全设计路线图](docs/roadmaps/security-analysis.zh.md)。

以下引用对应上游 DSH 项目：

```bibtex
@misc{deepseek-harness2026,
  title={DeepSeek Harness: Everything is a Plugin},
  author={DeepSeek-AI},
  year={2026},
  publisher={GitHub},
  howpublished={\url{https://github.com/deepseek-ai/deepseek-harness}},
}
```

## 许可证

[MIT](LICENSE)

第三方依赖及其许可证见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
