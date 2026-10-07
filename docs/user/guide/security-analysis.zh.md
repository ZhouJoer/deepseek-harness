---
description: "启动独立安全工作台，并准备经授权的逆向分析检查。"
---

# 逆向分析工作台

[English](security-analysis.md) | 中文

使用独立安全 profile 分析已授权样本。本文要求已有完成构建的源码目录、Node 和 pnpm，以及由操作者安装的外部逆向工具。agent 工作需要 DeepSeek 模型密钥；配置模型前也可以设置项目和查看证据。完整的外部工具验收矩阵见[安全插件](../../../packages/experimental/security-analysis/README.zh.md#known-limitations-and-deferred-work)。

## 1. 准备 profile

需要复用分析方法时，打开**工具箱 → 分析脚本**。流量分析包括抓包概览和报文筛选，MQTT 包括连接时间线和主题，动态观察包括原生模块和导出函数。展开条目查看依赖、必填参数和示例。让分析助手对你的材料使用对应内置脚本，它会加载关联技能、填写参数，并将结果保存到当前任务的分析目录。动态模板仍使用现有验证计划审批流程。浏览脚本库无需选择环境，也不会安装工具。

在仓库根目录执行 `pnpm run build` 构建。源码启动器仍加载已构建的工作区插件；修改 Host 或 Client 插件后，需要先重新构建再重启，刷新页面不能替代构建。打开**安全分析 → 逆向工具箱**，在工具卡片点击**配置工具**，或用**添加工具**登记自定义安装。**选择工具文件**浏览运行 DSH 的电脑上的文件，不会上传可执行文件。点击**检测**查看版本和诊断，或点击**检测并保存**在检测成功后立即应用。检测失败不会改变已保存配置。高级参数每行填写一个参数，用于解释器和自定义版本查询。**恢复默认配置**移除本机覆盖项。模型通过下一次所选环境检测发现新路径，无需重启服务。源码安全 profile 为本机环境启用编辑。也可使用下面的命令行入口。使用 Frida 时，`python` 必须安装官方 Frida bindings。工具安装情况和目标是否就绪分开检查。

```sh
pnpm security:doctor
pnpm security:doctor python unicorn radare2 tshark jadx --save
```

`pnpm security:doctor` 检查原生命令工具及 Python 模块（Unicorn、r2pipe 和 Frida），与工具箱使用同一个选定解释器。Python 诊断显示解释器路径、版本、虚拟环境、基础运行时和 pip 可用性，并区分可用安装、缺失的可选工具和失效的已保存路径。添加 `--dir "目录" --save` 可发现便携安装并保存可用路径；已保存路径失效时命令失败且不保存修改。完成后刷新工具箱。`pnpm security:tools list` 显示内置及已保存的自定义工具。工具 ID 可以扩展，使用小写字母、数字、连字符和下划线。Nmap、TShark、JADX 和 Metasploit（`msfconsole`）有内置发现项。`scan` 检查 PATH 和 Windows 常见安装目录，并执行有时限的版本查询；省略工具 ID 时检查全部原生工具及目录中登记的依赖项。添加 `--dir "目录"` 可递归搜索安装目录，包括便携版 JADX。未加 `--save` 时只报告扫描结果。使用 `set 工具ID "可执行文件"` 检查并保存确切路径，或用 `remove 工具ID` 删除已保存的覆盖项。Unicorn、r2pipe 等依赖工具通过所属运行时配置。用 `python -m venv .dsh/runtimes/unicorn` 创建独立环境；Windows 上用 `.dsh/runtimes/unicorn/Scripts/python.exe -m pip install unicorn` 安装（POSIX 使用 `bin/python`），然后在 Python 卡片选择该解释器，或运行 `pnpm security:tools set python "PYTHON绝对路径"`。运行 `pnpm security:doctor python unicorn` 检查两者。Unicorn 通过 Python 脚本提供 CPU 仿真，不提供 Android 或操作系统服务。

工具箱打开时先显示目录，不自动扫描全部工具。按用途搜索或按标签、工具包筛选后，点击单个工具的 **检测** 或 **检测筛选结果**。**工具定义与导入** 支持鼠标编辑 CLI/Python 模块定义、选择 JSON 文件导入以及导出工具包；高级 JSON 可编辑集合、依赖、平台、技能引用与 provider 引用。导入先预览校验并列出冲突，覆盖需要勾选确认；保存只注册定义，不安装软件、不运行命令。定义保存在独立的 `.dsh/security-tool-packs.json`，安装路径仍在原配置文件中。

工具包使用 `{"version":1,"id":"my-tools","label":"My tools","tools":[{"id":"my-cli","label":"My CLI","commands":["my-cli"],"tags":["firmware"],"guide":"Use bounded output."}],"collections":[]}` 格式。Python 模块使用 `dependency:"python"`、`invocation:"python"` 和 `probe:{kind:"python-module",module:"import_name",distribution:"package-name"}`。依赖可以引用其它已注册工具，导入时拒绝缺失引用和循环依赖。CLI 也支持 `pnpm security:tools import pack.json`（冲突时显式加 `--replace`）、`export PACK_ID output.json`、`doctor --tag firmware`、`doctor --collection web`，以及 `--catalog FILE` 指定定义文件。

会话的高级工作台提供 **本次会话工具偏好**。默认由模型按任务发现工具，所选工具或集合只是优先建议，模型仍可查询其它工具。偏好只影响本次活跃会话，下次请求生效；关闭会话或重启后恢复自动发现。安全委派复制创建时的偏好，此后父子独立。项目、角色和执行授权保持原有约束。

自定义工具默认用 `--version` 查询版本；在 `set` 时重复传入 `--version-arg=参数` 可覆盖。解释器可通过重复的 `--arg=参数` 为每次调用添加固定启动参数；`set` 不带 `--arg` 时清除原有启动参数。例如，将 JADX 配置为 Java 可执行文件，并传入 `--arg=-jar --arg="路径/jadx.jar"`。Windows 的 `.cmd`、`.bat` 和 `.ps1` 启动脚本需要改为配置解释器可执行文件。这些选项用于已有安装；登记名称不会安装软件或创建专用 provider。

可执行文件路径和参数保存在当前目录下被 Git 忽略的 `.dsh/security-tools.json`。请在仓库根目录运行这些命令。`pnpm security` 与页面共用该文件，工具检查和后续模型请求会重新读取它。已保存路径失效会报错，不会回退到其他安装。脚本配置已安装软件，不修改系统 PATH。TShark 通过原生分析脚本调用；JADX 还提供专用 Android provider。设备、容器及其他环境仍在[示例 overlay](../../../apps/cli/config/examples/security-analysis/cordis.yml) 中配置。`--config FILE` 用于管理其他 JSON 文件；启动器只读取默认文件。

<a id="external-docker-containers"></a>
### 接入已有本机或远程 Docker 容器

将[环境示例](../../../apps/cli/config/examples/security-analysis/external-container.json)复制到 `.dsh/security-environments.json`，修改容器名称和容器内工作目录。宿主 `cwd` 相对此 JSON 文件解析，因此 `".."` 表示仓库目录。`pnpm security` 按 ID 将环境合并到 profile 模板。`defaultEnvironmentIds` 为新任务选择环境；已有任务保留已保存的选择。修改环境声明后重启安全 profile。

示例使用当前 Docker context。将 Docker 安装项的 `prefixArgs` 设为 `["--context", "YOUR_CONTEXT"]`，即可选择其他已配置的 context，包括通过 SSH 或 TLS 连接的远程 daemon。宿主需要该 context 的凭据和传输程序。`externalContainer` 接入已运行的容器，不创建挂载、不启动服务、不改变网络，也不管理其生命周期。工具参数使用容器内文件系统；宿主文件不会自动上传。网络可达性由所选容器和 daemon 决定。

在所选容器内通过 Kali 软件包管理器安装 Metasploit。现有 `metasploit` 定义通过容器的 PATH 发现 `msfconsole`，无需绝对安装路径或单独的 DSH 插件。在仓库根目录验证已配置的环境：

```sh
pnpm security:tools doctor metasploit --environment kali
```

`available` 和 `ready` 分别表示版本检测通过和容器就绪。发现使用与本机工具相同的可扩展目录：导入其他工具包，再通过 `--environment` 选择其工具 ID。`set ID COMMAND`、`remove ID` 和 `scan --save` 管理该环境 `tools` 数组中的安装项。`--environments FILE` 为命令行操作选择其他部署文件。Web 安装文件选择器仍只浏览宿主文件。

`security_environment` 返回宿主命令和完整的 `prefixArgs`，包括 Docker context、容器和工作目录。追加工具参数即可，不要再包装一层 Docker 命令。容器停止与删除仍由操作者管理。取消检测会终止宿主 Docker 客户端，但不保证外部容器内的工作也已终止。现有角色、项目和 Shell 权限检查继续生效。远程传输已有确定性测试覆盖；实际远程部署仍需单独检查连接。

### 启动

通过现有 Web 应用加载安全组合：

```sh
pnpm security
```

在仓库根目录运行此命令。首次启动自动从 Web 模板创建 `security` profile，后续启动复用它；每次都加载安全 Host、Web 和工具配置 overlay。使用 `pnpm security --port 4081` 更换端口，使用 `pnpm security --dump-config` 查看组合而不启动服务。快捷入口仍通过原生 `dsh` profile 启动应用。

通过 DSH 打印的认证链接访问 `http://127.0.0.1:3081`。[安全 Web profile](../../../packages/experimental/security-web-profile/README.zh.md) 定义默认端口及 `--port` 覆盖方式。角色选择与安装管理见[角色和工具](../../../packages/experimental/security-analysis/README.zh.md#roles-tasks-and-tool-management)；后续工作与验收条件见[路线图](../../roadmaps/security-analysis.zh.md)。

## 2. 开始分析



“分析任务”把这次分析的材料、证据和报告保存在一起；报错中的“安全项目”指的就是这条记录。默认安全 profile 会在聊天首次调用安全工具时自动建立记录，即使当前工作区与启动目录不同。已退出任务的对话或显式停用自动创建的工作区需要通过下面的入口开始。

从侧栏打开**安全分析**，点击**新建分析**。选择已有工作区或添加本机绝对路径，再点击**使用此工作区**。描述目标，可选文件、文件夹、粘贴文字或填写宿主路径。**开始分析**先保存任务与材料，再向原生对话发送目标；发送失败可重试，不会再次导入。默认选择本机环境，**更多选项**可切换环境；未配置环境时显示阻塞原因。仅选择工作区不会导入文件。模型自主导入仍受 `importRoots` 限制；用户明确选择材料仅授权该次导入。任务列表支持搜索与状态筛选，“可继续”不表示模型正在运行。详情页集中展示材料、发现、证据与排版后的报告。展开**分析助手**可继续对话，折叠保留草稿。历史会话缺失时需要明确点击**继续分析**；停止的任务需要**恢复分析任务**，恢复已移除任务不会执行分析。

打开**高级详情** → **环境与工具**检查所选环境。缺失安装和设备断连显示为诊断。Android 设备 ID 和 Docker 镜像须在 Host overlay 中明确配置；默认示例只创建本机环境。使用 Ghidra 或设备前，请阅读 [provider 配置](../../../packages/experimental/security-analysis/README.zh.md#configure-analysis-providers)。

<a id="continuous-improvement"></a>

### 将实际观察转为源码改进

使用工作台后，打开任务的**持续改进**并选择**立即分析改进点**。系统先等待活动分析结束；安全 profile 也会在新增活动结束且静默五分钟后自动分析，期间 Host 须保持运行。这是阶段复盘，不代表安全任务完成。分析完成后可以没有值得提出的建议。失败运行显示原因，可再次请求。

打开**持续改进**对比不同任务的建议。展开一项查看问题、实际依据、期望能力和验收场景。模块名称只是调查线索，需编码 AI 检查仓库后确认。复制 Markdown 或下载任务包，交给能够访问 Harness 仓库的 Codex 或其他编码 AI。任务要求它先读 `AGENTS.md`、核实实现，再修改相应源码、脚本、工作流、提示词或技能文档并测试结果。

导入填写后的 `result.template.json`，或手动记录修改与测试结果。这会将实施声明记为**已修改**。检查改动后，由你选择**确认已验证**。不合适的建议可忽略，也可恢复。已验证建议遇到新依据时提示复查。系统不会自动启动编码工具。[配置与保留规则](../../../packages/experimental/security-analysis/README.zh.md#continuous-improvement)说明模型用量、输入限制和删除行为。

## 3. 收集并评估证据

主聊天页在输入框上方显示小型**工具**计数徽标，点击后在右侧栏打开**工具与进展**。工具卡片分别显示次数和状态徽标，时间线展示各研究方向的结论与下一步；逐次调用和证据默认折叠。侧栏只展示信息，直接在现有输入框补充或纠正分析方向，并使用原生停止按钮。任务详情也有**工具与进展**标签。未关联任务的聊天会显示提示，直到首次创建安全分析任务。

在打开任务前，可从侧栏进入**安全分析**并打开**工具箱**。选择宿主或已配置的容器，再刷新。通过链接中的说明手动安装缺失工具；刷新不会安装软件或启动 Docker。配置可执行文件路径可固定某个安装版本。r2ghidra 跟随选定的 radare2，Unicorn、r2pipe 和 Frida 跟随选定的 Python。停止的容器显示工具尚未检查；缺少可选工具不会令宿主不可用。

可要求协调者或分析子 agent 编写、编辑并执行分析脚本。生成的分析文件统一存放在所选工作区的 `.dsh/analysis/<task-session-key>/` 下：`scripts/` 放脚本，`outputs/` 放结果和日志，`tmp/` 放中间文件。每个任务和会话各有独立目录，可让 agent 告知具体路径。agent 从该目录运行脚本，用绝对路径读取原始材料。原生工具在 Windows 使用 PowerShell，在 Linux/macOS 使用 Bash；通过对应 Shell 调用 Python。使用 `job_output` 收集后台输出，再通过 `security_capture_analysis(assetId, callIds)` 保存已提交的调用标识。所得脚本分析日志可供发现、子报告和独立复核引用。它保留不完整输出，属于辅助证据，不会自动确认结论。原生脚本遵循 DSH 工作区权限、沙箱和审批；专用验证接口仍使用下述计划流程。

通过聊天要求整理样本、暴露入口及证据支持的风险假设。协调者可以委派有边界的静态问题或独立复核。子 agent 只获得指定资产；其详细 Session 可通过原生任务结果查看。重复分析前先查看原始证据并检索已有结果。

每项检查都有依赖、完成条件和支持证据，应逐项完成。如果新证据否定早先结果，填写原因后重新打开该检查；依赖步骤随之重开，相关批准被撤销。中断后必须核对实际进程、设备和脚本状态才能重试。

通过**分析进展**查看使用工具、当前结论和下一步或阻碍。同一问题的多轮研究合并展示，评估之后可以继续补充侦察。展开**查看调用与证据**检查执行详情。Shell 文本中的工具名称保持待确认，工具成功不代表安全结论成立。历史活动缺失显示为未记录，Host 重启后未完成调用的结果保持未知。工作台的**停止任务**先保存停用状态，再取消执行并等待清理。在现有输入框输入原生插话；继续已停止的分析前必须明确**恢复任务**。

协调者根据现有 Web、固件或 Android 材料选择[调查方法](../../../packages/experimental/security-analysis/README.zh.md#use-this-package)，简单问题可以自行处理。**分析进展**中的**子任务协作**显示已记录的分工、角色、执行状态和报告处理意见。展开详情可查看派工理由、完成条件、证据和不确定性，也可打开只读子会话。采纳报告用于调整计划，确认发现仍要求独立复核。缺少设备或搜索失败只留下相关待解问题，不中断无关分析。

## 4. 批准与停止验证

在**发现与验证**中检查目标、脚本、哈希、预期观察、影响、时限及清理方案，批准所展示的计划版本。改变目标、脚本或环境需要创建新计划，批准也会到期。**停止分析任务**阻止新操作，并取消正在执行的 provider 和委派工作。恢复不会自动重放未完成的注入或进程创建。

区分疑似、已验证、已反驳和证据不足的发现。工具执行成功本身不代表存在漏洞。共享经验需要操作者审核，始终作为参考材料，不能直接成为项目证据。

## 没有 Android 设备时如何验证

安全 profile 保留 DSH 聊天界面，在消息输入框上方增加**安全分析**入口。选择工作区并打开 Session 后，首条消息发送前即可看到入口。如果没有显示，请确认打开的是 `pnpm security` 输出的 3081 端口认证链接，构建更新后的客户端包并重启，再刷新浏览器。

1. 打开工作台，展开**高级设置与历史任务**并创建名为 `Demo` 的项目，目标填“检查自有静态样本”，环境选 `local`。这条手动配置路径不需要模型密钥。
2. 在**高级详情** → **资产**中导入 [static-demo.txt](../../../packages/experimental/security-analysis/tests/fixtures/static-demo.txt) 的绝对路径。在 PowerShell 执行 `Resolve-Path packages/experimental/security-analysis/tests/fixtures/static-demo.txt` 可取得路径。资产应显示实测 SHA-256；这是不含可执行代码的文本测试样本，不代表真实漏洞。
3. 可选地点击**生成四阶段检查计划**，再进入**高级详情** → **检查**。模板会创建带依赖关系的四项待执行检查；研究过程中可按需要选择或修订检查。试用**停止分析任务**和**恢复分析任务**，刷新后状态应保留。
4. 进入**高级详情** → **环境与工具**检查 `local`。外部工具缺失时应明确显示诊断；这不影响内置二进制 provider 读取已导入样本。
5. 配置模型后，在聊天中发送以下要求。通过实际工具卡片和证据 ID 核实调用，不能只看模型声称“已调用”的文字。

```text
Read security_scope and security_capabilities. For the imported static-demo.txt asset, use security_static with provider binary, operation strings and parameters {}. Do not run external tools or dynamic validation. Report the sample SHA-256, the saved evidence ID and the observed DSH_SECURITY_DEMO_V1 and DEMO_PARSER_ENTRY strings. Do not infer a vulnerability from this fixture.
```

在**高级详情** → **知识**中搜索 `DEMO_PARSER_ENTRY`，应能找到采集的项目证据并查看原始制品。验证委派时，让协调者把同一资产的清点交给 `reconnaissance`，任务为 `inventory`，收取 `job_output` 后，再交给 `reviewer` 以 `review` 任务复核证据。结果应包含子 Session 链接、证据引用和不确定性；子 agent 不能执行或批准验证计划。

Ghidra GUI 分析、JADX 和 Frida 需要配置对应外部工具。仅配置 Python 可执行文件不能证明 Frida bindings 或设备已经就绪。上述步骤不需要 Android 设备，通过它们也不代表外部工具验收矩阵已完成。

## 当前验收限制

Windows Frida 的正常结束和取消，以及 Docker 生命周期已有本地真实集成测试。目前没有 Android 设备可供验收。Ghidra GUI 集成、源码／二进制／Web 的全面分析及真实模型 Web 录制仍需外部环境。包 README 记录剩余实现限制；当前实验版本不表示完整计划已通过发布验收。

<a id="local-web-laboratory"></a>
## 本地 Web 靶场

侧栏的 **安全分析** 入口可独立于当前聊天访问持久项目。先在聊天工作台创建项目，再到侧栏选择它。**工具箱与靶场** 提供显式构建、启动、核对、停止和清空操作。构建会生成新镜像并下载软件包，可能持续数分钟，不会升级已有项目使用的镜像。

1. 确保 Docker Desktop 引擎已运行，Host PATH 包含 Docker CLI 和凭据助手。选择 **复用本地 Kali 镜像**，检测已安装的 `vxcontrol/kali-linux:latest`，无需重新构建或拉取该镜像。Host 靶场配置 `existingImage` 可指定其他本地镜像。登记固定不可变镜像 ID，记录工具版本和固定 yescrypt 向量的实测结果；可选工具缺失或 yescrypt 检测失败不阻塞 HTTP 采集。**构建新工具箱与靶场配方** 仍可生成官方 Kali 新镜像，该构建要求 yescrypt 检测通过。每次登记或构建产生独立版本，标签或配置变化不会改变已有靶场。准备期间可能下载固定版本的 Juice Shop 靶机镜像。
2. 启动已准备的靶场，再核对状态。严格隔离网络不支持直接发布浏览器端口，受控回环代理尚待实现。工具容器和靶机使用专属内部网络。清空会移除容器和网络；再次启动将产生新的目标标识。
3. 返回聊天工作台并刷新。在 **高级详情** → **资产** 中选择靶场环境，填写 Web 目标名称和允许的路径前缀（初次可用 /），登记已启动目标。重置后须重新登记。
4. 添加检查并准备计划：provider 为 web，operation 为 request，parameters 为 {"path":"/","method":"GET"}。填写假设、预期响应、持续时间、影响和清理说明，核对并批准具体版本后执行。HTTP 采集支持 GET 和 HEAD；记录重定向但不跟随。
5. 根据已保存证据记录疑似发现。请协调者委派新的 reviewer 子 Session 复核；复核者调用 security_review，提交发现哈希、`basis`（`static` 或 `runtime`）、支持/反对证据和不确定性。在 **高级详情** → **独立复核** 页面应用结论。静态结论须有完整的实现材料；运行验证结论须有已完成批准计划的完整证据。修改发现会使复核失效。
6. 使用会话模型或配置的专用模型，在 **报告** 页面生成报告。项目侧栏保留简短 Markdown 报告、完整 JSON 和可选的补充发现附表。正文概括安全判断、修复、可复用经验与未覆盖范围。输入或输出超出配置限额时，不会发布新报告。分析预算默认不计重复的缓存读取。接近探索限额时，DSH 会要求给出阶段总结，说明已保存的结果和未完成检查。可沿着下一项具体行动继续使用这些结果；阶段总结不代表调查已完成。

Nuclei 与 Metasploit 专用 provider 执行、审核模块目录、Vulhub 编排及通过这些 provider 访问任意外部目标尚不可用。配方安装其二进制不代表 provider 能力已可用。John provider 仅进行固定能力检测，离线密码审计后续实现。构建失败时查看记录的错误，先停止已拥有资源再重试。Host 重启将未完成靶场标为待核对，不会重放检查。

## 源码与静态前端项目

在**高级详情** → **资产**中导入已授权的源码文件或目录。选择单个文件时仅导入该文件。选择环境后可清点文件、从指定行读取相对路径或搜索字面文本。证据预览包含成员哈希、行号及续读位置；修改原始源码不会改变已导入快照。

设备应用应分别委派前端与设备逻辑问题。Web Bluetooth 和 GATT 应按设备协议分析，不能假定存在 HTTP 服务。让 DSH 生成注入假时钟、存储、WLAN 或 GATT 的 Python 或浏览器脚本，审批前检查具体脚本与固定镜像。镜像或运行时缺失属于能力阻塞。

项目记录保留通过的断言、失败、跳过场景和模拟假设；只有它们改变安全判断或造成重要覆盖缺口时才写进简报。独立 reviewer 必须读取原始证据，子任务摘要不能单独确立发现。依赖硬件的判断应保留待验证，直至另行授权设备测试。Ghidra 能力检查可独立延期，不影响源码分析。
