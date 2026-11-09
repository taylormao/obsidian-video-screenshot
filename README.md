# 视频截图笔记助手 - Obsidian

> 主线 **v3.2.2** / 备用 **v2.3.2** · 油猴脚本 · 多模板笔记 + 可选图床外链 + **任意网址视频捕获**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

在任意网页观看视频时，一键截图并自动写入 Obsidian Vault，生成带时间戳和 YAML 元数据的 Markdown 笔记。脚本会穿透 Shadow DOM、iframe 播放器、延迟加载的播放器，自动挑出主播放器截图；并以「完整 URL + 页面标题」双条件区分不同内容，避免截图串到同一篇笔记。

---

## 主分支与版本（2026-11-07 起）

**`master` 是 3.x 主线**：它包含仓库里的全部脚本，**v3.2.2** 是默认推荐安装的版本。`v3-template` 保留为 3.x 的开发/对照分支，日常使用请一律看 `master`。

| 分支 | 脚本文件 | 版本 | 定位 |
|------|----------|------|------|
| **`master`** | **`video-screenshot-obsidian-v3.user.js`** | **3.2.2** | **主推**：视频 / 读书 / 资源三模板 + 可选图床（默认关）+ 全站视频捕获 + 双条件身份判定 |
| `master` | `video-screenshot-obsidian-v2.user.js` | 2.3.2 | 备用：仅视频截图，base64 内嵌，笔记目录可自定义 |
| `master` | `视频截图笔记助手 - Obsidian v2 (图床外链版).js` | 2.3.2 | 备用：仅视频截图，始终走图床外链 |
| 两分支 | `video-screenshot-obsidian.user.js` | 历史快照 | **请勿安装**，仅保留作版本追溯 |

安装入口（打开后点 **Raw** 由 Tampermonkey 接管）：

- **3.2.2 主推**：<https://github.com/taylormao/obsidian-video-screenshot/blob/master/video-screenshot-obsidian-v3.user.js>
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

### 2. 脚本配置（以 3.2.2 为准）

1. 打开任意视频网站，点击右下角浮动按钮 → ⚙️ 设置
2. 填写 **REST API 地址**、**API Key**（v2 系列还需填笔记目录）
3. 点击「测试连接」确认成功，再点「保存」
4. 3.2.2 的笔记目录由模板固定：`视频笔记` / `读书笔记` / `资源收集`，暂不可自定义

### 3. 使用

| 操作 | 方式 |
|------|------|
| 截图并写入 | `Ctrl+Shift+S` 或浮动按钮 → 截图 |
| 只创建笔记 | 浮动按钮 → 创建笔记 |

### 4. 图床（可选）

- **3.2.2（主推）**：设置中把「截图存储方式」切到「上传图床，写入外链」，再填接口 URL / Token；**默认关闭**，不切就是 base64 内嵌
- **v2 图床版**：始终上传，在设置中填「图床上传接口 URL」和「Bearer Token」（可选）
- **v2 标准版**：不支持，截图内嵌为 base64

接口需接受 `multipart/form-data` 的 `file` 字段，返回 JSON；脚本兼容数组、 `{data: ...}`、以及 `publicUrl` / `src` / `url` / `link` 等常见字段。图床不可用时自动回退为 base64 内嵌，不会丢笔记。

### 5. 截图图片语法（3.2.2 / 2.3.2）

写入笔记的截图统一使用 HTML：

```html
<img src="https://your-imgbed/file/screenshot-....jpg" width="400" alt="00:01:37" />
```

为什么不用 `![alt|400](url)`：

- 它是**平台私有扩展**，不是标准 Markdown。Obsidian 官方对外部图片使用 `|宽x高`，仅宽度写法主要用于内部 wiki 链接，社区也有「阅读模式忽略外部图片自定义尺寸」的已知问题；Typora 能渲染不代表 Obsidian 能渲染。
- 实测图床链接本身完全正常（200、`Content-Type: image/jpeg`、无防盗链、`CORS: *`），所以破图来自语法与文件格式的解析，而不是网络。
- HTML `<img>` 在 Obsidian、Typora、GitHub 都能渲染，同时保留 400px 宽度控制；base64 内嵌与图床外链现在写法一致。

另一个隐藏问题：截图由 `canvas.toDataURL('image/jpeg', 0.85)` 生成，内容是 **JPEG**，而旧版上传时文件名写死 `.png`，扩展名与内容不符，部分渲染器按扩展名解码就会显示破图。现在文件名按实际 MIME 取 `.jpg`。

**旧笔记迁移**：3.2.2 之前的笔记里是 `![00:01:37|400](url)`，可批量正则替换：

