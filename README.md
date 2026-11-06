# 视频截图笔记助手 - Obsidian

> 主线 **v3.1.0** · 油猴脚本 · 多模板笔记 + 可选图床外链 + **任意网址视频捕获**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

在任意网页观看视频时，一键截图并自动写入 Obsidian Vault，生成带时间戳和 YAML 元数据的 Markdown 笔记。脚本会穿透 Shadow DOM、iframe 播放器、延迟加载的播放器，自动挑出主播放器截图。

---

## 主分支与版本（2026-11-07 起）

**`master` 已切换为 3.1.0 主线**：它现在包含仓库里的全部脚本，`v3.1.0` 是默认推荐安装的版本。`v3-template` 保留为 3.x 的开发/对照分支，日常使用请一律看 `master`。

| 分支 | 脚本文件 | 版本 | 定位 |
|------|----------|------|------|
| **`master`** | **`video-screenshot-obsidian-v3.user.js`** | **3.1.0** | **主推**：视频 / 读书 / 资源三模板 + 可选图床（默认关）+ 全站视频捕获 |
| `master` | `video-screenshot-obsidian-v2.user.js` | 2.2.0 | 备用：仅视频截图，base64 内嵌，笔记目录可自定义 |
| `master` | `视频截图笔记助手 - Obsidian v2 (图床外链版).js` | 2.2.0 | 备用：仅视频截图，始终走图床外链 |
| 两分支 | `video-screenshot-obsidian.user.js` | 历史快照 | **请勿安装**，仅保留作版本追溯 |

安装入口（打开后点 **Raw** 由 Tampermonkey 接管）：

- **3.1.0 主推**：<https://github.com/taylormao/obsidian-video-screenshot/blob/master/video-screenshot-obsidian-v3.user.js>
- v2 标准版：<https://github.com/taylormao/obsidian-video-screenshot/blob/master/video-screenshot-obsidian-v2.user.js>
- v2 图床版：<https://github.com/taylormao/obsidian-video-screenshot/blob/master/视频截图笔记助手%20-%20Obsidian%20v2%20(图床外链版).js>

三个脚本都使用 `@match *://*/*`（覆盖全部 http/https 网址），**没有网址白名单**，也**没有** `@noframes`——iframe 内的脚本实例是跨域播放器的捕获端，请勿手动添加 `@noframes`。

---

## 快速开始

### 1. Obsidian 配置

1. 安装并启用 **Local REST API** 插件（社区插件，作者 coddingtonbear）
2. 复制插件设置里的 **API Key**
3. 在 Vault 中建立笔记目录，默认 `视频笔记`

> 端口：脚本默认 `http://127.0.0.1:27123`（插件的 HTTP 端口）。若插件使用 HTTPS，通常是 `https://127.0.0.1:27124`，请在设置面板改成实际值。

### 2. 脚本配置（以 3.1.0 为准）

1. 打开任意视频网站，点击右下角浮动按钮 → ⚙️ 设置
2. 填写 **REST API 地址**、**API Key**（v2 系列还需填笔记目录）
3. 点击「测试连接」确认成功，再点「保存」
4. 3.1.0 的笔记目录由模板固定：`视频笔记` / `读书笔记` / `资源收集`，暂不可自定义

### 3. 使用

| 操作 | 方式 |
|------|------|
| 截图并写入 | `Ctrl+Shift+S` 或浮动按钮 → 截图 |
| 只创建笔记 | 浮动按钮 → 创建笔记 |

### 4. 图床（可选）

- **3.1.0（主推）**：设置中把「截图存储方式」切到「上传图床，写入外链」，再填接口 URL / Token；**默认关闭**，不切就是 base64 内嵌
- **v2 图床版**：始终上传，在设置中填「图床上传接口 URL」和「Bearer Token」（可选）
- **v2 标准版**：不支持，截图内嵌为 base64

接口需接受 `multipart/form-data` 的 `file` 字段，返回 JSON；脚本兼容数组、 `{data: ...}`、以及 `publicUrl` / `src` / `url` / `link` 等常见字段。图床不可用时自动回退为 base64 内嵌，不会丢笔记。

---

## 任意网址 + 视频捕获（2.2.0 / 3.1.0 核心修复）

