---
description: "启动独立安全工作台，并准备经授权的逆向分析检查。"
---

# 逆向分析工作台

[English](security-analysis.md) | 中文

使用独立安全 profile 分析已授权样本。本文要求已有完成构建的源码目录、Node 和 pnpm，以及由操作者安装的外部逆向工具。agent 工作需要 DeepSeek 模型密钥；配置模型前也可以设置项目和查看证据。完整的外部工具验收矩阵见[安全插件](../../../packages/experimental/security-analysis/README.zh.md#known-limitations-and-deferred-work)。

## 1. 准备 profile

在仓库根目录执行 `pnpm run build` 构建。编辑[示例 overlay](../../../apps/cli/config/examples/security-analysis/cordis.yml)，填入实际 Python、JADX 和 Android platform tools 的路径。`python` 必须安装官方 Frida bindings。工具安装情况和目标是否就绪分开检查。示例仅登记 fastboot 与 john 的版本查询。

通过现有 Web 应用加载安全组合：

```sh
pnpm security
```

在仓库根目录运行此命令。首次启动自动从 Web 模板创建 `security` profile，后续启动复用它；每次都加载安全 Host、Web 和工具配置 overlay。使用 `pnpm security --port 4081` 更换端口，使用 `pnpm security --dump-config` 查看组合而不启动服务。快捷入口仍通过原生 `dsh` profile 启动应用。

通过 DSH 打印的认证链接访问 `http://127.0.0.1:3081`。[安全 Web profile](../../../packages/experimental/security-web-profile/README.zh.md) 定义默认端口及 `--port` 覆盖方式。角色选择与安装管理见[角色和工具](../../../packages/experimental/security-analysis/README.zh.md#roles-tasks-and-tool-management)；后续工作与验收条件见[路线图](../../roadmaps/security-analysis.zh.md)。

## 2. 设置范围

选择工作区并打开 Session，然后点击消息输入框上方的**安全分析**。创建项目，填写目标并选择允许使用的已配置环境。在 `importRoots` 范围内输入样本绝对路径进行导入，再为该资产创建四阶段检查模板。APK 成员分别计算实测身份，并关联到父资产。

打开**环境与工具**检查所选环境。缺失安装和设备断连显示为诊断。Android 设备 ID 和 Docker 镜像须在 Host overlay 中明确配置；默认示例只创建本机环境。使用 Ghidra 或设备前，请阅读 [provider 配置](../../../packages/experimental/security-analysis/README.zh.md#configure-analysis-providers)。

## 3. 收集并评估证据

通过聊天要求整理样本、暴露入口及证据支持的风险假设。协调者可以委派有边界的静态问题或独立复核。子 agent 只获得指定资产；其详细 Session 可通过原生任务结果查看。重复分析前先查看原始证据并检索已有结果。

每项检查都有依赖、完成条件和支持证据，应逐项完成。如果新证据否定早先结果，填写原因后重新打开该检查；依赖步骤随之重开，相关批准被撤销。中断后必须核对实际进程、设备和脚本状态才能重试。

## 4. 批准与停止验证

在**发现与验证**中检查目标、脚本、哈希、预期观察、影响、时限及清理方案，批准所展示的计划版本。改变目标、脚本或环境需要创建新计划，批准也会到期。**停止项目**阻止新操作，并取消正在执行的 provider 和委派工作。恢复不会自动重放未完成的注入或进程创建。

区分疑似、已验证、已反驳和证据不足的发现。工具执行成功本身不代表存在漏洞。共享经验需要操作者审核，始终作为参考材料，不能直接成为项目证据。

## 没有 Android 设备时如何验证

安全 profile 保留 DSH 聊天界面，在消息输入框上方增加**安全分析**入口。选择工作区并打开 Session 后，首条消息发送前即可看到入口。如果没有显示，请确认打开的是 `pnpm security` 输出的 3081 端口认证链接，构建更新后的客户端包并重启，再刷新浏览器。

1. 打开工作台，创建名为 `Demo` 的项目，目标填“检查自有静态样本”，环境选 `local`。创建项目不需要模型密钥。
2. 在**资产**中导入 [static-demo.txt](../../../packages/experimental/security-analysis/tests/fixtures/static-demo.txt) 的绝对路径。在 PowerShell 执行 `Resolve-Path packages/experimental/security-analysis/tests/fixtures/static-demo.txt` 可取得路径。资产应显示实测 SHA-256；这是不含可执行代码的文本测试样本，不代表真实漏洞。
3. 点击**生成四阶段检查计划**，进入**检查**，应看到带依赖关系的四项待执行检查。生成计划不代表分析完成。试用**停止项目**和**恢复项目**，刷新后状态应保留。
4. 进入**环境与工具**检查 `local`。外部工具缺失时应明确显示诊断；这不影响内置二进制 provider 读取已导入样本。
5. 配置模型后，在聊天中发送以下要求。通过实际工具卡片和证据 ID 核实调用，不能只看模型声称“已调用”的文字。

```text
Read security_scope and security_capabilities. For the imported static-demo.txt asset, use security_static with provider binary, operation strings and parameters {}. Do not run external tools or dynamic validation. Report the sample SHA-256, the saved evidence ID and the observed DSH_SECURITY_DEMO_V1 and DEMO_PARSER_ENTRY strings. Do not infer a vulnerability from this fixture.
```

在**知识**中搜索 `DEMO_PARSER_ENTRY`，应能找到采集的项目证据并查看原始制品。验证委派时，让协调者把同一资产的清点交给 `reconnaissance`，任务为 `inventory`，收取 `job_output` 后，再交给 `reviewer` 以 `review` 任务复核证据。结果应包含子 Session 链接、证据引用和不确定性；子 agent 不能执行或批准验证计划。

Ghidra GUI 分析、JADX 和 Frida 需要配置对应外部工具。仅配置 Python 可执行文件不能证明 Frida bindings 或设备已经就绪。上述步骤不需要 Android 设备，通过它们也不代表外部工具验收矩阵已完成。

## 当前验收限制

Windows Frida 的正常结束和取消，以及 Docker 生命周期已有本地真实集成测试。目前没有 Android 设备可供验收。Ghidra GUI 集成、三类目标的四阶段分析及真实模型 Web 录制仍需外部环境。包 README 记录剩余实现限制；当前实验版本不表示完整计划已通过发布验收。
