---
description: "受约束的逆向检查、计划批准和项目证据。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-security-analysis

[English](README.md) | 中文

## 概述

按项目组织侦察、攻击面分析、漏洞评估与受控验证，保留可追溯的原始证据。通过可选 profile 使用 Ghidra、Frida 和 Android 专用工具，并委派有边界的查询。操作计划需要用户批准，工具能力在执行时再次检查。外部环境必须事先准备。

## 目录

- [使用](#use-this-package)
- [实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用

在专用 `dsh` profile 中使用 [security-profile](../security-profile/README.zh.md)，添加 [security-web-profile](../security-web-profile/README.zh.md) 即可打开会话内工作台。默认通用 profile 不加载这些组合。

1. 创建项目，填写目标并选择已配置环境。从部署允许的 `importRoots` 导入 PE、ELF、APK 或 DEX。
2. 为每个资产生成四阶段检查模板。APK 导入会分别测量 DEX 和 native 库，并保存父子关系。
3. 检查环境健康状态。在 `environments[].tools` 配置可执行文件；工具已安装不代表目标当前可访问。
4. 根据静态证据整理入口并评估假设，准备包含目标、脚本、预期观察、影响、时限及清理方式的验证计划。
5. 在工作台检查并批准不可变计划。停止或撤销会阻止新执行，并等待活动 provider 清理。中断的检查必须先核对再重试。

用户也可通过 `/security` 查看状态，或通过 `/security <JSON command>` 提交相同的修订检查命令。`security_help` 提供命令 schema。模型不能批准计划或共享经验。普通命令必须携带稳定的操作 ID 和已观察修订号；停止与撤销只减少执行权限，因此接受较旧修订号。

<a id="configure-analysis-providers"></a>
### 配置分析 provider

包分别导出 `./environment`、`./ghidra`、`./frida`、`./android` 和 `./commands` 插件。[配置源码](src/index.ts) 定义制品、输出、时长、批准有效期和委派限额。只允许已配置的本机、Docker 和 Android 环境。Docker 使用指定的已安装镜像，限制 CPU、内存和 PID，禁用网络，并挂载只读工作目录及独立交换目录。Docker 控制权保留在 Host。

[GhidraMCP 1.4](https://github.com/LaurieWired/GhidraMCP/tree/1.4) 需要应用[受管理补丁](resources/ghidra/patch_upstream.py)。对固定上游 Java 文件应用补丁，使用对应 Ghidra 发行版构建扩展，然后在 GUI 打开导入的程序。启动前设置 `DSH_GHIDRA_TOKEN`、`DSH_GHIDRA_SHA256` 和 `DSH_GHIDRA_PROGRAM`。在 Ghidra provider 的 `programs` 中配置相同 token、实测哈希和 domain-file 路径。补丁绑定稳定程序，只监听本地地址，认证每个请求，并拒绝已关闭或身份不符的程序。切换 GUI 当前程序不会改变查询目标。查询、改名、注释及原型操作走专用适配器；数据库写入需要计划。

Frida 通过 Harness subprocess 使用官方 Python bindings，需要配置已安装 Frida 的 Python。attach 请求明确 PID、名称和启动身份；helper 还核对可执行文件哈希或 Android 包身份。自定义脚本与 spawn 必须属于验证阶段。helper 卸载脚本并 detach，只终止自己启动的进程。配置带哈希的 Java bridge bundle 后，可用 `javaBridge: true` 在批准前拼入脚本；应先用 `frida-compile` 和 `frida-java-bridge` 打包[入口源码](resources/java_bridge_entry.js)，再配置路径、哈希及版本。批准的制品保存最终脚本字节。

JADX 接受 APK/DEX，并明确标记不完整反编译。adb 只操作指定设备，暴露固定的包和设备查询。Android 验证会先核对已安装的 base APK。root、Frida server/Gadget、USB 授权及版本兼容仍由用户准备。可登记 `fastboot`、`john` 的版本参数以检查安装情况；其设备写入或审计操作没有执行 provider。

### 工具清单与验收

| 工具 | 操作及影响 | 执行与清理 | 已验证组合 |
|---|---|---|---|
| 内置二进制检查 | 实测身份、有界十六进制和 ASCII/UTF-16LE 字符串 | 读取不可变制品；限制输出，不执行目标 | PE/ELF 头与字节分页 fixture |
| GhidraMCP 1.4 | 绑定程序查询；分析数据库修改需要计划 | 经认证的本地 HTTP、输出及时限约束；不重放数据库修改 | 已对固定源码应用补丁；GUI/扩展构建未验证 |
| Frida 17.18.0 | 进程、模块、导出枚举，trace，经批准的自定义脚本及 spawn | Python helper；配置时限及输出限额；卸载、detach、停止本任务创建的进程 | Windows 本机自有 Python 可执行文件：正常完成与取消 |
| JADX | APK/DEX 反编译、源码及资源提取 | 受管理子进程；限制输出并清理临时目录 | 集成未验证；部分反编译结果标记为不完整 |
| Docker 29.7.2 | 启动、检查、停止本任务拥有的环境 | 固定镜像摘要、资源限制、无网络、移除自有容器 | 本机 Docker Desktop 与已有 Kali ARM64 镜像：生命周期及 Python 命令 |
| adb | 所选设备状态、包列表/详情、base APK 身份读取 | 固定 argv 子进程调用；不接受任意 shell 命令 | 没有连接的 Android 设备；未验证 |
| fastboot / john | 仅版本登记 | 操作者配置的版本查询 | 执行 provider 尚不可用 |

<a id="roles-tasks-and-tool-management"></a>
### 角色、任务和工具管理

Host 操作者在[示例 overlay](../../../apps/cli/config/examples/security-analysis/cordis.yml) 的 `environments[].tools` 中增加或移除安装项，然后重启安全 profile。同一环境拒绝重复工具 ID。命令、版本参数和安装来源保留在 Host 配置中；agent 不能安装工具或选择任意可执行文件。移除安装项后，对应 provider 明确失败。`security_capabilities` 返回角色权限、provider 参数说明和安装声明，`security_environment` 检查版本和就绪状态，不安装或创建环境。工作台环境页提供操作者健康检查与生命周期操作。

| 角色 | 任务 | 可用分析能力 |
|---|---|---|
| `coordinator` | 规划、汇总与验证 | 全部领域工具、网页资料、jobs/goal/todo；执行已批准的验证计划 |
| `reconnaissance` | `inventory` | 二进制身份/十六进制/字符串，Ghidra 身份/函数/导入/导出/字符串，固定 adb 查询，环境检查，证据检索 |
| `reverse-analyst` | `surface`、`assessment` | 二进制检查、全部只读 Ghidra 查询、JADX 和固定 adb 查询、环境检查、证据检索 |
| `researcher` | `assessment` | 项目证据、已审核知识、公开网页搜索与读取；不能执行样本或调用静态 provider |
| `reviewer` | `review` | 指定资产的证据与知识检索；不能采集、访问网页或执行验证 |

结构化报告使用进程内驱动注册到子会话的 `structured_output` 工具。启动白名单包含全局及继承工具，不包含子会话局部注册的报告工具；执行时权限检查仍允许子会话提交结构化报告。

每个子 agent 使用 fresh Session，接收角色提示词及兼容任务。[提示词与权限定义](src/workbench/roles.ts) 要求明确单一资产、问题、完成条件、时间/输出限额、证据引用、不确定性及下一步。每次工具执行都会检查角色，领域静态采集入口再次检查；仅隐藏 schema 不构成授权。子 agent 不能继续委派、执行计划、批准或共享。协调者依据报告提交候选记录。研究提示词禁止将私有样本内容发送到公共查询；尚未实现网络数据防泄漏机制。

内置 `binary` provider 不需要外部安装。调用 `security_static`，设置 `provider: "binary"`、指定资产/环境及 `operation: "identity"`、`"hex"` 或 `"strings"`。身份查询返回实测 SHA-256 和部分 PE/ELF 头字段。十六进制与字符串参数接受字节 `offset` 和 `length`；字符串还接受 `minLength` 与 `encoding`（`ascii` 或 `utf16le`，仅提取可打印 ASCII 字符）。省略长度时取输出预算的八分之一。分页结果保留偏移和不完整标记；跨页字符串需重叠查询。这些观察不能证明文件完全有效、入口可达或存在漏洞。

### 证据与恢复

provider 原始输出先保存，再提交证据引用。证据记录保留样本、工具版本、参数、来源 Session/call、完整性和批准计划。`security_evidence` 分页读取原始字节。检索根据项目记录及原始证据重建 SQLite FTS，支持中文分词和标识符。共享经验必须经过用户审核，始终是参考材料，不是本项目证据。

日志以一个 storage-domain 记录追加一个完整命令。独立 SQLite 占用锁保证每个安全目录只有一个 Host。重启撤销批准，并将未结算执行标记为待核对，不会重放注入或进程创建。相同操作重试不会再次执行。`import-legacy` 将原型 JSON 归档保留为不可变的用户声明记录；必须另行导入实际样本才能获得实测身份，原归档不会提升为已验证证据。

-----

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

<a id="model-experience"></a>
## 模型体验

### 安全上下文

#### 模型看到的内容

协调者使用领域工具分解检查、检索证据、准备计划并汇总结论。子 agent 只看到分配的资产，返回摘要、证据引用、不确定性和建议。外部输出、共享经验与子报告是待核对数据，不能扩大权限。

#### Token 影响

领域工具定义和检索到的证据按配置的输出限额占用上下文。此包不改变 token 统计。

#### KV Cache effect

固定工具定义和工作流指引保持稳定；项目状态通过已记录的工具结果进入上下文。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- Ghidra 安装、扩展编译、GUI 启动和程序导入仍需要用户准备。认证补丁已在固定源码上应用验证；真实 Ghidra GUI 构建及三类目标完整四阶段验收尚未完成。
- 已在本任务创建的 Windows 进程上实际验证 Frida 17.18.0 观察与清理。目前没有 Android 设备；现有 Kali 镜像缺少 Frida、JADX 和 Ghidra，镜像存在不等于分析环境受支持。
- 真实 DeepSeek 教程分析已跑通静态证据和子 agent 报告回收，但出现错误的 ELF 解读。结构化格式解析与持久化复核尚未完成，真实模型 GUI GIF 仍待录制。keyless 测试与外部响应模拟分别作为证据。
- 环境租约保守地串行化操作，包括读取。自动 GUI 部署、完整组件/JNI 关联、远程实验室、语义检索、Web/IoT 专项、fastboot 写设备及 john 执行尚不可用。
- Android split APK 验证会被拒绝，因为单个导入的 base APK 不能证明完整安装包身份。本机 attach 会拒绝无法提供启动身份或可执行文件身份的平台。
- `/legacy` 为已录制 Session 保留隔离的原型。不能与工作台一起加载，两者注册相同的安全工具名。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作记录（非规范）</summary>

无。

</details>