- 查找：`!\[([^\]|]+)\|400\]\(([^)]+)\)`
- 替换：`<img src="$2" width="400" alt="$1" />`

注意旧外链的文件名仍是 `.png`（内容为 JPEG）。若替换后 Obsidian 仍显示破图，说明该渲染器按扩展名解码，只能重新截图生成新的 `.jpg` 外链，或把图片下载为 Vault 本地附件。

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
8. **链接修正**：回跳链接改用 `URL.searchParams.set('t', ...)`；`source_url` 不再裁剪查询参数（3.2.0 / 2.3.0 起，详见下节）。

> 若站点使用无 `<video>` 的纯 Canvas/WebGL 渲染，或 CDN 既不允许 CORS 又不暴露 video 元素，浏览器层面无法取帧，此时会走第 7 步的文字兜底。

---

## YAML Frontmatter 示例

```yaml
---
title: "示例视频标题 - 示例站点"
source_url: "https://example.com/watch?viewkey=AAA&p=1"
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

> `title` 取当前页面 `<title>` 标签内容，`source_url` 取当前页面完整 URL（保留全部查询参数，仅去掉 `#` 锚点）。两者都参与笔记身份判定。

## 笔记身份判定与文件追踪

### 为什么要两个条件

只按 URL 前缀归并，会把同路径下不同 `viewkey` / `id` 的页面塞进同一篇笔记；只按完整 URL 比对，又会让「同一视频仅多了 `utm_source` 之类跟踪参数」被拆成多篇。因此脚本用两个维度共同判定。

### 判定规则

| 场景 | 结果 |
|------|------|
| 归一 URL 相同、`title` 相同 | **复用同一篇笔记** |
| 内容参数不同（如 `viewkey=AAA` 与 `viewkey=BBB`） | **新建笔记** |
| 归一 URL 相同但 `title` 不同 | **新建笔记** |
| 仅多 `utm_*` / `spm` / `from` / `t` 等跟踪或时间参数 | **复用同一篇笔记** |
| 查询参数顺序不同 | **复用同一篇笔记** |

- **`source_url`（写入 frontmatter）** = 当前页面完整 URL，保留全部查询参数，去掉 `#` 锚点。
- **`title`（写入 frontmatter）** = 当前页面 `<title>` 内容，连续空白折叠为一个空格；YAML 写入时转义双引号与反斜杠，读回时还原，保证往返一致。
- **归一 URL（仅用于比对）** = 从 `source_url` 剔除纯跟踪/时间参数（`utm_*`、`spm`、`scm`、`from`、`ref`、`share_*`、`vd_source`、`t`、`timestamp` 等），剩余参数按参数名与值排序。**内容参数一律保留**，无需站点白名单。
- **身份键** = `归一 URL + 规范化 title`，用于脚本索引；索引失效时遍历 Vault 目录，读取每个 md 的 frontmatter 做同样比对，因此笔记改名后仍能找到。

### 旧笔记与升级

- 旧笔记若没有 `title` 字段，采用**保守回退**：只有完整 `source_url` 精确相等才复用，绝不因标题相同而合并。
- 索引键升级为 `obsidian_note_index_v4`，旧索引自动失效；首次使用新版本会遍历一次 Vault 重建，属正常现象。
- v2 原有的「按文件名/标题兜底复用」逻辑已移除——它与新规则冲突，会让不同 URL 但标题相同的页面被错误合并。

### 同名笔记去冲突（3.2.1 / 2.3.1）

文件名由页面标题生成，因此**不同 URL 但标题相同**的两个页面原本会指向同一个 `.md` 并互相覆盖。现在创建新笔记前会先读目标文件：若已存在且身份不匹配，则追加可读后缀，例如

```
视频笔记/同一标题.md
视频笔记/同一标题-viewkey-BBB.md
```

后缀优先取 URL 中最后一个内容参数（`参数名-值`），没有内容参数时用身份键的短哈希；生成规则稳定，同一页面重访不会重复建文件。

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

### 2026-11-09 —— 截图图片渲染修复（3.2.2 / 2.3.2）

| 变更 | 说明 |
|------|------|
| 现象 | 图床外链截图在 Obsidian 显示破图，Typora 能正常渲染 |
| 诊断 | 实测图片 URL 返回 200 / `Content-Type: image/jpeg` / 无防盗链 / `CORS: *`，资源本身正常 |
| 原因 1 | 截图是 JPEG，上传文件名却写死 `.png`，扩展名与内容不符 |
| 原因 2 | `![alt\|400](url)` 是平台私有扩展，Obsidian 对外部图片支持不稳定 |
| 修复 | 上传文件名按实际 MIME 取 `.jpg`；图片统一写为 `<img src="..." width="400" alt="...">` |
| 验证 | 回归测试新增图床外链场景，校验上传文件名与写入的图片语法；三个脚本全部断言通过 |
| 旧笔记 | 见「截图图片语法」一节的批量替换说明 |

