// ==UserScript==
// @name         视频截图笔记助手 - Obsidian
// @namespace    https://github.com/taylormao/video-screenshot-obsidian
// @version      1.0.0
// @description  一键截图视频画面并保存到 Obsidian 笔记（支持时间戳标记、自动续写）
// @author       taylormao
// @license      MIT
// @match        *://*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    // ============================================================
    // 第一部分：常量和前缀
    // ============================================================

    const SCRIPT_PREFIX = 'vso-'; // video screenshot obsidian

    const CONFIG_KEYS = {
        API_URL: 'obsidian_api_url',
        API_KEY: 'obsidian_api_key',
        FOLDER_NAME: 'obsidian_folder_name',
        NOTE_INDEX: 'obsidian_note_index',
    };

    const DEFAULTS = {
        API_URL: 'http://127.0.0.1:27124',
        API_KEY: '',
        FOLDER_NAME: '视频笔记',
    };

    // ============================================================
    // 第二部分：工具函数
    // ============================================================

    /** 格式化秒数为 HH:MM:SS */
    function formatTime(seconds) {
        if (seconds == null || isNaN(seconds)) return '00:00:00';
        const s = Math.floor(seconds);
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = s % 60;
        return [h, m, sec].map(v => String(v).padStart(2, '0')).join(':');
    }

    /** 获取纯净 URL 作为去重键（去掉 hash，按网站清洗 query） */
    function getCleanUrl() {
        const url = new URL(window.location.href);
        url.hash = '';
        // YouTube: 保留 v 参数（视频唯一标识）
        if (url.hostname.includes('youtube.com') && url.pathname === '/watch') {
            const v = url.searchParams.get('v');
            url.search = '';
            if (v) url.searchParams.set('v', v);
            return url.href;
        }
        // Bilibili: 保留 p 参数（分P）
        if (url.hostname.includes('bilibili.com')) {
            const p = url.searchParams.get('p');
            url.search = '';
            if (p && p !== '1') url.searchParams.set('p', p);
            return url.href;
        }
        url.search = '';
        return url.href;
    }

    /** HTML 转义（不使用 innerHTML，兼容 Trusted Types） */
    function escapeHtml(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    /**
     * 安全创建 DOM 元素（不使用 innerHTML，兼容 Trusted Types）
     * @param {string} tag - 标签名
     * @param {Object} attrs - 属性（className、textContent、style 对象等）
     * @param {Array} children - 子节点（字符串→文本节点，元素→追加）
     */
    function createEl(tag, attrs = {}, children = []) {
        const el = document.createElement(tag);
        for (const [key, value] of Object.entries(attrs)) {
            if (value === undefined || value === null) continue;
            if (key === 'className') {
                el.className = value;
            } else if (key === 'textContent') {
                el.textContent = value;
            } else if (key === 'style' && typeof value === 'object') {
                Object.assign(el.style, value);
            } else {
                el.setAttribute(key, value);
            }
        }
        for (const child of children) {
            if (child === undefined || child === null) continue;
            if (typeof child === 'string' || typeof child === 'number') {
                el.appendChild(document.createTextNode(String(child)));
            } else if (Array.isArray(child)) {
                child.forEach(c => el.appendChild(c));
            } else {
                el.appendChild(child);
            }
        }
        return el;
    }

    // ============================================================
    // 第三部分：配置管理
    // ============================================================

    const Config = {
        get(key) {
            return GM_getValue(CONFIG_KEYS[key], DEFAULTS[key]);
        },

        set(key, value) {
            GM_setValue(CONFIG_KEYS[key], value);
        },

        getApiUrl() {
            return this.get('API_URL');
        },

        getApiKey() {
            return this.get('API_KEY');
        },

        getFolderName() {
            return this.get('FOLDER_NAME') || DEFAULTS.FOLDER_NAME;
        },

        isConfigured() {
            return !!(this.getApiUrl() && this.getApiKey());
        },

        // ---------- 笔记索引 ----------

        /** 获取整个索引对象 */
        _getIndex() {
            return GM_getValue(CONFIG_KEYS.NOTE_INDEX, {});
        },

        /** 保存索引对象 */
        _setIndex(index) {
            GM_setValue(CONFIG_KEYS.NOTE_INDEX, index);
        },

        /** 查询某个视频 URL 是否已有笔记 */
        getNoteForURL(cleanUrl) {
            const index = this._getIndex();
            return index[cleanUrl] || null; // { filePath, title, createdAt }
        },

        /** 保存笔记索引 */
        setNoteForURL(cleanUrl, info) {
            const index = this._getIndex();
            index[cleanUrl] = info;
            this._setIndex(index);
        },
    };

    // ============================================================
    // 第四部分：Obsidian Local REST API 客户端
    // ============================================================

    /** 对文件路径做安全编码（保留 / 作为目录分隔符） */
    function encodeFilePath(filePath) {
        return filePath.split('/').map(encodeURIComponent).join('/');
    }

    const ObsidianAPI = {
        /**
         * 发送 HTTP 请求到 Obsidian Local REST API
         * 前置条件：Obsidian 需安装并启用 "Local REST API" 社区插件
         */
        request(endpoint, options = {}) {
            return new Promise((resolve, reject) => {
                const url = Config.getApiUrl().replace(/\/+$/, '') + endpoint;
                const apiKey = Config.getApiKey();

                GM_xmlhttpRequest({
                    method: options.method || 'GET',
                    url: url,
                    headers: Object.assign(
                        {
                            'Authorization': 'Bearer ' + apiKey,
                        },
                        options.headers || {}
                    ),
                    data: options.data || undefined,
                    onload: function (resp) {
                        if (resp.status >= 200 && resp.status < 300) {
                            resolve(resp.responseText);
                        } else {
                            reject(new Error('HTTP ' + resp.status + ': ' + resp.responseText));
                        }
                    },
                    onerror: function () {
                        reject(new Error('无法连接到 Obsidian。请确保 Obsidian 已启动且 REST API 插件已启用'));
                    },
                    ontimeout: function () {
                        reject(new Error('连接超时'));
                    },
                    timeout: 10000,
                });
            });
        },

        /** 测试连接：获取 vault 信息 */
        async testConnection() {
            const resp = await this.request('/');
            // 响应是 JSON: { ... vault info ... }
            if (resp && resp.trim().startsWith('{')) {
                try {
                    return JSON.parse(resp);
                } catch (e) {
                    // 不是 JSON，但状态码成功 → 连接成功
                    return { ok: true };
                }
            }
            return { ok: true };
        },

        /** 列出 vault 根目录下的文件和文件夹 */
        async listVault(path = '') {
            const resp = await this.request('/vault/' + encodeFilePath(path));
            if (resp && resp.trim().startsWith('{') || resp && resp.trim().startsWith('[')) {
                try {
                    return JSON.parse(resp);
                } catch (e) {
                    return [];
                }
            }
            return [];
        },

        /** 读取文件内容（返回字符串） */
        async readFile(filePath) {
            return await this.request('/vault/' + encodeFilePath(filePath));
        },

        /** 创建或更新文件 */
        async writeFile(filePath, content) {
            return await this.request('/vault/' + encodeFilePath(filePath), {
                method: 'PUT',
                headers: { 'Content-Type': 'text/markdown' },
                data: content,
            });
        },

        /** 在文件末尾追加内容 */
        async appendToFile(filePath, appendContent) {
            let existing = '';
            try {
                existing = await this.readFile(filePath);
                if (existing && !existing.endsWith('\n')) {
                    existing += '\n';
                }
            } catch (e) {
                // 文件不存在 → 从头创建
            }
            return await this.writeFile(filePath, existing + '\n' + appendContent);
        },
    };

    // ============================================================
    // 第五部分：视频工具函数
    // ============================================================

    const VideoUtils = {
        /** 获取页面中可用的 video 元素 */
        getVideo() {
            // YouTube 特殊处理
            if (window.location.hostname.includes('youtube.com')) {
                const mp = document.querySelector('#movie_player');
                if (mp) {
                    const v = mp.querySelector('video.html5-main-video') || mp.querySelector('video');
                    if (v && (v.videoWidth > 0 || v.readyState >= 2)) return v;
                }
                const allVideos = document.querySelectorAll('video');
                for (const v of allVideos) {
                    if (v.src && v.src.includes('googlevideo.com')) {
                        if (v.videoWidth > 0 || v.readyState >= 2) return v;
                    }
                }
            }

            const selectors = [
                'video.html5-main-video',      // YouTube 回退
                'video.bilibili-player-video', // Bilibili 旧版
                'video.bpx-player-video',      // Bilibili 新版
                'video',
            ];
            for (const sel of selectors) {
                const v = document.querySelector(sel);
                if (v && v.videoWidth > 0) return v;
            }
            return document.querySelector('video');
        },

        /** 检查页面是否有视频 */
        hasVideo() {
            const v = this.getVideo();
            return !!(v && (v.videoWidth > 0 || v.readyState >= 2));
        },

        /** 获取当前播放时间 */
        getCurrentTime() {
            const v = this.getVideo();
            if (!v) return null;
            return v.currentTime;
        },

        /** 截取当前画面为 base64 DataURL */
        capture() {
            const v = this.getVideo();
            if (!v) return null;
            try {
                const canvas = document.createElement('canvas');
                canvas.width = v.videoWidth;
                canvas.height = v.videoHeight;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(v, 0, 0);
                return canvas.toDataURL('image/jpeg', 0.85);
            } catch (e) {
                console.error('[视频截图笔记-Obsidian] 截图失败:', e);
                return null;
            }
        },
    };

    // ============================================================
    // 第六部分：页面元数据
    // ============================================================

    const PageMeta = {
        /** 获取视频标题 */
        getVideoTitle() {
            // Bilibili
            const biliTitle = document.querySelector(
                '.video-title .tit, .video-title .tit-text, .video-title .title'
            );
            if (biliTitle) return biliTitle.textContent.trim();

            // YouTube
            const ytSelectors = [
                '#title h1 yt-formatted-string',
                'h1.ytd-watch-metadata yt-formatted-string',
                '#above-the-fold #title h1',
                '#info h1',
            ];
            for (const sel of ytSelectors) {
                const el = document.querySelector(sel);
                if (el && el.textContent.trim()) return el.textContent.trim();
            }

            let title = document.title || '未知视频';
            if (window.location.hostname.includes('youtube.com')) {
                title = title.replace(/\s*-\s*YouTube\s*$/i, '').trim();
            }
            return title;
        },

        /** 获取当前页面 URL */
        getCurrentURL() {
            return window.location.href;
        },

        /** 获取带时间戳的 URL */
        getTimestampedURL(seconds) {
            const url = new URL(this.getCurrentURL());
            const t = Math.floor(seconds);
            url.searchParams.set('t', t);
            return url.href;
        },

        /** 收集当前页面的所有元数据 */
        collect() {
            const video = VideoUtils.getVideo();
            if (!video) return null;
            const currentTimeSeconds = VideoUtils.getCurrentTime();
            const cleanUrl = getCleanUrl();
            const videoTitle = this.getVideoTitle().replace(/[\\/:*?"<>|]/g, '-');

            return {
                videoTitle: videoTitle,
                pageURL: this.getCurrentURL(),
                cleanUrl: cleanUrl,
                currentTimeSeconds: currentTimeSeconds,
                currentTime: formatTime(currentTimeSeconds),
                source: window.location.hostname.replace('www.', ''),
                timestamp: new Date().toISOString(),
            };
        },
    };

    // ============================================================
    // 第七部分：笔记模板与截图追加
    // ============================================================

    const NoteTemplate = {
        /** 生成视频笔记头部 */
        buildHeader(meta) {
            let md = '# ' + meta.videoTitle + '\n\n';
            md += '> **来源**: [' + meta.source + '](' + meta.pageURL + ')\n';
            md += '> **创建时间**: ' + new Date().toLocaleString('zh-CN') + '\n\n';
            md += '---\n\n';
            md += '## 📸 视频截图\n\n';
            return md;
        },

        /** 生成截图块的 Markdown（图片宽度固定 400px） */
        buildScreenshotBlock(dataURL, meta) {
            let md = '### ⏱ ' + meta.currentTime + '\n\n';
            md += '<img src="' + dataURL + '" width="400" alt="' + meta.currentTime + '" />\n\n';
            md += '> 📌 [跳转到视频 ' + meta.currentTime + '](' + PageMeta.getTimestampedURL(meta.currentTimeSeconds) + ')\n\n';
            md += '---\n\n';
            return md;
        },
    };

    const NoteManager = {
        /**
         * 获取或创建视频笔记
         * 返回 { filePath, isNew }
         */
        async getOrCreateNote() {
            const meta = PageMeta.collect();
            if (!meta) throw new Error('无法获取页面信息');

            const cleanUrl = meta.cleanUrl;
            const folderName = Config.getFolderName();
            const filePath = folderName + '/' + meta.videoTitle + '.md';

            // 查索引
            const existing = Config.getNoteForURL(cleanUrl);
            if (existing) {
                return { filePath: existing.filePath, isNew: false };
            }

            // 创建新笔记
            const header = NoteTemplate.buildHeader(meta);
            await ObsidianAPI.writeFile(filePath, header);

            // 保存索引
            Config.setNoteForURL(cleanUrl, {
                filePath: filePath,
                title: meta.videoTitle,
                createdAt: meta.timestamp,
            });

            return { filePath: filePath, isNew: true };
        },

        /**
         * 追加截图到笔记末尾
         */
        async appendScreenshot(filePath, dataURL, meta) {
            const block = NoteTemplate.buildScreenshotBlock(dataURL, meta);
            await ObsidianAPI.appendToFile(filePath, block);
        },

        /**
         * 创建新视频笔记（不截图）
         */
        async createNote(meta) {
            const cleanUrl = meta.cleanUrl;
            const folderName = Config.getFolderName();
            const filePath = folderName + '/' + meta.videoTitle + '.md';

            // 查重
            const existing = Config.getNoteForURL(cleanUrl);
            if (existing) {
                throw new Error('该视频笔记已存在：' + existing.filePath);
            }

            const header = NoteTemplate.buildHeader(meta);
            await ObsidianAPI.writeFile(filePath, header);

            Config.setNoteForURL(cleanUrl, {
                filePath: filePath,
                title: meta.videoTitle,
                createdAt: meta.timestamp,
            });

            return filePath;
        },
    };

    // ============================================================
    // 第八部分：UI 样式（GM_addStyle）
    // ============================================================

    GM_addStyle(`
        .${SCRIPT_PREFIX}floating-btn {
            position: fixed;
            bottom: 20px;
            right: 20px;
            z-index: 2147483647;
            width: 48px;
            height: 48px;
            border: none;
            border-radius: 50%;
            background: linear-gradient(135deg, #7c3aed, #a855f7);
            color: #fff;
            font-size: 22px;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 4px 16px rgba(124, 58, 237, 0.4);
            transition: transform 0.2s, box-shadow 0.2s;
            user-select: none;
        }
        .${SCRIPT_PREFIX}floating-btn:hover {
            transform: scale(1.1);
            box-shadow: 0 6px 24px rgba(124, 58, 237, 0.6);
        }
        .${SCRIPT_PREFIX}menu {
            position: fixed;
            bottom: 80px;
            right: 20px;
            z-index: 2147483647;
            background: #1e1e2e;
            border: 1px solid #313244;
            border-radius: 12px;
            padding: 8px 0;
            min-width: 260px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
            display: none;
            user-select: none;
        }
        .${SCRIPT_PREFIX}menu.show {
            display: block;
        }
        .${SCRIPT_PREFIX}menu-status {
            padding: 6px 14px;
            font-size: 12px;
            line-height: 1.5;
        }
        .${SCRIPT_PREFIX}menu-status.ok {
            color: #a6e3a1;
        }
        .${SCRIPT_PREFIX}menu-status.warn {
            color: #f9e2af;
        }
        .${SCRIPT_PREFIX}menu-divider {
            height: 1px;
            margin: 6px 12px;
            background: #313244;
        }
        .${SCRIPT_PREFIX}menu-item {
            display: flex;
            align-items: center;
            gap: 8px;
            width: 100%;
            border: none;
            background: none;
            color: #cdd6f4;
            padding: 10px 14px;
            font-size: 14px;
            cursor: pointer;
            text-align: left;
            transition: background 0.2s;
        }
        .${SCRIPT_PREFIX}menu-item:hover:not(:disabled) {
            background: rgba(124, 58, 237, 0.15);
        }
        .${SCRIPT_PREFIX}menu-item .icon {
            font-size: 16px;
            width: 20px;
            text-align: center;
        }
        .${SCRIPT_PREFIX}menu-item .shortcut {
            margin-left: auto;
            font-size: 11px;
            color: #6c7086;
            background: #313244;
            padding: 2px 6px;
            border-radius: 4px;
        }
        .${SCRIPT_PREFIX}modal-overlay {
            position: fixed;
            inset: 0;
            z-index: 2147483647;
            background: rgba(0, 0, 0, 0.6);
            display: flex;
            align-items: center;
            justify-content: center;
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.25s;
        }
        .${SCRIPT_PREFIX}modal-overlay.show {
            opacity: 1;
            pointer-events: auto;
        }
        .${SCRIPT_PREFIX}modal {
            background: #1e1e2e;
            border: 1px solid #313244;
            border-radius: 16px;
            width: 90vw;
            max-width: 480px;
            max-height: 85vh;
            overflow-y: auto;
            box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
            display: flex;
            flex-direction: column;
        }
        .${SCRIPT_PREFIX}modal-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 16px 18px;
            border-bottom: 1px solid #313244;
        }
        .${SCRIPT_PREFIX}modal-header h2 {
            margin: 0;
            color: #cdd6f4;
            font-size: 18px;
        }
        .${SCRIPT_PREFIX}modal-close {
            background: none;
            border: none;
            color: #6c7086;
            font-size: 22px;
            cursor: pointer;
            padding: 0;
            line-height: 1;
        }
        .${SCRIPT_PREFIX}modal-close:hover {
            color: #cdd6f4;
        }
        .${SCRIPT_PREFIX}modal-body {
            padding: 18px;
            flex: 1;
        }
        .${SCRIPT_PREFIX}modal-footer {
            display: flex;
            justify-content: flex-end;
            gap: 8px;
            padding: 12px 18px;
            border-top: 1px solid #313244;
        }
        .${SCRIPT_PREFIX}form-group {
            margin-bottom: 14px;
        }
        .${SCRIPT_PREFIX}form-group label {
            display: block;
            margin-bottom: 6px;
            color: #a6adc8;
            font-size: 13px;
        }
        .${SCRIPT_PREFIX}form-group .hint {
            color: #6c7086;
            font-size: 11px;
        }
        .${SCRIPT_PREFIX}form-group input,
        .${SCRIPT_PREFIX}form-group select {
            width: 100%;
            padding: 10px 12px;
            border: 1px solid #313244;
            border-radius: 8px;
            background: #11111b;
            color: #cdd6f4;
            font-size: 14px;
            box-sizing: border-box;
            outline: none;
        }
        .${SCRIPT_PREFIX}form-group input:focus,
        .${SCRIPT_PREFIX}form-group select:focus {
            border-color: #7c3aed;
        }
        .${SCRIPT_PREFIX}help-text {
            margin-top: 16px;
            padding: 12px;
            background: #11111b;
            border-radius: 8px;
            color: #6c7086;
            font-size: 12px;
            line-height: 1.8;
        }
        .${SCRIPT_PREFIX}help-text strong {
            color: #a6adc8;
        }
        .${SCRIPT_PREFIX}btn {
            padding: 10px 20px;
            border: none;
            border-radius: 8px;
            font-size: 14px;
            cursor: pointer;
            transition: background 0.2s;
        }
        .${SCRIPT_PREFIX}btn-primary {
            background: #7c3aed;
            color: #fff;
        }
        .${SCRIPT_PREFIX}btn-primary:hover {
            background: #6d28d9;
        }
        .${SCRIPT_PREFIX}btn-secondary {
            background: #313244;
            color: #cdd6f4;
        }
        .${SCRIPT_PREFIX}btn-secondary:hover {
            background: #45475a;
        }
        .${SCRIPT_PREFIX}connection-status {
            margin-top: 10px;
            padding: 8px 12px;
            border-radius: 6px;
            font-size: 12px;
            display: none;
        }
        .${SCRIPT_PREFIX}connection-status.show {
            display: block;
        }
        .${SCRIPT_PREFIX}connection-status.success {
            background: rgba(166, 227, 161, 0.15);
            color: #a6e3a1;
        }
        .${SCRIPT_PREFIX}connection-status.error {
            background: rgba(243, 139, 168, 0.15);
            color: #f38ba8;
        }
        .${SCRIPT_PREFIX}connection-status.info {
            background: rgba(137, 180, 250, 0.15);
            color: #89b4fa;
        }
        .${SCRIPT_PREFIX}loading-overlay {
            position: fixed;
            inset: 0;
            z-index: 2147483647;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.2s;
        }
        .${SCRIPT_PREFIX}loading-overlay.show {
            opacity: 1;
            pointer-events: auto;
        }
        @keyframes ${SCRIPT_PREFIX}spin {
            to { transform: rotate(360deg); }
        }
        .${SCRIPT_PREFIX}spinner {
            width: 32px;
            height: 32px;
            border: 3px solid rgba(255,255,255,0.2);
            border-top-color: #a855f7;
            border-radius: 50%;
            animation: ${SCRIPT_PREFIX}spin 0.8s linear infinite;
        }
        .${SCRIPT_PREFIX}toast {
            position: fixed;
            bottom: 80px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 2147483647;
            padding: 12px 24px;
            border-radius: 10px;
            color: #fff;
            font-size: 14px;
            box-shadow: 0 4px 16px rgba(0,0,0,0.3);
            opacity: 0;
            pointer-events: none;
            transition: opacity 0.3s;
        }
        .${SCRIPT_PREFIX}toast.show {
            opacity: 1;
        }
        .${SCRIPT_PREFIX}toast.success {
            background: rgba(166, 227, 161, 0.9);
            color: #1e1e2e;
        }
        .${SCRIPT_PREFIX}toast.error {
            background: rgba(243, 139, 168, 0.9);
        }
        .${SCRIPT_PREFIX}toast.warning {
            background: rgba(249, 226, 175, 0.9);
            color: #1e1e2e;
        }
    `);

    // ============================================================
    // 第九部分：UI 组件
    // ============================================================

    const UI = {
        floatingBtn: null,
        menu: null,
        modal: null,
        toastTimer: null,

        /** 创建浮动按钮 */
        createFloatingButton() {
            if (this.floatingBtn) return;
            this.floatingBtn = document.createElement('button');
            this.floatingBtn.className = SCRIPT_PREFIX + 'floating-btn';
            this.floatingBtn.textContent = '📸';
            this.floatingBtn.title = '视频截图笔记助手 (Obsidian)';
            this.floatingBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleMenu();
            });
            document.body.appendChild(this.floatingBtn);
            this.updateMenu();
        },

        /** 切换菜单显示 */
        toggleMenu() {
            if (this.menu && this.menu.classList.contains('show')) {
                this.hideMenu();
            } else {
                this.showMenu();
            }
        },

        showMenu() {
            if (!this.menu) {
                this.menu = createEl('div', { className: SCRIPT_PREFIX + 'menu' });
                document.body.appendChild(this.menu);
            }
            this.updateMenu();
            this.menu.classList.add('show');
        },

        hideMenu() {
            if (this.menu) {
                this.menu.classList.remove('show');
            }
        },

        /** 更新菜单内容 */
        updateMenu() {
            if (!this.menu) return;
            const configured = Config.isConfigured();
            const hasVideo = VideoUtils.hasVideo();
            const disabled = !configured || !hasVideo;

            while (this.menu.firstChild) {
                this.menu.removeChild(this.menu.firstChild);
            }

            const statusText = configured ? '✓ Obsidian 已连接' : '⚠ 请先配置 Obsidian';
            this.menu.appendChild(createEl('div', {
                className: SCRIPT_PREFIX + 'menu-status ' + (configured ? 'ok' : 'warn'),
                textContent: statusText,
            }));

            if (!hasVideo) {
                this.menu.appendChild(createEl('div', {
                    className: SCRIPT_PREFIX + 'menu-status warn',
                    textContent: '⚠ 未检测到视频',
                }));
            }

            this.menu.appendChild(createEl('div', { className: SCRIPT_PREFIX + 'menu-divider' }));

            const captureBtn = createEl('button', {
                className: SCRIPT_PREFIX + 'menu-item',
                'data-action': 'capture',
                disabled: disabled ? '' : undefined,
                style: disabled ? { opacity: '0.5', cursor: 'not-allowed' } : undefined,
            }, [
                createEl('span', { className: 'icon', textContent: '📸' }),
                createEl('span', { textContent: '截图并发送到 Obsidian' }),
                createEl('span', { className: 'shortcut', textContent: 'Ctrl+Shift+S' }),
            ]);
            this.menu.appendChild(captureBtn);

            const createBtn = createEl('button', {
                className: SCRIPT_PREFIX + 'menu-item',
                'data-action': 'create',
                disabled: disabled ? '' : undefined,
                style: disabled ? { opacity: '0.5', cursor: 'not-allowed' } : undefined,
            }, [
                createEl('span', { className: 'icon', textContent: '📝' }),
                createEl('span', { textContent: '创建视频笔记' }),
            ]);
            this.menu.appendChild(createBtn);

            this.menu.appendChild(createEl('div', { className: SCRIPT_PREFIX + 'menu-divider' }));

            const settingsBtn = createEl('button', {
                className: SCRIPT_PREFIX + 'menu-item',
                'data-action': 'settings',
            }, [
                createEl('span', { className: 'icon', textContent: '⚙️' }),
                createEl('span', { textContent: '设置' }),
            ]);
            this.menu.appendChild(settingsBtn);

            // 绑定事件
            this.menu.querySelectorAll('.' + SCRIPT_PREFIX + 'menu-item').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const action = btn.getAttribute('data-action');
                    if (action === 'capture') Core.captureAndSend();
                    else if (action === 'create') Core.createVideoNote();
                    else if (action === 'settings') UI.showSettings();
                    this.hideMenu();
                });
            });
        },

        /** 显示设置面板 */
        showSettings() {
            if (this.modal) {
                this.modal.remove();
            }

            this.modal = createEl('div', { className: SCRIPT_PREFIX + 'modal-overlay' }, [
                createEl('div', { className: SCRIPT_PREFIX + 'modal' }, [
                    createEl('div', { className: SCRIPT_PREFIX + 'modal-header' }, [
                        createEl('h2', { textContent: '⚙️ Obsidian 设置' }),
                        createEl('button', { className: SCRIPT_PREFIX + 'modal-close', textContent: '×' }),
                    ]),
                    createEl('div', { className: SCRIPT_PREFIX + 'modal-body' }, [
                        createEl('div', { className: SCRIPT_PREFIX + 'form-group' }, [
                            createEl('label', {}, [
                                'REST API 地址 ',
                                createEl('span', { className: 'hint', textContent: '（默认 http://127.0.0.1:27124）' }),
                            ]),
                            createEl('input', {
                                type: 'text',
                                id: SCRIPT_PREFIX + 'api-url',
                                value: Config.getApiUrl(),
                                placeholder: 'http://127.0.0.1:27124',
                            }),
                        ]),
                        createEl('div', { className: SCRIPT_PREFIX + 'form-group' }, [
                            createEl('label', {}, [
                                'API Key ',
                                createEl('span', { className: 'hint', textContent: '（Local REST API 插件设置中查看）' }),
                            ]),
                            createEl('input', {
                                type: 'password',
                                id: SCRIPT_PREFIX + 'api-key',
                                value: Config.getApiKey(),
                                placeholder: '输入 API Key',
                            }),
                        ]),
                        createEl('div', { className: SCRIPT_PREFIX + 'form-group' }, [
                            createEl('label', {}, [
                                '笔记目录 ',
                                createEl('span', { className: 'hint', textContent: '（Vault 内的文件夹名，默认 视频笔记）' }),
                            ]),
                            createEl('input', {
                                type: 'text',
                                id: SCRIPT_PREFIX + 'folder-name',
                                value: Config.getFolderName(),
                                placeholder: '视频笔记',
                            }),
                        ]),
                        createEl('button', {
                            className: SCRIPT_PREFIX + 'btn ' + SCRIPT_PREFIX + 'btn-secondary',
                            id: SCRIPT_PREFIX + 'test-btn',
                            style: { width: '100%' },
                            textContent: '🔗 测试连接',
                        }),
                        createEl('div', {
                            className: SCRIPT_PREFIX + 'connection-status',
                            id: SCRIPT_PREFIX + 'conn-status',
                        }),
                        createEl('div', { className: SCRIPT_PREFIX + 'help-text' }, [
                            createEl('strong', { textContent: '使用说明：' }),
                            createEl('br'),
                            '1. 在 Obsidian 中安装并启用「Local REST API」社区插件',
                            createEl('br'),
                            '2. 在插件设置中开启服务并复制 API Key',
                            createEl('br'),
                            '3. 点击「测试连接」确认配置正确',
                            createEl('br'),
                            '4. 保存后即可使用',
                            createEl('br'),
                            '5. 在视频页面按 ',
                            createEl('strong', { textContent: 'Ctrl+Shift+S' }),
                            ' 快速截图发送',
                            createEl('br'),
                            '6. 同一视频的截图会追加到同一笔记中',
                        ]),
                    ]),
                    createEl('div', { className: SCRIPT_PREFIX + 'modal-footer' }, [
                        createEl('button', {
                            className: SCRIPT_PREFIX + 'btn ' + SCRIPT_PREFIX + 'btn-secondary',
                            id: SCRIPT_PREFIX + 'cancel-btn',
                            textContent: '取消',
                        }),
                        createEl('button', {
                            className: SCRIPT_PREFIX + 'btn ' + SCRIPT_PREFIX + 'btn-primary',
                            id: SCRIPT_PREFIX + 'save-btn',
                            textContent: '保存',
                        }),
                    ]),
                ]),
            ]);
            document.body.appendChild(this.modal);
            this.modal.classList.add('show');

            // 自动测试连接
            if (Config.getApiKey()) {
                this.testConnection();
            }

            // 绑定事件
            const closeBtn = this.modal.querySelector('.' + SCRIPT_PREFIX + 'modal-close');
            const cancelBtn = this.modal.querySelector('#' + SCRIPT_PREFIX + 'cancel-btn');
            const saveBtn = this.modal.querySelector('#' + SCRIPT_PREFIX + 'save-btn');
            const testBtn = this.modal.querySelector('#' + SCRIPT_PREFIX + 'test-btn');

            const closeModal = () => {
                this.modal.remove();
                this.modal = null;
            };

            closeBtn.addEventListener('click', closeModal);
            cancelBtn.addEventListener('click', closeModal);
            this.modal.addEventListener('click', (e) => {
                if (e.target === this.modal) closeModal();
            });
            testBtn.addEventListener('click', () => this.testConnection());
            saveBtn.addEventListener('click', () => {
                this.saveSettings();
                closeModal();
            });
        },

        /** 测试连接 */
        async testConnection() {
            const apiUrl = document.querySelector('#' + SCRIPT_PREFIX + 'api-url').value.trim();
            const apiKey = document.querySelector('#' + SCRIPT_PREFIX + 'api-key').value.trim();
            const statusEl = document.querySelector('#' + SCRIPT_PREFIX + 'conn-status');

            if (!apiUrl || !apiKey) {
                statusEl.className = SCRIPT_PREFIX + 'connection-status show error';
                statusEl.textContent = '请填写 API 地址和 API Key';
                return;
            }

            // 临时保存配置用于测试
            Config.set('API_URL', apiUrl);
            Config.set('API_KEY', apiKey);

            statusEl.className = SCRIPT_PREFIX + 'connection-status show info';
            statusEl.textContent = '正在连接...';

            try {
                const info = await ObsidianAPI.testConnection();
                statusEl.className = SCRIPT_PREFIX + 'connection-status show success';
                const vaultMsg = (info && info.name) ? '（Vault: ' + info.name + '）' : '';
                statusEl.textContent = '✓ 连接成功 ' + vaultMsg;
            } catch (e) {
                statusEl.className = SCRIPT_PREFIX + 'connection-status show error';
                statusEl.textContent = '✗ 连接失败: ' + e.message;
            }
        },

        /** 保存设置 */
        saveSettings() {
            const apiUrl = document.querySelector('#' + SCRIPT_PREFIX + 'api-url').value.trim();
            const apiKey = document.querySelector('#' + SCRIPT_PREFIX + 'api-key').value.trim();
            const folderName = document.querySelector('#' + SCRIPT_PREFIX + 'folder-name').value.trim() || DEFAULTS.FOLDER_NAME;

            Config.set('API_URL', apiUrl);
            Config.set('API_KEY', apiKey);
            Config.set('FOLDER_NAME', folderName);

            this.showToast('设置已保存', 'success');
            this.updateMenu();
        },

        /** 显示浮动按钮 */
        showFloatingButton() {
            if (this.floatingBtn) {
                this.floatingBtn.style.display = 'flex';
            }
        },

        hideFloatingButton() {
            if (this.floatingBtn) {
                this.floatingBtn.style.display = 'none';
                this.hideMenu();
            }
        },

        /** 显示/隐藏加载遮罩 */
        showLoading(text) {
            let overlay = document.querySelector('.' + SCRIPT_PREFIX + 'loading-overlay');
            if (!overlay) {
                overlay = createEl('div', { className: SCRIPT_PREFIX + 'loading-overlay' }, [
                    createEl('div', { style: { textAlign: 'center', color: '#fff' } }, [
                        createEl('div', { className: SCRIPT_PREFIX + 'spinner', style: { margin: '0 auto 12px' } }),
                        createEl('div', { className: SCRIPT_PREFIX + 'loading-text', textContent: text || '处理中...' }),
                    ]),
                ]);
                document.body.appendChild(overlay);
            } else {
                const textEl = overlay.querySelector('.' + SCRIPT_PREFIX + 'loading-text');
                if (textEl) textEl.textContent = text || '处理中...';
            }
            overlay.classList.add('show');
        },

        hideLoading() {
            const overlay = document.querySelector('.' + SCRIPT_PREFIX + 'loading-overlay');
            if (overlay) {
                overlay.classList.remove('show');
            }
        },

        /** Toast 提示 */
        showToast(msg, type = 'info', duration = 3000) {
            if (this.toastTimer) clearTimeout(this.toastTimer);

            let toast = document.querySelector('.' + SCRIPT_PREFIX + 'toast');
            if (!toast) {
                toast = document.createElement('div');
                toast.className = SCRIPT_PREFIX + 'toast';
                document.body.appendChild(toast);
            }

            toast.className = SCRIPT_PREFIX + 'toast ' + type;
            toast.textContent = msg;

            requestAnimationFrame(() => toast.classList.add('show'));

            this.toastTimer = setTimeout(() => {
                toast.classList.remove('show');
            }, duration);
        },
    };

    // ============================================================
    // 第十部分：核心功能
    // ============================================================

    const Core = {
        /** 截图并发送到 Obsidian */
        async captureAndSend() {
            if (!Config.isConfigured()) {
                UI.showToast('请先配置 Obsidian 设置', 'warning');
                UI.showSettings();
                return;
            }

            if (!VideoUtils.hasVideo()) {
                UI.showToast('当前页面未检测到视频', 'warning');
                return;
            }

            const meta = PageMeta.collect();
            if (meta.currentTimeSeconds == null || isNaN(meta.currentTimeSeconds)) {
                UI.showToast('无法读取视频时间戳', 'error');
                return;
            }

            UI.showLoading('正在截图...');

            const dataURL = VideoUtils.capture();
            if (!dataURL) {
                UI.hideLoading();
                UI.showToast('截图失败（可能是跨域限制）', 'error', 5000);
                return;
            }

            try {
                UI.showLoading('正在获取/创建笔记...');
                const { filePath, isNew } = await NoteManager.getOrCreateNote();

                UI.showLoading('正在写入笔记...');
                await NoteManager.appendScreenshot(filePath, dataURL, meta);

                UI.hideLoading();

                const msg = isNew
                    ? '✓ 已创建新笔记并添加截图 (' + meta.currentTime + ')'
                    : '✓ 截图已追加到笔记 (' + meta.currentTime + ')';
                UI.showToast(msg, 'success');
            } catch (e) {
                UI.hideLoading();
                console.error('[视频截图笔记-Obsidian] 发送失败:', e);
                UI.showToast('发送失败: ' + e.message, 'error', 5000);
            }
        },

        /** 创建新视频笔记（不截图） */
        async createVideoNote() {
            if (!Config.isConfigured()) {
                UI.showToast('请先配置 Obsidian 设置', 'warning');
                UI.showSettings();
                return;
            }

            if (!VideoUtils.hasVideo()) {
                UI.showToast('当前页面未检测到视频', 'warning');
                return;
            }

            UI.showLoading('正在创建视频笔记...');

            try {
                const meta = PageMeta.collect();
                const filePath = await NoteManager.createNote(meta);
                UI.hideLoading();
                UI.showToast('✓ 视频笔记已创建（' + meta.videoTitle + '）', 'success', 4000);
                console.log('[视频截图笔记-Obsidian] 笔记已创建:', filePath);
            } catch (e) {
                UI.hideLoading();
                console.error('[视频截图笔记-Obsidian] 创建笔记失败:', e);
                UI.showToast('创建笔记失败: ' + e.message, 'error', 5000);
            }
        },
    };

    // ============================================================
    // 第十一部分：快捷键监听
    // ============================================================

    function setupHotkeys() {
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.shiftKey && (e.key === 'S' || e.key === 's')) {
                e.preventDefault();
                e.stopPropagation();
                Core.captureAndSend();
            }
        });
    }

    // ============================================================
    // 第十二部分：初始化
    // ============================================================

    function init() {
        console.log('[视频截图笔记-Obsidian] 脚本已加载 v1.0.0');

        GM_registerMenuCommand('⚙️ Obsidian 设置', () => UI.showSettings());
        GM_registerMenuCommand('📸 截图并发送 (Ctrl+Shift+S)', () => Core.captureAndSend());
        GM_registerMenuCommand('📝 创建视频笔记', () => Core.createVideoNote());

        setupHotkeys();

        let checkTimer = null;

        function checkVideo() {
            if (checkTimer) clearTimeout(checkTimer);
            checkTimer = setTimeout(() => {
                UI.createFloatingButton();
                UI.showFloatingButton();
            }, 500);
        }

        checkVideo();

        const observer = new MutationObserver(() => {
            checkVideo();
        });
        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
        });

        let lastURL = window.location.href;
        setInterval(() => {
            if (window.location.href !== lastURL) {
                lastURL = window.location.href;
                checkVideo();
            }
        }, 1000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