旧版在不少视频站点「找不到视频、截不到图」，根因不是网址没匹配上，而是：

| 旧问题 | 后果 |
|--------|------|
| `detectType()` 只有 B站/YouTube/网盘白名单，兜底是 `document.querySelector('video')` | 未知视频站、播放器尚未插入时直接返回 `null`，**连截图都不尝试** |
| `document.querySelector('video')` 只查顶层 light DOM | Shadow DOM、iframe 内的播放器完全看不见 |
| 站点白名单匹配即返回第一个 `video` | 容易选中广告 / 预览小视频 |
| `canvas.toDataURL()` 遇跨域视频抛 `SecurityError`，`catch` 后返回 `null` | B站 / YouTube / 跨域 CDN 视频截图失败 |
| v3 时间戳用 `pageURL + '&t=' + 秒数` | 无 query 的网址生成无效回跳链接 |
| 非 B站/YouTube 站点清空全部 query 参数 | 不同视频被当成同一篇笔记，内容串台 |

现在三个脚本内置同一套 `VideoProbe` 模块，处理链路如下：

1. **全网址匹配**：`@match *://*/*`；v3 的 `detectType()` 对任意网址都有兜底（探测到视频或播放器特征 → 视频笔记，否则 → 通用资源笔记），永不返回 `null`。
2. **递归收集**：遍历当前文档、所有 `shadowRoot`、同源 iframe 的 `contentDocument`，带深度与节点数上限。
3. **择优打分**：按分辨率面积、`readyState`、是否播放中、可见性、播放器常见 class、是否迷你尺寸综合评分，选最可能是主播放器的那个。
4. **等待动态插入**：`MutationObserver` + 250ms 轮询，等待点击播放后才出现 / SPA 切换后的 video（默认 2.5s）。
5. **跨域 iframe 协作**：顶层找不到合格 video（或只有小视频）时，向所有 iframe `postMessage` 广播截图请求；iframe 内的脚本实例代截后回传画面与播放进度。**iframe 实例不注入 UI、不注册快捷键**。
6. **跨域污染降级**：`toDataURL` 失败时，克隆一个 `crossOrigin="anonymous"` 的 video 重载同一 `currentSrc` 并 seek 到当前时间点再截图（对带 CORS 头的 CDN 有效）。
7. **最终兜底**：仍拿不到画面时**不再整体失败**，笔记里写入 `> ⚠️ 未能捕获画面` 与时间戳，保证记录不丢。
8. **链接修正**：回跳链接改用 `URL.searchParams.set('t', ...)`；`source_url` 保留 `v` / `bvid` / `aid` / `vid` / `cid` / `id` / `p` 等标识参数。

> 若站点使用无 `<video>` 的纯 Canvas/WebGL 渲染，或 CDN 既不允许 CORS 又不暴露 video 元素，浏览器层面无法取帧，此时会走第 7 步的文字兜底。

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

## 智能文件追踪

笔记改名后旧版会重复建文件。v2/v3 均以 `source_url` 为唯一键维护索引，索引失效时遍历 Vault 目录搜索 frontmatter 中的 `source_url`，找到后更新索引并追加内容。

## v3 模板系统

| 模板 | 优先匹配 | 笔记目录 |
|------|----------|----------|
| `video-note` | 视频站白名单，或任意探测到视频的网页 | `视频笔记` |
| `reading-note` | 微信读书 / 知乎阅读等 | `读书笔记` |
| `resource-note` | 网盘 / GitHub Release，以及**其余所有网址兜底** | `资源收集` |

模板的 frontmatter、正文块、URL 匹配器、页面采集器都定义在脚本内的 `TEMPLATE_TYPES`。

> `loadObsidianTemplate()`（读取 `.obsidian/templates/*.md`）目前仍是**预留接口，尚未接线**；`templates/` 目录下的三个 `.md` 是示例文件，脚本暂不会读取它们。

---

## 版本变更

### 2026-11-07 —— 主线切换与凭据归档

