# Fork 二次开发

[English](FORK_DEVELOPMENT.md) | 中文

## 摘要

本 fork 是基于 DeepSeek Harness 进行独立二次开发的长期开发仓库。`Joer/experimental-development` 是默认集成分支，fork 专属改动不计划合并回上游 `master` 分支。上游仓库仅作为参考和选择性同步更新的来源。

## 目录

- [开发主线](#development-line)
- [分支策略](#branch-policy)
- [上游同步](#upstream-synchronization)
- [验证](#validation)
- [开发备注](#dev-note)

-----

<a id="development-line"></a>

## 开发主线

`origin` 远端指向 `ZhouJoer/deepseek-harness`，其中 `Joer/experimental-development` 是默认分支。`upstream` 远端指向原始 `deepseek-ai/deepseek-harness` 仓库，不接收本 fork 的专属提交。

-----

<a id="branch-policy"></a>

## 分支策略

Fork 专属改动集成到 `Joer/experimental-development`。实验分支使用 `Joer/` 前缀，以便清楚标识其归属和用途。贡献者保持提交聚焦，不以日后合并回上游为兼容目标。

-----

<a id="upstream-synchronization"></a>

## 上游同步

本 fork 会先评估上游变更对 fork 专属行为的影响，再选择性引入。解决冲突时以本 fork 的当前发展方向为准，不为日后合并回上游 `master` 优化。

-----

<a id="validation"></a>

## 验证

所有变更继续遵循仓库现有的 `AGENTS.md` 指令和验证流程。每次推送都执行受影响代码或文档所要求的检查。

-----

<a id="dev-note"></a>

## 开发备注

<details>
<summary>工作上下文</summary>

无。

</details>
