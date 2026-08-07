// ==UserScript==
// @name         视频截图笔记助手 - Obsidian（诊断版）
// @namespace    https://github.com/taylormao/video-screenshot-obsidian
// @version      2.0.2-debug
// @description  一键截图视频画面并保存到 Obsidian 笔记（诊断版本：输出详细调试日志）
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

    // 调试日志开关
    const DEBUG = true;
    function log(...args) { if (DEBUG) console.log('[截图笔记 DBG]', ...args); }
    function logWarn(...args) { if (DEBUG) console.warn('[截图笔记 DBG]', ...args); }

    // ============================================================
    // 第一部分：常量和前缀
    // ============================================================

    const SCRIPT_PREFIX = 'vso-';
    const SCRIPT_VERSION = '2.0.2-debug';

    const CONFIG_KEYS = {
        API_URL: 'obsidian_api_url',
        API_KEY: 'obsidian_api_key',
        FOLDER_NAME: 'obsidian_folder_name',
        NOTE_INDEX: 'obsidian_note_index_v2',
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

    function getFrontmatterValue(content, key) {
        const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
        if (!match) return null;
        const fm = match[1];
        const keyRegex = new RegExp('^' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':\\s*(.+)$', 'm');
        const km = fm.match(keyRegex);
        if (!km) return null;
        let val = km[1].trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
        }
        return val;
    }

    function setFrontmatterValue(content, key, value) {
        const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
        if (!match) return content;
        const fm = match[1];
        const keyRegex = new RegExp('^' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':.*$', 'm');
        if (fm.match(keyRegex)) {
            const newFm = fm.replace(keyRegex, key + ': ' + value);
            return content.replace(fm, newFm);
        } else {
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

        _getIndex() {
            return GM_getValue(CONFIG_KEYS.NOTE_INDEX, {});
        },

        _setIndex(index) {
            GM_setValue(CONFIG_KEYS.NOTE_INDEX, index);
        },

        getNoteForSourceURL(sourceUrl) {
            const index = this._getIndex();
            return index[sourceUrl] || null;
        },

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
    // 第四部分：Obsidian REST API 客户端（带诊断日志）
    // ============================================================

    function encodeFilePath(filePath) {
        return filePath.split('/').map(encodeURIComponent).join('/');
    }

    const ObsidianAPI = {
        request(endpoint, options = {}) {
            return new Promise((resolve, reject) => {
                const url = Config.getApiUrl().replace(/\/+$/, '') + endpoint;
                const apiKey = Config.getApiKey();

                log('API请求:', options.method || 'GET', url);

                GM_xmlhttpRequest({
                    method: options.method || 'GET',
                    url: url,
                    headers: Object.assign(
                        { 'Authorization': 'Bearer ' + apiKey },
                        options.headers || {}
                    ),
                    data: options.data || undefined,
                    onload: function (resp) {
                        log('API响应:', resp.status, 'content-type:', resp.responseHeaders);
                        if (resp.status >= 200 && resp.status < 300) {
                            log('API返回长度:', (resp.responseText || '').length, '前200字符:', (resp.responseText || '').substring(0, 200));
                            resolve(resp.responseText);
                        } else {
                            logWarn('API非2xx:', resp.status, resp.responseText ? resp.responseText.substring(0, 200) : '');
                            reject(new Error('HTTP ' + resp.status + ': ' + resp.responseText));
                        }
                    },
                    onerror: function () {
                        logWarn('API网络错误');
                        reject(new Error('无法连接到 Obsidian。请确保 Obsidian 已启动且 REST API 插件已启用'));
                    },
                    ontimeout: function () {
                        logWarn('API超时');
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
            const encodedPath = encodeFilePath(path);
            log('listVault 被调用, path:', JSON.stringify(path), 'encoded:', encodedPath);
            const resp = await this.request('/vault/' + encodedPath);
            log('listVault 原始响应类型:', typeof resp, '长度:', resp ? resp.length : 0);
            log('listVault 原始响应前500字符:', resp ? resp.substring(0, 500) : '(null/empty)');

            if (resp && (resp.trim().startsWith('{') || resp.trim().startsWith('['))) {
                try {
                    const parsed = JSON.parse(resp);
                    log('listVault JSON解析成功, keys:', Object.keys(parsed));
                    if (parsed && parsed.files && Array.isArray(parsed.files)) {
                        log('listVault 命中 {files: [...]} 格式, 文件数:', parsed.files.length);
                        log('listVault 首个文件对象:', JSON.stringify(parsed.files[0]));
                        return parsed.files;
                    }
                    if (Array.isArray(parsed)) {
                        log('listVault 命中数组格式, 长度:', parsed.length);
                        return parsed;
                    }
                    logWarn('listVault JSON已解析但格式不匹配, parsed类型:', typeof parsed);
                    return [];
                } catch (e) {
                    logWarn('listVault JSON解析失败:', e.message);
                    return [];
                }
            }
            if (resp && resp.trim()) {
                log('listVault 回退到文本分割模式');
                return resp.trim().split('\n').filter(Boolean).map(function(name) {
                    return { name: name, path: name };
                });
            }
            log('listVault 返回空数组');
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
                log('appendToFile: 文件不存在，将创建新文件:', filePath);
            }
            return await this.writeFile(filePath, existing + '\n' + appendContent);
        },

        async fileExists(filePath) {
            try {
                await this.request('/vault/' + encodeFilePath(filePath), { method: 'HEAD' });
                return true;
            } catch (e) {
                return false;
            }
        },

        async findNoteBySourceURL(folderName, sourceUrl) {
            log('findNoteBySourceURL 开始: folderName=', JSON.stringify(folderName), 'sourceUrl=', sourceUrl);
            try {
                const entries = await this.listVault(folderName);
                log('findNoteBySourceURL: listVault返回类型:', typeof entries, 'isArray:', Array.isArray(entries), '长度:', entries ? entries.length : 'null');
                if (!Array.isArray(entries)) {
                    logWarn('findNoteBySourceURL: entries不是数组，返回null');
                    return null;
                }

                const mdFiles = entries.filter(e => {
                    const name = (e.name || e.path || '').toLowerCase();
                    return name.endsWith('.md');
                });
                log('findNoteBySourceURL: 过滤后.md文件数:', mdFiles.length);

                const checkFiles = mdFiles.slice(0, 50);
                log('findNoteBySourceURL: 将检查', checkFiles.length, '个文件');

                for (const f of checkFiles) {
                    const name = f.name || f.path || '';
                    const filePath = folderName + '/' + name;
                    log('findNoteBySourceURL: 正在检查文件:', filePath);
                    try {
                        const content = await this.readFile(filePath);
                        const fmSourceUrl = getFrontmatterValue(content, 'source_url');
                        log('  frontmatter source_url:', fmSourceUrl, '目标 sourceUrl:', sourceUrl, '匹配:', fmSourceUrl === sourceUrl);
                        if (fmSourceUrl === sourceUrl) {
                            log('findNoteBySourceURL: 找到匹配文件!', filePath);
                            return filePath;
                        }
                    } catch (e) {
                        log('  读取文件失败:', e.message);
                        continue;
                    }
                }
                log('findNoteBySourceURL: 未找到匹配文件');
            } catch (e) {
                logWarn('findNoteBySourceURL 异常:', e.message);
                return null;
            }
            return null;
        },
    };

    // ============================================================
    // 第五部分：媒体工具
    // ============================================================

    const VideoUtils = {
        getVideo() {
            return document.querySelector('video') || null;
        },

        getCurrentTime() {
            const v = this.getVideo();
            return v ? v.currentTime : 0;
        },

        seekTo(seconds) {
            const v = this.getVideo();
            if (v) v.currentTime = seconds;
        },

        play() {
            const v = this.getVideo();
            if (v) v.play();
        },

        pause() {
            const v = this.getVideo();
            if (v) v.pause();
        },

        togglePlay() {
            const v = this.getVideo();
            if (v) { v.paused ? v.play() : v.pause(); }
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
                sourceUrl: cleanUrl,
                currentTimeSeconds: currentTimeSeconds,
                currentTime: formatTime(currentTimeSeconds),
                source: window.location.hostname.replace('www.', ''),
                timestamp: new Date().toISOString(),
            };
        },
    };

    // ============================================================
    // 第七部分：笔记模板
    // ============================================================

    const NoteTemplate = {
        buildFrontmatter(meta, editCount) {
            if (editCount === undefined) editCount = 1;
            const now = new Date();
            const created = now.toISOString().replace('T', ' ').substring(0, 19);
            const dateStr = now.toISOString().substring(0, 10);
            const timeStr = now.toLocaleString('zh-CN', { hour12: false });

            return [
                '---',
                'title: "' + meta.videoTitle + '"',
                'source: ' + meta.source,
                'source_url: ' + meta.sourceUrl,
                'created: ' + created,
                'updated: ' + timeStr,
                'edit_count: ' + editCount,
                'tags:',
                '  - video-note',
                '  - ' + meta.source,
                '---',
                '',
            ].join('\n');
        },

        buildHeader(meta) {
            return this.buildFrontmatter(meta, 1) + '# ' + meta.videoTitle + '\n\n';
        },

        buildScreenshotBlock(dataURL, meta) {
            let md = '### ⏱ ' + meta.currentTime + '\n\n';
            md += '<img src="' + dataURL + '" width="400" alt="' + meta.currentTime + '" />\n\n';
            md += '> 📌 [跳转到视频 ' + meta.currentTime + '](' + PageMeta.getTimestampedURL(meta.currentTimeSeconds) + ')\n\n';
            md += '---\n\n';
            return md;
        },
    };

    // ============================================================
    // 第八部分：笔记管理器（带诊断日志）
    // ============================================================

    const NoteManager = {
        async getOrCreateNote() {
            log('========== getOrCreateNote 开始 ==========');
            const meta = PageMeta.collect();
            if (!meta) throw new Error('无法获取页面信息');

            const sourceUrl = meta.sourceUrl;
            const folderName = Config.getFolderName();
            log('sourceUrl:', sourceUrl);
            log('folderName:', folderName);
            log('videoTitle:', meta.videoTitle);

            // Step 1: 检查索引
            const indexEntry = Config.getNoteForSourceURL(sourceUrl);
            log('Step 1 - 索引结果:', indexEntry ? JSON.stringify(indexEntry) : 'null');

            // Step 2: 验证索引路径
            if (indexEntry) {
                log('Step 2 - 验证索引路径:', indexEntry.filePath);
                try {
                    const exists = await ObsidianAPI.fileExists(indexEntry.filePath);
                    log('Step 2 - fileExists:', exists);
                    if (exists) {
                        log('Step 2 - 文件存在，直接使用');
                        return { filePath: indexEntry.filePath, isNew: false, meta: meta };
                    }
                } catch (e) {
                    log('Step 2 - 检查异常:', e.message);
                }
                log('Step 2 - 索引文件已失效，进入搜索');
            }

            // Step 3: 搜索 Vault
            log('Step 3 - 开始搜索 Vault');
            const foundPath = await ObsidianAPI.findNoteBySourceURL(folderName, sourceUrl);
            log('Step 3 - 搜索结果:', foundPath);
            if (foundPath) {
                log('Step 3 - 找到文件，更新索引');
                Config.setNoteForSourceURL(sourceUrl, foundPath, meta.videoTitle);
                return { filePath: foundPath, isNew: false, meta: meta };
            }

            // Step 4: 标题匹配兜底
            log('Step 4 - 标题匹配兜底');
            const titlePath = folderName + '/' + meta.videoTitle + '.md';
            try {
                const exists = await ObsidianAPI.fileExists(titlePath);
                log('Step 4 - 标题路径是否存在:', titlePath, exists);
                if (exists) {
                    const existingContent = await ObsidianAPI.readFile(titlePath);
                    if (!getFrontmatterValue(existingContent, 'source_url')) {
                        const fm = NoteTemplate.buildFrontmatter(meta, 1);
                        const newContent = fm + existingContent.replace(/^---[\s\S]*?---\s*\n?/, '');
                        await ObsidianAPI.writeFile(titlePath, newContent);
                    }
                    Config.setNoteForSourceURL(sourceUrl, titlePath, meta.videoTitle);
                    return { filePath: titlePath, isNew: false, meta: meta };
                }
            } catch (e) {
                log('Step 4 - 标题路径不存在或出错:', e.message);
            }

            // Step 5: 创建新文件
            log('Step 5 - 创建新文件');
            const filePath = folderName + '/' + meta.videoTitle + '.md';
            const header = NoteTemplate.buildHeader(meta);
            await ObsidianAPI.writeFile(filePath, header);
            Config.setNoteForSourceURL(sourceUrl, filePath, meta.videoTitle);
            log('========== getOrCreateNote 结束: 新建文件 ' + filePath + ' ==========');
            return { filePath: filePath, isNew: true, meta: meta };
        },

        async appendScreenshot(result) {
            const { filePath, meta } = result;
            const dataURL = VideoUtils.capture();
            if (!dataURL) throw new Error('截图失败');

            const block = NoteTemplate.buildScreenshotBlock(dataURL, meta);

            // 更新 edit_count
            try {
                const content = await ObsidianAPI.readFile(filePath);
                const currentCount = parseInt(getFrontmatterValue(content, 'edit_count') || '0', 10);
                const newContent = setFrontmatterValue(content, 'edit_count', String(currentCount + 1));
                const now = new Date().toLocaleString('zh-CN', { hour12: false });
                const updatedContent = setFrontmatterValue(newContent, 'updated', now);
                await ObsidianAPI.writeFile(filePath, updatedContent);
            } catch (e) {
                logWarn('更新 frontmatter 失败:', e.message);
            }

            await ObsidianAPI.appendToFile(filePath, block);
            return filePath;
        },
    };

    // ============================================================
    // 第九部分：UI 与通知
    // ============================================================

    const UI = {
        showNotification(message, type = 'success', duration = 3000) {
            const existing = document.querySelector('.vso-notification');
            if (existing) existing.remove();

            const bgColors = { success: '#4caf50', error: '#f44336', info: '#2196f3', warn: '#ff9800' };
            const notif = createEl('div', {
                className: 'vso-notification',
                style: {
                    position: 'fixed', top: '20px', right: '20px', zIndex: '2147483647',
                    padding: '12px 20px', borderRadius: '8px', color: '#fff',
                    backgroundColor: bgColors[type] || bgColors.info,
                    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
                    fontSize: '14px', fontWeight: '500',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
                    transition: 'opacity 0.3s', opacity: '1',
                    maxWidth: '400px', wordBreak: 'break-word',
                },
            });
            notif.textContent = message;
            document.body.appendChild(notif);

            setTimeout(() => {
                notif.style.opacity = '0';
                setTimeout(() => notif.remove(), 300);
            }, duration);
        },
    };

    // ============================================================
    // 第十部分：主流程
    // ============================================================

    async function takeScreenshot() {
        try {
            if (!Config.isConfigured()) {
                UI.showNotification('请先在 Tampermonkey 菜单中配置 Obsidian API', 'error', 5000);
                return;
            }

            UI.showNotification('正在截图并保存...', 'info', 2000);

            const result = await NoteManager.getOrCreateNote();
            const filePath = await NoteManager.appendScreenshot(result);

            const statusText = result.isNew ? '创建新笔记' : '追加到笔记';
            UI.showNotification(statusText + ': ' + filePath.replace(/\\/g, '/'), 'success', 4000);
        } catch (e) {
            console.error('[视频截图笔记] 错误:', e);
            UI.showNotification('错误: ' + e.message, 'error', 5000);
        }
    }

    function registerHotkeys() {
        document.addEventListener('keydown', function (e) {
            if (e.ctrlKey && e.shiftKey && e.key === 'S') {
                e.preventDefault();
                takeScreenshot();
            }
        });
    }

    // 注册菜单
    GM_registerMenuCommand('截图并保存到 Obsidian (Ctrl+Shift+S)', takeScreenshot);
    GM_registerMenuCommand('⚙ 设置 Obsidian API', function () {
        const apiUrl = prompt('Obsidian REST API URL:', Config.getApiUrl());
        if (apiUrl !== null) Config.set('API_URL', apiUrl);

        const apiKey = prompt('API Key:', Config.getApiKey());
        if (apiKey !== null) Config.set('API_KEY', apiKey);

        const folderName = prompt('笔记文件夹名称:', Config.getFolderName());
        if (folderName !== null) Config.set('FOLDER_NAME', folderName);

        UI.showNotification('配置已保存', 'success');
    });
    GM_registerMenuCommand('🗑 清空笔记索引', function () {
        if (confirm('确定要清空笔记索引吗？下次截图将重新搜索匹配。')) {
            GM_deleteValue(CONFIG_KEYS.NOTE_INDEX);
            UI.showNotification('索引已清空', 'info');
        }
    });
    GM_registerMenuCommand('📋 查看笔记索引', function () {
        const index = Config._getIndex();
        const keys = Object.keys(index);
        if (keys.length === 0) {
            alert('笔记索引为空');
        } else {
            const lines = keys.map(k => {
                const entry = index[k];
                return '• ' + (entry.title || '(无标题)') + '\n  路径: ' + (entry.filePath || '(空)') + '\n  URL: ' + k.substring(0, 60) + '...';
            });
            alert('笔记索引 (' + keys.length + ' 条):\n\n' + lines.join('\n\n'));
        }
    });

    registerHotkeys();
    log('诊断版脚本已加载, v' + SCRIPT_VERSION);
})();