### 2026-11-07 —— 运行时验证与同名笔记去冲突（3.2.1 / 2.3.1）

| 变更 | 说明 |
|------|------|
| 验证方式 | 新增 `tests/verify-note-identity.js`：Node `vm` + 模拟 DOM / GM API / Obsidian REST API，**完整加载脚本**并触发「采集并发送」，检查实际写入的 Markdown |
| 发现的问题 | 不同 URL 但 `<title>` 相同时，文件名相同导致后一次覆盖前一次笔记（严格断言下复现） |
| 修复 | 创建笔记前检查同名文件身份，不匹配时追加可读后缀；三个脚本同步 |
| 结果 | 三个脚本均 9/9 断言通过，运行期无异常 |
| 说明 | 这是模拟环境回归测试，**不能替代** Tampermonkey + 真实 Obsidian 插件 + 真实视频网站的端到端验证 |

### 2026-11-07 —— 笔记身份判定修复（3.2.0 / 2.3.0）

| 变更 | 说明 |
|------|------|
| 问题 | 旧版裁掉 URL 查询参数，同路径下仅 `viewkey` / `id` 不同的两个页面被算成同一 `source_url`，截图串到同一篇 md |
| `source_url` | 改为写入**当前页面完整 URL**（保留全部查询参数，去掉 `#` 锚点） |
| `title` | frontmatter 改为写入当前页面 `<title>` 内容，并用 YAML 双引号安全转义 |
| 判定规则 | 索引与 Vault 遍历改用「归一 URL + 规范化 title」双条件，**两者都相同**才复用同一篇笔记 |
| 归一 URL | 仅剔除纯跟踪/时间参数并对参数排序，内容参数（含 `viewkey`）全部保留 |
| 移除兜底 | 删除 v2 的「按文件名/标题匹配复用」逻辑，避免标题相同导致误合并 |
| 兼容与迁移 | 旧笔记缺 `title` 时只在完整 URL 精确相等才复用；索引键升级为 `obsidian_note_index_v4`，旧索引失效后由 Vault 遍历重建 |
| 范围 | 三个脚本同步升级：3.2.0（主推）、两个 v2 脚本 2.3.0 |

### 2026-11-07 —— 主线切换与凭据归档

| 变更 | 说明 |
|------|------|
| 主分支切换 | `master` 合并 `v3-template`，内容升级为 **3.1.0 主线**（含 v3 脚本、`templates/`、两个 v2 脚本）；GitHub 默认分支仍是 `master`，无需改仓库设置 |
| 安装链接 | 三条安装入口统一指向 `master`，主推 `video-screenshot-obsidian-v3.user.js` |
| 凭据归档 | 新增 `store.txt`，汇总历史提交中记录过的图床接口 URL / Bearer Token 与 Obsidian API Token（**含明文，见下方安全提示**） |

> 该次提交只做分支合并与凭据归档，未改动脚本代码。

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
- [x] 2026-11-07 — 把 `master` 主分支切换到 3.x
- [x] 2026-11-07 — 双条件笔记身份判定，修复不同查询参数被合并的问题
- [ ] 把 `store.txt` 移出公开仓库（加入 `.gitignore`，仅本地保管）
- [ ] 接线 `loadObsidianTemplate()`，让 `templates/*.md` 真正生效
- [ ] 截图上传为 Obsidian 本地附件（REST API 二进制写入），替代外部图床
- [ ] 批量截图模式
- [ ] 三个脚本共用代码改为构建产物或 `@require`，避免重复维护
- [ ] 统一文件命名，清理历史快照文件

---

## 回归测试

在仓库根目录运行（需要 Node.js 18+）：

```bash
node tests/verify-note-identity.js video-screenshot-obsidian-v3.user.js
node tests/verify-note-identity.js video-screenshot-obsidian-v2.user.js
```

测试覆盖：脚本能否完整加载并初始化、frontmatter 的 `source_url` / `title`、双条件身份判定、同名笔记去冲突、图床外链上传（含上传文件名扩展名）、写入的图片语法是否为兼容的 `<img>`、运行期有无异常。全部通过会输出 `FAILED = 0`。

## 依赖

- 浏览器：Tampermonkey / Violentmonkey（需允许脚本在 iframe 中运行）
- Obsidian 插件：[Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api)

## 许可证

MIT © taylormao
