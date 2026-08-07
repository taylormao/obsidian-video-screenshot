// ==UserScript==
// @name         视频截图笔记助手 - Obsidian v2
// @namespace    https://github.com/taylormao/video-screenshot-obsidian
// @version      2.0.3
// @description  一键截图视频画面并保存到 Obsidian 笔记（v2 源URL索引+智能追踪）
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

    const SCRIPT_PREFIX = 'vso-';
    const SCRIPT_VERSION = '2.0.3';

    const CONFIG_KEYS = {
        API_URL: 'obsidian_api_url',
        API_KEY: 'obsidian_api_key',
        FOLDER_NAME: 'obsidian_folder_name',
        NOTE_INDEX: 'obsidian_note_index_v2',  // v2: 用 source_url 做键
    };

    const DEFAULTS = {
        API_URL: 'http://127.0.0.1:27124',
        API_KEY: '',
        FOLDER_NAME: '视频笔记',
    };

    // ============================================================
    // 第二部分：工具函数
    // ============================================================

    function formatTime(seconds) {
        if (seconds == null || isNaN(seconds)) return '00:00:00';
        const s = Math.floor(seconds);
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = s % 60;
        return [h, m, sec].map(v => String(v).padStart(2, '0')).join(':');
    }

    function getCleanUrl() {
        const url = new URL(window.location.href);
        url.hash = '';
        if (url.hostname.includes('youtube.com') && url.pathname === '/watch') {
            const v = url.searchParams.get('v');
            url.search = '';
            if (v) url.searchParams.set('v', v);
            return url.href;
        }
        if (url.hostname.includes('bilibili.com')) {
            const p = url.searchParams.get('p');
            url.search = '';
            if (p && p !== '1') url.searchParams.set('p', p);
            return url.href;
        }
        url.search = '';
        return url.href;
    }

    function escapeHtml(text) {
        return String(text)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

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

    /** 从 Markdown 内容中提取 YAML frontmatter 的某个字段 */
    function getFrontmatterValue(content, key) {
        const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
        if (!match) return null;
        const fm = match[1];
        const keyRegex = new RegExp('^' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':\\s*(.+)$', 'm');
        const km = fm.match(keyRegex);
        if (!km) return null;
        let val = km[1].trim();
        // 去除引号
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
        }
        return val;
    }

    /** 设置 YAML frontmatter 中的某个字段 */
    function setFrontmatterValue(content, key, value) {
        const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
        if (!match) return content;
        const fm = match[1];
        const keyRegex = new RegExp('^' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':.*$', 'm');
        if (fm.match(keyRegex)) {
            const newFm = fm.replace(keyRegex, key + ': ' + value);
            return content.replace(fm, newFm);
        } else {
            // 插入到 frontmatter 末尾
            const newFm = fm + '\n' + key + ': ' + value;
            return content.replace(fm, newFm);
        }
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

        getApiUrl() { return this.get('API_URL'); },
        getApiKey() { return this.get('API_KEY'); },
        getFolderName() { return this.get('FOLDER_NAME') || DEFAULTS.FOLDER_NAME; },
        isConfigured() { return !!(this.getApiUrl() && this.getApiKey()); },

        // ---------- 笔记索引 v2（以 source_url 为键）----------

        _getIndex() {
            return GM_getValue(CONFIG_KEYS.NOTE_INDEX, {});
        },

        _setIndex(index) {
            GM_setValue(CONFIG_KEYS.NOTE_INDEX, index);
        },

        /** 查询某个视频 URL 是否已有笔记 */
        getNoteForSourceURL(sourceUrl) {
            const index = this._getIndex();
            return index[sourceUrl] || null;
        },

        /** 保存笔记索引（source_url → filePath） */
        setNoteForSourceURL(sourceUrl, filePath, title) {
            const index = this._getIndex();
            index[sourceUrl] = {
                filePath: filePath,
                title: title,
                updatedAt: new Date().toISOString(),
            };
            this._setIndex(index);
        },
    };

    // ============================================================
    // 第四部分：Obsidian REST API 客户端
    // ============================================================

    function encodeFilePath(filePath) {
        return filePath.split('/').map(encodeURIComponent).join('/');
    }

    const ObsidianAPI = {
        request(endpoint, options = {}) {
            return new Promise((resolve, reject) => {
                const url = Config.getApiUrl().replace(/\/+$/, '') + endpoint;
                const apiKey = Config.getApiKey();

                GM_xmlhttpRequest({
                    method: options.method || 'GET',
                    url: url,
                    headers: Object.assign(
                        { 'Authorization': 'Bearer ' + apiKey },
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

        async testConnection() {
            const resp = await this.request('/');
            if (resp && resp.trim().startsWith('{')) {
                try { return JSON.parse(resp); } catch (e) { return { ok: true }; }
            }
            return { ok: true };
        },

        async listVault(path = '') {
            const resp = await this.request('/vault/' + encodeFilePath(path));
            if (resp && (resp.trim().startsWith('{') || resp.trim().startsWith('['))) {
                try {
                    const parsed = JSON.parse(resp);
                    // Obsidian Local REST API 返回格式：{ "files": [...] }
                    // 归一化为数组
                    if (parsed && parsed.files && Array.isArray(parsed.files)) {
                        return parsed.files;
                    }
                    if (Array.isArray(parsed)) {
                        return parsed;
                    }
                    return [];
                } catch (e) { return []; }
            }
            // 有些版本的 API 可能返回换行分隔的文本列表
            if (resp && resp.trim()) {
                return resp.trim().split('\n').filter(Boolean).map(function(name) {
                    return { name: name, path: name };
                });
            }
            return [];
        },

        async readFile(filePath) {
            return await this.request('/vault/' + encodeFilePath(filePath));
        },

        async writeFile(filePath, content) {
            return await this.request('/vault/' + encodeFilePath(filePath), {
                method: 'PUT',
                headers: { 'Content-Type': 'text/markdown' },
                data: content,
            });
        },

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

        /** 检查文件是否存在 */
        async fileExists(filePath) {
            try {
                await this.request('/vault/' + encodeFilePath(filePath), { method: 'HEAD' });
                return true;
            } catch (e) {
                return false;
            }
        },

        /**
         * 🔑 在目录中搜索含有指定 source_url 的笔记文件
         * 通过逐个读取 .md 文件的 frontmatter 来匹配
         */
        async findNoteBySourceURL(folderName, sourceUrl) {
            try {
                const entries = await this.listVault(folderName);
                if (!Array.isArray(entries)) return null;

                const mdFiles = entries.filter(e => {
                    const name = (typeof e === 'string' ? e : (e.name || e.path || '')).toLowerCase();
                    return name.endsWith('.md');
                });

                // 最多检查 50 个文件（避免性能问题）
                const checkFiles = mdFiles.slice(0, 50);
                for (const f of checkFiles) {
                    const name = (typeof f === 'string') ? f : (f.name || f.path || '');
                    const filePath = folderName + '/' + name;
                    try {
                        const content = await this.readFile(filePath);
                        const fmSourceUrl = getFrontmatterValue(content, 'source_url');
                        if (fmSourceUrl === sourceUrl) {
                            return filePath;
                        }
                    } catch (e) {
                        // 读文件失败，跳过
                        continue;
                    }
                }
                return null;
            } catch (e) {
                console.error('[视频截图笔记] 搜索笔记失败:', e);
                return null;
            }
        },
    };

    // ============================================================
    // 第五部分：视频工具函数
    // ============================================================

    const VideoUtils = {
        getVideo() {
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
                'video.html5-main-video',
                'video.bilibili-player-video',
                'video.bpx-player-video',
                'video',
            ];
            for (const sel of selectors) {
                const v = document.querySelector(sel);
                if (v && v.videoWidth > 0) return v;
            }
            return document.querySelector('video');
        },

        hasVideo() {
            const v = this.getVideo();
            return !!(v && (v.videoWidth > 0 || v.readyState >= 2));
        },

        getCurrentTime() {
            const v = this.getVideo();
            if (!v) return null;
            return v.currentTime;
        },

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
                console.error('[视频截图笔记] 截图失败:', e);
                return null;
            }
        },
    };

    // ============================================================
    // 第六部分：页面元数据
    // ============================================================

    const PageMeta = {
        getVideoTitle() {
            const biliTitle = document.querySelector('.video-title .tit, .video-title .tit-text, .video-title .title');
            if (biliTitle) return biliTitle.textContent.trim();

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

        getCurrentURL() {
            return window.location.href;
        },

        getTimestampedURL(seconds) {
            const url = new URL(this.getCurrentURL());
            url.searchParams.set('t', Math.floor(seconds));
            return url.href;
        },

        collect() {
            const video = VideoUtils.getVideo();
            if (!video) return null;
            const currentTimeSeconds = VideoUtils.getCurrentTime();
            const pageURL = this.getCurrentURL();
            const cleanUrl = getCleanUrl();
            const videoTitle = this.getVideoTitle().replace(/[\\/:*?"<>|]/g, '-');

            return {
                videoTitle: videoTitle,
                pageURL: pageURL,
                cleanUrl: cleanUrl,
                sourceUrl: cleanUrl,       // 以此作为唯一标识
                currentTimeSeconds: currentTimeSeconds,
                currentTime: formatTime(currentTimeSeconds),
                source: window.location.hostname.replace('www.', ''),
                timestamp: new Date().toISOString(),
            };
        },
    };

    // ============================================================
    // 第七部分：笔记模板（含 YAML frontmatter）
    // ============================================================

    const NoteTemplate = {
        /** 生成 YAML frontmatter */
        buildFrontmatter(meta, editCount) {
            if (editCount === undefined) editCount = 1;
            const now = new Date();
            const created = now.toISOString().replace('T', ' ').substring(0, 19);
            const dateStr = now.toISOString().substring(0, 10);
            const timeStr = now.toLocaleString('zh-CN', { hour12: false });

            return [
                '---',
                'title: "' + meta.videoTitle + '"',
                'source_url: ' + meta.sourceUrl,
                'source_name: ' + meta.source,
                'created: ' + created,
                'modified: ' + created,
                'date: ' + dateStr,
                'edit_count: ' + editCount,
                'type: video-note',
                'summary: ""',
                'tags: [视频笔记]',
                '---',
                '',
            ].join('\n');
        },

        /** 生成视频笔记头部（含 frontmatter） */
        buildHeader(meta) {
            let md = this.buildFrontmatter(meta, 1);
            md += '# ' + meta.videoTitle + '\n\n';
            md += '> **来源**: [' + meta.source + '](' + meta.pageURL + ')\n';
            md += '> **创建时间**: ' + new Date().toLocaleString('zh-CN') + '\n\n';
            md += '---\n\n';
            md += '## 📸 视频截图\n\n';
            return md;
        },

        /** 生成截图块 */
        buildScreenshotBlock(dataURL, meta) {
            let md = '### ⏱ ' + meta.currentTime + '\n\n';
            md += '<img src="' + dataURL + '" width="400" alt="' + meta.currentTime + '" />\n\n';
            md += '> 📌 [跳转到视频 ' + meta.currentTime + '](' + PageMeta.getTimestampedURL(meta.currentTimeSeconds) + ')\n\n';
            md += '---\n\n';
            return md;
        },
    };

    // ============================================================
    // 第八部分：笔记管理器（智能文件追踪）
    // ============================================================

    const NoteManager = {
        /**
         * 🔑 获取或创建视频笔记（智能追踪版本）
         * 核心改进：以 source_url 为唯一标识，支持文件改名后仍能匹配
         */
        async getOrCreateNote() {
            const meta = PageMeta.collect();
            if (!meta) throw new Error('无法获取页面信息');

            const sourceUrl = meta.sourceUrl;
            const folderName = Config.getFolderName();

            // Step 1: 检查索引
            let indexEntry = Config.getNoteForSourceURL(sourceUrl);

            // Step 2: 如果索引存在，验证文件是否还存活
            if (indexEntry) {
                try {
                    // 尝试读取索引中的路径
                    await ObsidianAPI.request('/vault/' + encodeFilePath(indexEntry.filePath), { method: 'HEAD' });
                    // 文件存在 → 直接使用，同时更新编辑次数
                    return { filePath: indexEntry.filePath, isNew: false, meta: meta };
                } catch (e) {
                    // 文件不存在（可能已被改名或删除） → 进入搜索流程
                    console.log('[视频截图笔记] 索引文件已失效，搜索 Vault 中...');
                }
            }

            // Step 3: 在 Vault 中搜索含有该 source_url 的笔记
            const foundPath = await ObsidianAPI.findNoteBySourceURL(folderName, sourceUrl);
            if (foundPath) {
                // 找到改名后的文件 → 更新索引
                Config.setNoteForSourceURL(sourceUrl, foundPath, meta.videoTitle);
                return { filePath: foundPath, isNew: false, meta: meta };
            }

            // Step 4: 尝试按标题匹配（兜底策略，兼容没有 frontmatter 的旧笔记）
            const titlePath = folderName + '/' + meta.videoTitle + '.md';
            try {
                await ObsidianAPI.request('/vault/' + encodeFilePath(titlePath), { method: 'HEAD' });
                // 标题匹配成功 → 可能是旧版笔记或无 frontmatter 的笔记
                // 升级：写入 frontmatter
                const existingContent = await ObsidianAPI.readFile(titlePath);
                if (!getFrontmatterValue(existingContent, 'source_url')) {
                    // 旧笔记没有 frontmatter → 添加
                    const fm = NoteTemplate.buildFrontmatter(meta, 1);
                    const newContent = fm + existingContent.replace(/^---[\s\S]*?---\s*\n?/, '');
                    await ObsidianAPI.writeFile(titlePath, newContent);
                }
                Config.setNoteForSourceURL(sourceUrl, titlePath, meta.videoTitle);
                return { filePath: titlePath, isNew: false, meta: meta };
            } catch (e) {
                // 也不存在 → 创建新笔记
            }

            // Step 5: 创建新笔记
            const filePath = folderName + '/' + meta.videoTitle + '.md';
            const header = NoteTemplate.buildHeader(meta);
            await ObsidianAPI.writeFile(filePath, header);

            Config.setNoteForSourceURL(sourceUrl, filePath, meta.videoTitle);

            return { filePath: filePath, isNew: true, meta: meta };
        },

        /**
         * 追加截图并更新元数据
         */
        async appendScreenshot(filePath, dataURL, meta) {
            // 读取当前内容
            let content = '';
            try {
                content = await ObsidianAPI.readFile(filePath);
            } catch (e) {
                // 文件不存在
            }

            // 更新 frontmatter：修改时间 + 编辑次数
            const now = new Date();
            const modifiedStr = now.toISOString().replace('T', ' ').substring(0, 19);
            const dateStr = now.toISOString().substring(0, 10);

            let editCount = 1;
            const ecStr = getFrontmatterValue(content, 'edit_count');
            if (ecStr) editCount = parseInt(ecStr) + 1;

            content = setFrontmatterValue(content, 'modified', modifiedStr);
            content = setFrontmatterValue(content, 'date', dateStr);
            content = setFrontmatterValue(content, 'edit_count', String(editCount));

            // 追加截图块
            if (!content.endsWith('\n')) content += '\n';
            const block = NoteTemplate.buildScreenshotBlock(dataURL, meta);
            content += '\n' + block;

            await ObsidianAPI.writeFile(filePath, content);
        },

        /** 创建新视频笔记（不截图） */
        async createNote() {
            const meta = PageMeta.collect();
            if (!meta) throw new Error('无法获取页面信息');

            const sourceUrl = meta.sourceUrl;
            const folderName = Config.getFolderName();

            const existing = Config.getNoteForSourceURL(sourceUrl);
            if (existing) {
                // 验证文件是否存在
                try {
                    await ObsidianAPI.request('/vault/' + encodeFilePath(existing.filePath), { method: 'HEAD' });
                    throw new Error('该视频笔记已存在：' + existing.filePath);
                } catch (e) {
                    if (e.message.includes('已存在')) throw e;
                    // 文件不存在，搜索
                }
            }

            const foundPath = await ObsidianAPI.findNoteBySourceURL(folderName, sourceUrl);
            if (foundPath) {
                Config.setNoteForSourceURL(sourceUrl, foundPath, meta.videoTitle);
                throw new Error('该视频笔记已存在：' + foundPath);
            }

            const filePath = folderName + '/' + meta.videoTitle + '.md';
            const header = NoteTemplate.buildHeader(meta);
            await ObsidianAPI.writeFile(filePath, header);

            Config.setNoteForSourceURL(sourceUrl, filePath, meta.videoTitle);
            return filePath;
        },
    };

    // ============================================================
    // 第九部分：UI 样式（与 v1.0 一致，省略注释）
    // ============================================================

    GM_addStyle(`
        .${SCRIPT_PREFIX}floating-btn {position:fixed;bottom:20px;right:20px;z-index:2147483647;width:48px;height:48px;border:none;border-radius:50%;background:linear-gradient(135deg,#7c3aed,#a855f7);color:#fff;font-size:22px;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 16px rgba(124,58,237,0.4);transition:transform 0.2s,box-shadow 0.2s;user-select:none;}
        .${SCRIPT_PREFIX}floating-btn:hover {transform:scale(1.1);box-shadow:0 6px 24px rgba(124,58,237,0.6);}
        .${SCRIPT_PREFIX}menu {position:fixed;bottom:80px;right:20px;z-index:2147483647;background:#1e1e2e;border:1px solid #313244;border-radius:12px;padding:8px 0;min-width:260px;box-shadow:0 8px 32px rgba(0,0,0,0.4);display:none;user-select:none;}
        .${SCRIPT_PREFIX}menu.show {display:block;}
        .${SCRIPT_PREFIX}menu-status {padding:6px 14px;font-size:12px;line-height:1.5;}
        .${SCRIPT_PREFIX}menu-status.ok {color:#a6e3a1;}
        .${SCRIPT_PREFIX}menu-status.warn {color:#f9e2af;}
        .${SCRIPT_PREFIX}menu-divider {height:1px;margin:6px 12px;background:#313244;}
        .${SCRIPT_PREFIX}menu-item {display:flex;align-items:center;gap:8px;width:100%;border:none;background:none;color:#cdd6f4;padding:10px 14px;font-size:14px;cursor:pointer;text-align:left;transition:background 0.2s;}
        .${SCRIPT_PREFIX}menu-item:hover:not(:disabled) {background:rgba(124,58,237,0.15);}
        .${SCRIPT_PREFIX}menu-item .icon {font-size:16px;width:20px;text-align:center;}
        .${SCRIPT_PREFIX}menu-item .shortcut {margin-left:auto;font-size:11px;color:#6c7086;background:#313244;padding:2px 6px;border-radius:4px;}
        .${SCRIPT_PREFIX}modal-overlay {position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;opacity:0;pointer-events:none;transition:opacity 0.25s;}
        .${SCRIPT_PREFIX}modal-overlay.show {opacity:1;pointer-events:auto;}
        .${SCRIPT_PREFIX}modal {background:#1e1e2e;border:1px solid #313244;border-radius:16px;width:90vw;max-width:480px;max-height:85vh;overflow-y:auto;box-shadow:0 16px 48px rgba(0,0,0,0.5);display:flex;flex-direction:column;}
        .${SCRIPT_PREFIX}modal-header {display:flex;align-items:center;justify-content:space-between;padding:16px 18px;border-bottom:1px solid #313244;}
        .${SCRIPT_PREFIX}modal-header h2 {margin:0;color:#cdd6f4;font-size:18px;}
        .${SCRIPT_PREFIX}modal-close {background:none;border:none;color:#6c7086;font-size:22px;cursor:pointer;padding:0;line-height:1;}
        .${SCRIPT_PREFIX}modal-close:hover {color:#cdd6f4;}
        .${SCRIPT_PREFIX}modal-body {padding:18px;flex:1;}
        .${SCRIPT_PREFIX}modal-footer {display:flex;justify-content:flex-end;gap:8px;padding:12px 18px;border-top:1px solid #313244;}
        .${SCRIPT_PREFIX}form-group {margin-bottom:14px;}
        .${SCRIPT_PREFIX}form-group label {display:block;margin-bottom:6px;color:#a6adc8;font-size:13px;}
        .${SCRIPT_PREFIX}form-group .hint {color:#6c7086;font-size:11px;}
        .${SCRIPT_PREFIX}form-group input,.${SCRIPT_PREFIX}form-group select {width:100%;padding:10px 12px;border:1px solid #313244;border-radius:8px;background:#11111b;color:#cdd6f4;font-size:14px;box-sizing:border-box;outline:none;}
        .${SCRIPT_PREFIX}form-group input:focus,.${SCRIPT_PREFIX}form-group select:focus {border-color:#7c3aed;}
        .${SCRIPT_PREFIX}help-text {margin-top:16px;padding:12px;background:#11111b;border-radius:8px;color:#6c7086;font-size:12px;line-height:1.8;}
        .${SCRIPT_PREFIX}help-text strong {color:#a6adc8;}
        .${SCRIPT_PREFIX}btn {padding:10px 20px;border:none;border-radius:8px;font-size:14px;cursor:pointer;transition:background 0.2s;}
        .${SCRIPT_PREFIX}btn-primary {background:#7c3aed;color:#fff;}
        .${SCRIPT_PREFIX}btn-primary:hover {background:#6d28d9;}
        .${SCRIPT_PREFIX}btn-secondary {background:#313244;color:#cdd6f4;}
        .${SCRIPT_PREFIX}btn-secondary:hover {background:#45475a;}
        .${SCRIPT_PREFIX}connection-status {margin-top:10px;padding:8px 12px;border-radius:6px;font-size:12px;display:none;}
        .${SCRIPT_PREFIX}connection-status.show {display:block;}
        .${SCRIPT_PREFIX}connection-status.success {background:rgba(166,227,161,0.15);color:#a6e3a1;}
        .${SCRIPT_PREFIX}connection-status.error {background:rgba(243,139,168,0.15);color:#f38ba8;}
        .${SCRIPT_PREFIX}connection-status.info {background:rgba(137,180,250,0.15);color:#89b4fa;}
        .${SCRIPT_PREFIX}loading-overlay {position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;opacity:0;pointer-events:none;transition:opacity 0.2s;}
        .${SCRIPT_PREFIX}loading-overlay.show {opacity:1;pointer-events:auto;}
        @keyframes ${SCRIPT_PREFIX}spin {to{transform:rotate(360deg);}}
        .${SCRIPT_PREFIX}spinner {width:32px;height:32px;border:3px solid rgba(255,255,255,0.2);border-top-color:#a855f7;border-radius:50%;animation:${SCRIPT_PREFIX}spin 0.8s linear infinite;}
        .${SCRIPT_PREFIX}toast {position:fixed;bottom:80px;left:50%;transform:translateX(-50%);z-index:2147483647;padding:12px 24px;border-radius:10px;color:#fff;font-size:14px;box-shadow:0 4px 16px rgba(0,0,0,0.3);opacity:0;pointer-events:none;transition:opacity 0.3s;}
        .${SCRIPT_PREFIX}toast.show {opacity:1;}
        .${SCRIPT_PREFIX}toast.success {background:rgba(166,227,161,0.9);color:#1e1e2e;}
        .${SCRIPT_PREFIX}toast.error {background:rgba(243,139,168,0.9);}
        .${SCRIPT_PREFIX}toast.warning {background:rgba(249,226,175,0.9);color:#1e1e2e;}
        .${SCRIPT_PREFIX}version-badge {position:fixed;bottom:72px;right:22px;z-index:2147483646;font-size:10px;color:#7c3aed;opacity:0.7;pointer-events:none;}
    `);

    // ============================================================
    // 第十部分：UI 组件
    // ============================================================

    const UI = {
        floatingBtn: null,
        menu: null,
        modal: null,
        toastTimer: null,

        createFloatingButton() {
            if (this.floatingBtn) return;
            this.floatingBtn = createEl('button', {
                className: SCRIPT_PREFIX + 'floating-btn',
                textContent: '📸',
                title: '视频截图笔记助手 v' + SCRIPT_VERSION,
            });
            this.floatingBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.toggleMenu();
            });
            document.body.appendChild(this.floatingBtn);

            // 版本标记
            const badge = createEl('div', {
                className: SCRIPT_PREFIX + 'version-badge',
                textContent: 'v' + SCRIPT_VERSION,
            });
            document.body.appendChild(badge);

            this.updateMenu();
        },

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
            if (this.menu) this.menu.classList.remove('show');
        },

        updateMenu() {
            if (!this.menu) return;
            const configured = Config.isConfigured();
            const hasVideo = VideoUtils.hasVideo();
            const disabled = !configured || !hasVideo;

            while (this.menu.firstChild) this.menu.removeChild(this.menu.firstChild);

            this.menu.appendChild(createEl('div', {
                className: SCRIPT_PREFIX + 'menu-status ' + (configured ? 'ok' : 'warn'),
                textContent: configured ? '✓ Obsidian 已连接' : '⚠ 请先配置 Obsidian',
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

        showSettings() {
            if (this.modal) this.modal.remove();

            this.modal = createEl('div', { className: SCRIPT_PREFIX + 'modal-overlay' }, [
                createEl('div', { className: SCRIPT_PREFIX + 'modal' }, [
                    createEl('div', { className: SCRIPT_PREFIX + 'modal-header' }, [
                        createEl('h2', { textContent: '⚙️ Obsidian 设置' }),
                        createEl('button', { className: SCRIPT_PREFIX + 'modal-close', textContent: '×' }),
                    ]),
                    createEl('div', { className: SCRIPT_PREFIX + 'modal-body' }, [
                        createEl('div', { className: SCRIPT_PREFIX + 'form-group' }, [
                            createEl('label', {}, ['REST API 地址 ', createEl('span', { className: 'hint', textContent: '（默认 http://127.0.0.1:27124）' })]),
                            createEl('input', { type: 'text', id: SCRIPT_PREFIX + 'api-url', value: Config.getApiUrl(), placeholder: 'http://127.0.0.1:27124' }),
                        ]),
                        createEl('div', { className: SCRIPT_PREFIX + 'form-group' }, [
                            createEl('label', {}, ['API Key ', createEl('span', { className: 'hint', textContent: '（Local REST API 插件设置中查看）' })]),
                            createEl('input', { type: 'password', id: SCRIPT_PREFIX + 'api-key', value: Config.getApiKey(), placeholder: '输入 API Key' }),
                        ]),
                        createEl('div', { className: SCRIPT_PREFIX + 'form-group' }, [
                            createEl('label', {}, ['笔记目录 ', createEl('span', { className: 'hint', textContent: '（Vault 内的文件夹名，默认 视频笔记）' })]),
                            createEl('input', { type: 'text', id: SCRIPT_PREFIX + 'folder-name', value: Config.getFolderName(), placeholder: '视频笔记' }),
                        ]),
                        createEl('button', { className: SCRIPT_PREFIX + 'btn ' + SCRIPT_PREFIX + 'btn-secondary', id: SCRIPT_PREFIX + 'test-btn', style: { width: '100%' }, textContent: '🔗 测试连接' }),
                        createEl('div', { className: SCRIPT_PREFIX + 'connection-status', id: SCRIPT_PREFIX + 'conn-status' }),
                        createEl('div', { className: SCRIPT_PREFIX + 'help-text' }, [
                            createEl('strong', { textContent: 'v' + SCRIPT_VERSION + ' 更新说明：' }),
                            createEl('br'),
                            '• YAML frontmatter 元数据（自动记录来源/修改次数）',
                            createEl('br'),
                            '• 智能文件追踪：改名后仍能追加到原笔记',
                            createEl('br'),
                            createEl('br'),
                            createEl('strong', { textContent: '使用说明：' }),
                            createEl('br'),
                            '1. 在 Obsidian 中安装并启用「Local REST API」插件',
                            createEl('br'),
                            '2. 复制 API Key 并填写到上方',
                            createEl('br'),
                            '3. 在 Vault 中创建笔记目录（默认 视频笔记）',
                            createEl('br'),
                            '4. 点击「测试连接」确认配置',
                            createEl('br'),
                            '5. 在视频页面按 Ctrl+Shift+S 截图',
                        ]),
                    ]),
                    createEl('div', { className: SCRIPT_PREFIX + 'modal-footer' }, [
                        createEl('button', { className: SCRIPT_PREFIX + 'btn ' + SCRIPT_PREFIX + 'btn-secondary', id: SCRIPT_PREFIX + 'cancel-btn', textContent: '取消' }),
                        createEl('button', { className: SCRIPT_PREFIX + 'btn ' + SCRIPT_PREFIX + 'btn-primary', id: SCRIPT_PREFIX + 'save-btn', textContent: '保存' }),
                    ]),
                ]),
            ]);
            document.body.appendChild(this.modal);
            this.modal.classList.add('show');

            if (Config.getApiKey()) this.testConnection();

            const closeBtn = this.modal.querySelector('.' + SCRIPT_PREFIX + 'modal-close');
            const cancelBtn = this.modal.querySelector('#' + SCRIPT_PREFIX + 'cancel-btn');
            const saveBtn = this.modal.querySelector('#' + SCRIPT_PREFIX + 'save-btn');
            const testBtn = this.modal.querySelector('#' + SCRIPT_PREFIX + 'test-btn');

            const closeModal = () => { this.modal.remove(); this.modal = null; };
            closeBtn.addEventListener('click', closeModal);
            cancelBtn.addEventListener('click', closeModal);
            this.modal.addEventListener('click', (e) => { if (e.target === this.modal) closeModal(); });
            testBtn.addEventListener('click', () => this.testConnection());
            saveBtn.addEventListener('click', () => { this.saveSettings(); closeModal(); });
        },

        async testConnection() {
            const apiUrl = document.querySelector('#' + SCRIPT_PREFIX + 'api-url').value.trim();
            const apiKey = document.querySelector('#' + SCRIPT_PREFIX + 'api-key').value.trim();
            const statusEl = document.querySelector('#' + SCRIPT_PREFIX + 'conn-status');

            if (!apiUrl || !apiKey) {
                statusEl.className = SCRIPT_PREFIX + 'connection-status show error';
                statusEl.textContent = '请填写 API 地址和 API Key';
                return;
            }
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

        showFloatingButton() {
            if (this.floatingBtn) this.floatingBtn.style.display = 'flex';
        },

        hideFloatingButton() {
            if (this.floatingBtn) {
                this.floatingBtn.style.display = 'none';
                this.hideMenu();
            }
        },

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
            if (overlay) overlay.classList.remove('show');
        },

        showToast(msg, type = 'info', duration = 3000) {
            if (this.toastTimer) clearTimeout(this.toastTimer);
            let toast = document.querySelector('.' + SCRIPT_PREFIX + 'toast');
            if (!toast) {
                toast = createEl('div', { className: SCRIPT_PREFIX + 'toast' });
                document.body.appendChild(toast);
            }
            toast.className = SCRIPT_PREFIX + 'toast ' + type;
            toast.textContent = msg;
            requestAnimationFrame(() => toast.classList.add('show'));
            this.toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
        },
    };

    // ============================================================
    // 第十一部分：核心功能
    // ============================================================

    const Core = {
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
                console.error('[视频截图笔记] 发送失败:', e);
                UI.showToast('发送失败: ' + e.message, 'error', 5000);
            }
        },

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
                const filePath = await NoteManager.createNote();
                UI.hideLoading();
                UI.showToast('✓ 视频笔记已创建', 'success', 4000);
                console.log('[视频截图笔记] 笔记已创建:', filePath);
            } catch (e) {
                UI.hideLoading();
                console.error('[视频截图笔记] 创建笔记失败:', e);
                UI.showToast('创建笔记失败: ' + e.message, 'error', 5000);
            }
        },
    };

    // ============================================================
    // 第十二部分：快捷键
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
    // 第十三部分：初始化
    // ============================================================

    function init() {
        console.log('[视频截图笔记-Obsidian] v' + SCRIPT_VERSION + ' 已加载');

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

        const observer = new MutationObserver(() => checkVideo());
        observer.observe(document.documentElement, { childList: true, subtree: true });

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
