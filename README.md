# 视频截图一键导入 Obsidian

一款油猴脚本（Tampermonkey），让你在观看网页视频时，一键截图并自动导入到 Obsidian 笔记中。

## 功能

- 🎬 **一键截图**：在网页视频播放器右下角添加截图按钮，点击即截取当前画面
- 📝 **自动生成笔记**：截图自动写入 Obsidian Vault，附带视频标题、时间戳等元数据
- 🏷️ **分类存储**：不同视频的截图归入同一个笔记文件，按时间顺序排列
- ⚙️ **灵活配置**：支持自定义 API 地址、文件夹名称等参数

## 前置条件

### 1. 安装脚本管理器

在浏览器中安装油猴扩展：

| 浏览器 | 扩展 | 安装地址 |
|--------|------|----------|
| Chrome/Edge | Tampermonkey | [Chrome 商店](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo) |
| Firefox | Tampermonkey | [Firefox 附加组件](https://addons.mozilla.org/firefox/addon/tampermonkey/) |
| Tabbit 浏览器 | 内置脚本管理器 | 设置 → 脚本管理 |

### 2. 安装 Obsidian 插件

在 Obsidian 中安装以下社区插件：

**Local REST API（必装）**

1. 打开 Obsidian → 设置 → 第三方插件 → 浏览
2. 搜索 **"Local REST API"**（作者：coddingtonbear）
3. 点击安装 → 启用

> ⚠️ **注意**：新版本插件名称已改为 **"Local REST API with MCP"**，功能一致。请勿同时安装多个版本的 REST API 插件。

## 安装脚本

### 方式一：直接安装（推荐）

[点击此处安装脚本](https://raw.githubusercontent.com/你的用户名/obsidian-video-screenshot/main/video-screenshot-obsidian.user.js)

> 如果浏览器已安装 Tampermonkey，点击链接会自动弹出安装窗口。

### 方式二：手动安装

1. 打开 Tampermonkey 控制面板 → 添加新脚本
2. 将 `video-screenshot-obsidian.user.js` 文件内容全部粘贴进去
3. 按 `Ctrl + S` 保存

## 配置步骤

### 第一步：获取 API Key

1. 打开 Obsidian → 设置 → 第三方插件
2. 找到 **"Local REST API"** 插件 → 点击右侧 **齿轮图标** ⚙️
3. 在设置面板中找到 **"API Key"** 字段，点击旁边的复制按钮

> 💡 **找不到设置？**
> - 确保插件已**启用**（开关为打开状态）
> - 切换到 HTTP 协议：在插件设置中将 **"HTTPS"** 改为 **"HTTP"** 模式
> - 如果设置面板完全不显示，可以在仓库路径 `.obsidian/plugins/obsidian-local-rest-api/data.json` 中直接查找 `"apiKey"` 字段

### 第二步：配置脚本

1. 打开任意视频网站（如 B站、YouTube）
2. 点击视频播放器右下角的 **📸 截图按钮**
3. 点击 **⚙️ 设置**
4. 填写以下参数：

| 设置项 | 说明 | 默认值 |
|--------|------|--------|
| 实际截图按钮 | 每次点击直接截图，无需弹出确认框 | 关闭 |
| API 地址 | Obsidian Local REST API 地址 | `http://127.0.0.1:27124` |
| API Key | 从 Obsidian 插件复制 | 空 |
| 文件夹名称 | Vault 中存放笔记的文件夹 | `视频笔记` |

5. 点击 **测试连接** 验证配置是否正确
6. 点击 **保存**

> ⚠️ **重要**：如果 API 地址使用 `https://`（HTTPS），需确保 Obsidian 插件也开启了 HTTPS 模式，两者必须一致。**建议使用 HTTP 模式**以避免自签名证书问题。

### 第三步：创建目标文件夹

在 Obsidian Vault 中手动创建配置中指定的文件夹（默认为 `视频笔记`），否则创建笔记时会报 404 错误。

## 使用说明

### 截图操作

1. 打开支持 HTML5 视频播放器的网页
2. 视频右下角会出现 **📸 按钮**
3. 点击按钮 → 自动截取当前画面 → 导入 Obsidian

### 笔记格式

生成的笔记文件结构如下：

```markdown
# 视频标题

## 🕐 00:01:23
![00:01:23](截图文件名.png)
*截图时间：2026-08-05 14:30:00*

## 🕐 00:05:47
![00:05:47](截图文件名.png)
*截图时间：2026-08-05 14:35:12*
```

### 截图存储

- 截图文件保存在 Vault 根目录的 `.screenshots/` 文件夹中
- 笔记文件保存在配置的文件夹中（默认 `视频笔记/`）
- 同一视频的截图共享一个笔记文件，文件名使用视频标题
- 点击截图按钮时，如果已有同名笔记会自动追加内容

## 支持的视频网站

脚本会在所有网页上运行。只要页面中存在 HTML5 `<video>` 元素，就会自动添加截图按钮，包括但不限于：

- Bilibili (B站)
- YouTube
- 腾讯视频
- 爱奇艺
- 优酷
- Vimeo
- 各类教学平台

## 常见问题

### Q: 测试连接失败？

1. 确认 Obsidian 已打开且 Local REST API 插件已启用
2. 检查 API 地址和端口是否正确（默认 `http://127.0.0.1:27124`）
3. 检查 HTTP/HTTPS 协议是否与插件设置一致
4. 确认 API Key 已正确复制粘贴

### Q: 截图后提示 404 错误？

说明目标文件夹在 Vault 中不存在。请在 Obsidian 中手动创建对应的文件夹（默认为 `视频笔记`）。

### Q: 保存设置后下次打开又变回默认？

检查脚本版本是否为最新。该问题已在脚本中修复（`Config.set` 参数传递错误）。

### Q: 视频右下角没有出现截图按钮？

1. 页面可能通过 iframe 加载视频，脚本仅作用于顶层页面
2. 刷新页面重试
3. 确认 Tampermonkey 已启用该脚本
4. 确认当前页面有 HTML5 `<video>` 元素

### Q: API Key 不生效 / 提示未授权？

1. 确认复制的是 **Local REST API** 插件的 Key（不是 MCP 插件的 Key）
2. API Key 前后不要有多余的空格
3. 如果 Obsidian 重启过，API Key 可能会重置，需要重新复制

## 项目结构

```
obsidianhelp/
├── README.md                          # 本文档
└── video-screenshot-obsidian.user.js  # 油猴脚本
```

## 技术原理

```
浏览器网页 ──GM_xmlhttpRequest──→ Obsidian Local REST API (:27124)
                                    │
                                    └──→ Obsidian Vault (读写笔记文件)
```

- 脚本通过 `GM_xmlhttpRequest` 绕过浏览器跨域限制
- 使用 Obsidian Local REST API 插件的 `/vault/` 端点读写 Vault 文件
- 截图通过 Canvas API 从 `<video>` 元素中抓取当前帧

## License

MIT
