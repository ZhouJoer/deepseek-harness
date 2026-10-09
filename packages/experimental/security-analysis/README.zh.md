---
description: "受约束的逆向检查、计划批准和项目证据。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-security-analysis

[English](README.md) | 中文

## 概述

使用独立 provider 和复核结论研究自有源码、二进制与 Web 目标。根据安全问题选择检查方法和验证深度，不要求固定顺序。操作计划需要用户批准，工具能力在执行时再次检查。人读报告是简短安全简报，原始证据仍可供深入分析。

## 目录

- [使用](#use-this-package)
- [实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

经认证的操作者可导入粘贴的 UTF-8 文字、上传的文件或文件夹，以及明确选择的主机文件或目录。主机路径选择仅授权本次导入，模型工具仍受已配置的导入根目录限制。所有材料保存为不可变工件，并遵守配置的字节数和条目数上限。操作者导入 Remote 也接受不含材料的初始任务和明确选择的已配置环境 ID；创建任务不会保存工作区默认配置。操作者二次确认永久删除后，提交已删除任务的 ID 和所显示的修订号。它从历史提交中清除任务记录，删除调用记录和非共享的存储工件，并重建搜索；中断的清理在重新打开时继续。共享工件引用、原始素材、工作区文件和独立聊天保留。所属靶场必须先停止或重置，再永久删除。摘要和报告使用简体中文，标识和路径保持原样。项目移除可恢复：移除会停止执行、停用项目关联并从活动列表隐藏；恢复后仍保持停止状态，且不会自动重新关联会话。 仅供操作员使用的 projectSessions 返回有效协调会话引用，客户端按可访问且未归档的 Session 目录筛选。projectArtifact 先根据所选项目校验归属，再执行现有摘要校验和输出限长读取。这些读取不打开 Session，也不修改绑定或持久记录。

-----

<a id="use-this-package"></a>
## 使用

在专用 `dsh` profile 中使用 [security-profile](../security-profile/README.zh.md)，添加 [security-web-profile](../security-web-profile/README.zh.md) 即可打开会话内工作台。默认通用 profile 不加载这些组合。

通过常规 `skill` 工具加载 `security-investigation`，再按材料与问题组合 `security-web`、`security-firmware`、`security-android` 和 `security-iot-offline`。这些 [skill（技能）方法](src/methods.ts) 指导根据证据提出假设、设计可区分假设的检查、选择工具和限定委派范围。Web 调查追踪身份、输入和处理入口；固件调查连接提取组件与可达的使用方；Android 调查区分 APK/DEX 检查与明确选择的 adb 设备观察。无法访问设备时，设备行为保持未验证，不妨碍有价值的静态工作。方法不安装工具，也不授予权限：现有角色检查、项目范围和执行审批仍决定执行权限。

1. 在已配置工作区的 Web 对话中描述任务，或创建项目并指定目标和已配置环境。从部署的 `importRoots` 导入 PE、ELF、APK、DEX 文件，或不可变源码文件或目录。
2. 根据每项资产的研究问题选择下一步分析和 provider。APK 导入会分别测量 DEX 和 native 库，并保存父子关系。
3. 检查环境健康状态。在 `environments[].tools` 配置可执行文件；工具已安装不代表目标当前可访问。
4. 使用实现材料评估假设。需要运行验证时，准备包含目标、脚本、预期观察、影响、时限及清理方式的计划。
5. 在工作台检查并批准不可变计划。停止或撤销会阻止新执行，并等待活动 provider 清理。中断的检查必须先核对再重试。

内置[分析脚本库](src/analysis-scripts.ts) 将可复用文件保存在 `resources/analysis-scripts/{tshark,mqtt,dynamic}/`。编写新分析代码前，加载 `security-packet-analysis`、`security-mqtt` 或 `security-dynamic` 获取分析思路、绝对资源目录、参数和示例。离线 Python 脚本使用明确选择的 TShark 可执行文件读取 pcap/pcapng，保留 MQTT 消息边界和重组信息，并返回有界 JSON，包含输入与脚本摘要、工具版本、参数和不完整原因。时间、帧数、解码字节和结果字节上限均为必填参数。输出路径必须是尚不存在的绝对路径，结果保存在任务的 `outputs/` 中。动态 `prepare.py` 在任务的 `scripts/` 中生成参数化 JavaScript，交给现有不可变 Frida 验证计划；准备工具不会附加进程。模板观察原生模块或导出函数，达到事件上限时证据标记为不完整。内置资源保持不变。脚本运行在本机 Host；不提供在线 MQTT、Android Java 模板或自定义目录导入。`scriptCatalog` 支持无需选择项目或环境的只读浏览。

自动 Web 任务入口依次使用操作者保存的工作区资源、`taskIntake.workspaces` 精确条目（`cwd`、`environmentIds`），或未匹配工作区的 `taskIntake.defaultEnvironmentIds`。`taskIntake.maxAttempts` 提供尝试上限。保存的选择在重启后保留；空选择会禁用自动入口，即使存在默认环境。修改只影响新任务。首个获准执行的安全工具将已记录的用户请求绑定到选定资源。内部消息和委派 Session 不能初始化任务；已有绑定和用户主动退出的状态都会保留。安全 profile 为未匹配的工作区选择 `local`。CLI 入口仍需显式创建项目。初始化不会导入文件、注册网络目标或批准执行。

用户也可通过 `/security` 查看状态，或通过 `/security <JSON command>` 提交相同的修订检查命令。`security_help` 可通过可选 `action` 仅返回该动作的命令 schema；省略时返回完整 schema。静态采集回执包含可用于后续命令的当前修订号；发生并发修改时仍需刷新。模型不能批准计划或共享经验。普通命令必须携带稳定的操作 ID 和已观察修订号；停止与撤销只减少执行权限，因此接受较旧修订号。

<a id="configure-analysis-providers"></a>
### 配置分析 provider

包分别导出 `./native`、`./offline`、`./web`、`./laboratory`、`./environment`、`./ghidra`、`./frida`、`./android` 和 `./commands` 插件。[配置源码](src/index.ts) 定义制品、输出、时长、审批有效期和委派限制。仅允许已配置的本地、Docker 和 Android 环境；Docker 控制留在 Host。

Docker 环境通过 `externalContainer: { name, workdir }` 使用已有容器，不能同时设置 `image`。`workdir` 是容器内的绝对目录。Docker 安装项的 `prefixArgs` 选择本机或远程 context。外部容器支持清单检测与原生 Shell 调用；分析 provider 操作会拒绝它们，因为尚不支持传输宿主制品。生命周期与网络设置仍由操作者管理；DSH 不挂载宿主文件，也不在取消或释放时停止容器。取消仅等待宿主 Docker 客户端退出，远程进程是否完成仍未确认。清单返回宿主可执行文件及完整启动参数，同时单独保留容器安装信息。[部署指南](../../../docs/user/guide/security-analysis.zh.md#external-docker-containers)说明配置与命令行管理方式。

[GhidraMCP 1.4](https://github.com/LaurieWired/GhidraMCP/tree/1.4) 需要应用[受管理补丁](resources/ghidra/patch_upstream.py)。对固定上游 Java 文件应用补丁，使用对应 Ghidra 发行版构建扩展，然后在 GUI 打开导入的程序。启动前设置 `DSH_GHIDRA_TOKEN`、`DSH_GHIDRA_SHA256` 、`DSH_GHIDRA_PROGRAM` 和 `DSH_GHIDRA_PORT`；端口 0 选择空闲端口。可选 `DSH_GHIDRA_READY` 指定保存实际端口的新文件。在 Ghidra provider 的 `programs` 中配置相同 token、实测哈希和 domain-file 路径。补丁绑定稳定程序，只监听本地地址，认证每个请求，并拒绝已关闭或身份不符的程序。切换 GUI 当前程序不会改变查询目标。查询、改名、注释及原型操作走专用适配器；数据库写入需要计划。

Frida 通过 Harness subprocess 使用官方 Python bindings，需要配置已安装 Frida 的 Python。attach 请求明确 PID、名称和启动身份；helper 还核对可执行文件哈希或 Android 包身份。自定义脚本与 spawn 必须属于验证阶段。helper 卸载脚本并 detach，只终止自己启动的进程。配置带哈希的 Java bridge bundle 后，可用 `javaBridge: true` 在批准前拼入脚本；应先用 `frida-compile` 和 `frida-java-bridge` 打包[入口源码](resources/java_bridge_entry.js)，再配置路径、哈希及版本。批准的制品保存最终脚本字节。

JADX 接受 APK/DEX，并明确标记不完整反编译。adb 只操作指定设备，暴露固定的包和设备查询。Android 验证会先核对已安装的 base APK。root、Frida server/Gadget、USB 授权及版本兼容仍由用户准备。可登记 `fastboot`、`john` 的版本参数以检查安装情况；其设备写入或审计操作没有执行 provider。

### 工具清单与验收

Host 与 CLI 的工具检查共用可执行文件发现、依赖排序和探测解析。仅在候选程序不存在时继续发现。选定程序的查询失败、超时、空响应或无效 JSON 会报告错误，不尝试其他安装；失败的检查不会保存配置。Python 身份包含解释器位置、环境前缀及 pip 可用性。

| 工具 | 操作及影响 | 执行与清理 | 已验证组合 |
|---|---|---|---|
| 内置二进制检查 | 实测身份、有界十六进制和 ASCII/UTF-16LE 字符串 | 读取不可变制品；限制输出，不执行目标 | PE/ELF 头与字节分页 fixture |
| GhidraMCP 1.4 | 绑定程序查询；数据库写操作需要计划 | 认证回环 HTTP、有界响应；不重放数据库修改 | 已针对 Ghidra 11.3.2 构建扩展并完成独立 ARM ELF 导入；GUI 关闭后的 DSH 查询被阻塞 |
| Frida 17.18.0 | 进程、模块、导出枚举，trace，经批准的自定义脚本及 spawn | Python helper；配置时限及输出限额；卸载、detach、停止本任务创建的进程 | Windows 本机自有 Python 可执行文件：正常完成与取消 |
| JADX | APK/DEX 反编译、源码及资源提取 | 受管理子进程；限制输出并清理临时目录 | 集成未验证；部分反编译结果标记为不完整 |
| Docker 29.7.2 | 启动、检查、停止本任务拥有的环境 | 固定镜像摘要、资源限制、无网络、移除自有容器 | 本机 Docker Desktop 与已有 Kali ARM64 镜像：生命周期及 Python 命令 |
| adb | 所选设备状态、包列表/详情、base APK 身份读取 | 固定 argv 子进程调用；不接受任意 shell 命令 | 没有连接的 Android 设备；未验证 |
| fastboot / john | 版本登记；受管工具箱内进行固定 John yescrypt 验收 | 操作者查询与隔离测试向量检测 | 设备写入与密码审计 provider 尚不可用 |

<a id="roles-tasks-and-tool-management"></a>
### 角色、任务和工具管理

工具箱将可共享定义、环境安装配置和实测结果分开管理。`toolCatalogPath` 指定保存 version-1 工具包数组的绝对 JSON 路径；源码启动器使用 `.dsh/security-tool-packs.json`。工具包支持 CLI 命令、导入名与发行包名分开的 Python 模块、JSON 插件查询、既有 provider 引用、自由标签、工具集合、依赖、用法说明与技能引用。导入预览校验引用、循环依赖和名称冲突，不执行命令；显式确认覆盖并检查修订版本后才原子写入。后续查询重新读取定义，进行中的检测保留已捕获的定义。`toolConfiguration` 仍指定本机 `environmentId` 和安装 JSON `path`；现有 `.dsh/security-tools.json` 与 `environments[].tools`（包括自定义 ID）继续有效。页面保存安装配置要求有界检测成功，显式配置失败不会静默回退 PATH。其它环境使用部署配置，软件仍由用户安装。

| 角色 | 任务 | 可用分析能力 |
|---|---|---|
| `coordinator` | 规划、汇总与验证 | 领域工具、原生脚本、网页资料、jobs/goal/todo；执行已批准的验证计划 |
| `reconnaissance` | `inventory` | 原生脚本、二进制身份/十六进制/字符串、Ghidra 清单、固定 adb 查询、环境检查、证据检索 |
| `reverse-analyst` | `surface`、`assessment` | 原生脚本、二进制检查、只读 Ghidra 查询、JADX 和固定 adb 查询、环境检查、证据检索与公开资料研究 |
| `web-analyst` | `surface`、`assessment` | 原生脚本、已分配的 HTTP 证据、不可变源码读取/搜索、环境检查与公开资料研究 |
| `researcher` | `assessment` | 项目证据、已审核知识、公开网页搜索与读取；不能执行样本或调用静态 provider |
| `reviewer` | `review` | 指定资产的证据与知识检索；不能采集、访问网页或执行验证 |

角色过滤在子 preset 初始化后执行，涵盖继承的原生工具和子会话局部的 `structured_output` 报告工具。Reviewer Session 保留专属 `security_review` 工具。

每个子 agent 使用 fresh Session，接收角色提示词及兼容任务。[提示词与权限定义](src/workbench/roles.ts) 要求明确单一资产、问题、完成条件、时间/输出限额、证据引用、不确定性及下一步。每次工具执行都会检查角色，领域静态采集入口再次检查；仅隐藏 schema 不构成授权。子 agent 不能继续委派、执行计划、批准或共享。协调者依据报告提交候选记录。研究提示词禁止将私有样本内容发送到公共查询；尚未实现网络数据防泄漏机制。

协调者自行处理简短或紧密依赖的问题，在并行推进、节省上下文或独立检查足以抵偿交接成本时委派。Web 和逆向分析员可以直接解决小的公开知识缺口；较大的独立资料研究适合交给 `researcher`。`security_delegate.reason` 保存预期收益。每个委派保留问题、完成条件、原始项目和资产、研究方向、子会话地址及执行结果。`security_scope` 的 `kind: "delegation"` 返回有界摘要和详情；已记录的运行时上下文提示未处理工作。协调者通过 `delegation-disposition` 记录 `accepted`、`needs-more` 或 `rejected` 及理由。采纳报告不代表确认发现。`retryOf` 将新的有界任务关联到已终结任务，不恢复原子会话。

Job 负责取消并等待子任务清理。成功取得 job ID 只代表已派出，不代表完成；有效且未超限的报告在清理结束后才记为完成。停止或归档会取消活动委派并等待终结。Host 重启后，未完成委派标记为中断，不自动重跑。原始 Session 日志和证据仍可访问。历史 `binding.report` 摘要保持可读，不补造派工元数据；新报告归属于委派记录。

尚无发现记录时，reviewer 可以检查已有证据，并返回包含证据引用和不确定性的结构化报告。该报告既不创建发现，也不记录对发现的正式裁决。需要正式裁决时，协调者先保存带证据的疑似发现，再由 reviewer 使用真实发现 ID 和当前哈希调用 `security_review`。

内置 `binary` provider 不需要外部安装。调用 `security_static`，设置 `provider: "binary"`、指定资产/环境及 `operation: "identity"`、`"hex"` 或 `"strings"`。身份查询返回实测 SHA-256 和部分 PE/ELF 头字段。十六进制与字符串参数接受字节 `offset` 和 `length`；字符串还接受 `minLength` 与 `encoding`（`ascii` 或 `utf16le`，仅提取可打印 ASCII 字符）。省略长度时取输出预算的八分之一。分页结果保留偏移和不完整标记；跨页字符串需重叠查询。这些观察不能证明文件完全有效、入口可达或存在漏洞。

### 证据与恢复

失败或取消的观测及已批准执行先保存可用字节和失败诊断，再拒绝调用。重复相同操作会报告已保存的失败，不再次调用 provider。没有失败的不完整观测仍可读取；存在证据记录本身不代表成功。

`security_capture_analysis(assetId)` 列出调用者自身 Session 中可采集的调用 ID，不保存证据；可选的 `jobId` 筛选已收集的后台输出，`offset` 按返回的 `nextOffset` 继续查询。列表不含命令或输出正文。后台任务 ID 不是调用 ID。将返回的 ID 传入 `security_capture_analysis(assetId, callIds)`，即可将调用者自身 Session 中已提交的原生 `bash`、`pwsh` 和 `job_output` 事件保存为不可变的脚本分析日志。后台采集包含已记录的 Shell 启动及截至所选调用的已收集输出。重复选择返回同一证据，并将它关联到每条匹配的调用记录。采集这些调用无需导入生成的脚本。失败、裁剪、外溢或未完成状态保持明确；不会读取外溢路径。资产关联由分析者声明，日志属于辅助证据：可供发现、子报告、检索和独立复核引用，但不能单独满足完整实现证据或已批准运行时验证的要求。

协调者、侦察、逆向分析和 Web 分析角色使用原生工作区工具及继承的 DSH 权限运行脚本。`security_capabilities.analysisDirectory` 返回 Session 工作区下 `.dsh/analysis/<task-session-key>/` 的绝对路径；缺少工作区或活动绑定时返回 null。查询不会创建目录或授予权限。协调者和子任务指令要求把生成脚本放入 `scripts/`、结果及日志放入 `outputs/`、中间文件放入 `tmp/`；Shell 调用以分析目录作为 `workdir`，用绝对路径读取原始输入。任务与 Session 标识决定各自独立且稳定的目录。文件跨轮保留；清理前需保存相关工具结果作为证据。用户要求的项目代码和交付物遵循项目布局。研究和复核角色不能执行脚本。项目停止和归档会取消跟踪的原生前台进程及所属后台任务，并等待清理。原生 Shell 取消涵盖 DSH 管理的进程树；外部服务或脱离的容器工作负载需要通过对应环境的生命周期操作清理。专用验证 provider 仍要求已批准计划。

只读 `toolboxDirectory` Remote 立即显示未检测的定义，打开页面不运行探测。`toolboxInventory` 和 `security_environment` 按当前目录检测所选工具 ID 及其递归依赖。Host 与 CLI 共享定义校验、候选路径发现、依赖排序、探测参数和结果解析。CLI `doctor` 报告 Python 解释器、虚拟环境和 pip 信息；`import`、`export`、`--tag` 与 `--collection` 管理可复用工具包。`security_capabilities` 按查询词、标签、集合或工具 ID 返回有界摘要；`details` 加载所选工具或 `providerId` 的完整说明。`toolDiscoveryPageSize` 限制每页数量，`modelResultBytes` 限制完整响应。系统指令仅保留发现原则。TShark 详情区分可执行文件、驱动、接口与访问检查，并包含 Wireshark extcap 发现方法；版本检测不能证明抓包权限。

共享指导优先采用原生机器可读结果，并按当前安全问题选择有界查询。按需加载的[工具指南](src/builtin-tools.ts)说明二进制、抓包、动态、Android、HTTP 和扫描工具的格式及限制；[调查方法](src/methods.ts)衔接所需观察、最小查询、结果解释和停止决策。输入身份、参数和覆盖范围匹配时复用已保存结果。小型任务脚本筛选或关联字段，同时保留原始文件和定位信息。把文本放入 `stdout` 不等于结构化其内容。空结果、部分结果、截断、格式不支持或执行失败均需明确保留缺口；工具观察和建模假设应与 finding 及 review 结论区分。

Metasploit 详情包含 JSON 任务文件模板，区分可复用的模块设置、本次环境与目标绑定，以及实测运行结果。指南要求 agent 在 `scripts/` 保留 rc 模板，在 `outputs/` 保留实际执行的 rc 和带哈希的输出，并将调用捕获为证据。复用采用所选环境的实测启动参数，明确宿主与容器路径，通过相同 Docker context 复制文件。模块覆盖值保留适用条件，未执行的负对照保持未验证。获准的 `import-source` 可归档 `importRoots` 内的文件；checkpoint 引用文件和证据。这些是现有原生 Shell 工具的使用指引，不是自动配方执行器，也不代表 Metasploit 集成已验收。

`toolPreferences` Remote 只保存经过身份验证的活跃会话偏好；偏好是软建议，不改变角色、环境和执行权限，也不限制发现其它工具。下一次模型请求通过既有 runtime-context 快照记录这些 ID。安全委派在创建子会话时复制偏好，之后父子独立；会话释放或 Host 重启后恢复自动发现，不写入项目记录。

provider 原始输出先保存，再提交证据引用。证据记录保留样本、工具版本、参数、来源 Session/call、完整性和批准计划。`security_evidence` 按字节分页，或按行号选取已保存的源码读取结果；分页读取原始字节。检索根据项目记录及原始证据重建 SQLite FTS，支持中文分词和标识符。共享经验必须经过用户审核，始终是参考材料，不是本项目证据。

复盘和经验通过 `remember` 命令保存 `category`、`title`、`summary`、`conditions`、`actions`、`pitfalls` 和 `tags`。条目描述目标弱点、适用条件，以及能帮助下次识别、验证或防护的做法。工具报错和格式修正不属于可复用的安全经验。旧版自由文本可由整理任务读取，完成整理后才在界面中显示。

Host 运行期间，配置成对的 `knowledgeProvider` 和 `knowledgeModel` 后，知识整理按 `knowledgeIntervalMs` 定期执行（默认 3,600,000 毫秒；设为零关闭自动整理）。工作台也支持手动整理；未配置专用模型时，手动整理沿用发起会话的模型。独立且禁用工具的 Agent Session 记录完整模型请求与响应。`knowledgeInputBytes` 默认为 131,072 字节，`knowledgeOutputTokens` 默认为 8,192 token；`maxOutputBytes` 限制完整响应大小，`delegationTimeoutMs` 限制运行时间。

整理跳过未变化的内容，只处理同一项目。每条输入须恰好归入保留、合并或排除，也可以全部排除。被排除的操作笔记退出报告、搜索、共享和日常知识视图，journal 仍保留历史。无效、超限、已取消或与并发编辑冲突的结果不能覆盖记录；已共享内容变化后须重新审核。失败可手动重试或等待下一周期，停止项目会取消活动整理。

日志以一个 storage-domain 记录追加一个完整命令。独立 SQLite 占用锁保证每个安全目录只有一个 Host。重启撤销批准，并将未结算执行标记为待核对，不会重放注入或进程创建。相同操作重试不会再次执行。`import-legacy` 将原型 JSON 归档保留为不可变的用户声明记录；必须另行导入实际样本才能获得实测身份，原归档不会提升为已验证证据。

-----

<a id="source-snapshots-and-offline-checks"></a>
### 源码快照与离线检查

委派接受可选 `checkId` 和 `inputEvidenceIds`。关联检查必须属于指定项目和资产，在准入和绑定子任务时保持待检查且依赖全部完成。输入观察必须属于该资产，并通过字节长度与摘要校验；失败或不完整观察仍可用于解释阻塞。重试须显式提供本次输入。子任务记录的初始消息包含检查标题、完成条件和依据引用；原始观察通过依据工具读取。待启动或运行中的委派阻止重开对应检查及受影响的上游检查，须先取消并等待清理。采纳报告不会完成检查或确认发现。

共享的[覆盖投影](src/workbench/coverage.ts)区分检查执行、观察和已采纳的当前复核。观察仅通过检查、依据和计划的显式引用关联。活动流 snapshot/project 帧可携带同修订的覆盖，不持久化派生结果。新报告使用同一投影，已保存报告保留原快照。未关联检查、采集不完整、模拟和未记录方式保持可见；数量不表示目标安全程度。

经过认证的 Connection Fetch 提供操作者专用 `GET/HEAD /api/security.report.export?projectId=…&reportId=…`。ZIP 包含选定报告、可选发现附录、不可变 JSON 快照、全部原始观察及其引用的计划脚本，按 SHA-256 去重。版本 1 的 `manifest.json` 映射记录与文件，并列出未包含的导入材料；`SHA256SUMS` 覆盖载荷和清单。导入样本和源码目录成员默认不包含，除非其字节作为观察或脚本被明确纳入。`exportMaxBytes` 默认 268,435,456 字节，限制去重后的未压缩载荷、清单和校验文件。缺失、损坏或超限内容会失败，不生成完整 ZIP。取消下载、卸载插件或永久删除项目时会取消读取并等待释放；生成另一份报告不会改变选定快照。

`import-source` 将选定的源码文件或目录保存为一个资产，包含相对路径、SHA-256 哈希和不可变内容制品。选择单个文件时，清单仅包含以该文件名命名的一项，不会导入相邻文件。目录遍历会记录排除的链接而不跟随它们。`maxDerivedAssets` 限制遍历条目，`maxArtifactBytes` 限制源码总字节数。`source` provider 提供有界的 `list`、`read` 和字面文本 `search` 操作；结果保留文件哈希、行号和续读位置。旧文件资产仍可读取。

`./native` 插件直接在 Host（包括 Windows）执行已审批的 `native/python` 计划。选择验证检查项和本机环境，提交完整 Python 脚本，参数为 `{}` 或环境工作区内的 `{cwd: 绝对目录}`。准备阶段发现已配置或可用的 Python，固定程序路径、版本、操作系统和已存在的工作目录。执行前重新核对这些值，通过标准输入和 `-I -u -B` 运行已保存脚本，不另行加载可变脚本包装器。输入和依赖仍为本机当前文件，应使用绝对路径并在结果中记录其身份。本机执行具有 Host 当前用户的文件、网络和设备权限，不提供 Docker 隔离；计划须说明影响和清理方式。审批、时长与输出上限、项目停止和子进程清理仍生效。脚本生成的文件保留；`graceMs` 配置进程清理宽限期。Windows DLL 需要 Windows 和兼容的 Python 架构。应新建本机计划，不能复用离线审批。

`./offline` 插件仅通过已审批的不可变计划接收 Python 或浏览器脚本。配置本地 `docker` 和包含 Python、Node、Playwright、Chromium 的现有镜像；[镜像配方](resources/offline/Dockerfile) 与[浏览器运行器](resources/offline/browser.mjs) 定义运行时布局。准备阶段固定已安装镜像 ID，provider 不拉取镜像。可配置限制为 `image`、`memoryMb`、`cpus`、`pids`、`temporaryMb` 和 `graceMs`。这种 Linux 模拟不能读取 Host 磁盘路径或原生加载 Windows DLL；此类检查应选择 `native/python`。

每次执行使用新的非特权容器，禁用网络和设备访问，根目录与源码挂载只读，临时存储有界。浏览器请求从快照拦截到 `http://localhost`。脚本注入模拟硬件，打印运行时版本、事件与断言，并在断言失败时返回失败。证据区分模拟、静态和设备观察，保留失败及清理详情。容器测试覆盖 Python 和 Chromium，但不能证明固件或无线行为；Host 崩溃后仍需操作者核对残留离线容器。

模型的项目视图与搜索结果返回短摘要，包含源码证据的文件路径与读取范围；`security_scope` 按字节分页读取绑定项目修订的记录详情，`security_evidence` 可按字节分页读取原始观察，也可按行号选取已保存的源码读取结果。`modelResultBytes` 默认将完整模型工具响应限制为 16,384 字节，`maxOutputBytes` 仍用于采集。命令返回有界回执，完全相同的观察重试返回已保存证据 ID。子任务摘要保留在 Session 绑定中，不作为原始证据或报告正文。

`./packet-capture` 为本机环境中已导入的 PCAP/PCAPNG 文件资产注册固定的 `summary` 和 `packets` 观察操作。`parameters.protocol` 选择 `wifi` 或 `ble`；可选 `filter` 是 TShark 显示过滤器。需要 Python 和直接执行的 TShark 程序。Provider 配置 `maxPackets`（10,000）、`maxDecodeBytes`（16,777,216）及 `graceMs`（3,000）与工作台的时间、输出限制共同生效。证据保留抓包哈希、脚本身份、参数、工具版本和帧号、时间戳；失败及省略输出明确标记为不完整。HCI、空口抓包和 IP 流量分别标注，不推测缺失或加密字段。原始抓包只返回二进制元数据，不做 UTF-8 预览。采集角色可执行固定操作，研究者和复核者仅可读取已保存证据。

`deviceDirectory` 只读取进程内诊断缓存，不触发检测。显式调用 `deviceInventory` 或 `security_environment` 的 `devices: true` 检查 Windows 本机 Python/TShark 安装、Npcap 驱动、抓包及 nRF extcap 接口和 COM/PnP 身份。接口检查失败保留上次观测及其时间。通用串口不自动识别为 Tufty，不打开串口，真机采集能力保持未验证；发现过程不安装工具、不修改驱动。非 Windows 或非本机环境不支持设备检查。

<a id="understand-the-implementation"></a>
## 实现

<details>
<summary>实现细节</summary>

模型工具与生成的 Remote 方法共用[领域控制器](src/workbench/controller.ts)。provider 注册返回 disposer，并通过现有 Loader 组合。服务增加指引和执行守卫，不修改 `agent-loop`。明确的 Session 绑定决定协调者、侦察者、逆向分析员、研究员和复核者权限。新的委派 Session 返回证据 ID 和不确定性；普通 job 结果保留其 Session 链接。

[领域日志](src/workbench/journal.ts) 保存检查及尝试的权威状态，jobs、goal、todo 负责运行中的协调。制品存储按哈希发布完整内容，可重建检索索引不会删除日志中的证据。损坏的派生索引会被隔离，并从已提交记录重建；权限及 I/O 错误会明确报出。不发布 invariant companion：日志投影只有一个写入者，并在重开时校验；provider 在执行入口核对当前身份及权限。

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [安全分析路线图](../../../docs/roadmaps/security-analysis.zh.md)
- [实验性插件](../README.zh.md)
- [架构](../../../docs/architecture.zh.md)

-----

## Web 靶场支持

./web 和 ./laboratory 插件提供批准后的 HTTP 证据采集与操作者显式管理的靶场生命周期。配置见 [Web 靶场指南](../../../docs/user/guide/security-analysis.zh.md#local-web-laboratory)，未验收或延后项见 [交付范围](../../../docs/roadmaps/security-analysis.zh.md#web-delivery-scope-2026-09-22)。版本化配方使用官方 Kali，记录已安装软件包，并以已知 yescrypt 向量检测作为构建条件。操作者可从本地 Docker 镜像库复用 `existingImage`（默认 `vxcontrol/kali-linux:latest`），不拉取或构建工具箱。复用会固定镜像 ID，在自有断网容器内检测工具，记录 yescrypt 失败而不阻塞 HTTP；缺少 Python 运行时则拒绝登记。每次复用或构建产生独立版本，升级时保留已有靶场。安装 Nuclei 和 Metasploit 不会增加专用 provider 接口；原生 Shell 调用遵循 DSH 权限。

独立复核绑定发现内容、同目标证据和复核子 Session。完整的静态实现材料可支持独立复核后的确认或反驳；身份、版本及字符串线索不能单独确认。运行验证结论仍须具备已完成的批准计划。报告生成通过一次禁用工具的模型调用整理安全判断与覆盖，并核对每条发现的去向。报告输入区分用户请求与已保存的发现状态、已接受的复核裁决；完成静态复核不代表完成运行验证。输出可以是独立 JSON 对象，或包在单个 JSON 或未标注语言的 Markdown 代码围栏中；夹杂说明文字、多个代码块及无效报告字段均会被拒绝。Markdown 正文是简短安全报告，多余的目标发现进入可选附表；JSON 保留项目记录。`reportMaxChars` 默认以 1,200 字为写作目标，不作为硬性截断上限，`reportInputBytes` 默认 131,072，`reportOutputTokens` 默认 4,096，`reportMaxFindings` 默认五条，`reportMaxLessons` 默认三条。未配置专用模型时，报告沿用发起会话的模型。生成失败或超限时不发布报告。

使用 `security_command` 的 `checkpoint` 动作保存简短的方向标题、阶段、转向原因、结论、下一步及证据或发现引用。同一问题的多轮研究按 ID 更新当前段；问题或阶段改变时新建一段。保存第一个检查点时，会关联该项目中同一协调会话此前未归类的调用；其他会话及已有阶段的调用保持原归属。子任务调用保留委派时的进展归属。Provider 请求及原生 Shell/PTC 后台任务根据实际执行记录计数，活动独立持久化，不改变审批修订号。命令文本只能识别待确认的工具候选，安装检测不计分析次数。失败、中断、重启后的未知结果及不完整输出与安全结论分别显示。协调者回合结束时将有长度上限的可见回复简报保存到当前方向，预算收尾也适用。`activityPageSize` 默认为 20，每页可配置 1–100 条调用详情。


<a id="continuous-improvement"></a>

## 持续改进

改进分析从成功与失败的安全任务中发现本 Agent 在能力、流程、脚本和方法论上的不足，提出可复用工具、缺失接口、委派改进、脚本参数化、流程调整或可重复执行的调查方法，并附实际依据和验收场景。方法改进可落实为提示词、技能文档或工作流规则，无需新增工具。网络与 IoT 复盘重点检查协议状态、抓包/固件/日志关联、可复现验证，以及协作中的上下文缺口。目标漏洞仍归安全发现管理。允许没有建议。工作台提供手动分析、统一改进池、人工状态和可交接的编码任务；操作见[用户流程](../../../docs/user/guide/security-analysis.zh.md#continuous-improvement)。

服务的 `evolution.auto` 默认为 false，安全 profile 将其设为 true。新增活动后，`idleMs` 默认等待 300,000 毫秒；协调会话、子任务、检查和后台作业须全部空闲。手动请求也等待空闲，但不等待静默间隔。每个任务保留一个请求；`concurrency` 默认为一。新增活动取消分析并重新等待。停止、归档和卸载会取消并等待执行结束。待处理请求跨重启保留；中断运行重新排队，失败则等待新增活动或手动重试。历史任务不自动回溯。

专用 `evolution.provider` 与 `model` 必须一起配置；否则沿用最近观察到的协调者已解析 provider/model。独立分析沿用模型默认推理强度；`evolution.reasoningEffort` 可显式选择受支持的强度，不支持的值会在发送请求前报错。该设置不改变协调者。在推理与正文共用额度的服务商上，`outputTokens` 同时限制两者。默认 `inputBytes: 131072`、`excerptBytes: 2048`、`outputTokens: 24576`、`timeoutMs: 300000`、`maxCandidates: 20` 和 `maxSuggestions: 5`。输入包含有界可见记录、准确 Session 序号、任务记录、运行版本、截断标记和历史资料缺口。事件发生时确定归属；工具结果保留调用所属任务。不收集推理流。候选筛选匹配组件、适用条件和预期改动的中英文关键词；模型归并保留人工进度，准确来源去重。已验证建议收到新依据时提示复查，不改变状态。

独立 `security_evolution` 存储域串行提交包含运行、记录、建议和回执的原子状态记录，其修订号不改变安全审批修订号。永久删除接入现有可恢复清理，移除任务记录与快照，保留共享建议中其他任务的贡献。导出即时生成，仅附有界摘录，不附样本或完整会话。原始及复盘 Session 沿用现有保留规则；用途标记继续保留，禁止将复盘 Session 作为普通 Agent 续聊。

共享模型执行器使用独立持久 Session，记录完整请求与响应，并禁止工具执行。其 token 用量额外于原分析任务。它不修改源码，也不启动编码工具。回执导入保留编码 AI 的声明；只有明确的人工操作才能将建议标记为已验证。浏览器类型及 Remote 方法见[子系统参考](../../../docs/subsystems/security-workbench.zh.md)。

<a id="model-experience"></a>

## 模型体验

### 安全上下文

#### 模型看到的内容

协调者使用 `security_scope` 等领域工具分解检查、检索证据、准备计划并汇总结论。skill 目录提供方法摘要；`skill` 工具加载所选方法的完整指令。子 agent 只看到分配的资产，返回摘要、证据引用、不确定性和建议。外部输出、共享经验与子报告是待核对数据，不能扩大权限。

#### Token 影响

skill 摘要占用目录上下文，方法正文在加载时增加上下文。领域工具响应使用 `modelResultBytes`，原始采集使用 `maxOutputBytes`。`analysisTurnTokens` 默认允许每个 Session 分析轮次使用 120,000 个探索 token，计入未缓存输入、缓存写入和输出。`analysisCountCacheReads: true` 还会计入重复的缓存读取；两种模式均保留完整的模型用量日志。如果再执行一次与上次消耗相当的步骤会达到限额，模型会收到已记录的阶段总结指令，并在既有输出上限内执行一次总结步骤。探索工具从列表中隐藏，执行端也会阻止调用；委派任务仍可使用 `structured_output`。单次请求超出剩余预算时也进入收尾。总结后的额外模型步骤会被拒绝，不会抛出预算异常。阶段总结说明已确认结果、保存的证据、缺口及下一步，不把调查标记为完成。用户后续提问会获得新的轮次预算并恢复正常工具。

#### KV Cache effect

固定工具定义和工作流指引保持稳定。skill 目录作为上下文记录；已加载的方法和项目状态通过已记录的工具结果进入上下文。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- Ghidra 安装、扩展编译、GUI 启动和样本导入需要操作者准备。DSH 函数、反编译和交叉引用验收仍待完成；导入成功或操作者探查不能证明 DSH 查询能力。
- 已在本任务创建的 Windows 进程上实际验证 Frida 17.18.0 观察与清理。目前没有 Android 设备；现有 Kali 镜像缺少 Frida、JADX 和 Ghidra，镜像存在不等于分析环境受支持。
- 真实 DeepSeek 教程分析已跑通静态证据和子 agent 报告回收，但出现错误的 ELF 解读。结构化格式解析尚未完成；新版简报仍需真实模型运行与 GUI GIF 验证。keyless 测试与外部响应模拟分别作为证据。
- 不可变源码和二进制读取可独立运行。Provider 标识共享外部实例并使用独占租约；Ghidra 按实际回环地址租约。自动 GUI 部署、丰富的组件/JNI 关联、远程实验室、语义搜索、设备专属 IoT 验证、fastboot 写入和 John 密码审计仍不可用。
- Android split APK 验证会被拒绝，因为单个导入的 base APK 不能证明完整安装包身份。本机 attach 会拒绝无法提供启动身份或可执行文件身份的平台。
- 整理处理项目的完整知识集合；超过 `knowledgeInputBytes` 时直接失败，不截断内容。自动任务需要 Host 持续运行且已配置模型。语义等价由模型判断，共享结果仍需用户审核。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作记录（非规范）</summary>

无。

</details>