| 变更 | 说明 |
|------|------|
| 主分支切换 | `master` 合并 `v3-template`，内容升级为 **3.1.0 主线**（含 v3 脚本、`templates/`、两个 v2 脚本）；GitHub 默认分支仍是 `master`，无需改仓库设置 |
| 安装链接 | 三条安装入口统一指向 `master`，主推 `video-screenshot-obsidian-v3.user.js` |
| 凭据归档 | 新增 `store.txt`，汇总历史提交中记录过的图床接口 URL / Bearer Token 与 Obsidian API Token（**含明文，见下方安全提示**） |

> 本次未改动任何脚本代码，3.1.0 的功能与 2026-11-06 一致。

### 2026-11-06 —— 合并与全站捕获

| 版本 | 变更 |
|------|------|
| 2.2.0 / 2.2.0 图床版 | 接入 `VideoProbe` 全站视频捕获；移除硬编码 API Key 与图床 Token，改为设置项；图床失败自动回退 base64；统一 27123 端口；修复浮动按钮防抖与重建 |
| 3.1.0 | 合并 `master` 2.1.0 的图床外链能力（做成可选、默认关闭）；接入同一套 `VideoProbe`；`detectType()` 全网址兜底；修复时间戳链接与 `source_url` 参数丢失；同步浮动按钮防抖修复；设置面板新增图床配置 |

### 历史

| 版本 | 日期 | 变更 |
|------|------|------|
| 2.1.0 | 2026-08-25 | 图床外链版：接入 Cloudflare 图床；`<img>` 改为 `![|400]()`；浮动按钮防抖优化（500ms→100ms） |
| 3.0.3 | 2026-08-07 | 修复 frontmatter key 特殊字符转义 |
| 3.0.2 / 2.0.2 | 2026-08-07 | 兼容 REST API v5.1.0 的字符串数组返回 |
| 3.0.1 / 2.0.1 | 2026-08-07 | 修复 `listVault` 解析失败导致改名后无法匹配笔记 |
| 3.0.0 | 2026-08-07 | 多模板系统（视频 / 读书 / 资源），预留 Obsidian 模板接口 |
| 2.0.3 | 2026-08-07 | 恢复完整 UI；frontmatter regex 转义 |
| 2.0.0 | 2026-08-07 | YAML frontmatter + `source_url` 智能文件追踪 |
| 1.0.0 | 2026-08-05 | 初始版本：基础截图 + Obsidian 写入 |

---

## 安全提示（重要）

⚠️ **`store.txt` 含明文凭据，且本仓库是公开的**：文件中记录了 Obsidian Local REST API Token、图床上传接口 URL 与 Bearer Token，任何访问本仓库的人都能直接读取，自动化爬虫同样会抓取。此外这些值也存在于 Git 历史提交 `c05de5d` 中，删除文件无法消除历史。

请尽快：

1. 在 Obsidian Local REST API 插件中重新生成 API Key；
2. 在图床后台轮换 Bearer Token；
3. 更新三个脚本设置面板里的对应值（脚本代码本身已不含任何硬编码密钥）；
4. 若不打算保留该文件，把它加入 `.gitignore` 并从仓库移除——但历史中的值仍应视为已泄露，仍须轮换。

`store.txt` 仅作本地配置备份用途，请勿用于任何部署环境。

---

## 开发计划

- [x] v2.0 — YAML frontmatter + 智能文件追踪
- [x] v3.0 — 多模板笔记系统
- [x] v2.1 / v2.2 — 图床外链 + 全站视频捕获
- [x] v3.1 — 合并两条线的能力，任意网址可用
- [x] 2026-11-07 — 把 `master` 主分支切换到 3.1.0
- [ ] 把 `store.txt` 移出公开仓库（加入 `.gitignore`，仅本地保管）
- [ ] 接线 `loadObsidianTemplate()`，让 `templates/*.md` 真正生效
- [ ] 截图上传为 Obsidian 本地附件（REST API 二进制写入），替代外部图床
- [ ] 批量截图模式
- [ ] 三个脚本共用代码改为构建产物或 `@require`，避免重复维护
- [ ] 统一文件命名，清理历史快照文件

---

## 依赖

- 浏览器：Tampermonkey / Violentmonkey（需允许脚本在 iframe 中运行）
- Obsidian 插件：[Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api)

## 许可证

MIT © taylormao
