# 视频截图笔记助手 - Obsidian

**请优先使用`视频截图笔记助手 - Obsidian v2.js这里面的脚本`**

> v2.0.3 / v3.0.3 | 油猴脚本 | 一键截图视频画面并保存到 Obsidian 笔记

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

在 B站 / YouTube 等视频网站观看视频时，一键截图并自动写入 Obsidian Vault，生成带时间戳和 YAML 元数据的标准 Markdown 笔记。

---

## 版本分支

| 分支 | 文件 | 版本 | 说明 |
|------|------|------|------|
| `master` | `video-screenshot-obsidian-v2.user.js` | 2.0.3 | **稳定版**：YAML frontmatter + 智能文件追踪 |
| `v3-template` | `video-screenshot-obsidian-v3.user.js` | 3.0.3 | **模板版**：多模板系统（视频/读书/资源） |
| `master` | `video-screenshot-obsidian.user.js` | 1.0.0 | 原始版本（不再维护） |

---

## 快速开始

### 1. 安装脚本

- **v2 稳定版**：[点击安装](https://github.com/taylormao/obsidian-video-screenshot/raw/master/video-screenshot-obsidian-v2.user.js)
- **v3 模板版**：[点击安装](https://github.com/taylormao/obsidian-video-screenshot/raw/v3-template/video-screenshot-obsidian-v3.user.js)

### 2. Obsidian 配置

1. 在 Obsidian 中安装 **Local REST API** 插件
2. 在 Vault 中创建笔记目录（例如 `视频笔记`）
3. 复制 REST API 的 **API Key**

### 3. 脚本配置

1. 打开任意视频网站（B站 / YouTube）
2. 点击右下角紫色浮动按钮 → 设置
3. 填写 API 地址、API Key、笔记目录
4. 点击 **测试连接**

### 4. 使用

| 操作 | 方式 |
|------|------|
| 截图发送 | `Ctrl+Shift+S` 或点击浮动按钮 → 截图 |
| 创建笔记 | 浮动按钮 → 创建视频笔记 |

---

## YAML Frontmatter 示例

```yaml
---
title: "视频标题"
source_url: https://www.bilibili.com/video/BV1xxx
source_name: bilibili.com
created: 2026-08-07 14:30:00
modified: 2026-08-07 15:45:00
date: 2026-08-07
edit_count: 3
type: video-note
summary: ""
tags: [视频笔记]
---
```

---

## 智能文件追踪机制

**问题**：旧版脚本用文件名匹配笔记，改名后找不到了，会重新创建新文件。

**v2.0 解决方案**：
1. 每个笔记的 YAML frontmatter 包含唯一的 `source_url`
2. 脚本维护一个 `source_url -> filePath` 索引
3. 索引失效时，遍历 Vault 目录搜索含有该 `source_url` 的笔记
4. 找到后更新索引，追加到改名后的文件中

---

## v3 模板系统

v3 支持自动识别当前网站并套用对应笔记模板：

| 模板 | URL 匹配 | 使用场景 |
|------|----------|----------|
| `video` | bilibili / youtube / vimeo | 视频学习笔记 |
| `reading` | 匹配自定义阅读网站 | 读书/阅读笔记 |
| `resource` | 其他未匹配 URL | 通用资源笔记 |

模板类型自动写入 frontmatter 的 `type` 字段。

---

## 目录结构

```
Vault/
  视频笔记/           ← 笔记目录（可自定义）
     视频标题.md     ← 视频笔记
        ├── YAML frontmatter（source_url, created, modified, edit_count）
        ├── 来源链接
        └── 截图（base64 内嵌）
```

---

## 版本变更

### v3.x（模板版，`v3-template` 分支）

| 版本 | 日期 | 变更 |
|------|------|------|
| 3.0.3 | 2026-08-07 | 修复 `getFrontmatterValue` / `setFrontmatterValue` 中 key 的特殊字符未转义问题 |
| 3.0.2 | 2026-08-07 | 修复 `listVault` 兼容 Obsidian REST API v5.1.0 字符串数组格式；抽取 `getName` 辅助函数 |
| 3.0.1 | 2026-08-07 | 修复 `listVault` 解析 Obsidian REST API 返回格式失败导致改名后无法匹配笔记 |
| 3.0.0 | 2026-08-07 | 初始模板版：多模板系统（`TEMPLATE_TYPES`）、`detectType` URL 自动匹配、`TemplateManager` |

### v2.x（稳定版，`master` 分支）

| 版本 | 日期 | 变更 |
|------|------|------|
| 2.0.3 | 2026-08-07 | 恢复完整 UI（浮动按钮/菜单/设置弹窗/Toast/Loading）；修复 `getFrontmatterValue` / `setFrontmatterValue` key 转义 |
| 2.0.2 | 2026-08-07 | 修复 `listVault` / `findNoteBySourceURL` 兼容 Obsidian REST API v5.1.0 字符串数组格式 |
| 2.0.1 | 2026-08-07 | 修复 `listVault` 无法解析 Obsidian REST API 返回格式导致改名后无法匹配 |
| 2.0.0 | 2026-08-07 | YAML frontmatter 元数据 + 智能文件追踪（source_url 索引） |

### v1.x（原始版本）

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0.0 | 2026-08-07 | 初始版本：基础截图 + Obsidian 写入 |

---

## 依赖

- 浏览器：Tampermonkey / Violentmonkey
- Obsidian 插件：[Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api)

---

## 开发计划

- [x] v2.0 - YAML frontmatter + 智能文件追踪
- [x] v3.0 - 可配置笔记模板系统（视频 / 读书 / 资源）
- [ ] 截图上传为本地附件文件
- [ ] 批量截图模式

## 许可证

MIT © taylormao
