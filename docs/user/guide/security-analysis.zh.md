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

<a id="local-web-laboratory"></a>
## 本地 Web 靶场

侧栏的 **安全分析** 入口可独立于当前聊天访问持久项目。先在聊天工作台创建项目，再到侧栏选择它。**工具箱与靶场** 提供显式构建、启动、核对、停止和清空操作。构建会生成新镜像并下载软件包，可能持续数分钟，不会升级已有项目使用的镜像。

1. 确保 Docker Desktop 引擎已运行，Host PATH 包含 Docker CLI 和凭据助手。选择 **复用本地 Kali 镜像**，检测已安装的 `vxcontrol/kali-linux:latest`，无需重新构建或拉取该镜像。Host 靶场配置 `existingImage` 可指定其他本地镜像。登记固定不可变镜像 ID，记录工具版本和固定 yescrypt 向量的实测结果；可选工具缺失或 yescrypt 检测失败不阻塞 HTTP 采集。**构建新工具箱与靶场配方** 仍可生成官方 Kali 新镜像，该构建要求 yescrypt 检测通过。每次登记或构建产生独立版本，标签或配置变化不会改变已有靶场。准备期间可能下载固定版本的 Juice Shop 靶机镜像。
2. 启动已准备的靶场，再核对状态。严格隔离网络不支持直接发布浏览器端口，受控回环代理尚待实现。工具容器和靶机使用专属内部网络。清空会移除容器和网络；再次启动将产生新的目标标识。
3. 返回聊天工作台并刷新。在 **资产** 中选择靶场环境，填写 Web 目标名称和允许的路径前缀（初次可用 /），登记已启动目标。重置后须重新登记。
4. 添加检查并准备计划：provider 为 web，operation 为 request，parameters 为 {"path":"/","method":"GET"}。填写假设、预期响应、持续时间、影响和清理说明，核对并批准具体版本后执行。HTTP 采集支持 GET 和 HEAD；记录重定向但不跟随。
5. 根据已保存证据记录疑似发现。请协调者委派新的 reviewer 子 Session 复核；复核者调用 security_review，提交发现哈希、支持/反对证据和不确定性。在 **独立复核** 页面应用结论。确认或反驳须具备已完成验证阶段计划的完整证据；修改发现会使复核失效。
6. 在 **报告** 页面生成报告。刷新后仍可从项目侧栏读取 Markdown 与 JSON；Markdown 包含结论、覆盖、阻塞、清理情况和证据索引。

Nuclei 与 Metasploit 执行、审核模块目录、Vulhub 编排及任意外部目标尚不可用。配方安装其二进制不代表 provider 能力已可用。John 仅进行固定能力检测，离线密码审计后续实现。构建失败时查看记录的错误，先停止已拥有资源再重试。Host 重启将未完成靶场标为待核对，不会重放检查。
