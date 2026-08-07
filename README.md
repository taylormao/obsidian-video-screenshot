# 视频截图笔记助手 - Obsidian

> v2.0.0 | 油猴脚本 | 一键截图视频画面并保存到 Obsidian 笔记

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

在 B站 / YouTube 等视频网站观看视频时，一键截图并自动写入 Obsidian Vault，生成带时间戳和 YAML 元数据的标准 Markdown 笔记。

---

## v2.0 新特性

| 特性 | 说明 |
|------|------|
| **YAML Frontmatter** | 自动记录 `source_url`、`created`、`modified`、`edit_count` 等元数据 |
| **智能文件追踪** | 视频笔记改名后，仍能通过 `source_url` 匹配并追加内容 |
| **编辑计数** | `edit_count` 字段记录笔记被脚本追加的次数 |
| **模板系统（开发中）** | v3.0 将支持自定义笔记模板（视频笔记 / 读书笔记 / 资源笔记） |

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

## 快速开始

### 1. 安装脚本

- [点击安装](https://github.com/taylormao/obsidian-video-screenshot/raw/main/video-screenshot-obsidian.user.js)

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

## 智能文件追踪机制

**问题**：旧版脚本用文件名匹配笔记，改名后找不到了，会重新创建新文件。

**v2.0 解决方案**：
1. 每个笔记的 YAML frontmatter 包含唯一的 `source_url`
2. 脚本维护一个 `source_url -> filePath` 索引
3. 索引失效时，遍历 Vault 目录搜索含有该 `source_url` 的笔记
4. 找到后更新索引，追加到改名后的文件中

**处理同名文件冲突**：
- 如果 Vault 中已存在通过其他方式创建的同名 md 文件（无 frontmatter）
- 脚本会添加 YAML frontmatter 并建立索引
- **不会移动或覆盖**现有文件

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

## 依赖

- 浏览器：Tampermonkey / Violentmonkey
- Obsidian 插件：[Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api)

---

## 开发计划

- [x] v2.0 - YAML frontmatter + 智能文件追踪
- [ ] v3.0 - 可配置笔记模板系统（视频 / 读书 / 资源）
- [ ] v3.0 - 截图上传为本地附件文件
- [ ] v3.0 - 批量截图模式

## 许可证

MIT © taylormao
