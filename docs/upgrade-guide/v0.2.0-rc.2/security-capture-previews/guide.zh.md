---
kind: upgrade-guide
description: "安全 Remote 的抓包预览返回二进制元数据，不再返回 UTF-8 文本。"
---

# 处理二进制抓包预览

[English](guide.md) | 中文

## 变更

安全服务的 `artifact` 和 `projectArtifact` Remote 响应根据 PCAP/PCAPNG 文件头返回 `binary: true`，并将 `text` 设为空字符串。此前这些方法把抓包字节解码为 UTF-8。将所有制品作为文本显示的自定义客户端需要适配。哈希、大小、原始资产和已保存证据保持不变。

## 迁移

1. 自定义 Remote 客户端解析 JSON 响应后，先检查 `binary === true`，再决定是否渲染 `text`。二进制抓包显示 `sha256` 和 `size`。
2. 导入 PCAP 或 PCAPNG，确认预览显示元数据，不显示解码后的字节。协议观察使用[离线分析流程](../../../user/guide/security-analysis.zh.md#windows-wireless)。既有文本证据继续使用 `text`，无需迁移已保存数据。
