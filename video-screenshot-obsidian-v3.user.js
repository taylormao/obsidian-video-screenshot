// ==UserScript==
// @name         截图笔记助手 - Obsidian（模板版）
// @namespace    https://github.com/taylormao/video-screenshot-obsidian
// @version      3.0.2
// @description  多模板笔记助手：视频笔记 / 读书笔记 / 资源笔记，支持 Obsidian 自定义模板
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
    // 第一部分：常量与配置键
    // ============================================================

    const SCRIPT_PREFIX = 'sno-';
    const SCRIPT_VERSION = '3.0.0';

    const CONFIG_KEYS = {
        API_URL: 'obsidian_api_url',
        API_KEY: 'obsidian_api_key',
        NOTE_INDEX: 'obsidian_note_index_v3',
        CURRENT_TEMPLATE: 'current_template_type',
    };

    const DEFAULTS = {
        API_URL: 'http://127.0.0.1:27124',
        API_KEY: '',
    };

    // ============================================================
    // 第二部分：模板定义系统
    // ============================================================

    /**
     * 模板类型枚举
     * 每种类型对应不同的笔记结构、frontmatter 字段和 URL 匹配规则
     */
    const TEMPLATE_TYPES = {
        'video-note': {
            id: 'video-note',
            name: '视频笔记',
            icon: '📹',
            folder: '视频笔记',
            frontmatter: {
                static: {
                    type: 'video-note',
                },
                dynamic: {
                    title: { label: '标题', source: 'page.title' },
                    source_url: { label: '视频链接', source: 'page.cleanUrl' },
                    source_name: { label: '来源平台', source: 'page.source' },
                    video_timestamp: { label: '视频时长', source: 'page.videoDuration' },
                },
                auto: ['created', 'modified', 'date', 'edit_count'],
                defaults: {
                    summary: '""',
                    tags: '[视频笔记]',
                },
            },
            content: {
                header: [
                    '# {{title}}',
                    '',
                    '> **来源**: [{{source_name}}]({{page_url}})',
                    '> **创建时间**: {{created}}',
                    '',
                    '---',
                    '',
                    '## 📸 视频截图',
                    '',
                ],
                screenshot: [
                    '### ⏱ {{current_time}}',
                    '',
                    '<img src="{{dataURL}}" width="400" alt="{{current_time}}" />',
                    '',
                    '> 📌 [跳转到视频 {{current_time}}]({{timestamped_url}})',
                    '',
                    '---',
                    '',
                ],
            },
            /** URL 匹配规则 → 返回 true 表示该页面适用此模板 */
            urlMatcher(url) {
                const host = new URL(url).hostname;
                return host.includes('bilibili.com')
                    || host.includes('youtube.com')
                    || host.includes('douyin.com')
                    || /\.(youku|iqiyi|vimeo)\.com/.test(host);
            },
            /** 页面数据采集器 → 返回模板变量 */
            pageCollector() {
                return PageCollectors.videoPage();
            },
            /** 截图函数 */
            async capture() {
                return PageCollectors.captureVideoFrame();
            },
        },

        'reading-note': {
            id: 'reading-note',
            name: '读书笔记',
            icon: '📖',
            folder: '读书笔记',
            frontmatter: {
                static: {
                    type: 'reading-note',
                },
                dynamic: {
                    book_title: { label: '书名', source: 'page.bookTitle' },
                    author: { label: '作者', source: 'page.author' },
                    source_url: { label: '阅读链接', source: 'page.cleanUrl' },
                    source_name: { label: '阅读平台', source: 'page.source' },
                    reading_progress: { label: '阅读进度', source: 'page.progress' },
                },
                auto: ['created', 'modified', 'date', 'edit_count'],
                defaults: {
                    summary: '""',
                    tags: '[读书笔记]',
                },
            },
            content: {
                header: [
                    '# {{book_title}}',
                    '',
                    '> **作者**: {{author}}',
                    '> **来源**: [{{source_name}}]({{page_url}})',
                    '> **阅读进度**: {{reading_progress}}',
                    '> **创建时间**: {{created}}',
                    '',
                    '---',
                    '',
                    '## 📝 摘录与笔记',
                    '',
                    '> 💡 选中文本后按 `Ctrl+Shift+S` 摘录',
                    '',
                ],
                excerpt: [
                    '### 📌 {{chapter_title}}',
                    '',
                    '> {{excerpt_text}}',
                    '',
                    '> 🔗 [原文链接]({{excerpt_url}})',
                    '',
                    '**我的笔记**：',
                    '',
                    '',
                    '---',
                    '',
                ],
            },
            urlMatcher(url) {
                const host = new URL(url).hostname;
                return host.includes('weread.qq.com')
                    || host.includes('reader.qq.com')
                    || host.includes('zhihu.com/read');
            },
            pageCollector() {
                return PageCollectors.readingPage();
            },
            async capture() {
                return null; // 读书笔记不需要截图
            },
        },

        'resource-note': {
            id: 'resource-note',
            name: '资源笔记',
            icon: '📦',
            folder: '资源收集',
            frontmatter: {
                static: {
                    type: 'resource-note',
                },
                dynamic: {
                    title: { label: '资源名称', source: 'page.title' },
                    source_url: { label: '资源链接', source: 'page.cleanUrl' },
                    source_name: { label: '来源平台', source: 'page.source' },
                    resource_type: { label: '资源类型', source: 'page.resourceType' },
                },
                auto: ['created', 'modified', 'date', 'edit_count'],
                defaults: {
                    summary: '""',
                    tags: '[资源收集]',
                },
            },
            content: {
                header: [
                    '# {{title}}',
                    '',
                    '> **来源**: [{{source_name}}]({{page_url}})',
                    '> **资源类型**: {{resource_type}}',
                    '> **创建时间**: {{created}}',
                    '',
                    '---',
                    '',
                    '## 🔗 下载链接',
                    '',
                ],
                link_item: [
                    '- [ ] [{{link_name}}]({{link_url}}) {{link_extra}}',
                ],
            },
            urlMatcher(url) {
                const host = new URL(url).hostname;
                return host.includes('pan.baidu.com')
                    || host.includes('aliyundrive.com')
                    || host.includes('pan.quark.cn')
                    || host.includes('123pan.com')
                    || host.includes('lanzou')
                    || host.includes('github.com') && url.includes('/releases');
            },
            pageCollector() {
                return PageCollectors.resourcePage();
            },
            async capture() {
                return null;
            },
        },
    };

    // ============================================================
    // 第三部分：页面数据采集器
    // ============================================================

    const PageCollectors = {

        /** ---------- 视频页面 ---------- */

        videoPage() {
            const video = this._getVideo();
            const title = this._getVideoTitle();
            const source = window.location.hostname.replace('www.', '');
            const url = new URL(window.location.href);
            const cleanUrl = this._getCleanUrl(url);
            const duration = video ? formatTime(video.duration) : '';

            return {
                videoTitle: title.replace(/[\\/:*?"<>|]/g, '-'),
                pageURL: url.href,
                cleanUrl: cleanUrl,
                sourceUrl: cleanUrl,
                source: source,
                videoDuration: duration,
                currentTimeSeconds: video ? video.currentTime : null,
                currentTime: formatTime(video ? video.currentTime : null),
                timestamp: new Date().toISOString(),
            };
        },

        async captureVideoFrame() {
            const video = this._getVideo();
            if (!video) return null;
            try {
                const canvas = document.createElement('canvas');
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                canvas.getContext('2d').drawImage(video, 0, 0);
                return canvas.toDataURL('image/jpeg', 0.85);
            } catch (e) { return null; }
        },

        _getVideo() {
            if (window.location.hostname.includes('youtube.com')) {
                const mp = document.querySelector('#movie_player');
                if (mp) {
                    const v = mp.querySelector('video.html5-main-video') || mp.querySelector('video');
                    if (v && (v.videoWidth > 0 || v.readyState >= 2)) return v;
                }
            }
            const selectors = ['video.html5-main-video', 'video.bilibili-player-video', 'video.bpx-player-video', 'video'];
            for (const sel of selectors) {
                const v = document.querySelector(sel);
                if (v && v.videoWidth > 0) return v;
            }
            return document.querySelector('video');
        },

        _getVideoTitle() {
            const biliTitle = document.querySelector('.video-title .tit, .video-title .tit-text, .video-title .title');
            if (biliTitle) return biliTitle.textContent.trim();
            const ytSel = ['#title h1 yt-formatted-string', 'h1.ytd-watch-metadata yt-formatted-string'];
            for (const sel of ytSel) {
                const el = document.querySelector(sel);
                if (el && el.textContent.trim()) return el.textContent.trim();
            }
            let title = document.title || '未知视频';
            if (window.location.hostname.includes('youtube.com')) {
                title = title.replace(/\s*-\s*YouTube\s*$/i, '').trim();
            }
            return title;
        },

        _getCleanUrl(url) {
            const u = new URL(url.href);
            u.hash = '';
            if (u.hostname.includes('youtube.com') && u.pathname === '/watch') {
                const v = u.searchParams.get('v');
                u.search = '';
                if (v) u.searchParams.set('v', v);
                return u.href;
            }
            if (u.hostname.includes('bilibili.com')) {
                const p = u.searchParams.get('p');
                u.search = '';
                if (p && p !== '1') u.searchParams.set('p', p);
                return u.href;
            }
            u.search = '';
            return u.href;
        },

        /** ---------- 读书页面 ---------- */

        readingPage() {
            const source = window.location.hostname.replace('www.', '');
            return {
                bookTitle: this._getBookTitle(),
                author: this._getBookAuthor(),
                source: source,
                sourceUrl: window.location.href.split('?')[0].split('#')[0],
                cleanUrl: window.location.href.split('?')[0].split('#')[0],
                pageURL: window.location.href,
                progress: this._getReadingProgress(),
                chapterTitle: '',
                excerptText: this._getSelectedText(),
                excerptUrl: window.location.href,
                timestamp: new Date().toISOString(),
            };
        },

        _getBookTitle() {
            // 微信读书
            const wrTitle = document.querySelector('.readerTopBar_title, .readerBookInfo_name, .book_title');
            if (wrTitle) return wrTitle.textContent.trim();
            return document.title || '未命名书籍';
        },

        _getBookAuthor() {
            const wrAuthor = document.querySelector('.readerBookInfo_author, .book_author');
            if (wrAuthor) return wrAuthor.textContent.trim();
            return '';
        },

        _getReadingProgress() {
            const wrProgress = document.querySelector('.readerFooter_progress, .reader_progress_bar_text');
            if (wrProgress) return wrProgress.textContent.trim();
            return '';
        },

        _getSelectedText() {
            const sel = window.getSelection();
            return sel ? sel.toString().trim() : '';
        },

        /** ---------- 资源页面 ---------- */

        resourcePage() {
            const source = window.location.hostname.replace('www.', '');
            return {
                title: document.title || '未命名资源',
                source: source,
                sourceUrl: window.location.href.split('?')[0].split('#')[0],
                cleanUrl: window.location.href.split('?')[0].split('#')[0],
                pageURL: window.location.href,
                resourceType: guessResourceType(),
                timestamp: new Date().toISOString(),
            };
        },
    };

    function guessResourceType() {
        const url = window.location.href;
        if (/pan\.baidu\.com/.test(url)) return '百度网盘';
        if (/aliyundrive/.test(url)) return '阿里云盘';
        if (/pan\.quark\.cn/.test(url)) return '夸克网盘';
        if (/123pan\.com/.test(url)) return '123云盘';
        if (/lanzou/.test(url)) return '蓝奏云';
        if (/github\.com.*\/releases/.test(url)) return 'GitHub Release';
        return '其他资源';
    }

    // ============================================================
    // 第四部分：模板管理器
    // ============================================================

    const TemplateManager = {
        /**
         * 根据当前 URL 自动匹配模板类型
         * 遍历所有模板，返回第一个匹配的
         */
        detectType() {
            const url = window.location.href;
            for (const [typeId, template] of Object.entries(TEMPLATE_TYPES)) {
                if (template.urlMatcher(url)) {
                    return typeId;
                }
            }
            // 兜底：如果有视频则用视频模板，否则返回 null
            const video = document.querySelector('video');
            return video ? 'video-note' : null;
        },

        /** 获取指定类型的模板定义 */
        getTemplate(typeId) {
            return TEMPLATE_TYPES[typeId] || null;
        },

        /** 获取当前页面适用的模板 */
        getCurrentTemplate() {
            return this.getTemplate(this.detectType());
        },

        /**
         * 🔮 预留接口：从 Obsidian 读取自定义模板
         *
         * Obsidian 中模板文件路径约定：
         *   Vault/.obsidian/templates/video-note-template.md
         *   Vault/.obsidian/templates/reading-note-template.md
         *   Vault/.obsidian/templates/resource-note-template.md
         *
         * 模板文件中用 {{field_name}} 占位符，脚本自动替换
         */
        async loadObsidianTemplate(typeId) {
            const templatePath = '.obsidian/templates/' + typeId + '-template.md';
            try {
                const content = await ObsidianAPI.readFile(templatePath);
                return content;
            } catch (e) {
                // 没有自定义模板，使用内置默认
                return null;
            }
        },

        /**
         * 根据模板渲染 frontmatter
         *
         * @param {string} typeId 模板类型
         * @param {object} pageData 页面采集的数据
         * @param {object} overrides 覆盖值（如 edit_count）
         */
        buildFrontmatter(typeId, pageData, overrides = {}) {
            const tmpl = this.getTemplate(typeId);
            if (!tmpl) return '';

            const fm = tmpl.frontmatter;
            const now = new Date();
            const created = overrides.created || now.toISOString().replace('T', ' ').substring(0, 19);
            const dateStr = now.toISOString().substring(0, 10);

            let lines = ['---'];
            // 静态字段
            for (const [key, value] of Object.entries(fm.static)) {
                lines.push(key + ': ' + value);
            }
            // 动态字段
            for (const [key, def] of Object.entries(fm.dynamic)) {
                const val = this._resolveSource(pageData, def.source);
                lines.push(key + ': "' + (val || '').replace(/"/g, '\\"') + '"');
            }
            // 自动字段
            if (fm.auto.includes('created')) lines.push('created: ' + created);
            if (fm.auto.includes('modified')) lines.push('modified: ' + created);
            if (fm.auto.includes('date')) lines.push('date: ' + dateStr);
            if (fm.auto.includes('edit_count')) {
                lines.push('edit_count: ' + (overrides.edit_count || 1));
            }
            // 默认值字段
            for (const [key, value] of Object.entries(fm.defaults)) {
                lines.push(key + ': ' + value);
            }
            lines.push('---');
            lines.push('');
            return lines.join('\n');
        },

        /**
         * 根据模板渲染正文内容块
         *
         * @param {string} typeId 模板类型
         * @param {string} blockType 'header' | 'screenshot' | 'excerpt' | 'link_item'
         * @param {object} variables 变量值
         */
        buildContentBlock(typeId, blockType, variables = {}) {
            const tmpl = this.getTemplate(typeId);
            if (!tmpl) return '';
            const block = tmpl.content[blockType];
            if (!block) return '';

            return block.map(line => this._renderTemplate(line, variables)).join('\n');
        },

        /** 从 pageData 中按 source 路径解析值 */
        _resolveSource(pageData, source) {
            if (!source || !source.startsWith('page.')) return '';
            const keys = source.split('.');
            let val = pageData;
            for (const k of keys.slice(1)) {
                if (val == null) return '';
                val = val[k];
            }
            return val ?? '';
        },

        /** 简单模板渲染：{{key}} → 变量值 */
        _renderTemplate(template, variables) {
            return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
                return variables[key] !== undefined ? String(variables[key]) : '';
            });
        },
    };

    // ============================================================
    // 第五部分：工具函数
    // ============================================================

    function formatTime(seconds) {
        if (seconds == null || isNaN(seconds)) return '00:00:00';
        const s = Math.floor(seconds);
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = s % 60;
        return [h, m, sec].map(v => String(v).padStart(2, '0')).join(':');
    }

    function createEl(tag, attrs = {}, children = []) {
        const el = document.createElement(tag);
        for (const [key, value] of Object.entries(attrs)) {
            if (value === undefined || value === null) continue;
            if (key === 'className') el.className = value;
            else if (key === 'textContent') el.textContent = value;
            else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
            else el.setAttribute(key, value);
        }
        for (const child of children) {
            if (child == null) continue;
            if (typeof child === 'string' || typeof child === 'number') {
                el.appendChild(document.createTextNode(String(child)));
            } else if (Array.isArray(child)) {
                child.forEach(c => el.appendChild(c));
            } else el.appendChild(child);
        }
        return el;
    }

    function getFrontmatterValue(content, key) {
        const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
        if (!match) return null;
        const km = match[1].match(new RegExp('^' + key + ':\\s*(.+)$', 'm'));
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
        const keyRegex = new RegExp('^' + key + ':.*$', 'm');
        if (fm.match(keyRegex)) {
            return content.replace(fm, fm.replace(keyRegex, key + ': ' + value));
        }
        return content.replace(fm, fm + '\n' + key + ': ' + value);
    }

    // ============================================================
    // 第六部分：配置管理
    // ============================================================

    const Config = {
        get(key) { return GM_getValue(CONFIG_KEYS[key], DEFAULTS[key] || ''); },
        set(key, value) { GM_setValue(CONFIG_KEYS[key], value); },
        getApiUrl() { return this.get('API_URL'); },
        getApiKey() { return this.get('API_KEY'); },
        isConfigured() { return !!(this.getApiUrl() && this.getApiKey()); },

        _getIndex() { return GM_getValue(CONFIG_KEYS.NOTE_INDEX, {}); },
        _setIndex(idx) { GM_setValue(CONFIG_KEYS.NOTE_INDEX, idx); },

        getNoteForSourceURL(url) {
            const idx = this._getIndex();
            return idx[url] || null;
        },

        setNoteForSourceURL(url, filePath, title, templateType) {
            const idx = this._getIndex();
            idx[url] = { filePath, title, templateType, updatedAt: new Date().toISOString() };
            this._setIndex(idx);
        },
    };

    // ============================================================
    // 第七部分：Obsidian REST API
    // ============================================================

    function encodeFilePath(p) { return p.split('/').map(encodeURIComponent).join('/'); }

    const ObsidianAPI = {
        request(endpoint, options = {}) {
            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: options.method || 'GET',
                    url: Config.getApiUrl().replace(/\/+$/, '') + endpoint,
                    headers: Object.assign(
                        { 'Authorization': 'Bearer ' + Config.getApiKey() },
                        options.headers || {}
                    ),
                    data: options.data || undefined,
                    onload(resp) {
                        if (resp.status >= 200 && resp.status < 300) resolve(resp.responseText);
                        else reject(new Error('HTTP ' + resp.status));
                    },
                    onerror() { reject(new Error('无法连接 Obsidian')); },
                    ontimeout() { reject(new Error('连接超时')); },
                    timeout: 10000,
                });
            });
        },

        async listVault(path = '') {
            const resp = await this.request('/vault/' + encodeFilePath(path));
            if (resp && (resp.trim().startsWith('{') || resp.trim().startsWith('['))) {
                try {
                    const parsed = JSON.parse(resp);
                    if (parsed && parsed.files && Array.isArray(parsed.files)) {
                        return parsed.files;
                    }
                    if (Array.isArray(parsed)) {
                        return parsed;
                    }
                    return [];
                } catch (e) { return []; }
            }
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
                method: 'PUT', headers: { 'Content-Type': 'text/markdown' }, data: content,
            });
        },

        async fileExists(filePath) {
            try {
                await this.request('/vault/' + encodeFilePath(filePath), { method: 'HEAD' });
                return true;
            } catch (e) { return false; }
        },

        /**
         * 🔑 在目录中搜索含有指定 source_url 的笔记
         */
        async findNoteBySourceURL(folderName, sourceUrl) {
            try {
                const entries = await this.listVault(folderName);
                if (!Array.isArray(entries)) return null;
                const getName = x => (typeof x === 'string') ? x : (x.name || x.path || '');
                const mdFiles = entries.filter(e => getName(e).toLowerCase().endsWith('.md')).slice(0, 50);
                for (const f of mdFiles) {
                    const fp = folderName + '/' + getName(f);
                    try {
                        const content = await this.readFile(fp);
                        if (getFrontmatterValue(content, 'source_url') === sourceUrl) return fp;
                    } catch (e) { continue; }
                }
                return null;
            } catch (e) { return null; }
        },

        async testConnection() {
            const resp = await this.request('/');
            try { return JSON.parse(resp); } catch (e) { return { ok: true }; }
        },
    };

    // ============================================================
    // 第八部分：笔记管理器
    // ============================================================

    const NoteManager = {
        async getOrCreateNote(typeOverride) {
            const typeId = typeOverride || TemplateManager.detectType();
            if (!typeId) throw new Error('当前页面未匹配任何模板类型');

            const tmpl = TemplateManager.getTemplate(typeId);
            const pageData = tmpl.pageCollector();

            const sourceUrl = pageData.sourceUrl || pageData.cleanUrl;
            const folderName = tmpl.folder;

            // Step 1: 检查索引
            let indexEntry = Config.getNoteForSourceURL(sourceUrl);
            if (indexEntry) {
                try {
                    await ObsidianAPI.request('/vault/' + encodeFilePath(indexEntry.filePath), { method: 'HEAD' });
                    return { filePath: indexEntry.filePath, isNew: false, pageData, templateType: typeId };
                } catch (e) { /* 文件改名，继续搜索 */ }
            }

            // Step 2: 在 Vault 中搜索
            const foundPath = await ObsidianAPI.findNoteBySourceURL(folderName, sourceUrl);
            if (foundPath) {
                Config.setNoteForSourceURL(sourceUrl, foundPath, pageData.videoTitle || pageData.bookTitle || pageData.title, typeId);
                return { filePath: foundPath, isNew: false, pageData, templateType: typeId };
            }

            // Step 3: 创建新笔记
            const noteName = (pageData.videoTitle || pageData.bookTitle || pageData.title || '未命名').replace(/[\\/:*?"<>|]/g, '-');
            const filePath = folderName + '/' + noteName + '.md';

            const frontmatter = TemplateManager.buildFrontmatter(typeId, pageData, { edit_count: 1 });
            const header = TemplateManager.buildContentBlock(typeId, 'header', {
                title: noteName,
                book_title: pageData.bookTitle || noteName,
                author: pageData.author || '',
                source_name: pageData.source || '',
                page_url: pageData.pageURL || '',
                sourceUrl: sourceUrl,
                reading_progress: pageData.progress || '',
                resource_type: pageData.resourceType || '',
                created: new Date().toLocaleString('zh-CN'),
            });

            await ObsidianAPI.writeFile(filePath, frontmatter + '\n' + header);
            Config.setNoteForSourceURL(sourceUrl, filePath, noteName, typeId);
            return { filePath, isNew: true, pageData, templateType: typeId };
        },

        async appendContent(filePath, pageData, typeId) {
            let content = '';
            try { content = await ObsidianAPI.readFile(filePath); } catch (e) {}

            const now = new Date();
            const modifiedStr = now.toISOString().replace('T', ' ').substring(0, 19);

            let editCount = 1;
            const ecStr = getFrontmatterValue(content, 'edit_count');
            if (ecStr) editCount = parseInt(ecStr) + 1;

            content = setFrontmatterValue(content, 'modified', modifiedStr);
            content = setFrontmatterValue(content, 'date', now.toISOString().substring(0, 10));
            content = setFrontmatterValue(content, 'edit_count', String(editCount));

            if (!content.endsWith('\n')) content += '\n';

            if (typeId === 'video-note') {
                const block = TemplateManager.buildContentBlock(typeId, 'screenshot', {
                    current_time: pageData.currentTime || '',
                    dataURL: pageData.dataURL || '',
                    timestamped_url: pageData.pageURL + '&t=' + Math.floor(pageData.currentTimeSeconds || 0),
                });
                content += '\n' + block;
            } else if (typeId === 'reading-note') {
                const block = TemplateManager.buildContentBlock(typeId, 'excerpt', {
                    chapter_title: pageData.chapterTitle || '',
                    excerpt_text: pageData.excerptText || '',
                    excerpt_url: pageData.excerptUrl || '',
                });
                content += '\n' + block;
            } else if (typeId === 'resource-note') {
                const block = TemplateManager.buildContentBlock(typeId, 'link_item', {
                    link_name: pageData.title || document.title,
                    link_url: pageData.pageURL || '',
                    link_extra: '',
                });
                content += block + '\n';
            }

            await ObsidianAPI.writeFile(filePath, content);
        },
    };

    // ============================================================
    // 第九部分：UI
    // ============================================================

    // ... (UI 代码与 v2.0 相同，仅调整了部分文案和按钮) ...

    GM_addStyle(`
        .${SCRIPT_PREFIX}floating-btn {position:fixed;bottom:20px;right:20px;z-index:2147483647;width:48px;height:48px;border:none;border-radius:50%;background:linear-gradient(135deg,#7c3aed,#a855f7);color:#fff;font-size:22px;cursor:pointer;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 16px rgba(124,58,237,0.4);transition:transform 0.2s,box-shadow 0.2s;user-select:none;}
        .${SCRIPT_PREFIX}floating-btn:hover {transform:scale(1.1);box-shadow:0 6px 24px rgba(124,58,237,0.6);}
        .${SCRIPT_PREFIX}menu {position:fixed;bottom:80px;right:20px;z-index:2147483647;background:#1e1e2e;border:1px solid #313244;border-radius:12px;padding:8px 0;min-width:280px;box-shadow:0 8px 32px rgba(0,0,0,0.4);display:none;user-select:none;}
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

    const UI = {
        floatingBtn: null,
        menu: null,
        modal: null,
        toastTimer: null,

        createFloatingButton() {
            if (this.floatingBtn) return;
            const tmpl = TemplateManager.detectType();
            const icon = tmpl ? TEMPLATE_TYPES[tmpl].icon : '📝';
            this.floatingBtn = createEl('button', {
                className: SCRIPT_PREFIX + 'floating-btn',
                textContent: icon,
                title: '截图笔记助手 v' + SCRIPT_VERSION,
            });
            this.floatingBtn.addEventListener('click', (e) => { e.stopPropagation(); this.toggleMenu(); });
            document.body.appendChild(this.floatingBtn);
            const badge = createEl('div', { className: SCRIPT_PREFIX + 'version-badge', textContent: 'v' + SCRIPT_VERSION });
            document.body.appendChild(badge);
            this.updateMenu();
        },

        toggleMenu() {
            if (this.menu && this.menu.classList.contains('show')) this.hideMenu();
            else this.showMenu();
        },

        showMenu() {
            if (!this.menu) { this.menu = createEl('div', { className: SCRIPT_PREFIX + 'menu' }); document.body.appendChild(this.menu); }
            this.updateMenu();
            this.menu.classList.add('show');
        },

        hideMenu() { if (this.menu) this.menu.classList.remove('show'); },

        updateMenu() {
            if (!this.menu) return;
            const configured = Config.isConfigured();
            const typeId = TemplateManager.detectType();
            const tmpl = typeId ? TemplateManager.getTemplate(typeId) : null;

            while (this.menu.firstChild) this.menu.removeChild(this.menu.firstChild);

            this.menu.appendChild(createEl('div', {
                className: SCRIPT_PREFIX + 'menu-status ' + (configured ? 'ok' : 'warn'),
                textContent: configured ? '✓ Obsidian 已连接' : '⚠ 请先配置 Obsidian',
            }));

            if (tmpl) {
                this.menu.appendChild(createEl('div', {
                    className: SCRIPT_PREFIX + 'menu-status ok',
                    textContent: tmpl.icon + ' 当前模板: ' + tmpl.name,
                }));
            } else {
                this.menu.appendChild(createEl('div', {
                    className: SCRIPT_PREFIX + 'menu-status warn',
                    textContent: '⚠ 未匹配到模板',
                }));
            }

            this.menu.appendChild(createEl('div', { className: SCRIPT_PREFIX + 'menu-divider' }));

            const captureBtn = createEl('button', {
                className: SCRIPT_PREFIX + 'menu-item',
                disabled: !configured || !tmpl ? '' : undefined,
                style: (!configured || !tmpl) ? { opacity: '0.5', cursor: 'not-allowed' } : undefined,
            }, [
                createEl('span', { className: 'icon', textContent: typeId === 'reading-note' ? '📝' : '📸' }),
                createEl('span', { textContent: typeId === 'reading-note' ? '摘录选中文本' : '截图并发送' }),
                createEl('span', { className: 'shortcut', textContent: 'Ctrl+Shift+S' }),
            ]);
            captureBtn.addEventListener('click', () => { this.hideMenu(); Core.captureAndSend(); });
            this.menu.appendChild(captureBtn);

            const createBtn = createEl('button', {
                className: SCRIPT_PREFIX + 'menu-item',
                disabled: !configured || !tmpl ? '' : undefined,
                style: (!configured || !tmpl) ? { opacity: '0.5', cursor: 'not-allowed' } : undefined,
            }, [
                createEl('span', { className: 'icon', textContent: '📄' }),
                createEl('span', { textContent: '创建新笔记' }),
            ]);
            createBtn.addEventListener('click', () => { this.hideMenu(); Core.createNote(); });
            this.menu.appendChild(createBtn);

            this.menu.appendChild(createEl('div', { className: SCRIPT_PREFIX + 'menu-divider' }));

            const settingsBtn = createEl('button', {
                className: SCRIPT_PREFIX + 'menu-item',
            }, [
                createEl('span', { className: 'icon', textContent: '⚙️' }),
                createEl('span', { textContent: '设置' }),
            ]);
            settingsBtn.addEventListener('click', () => { this.hideMenu(); UI.showSettings(); });
            this.menu.appendChild(settingsBtn);
        },

        showSettings() {
            if (this.modal) this.modal.remove();
            this.modal = createEl('div', { className: SCRIPT_PREFIX + 'modal-overlay' }, [
                createEl('div', { className: SCRIPT_PREFIX + 'modal' }, [
                    createEl('div', { className: SCRIPT_PREFIX + 'modal-header' }, [
                        createEl('h2', { textContent: '⚙️ 设置' }),
                        createEl('button', { className: SCRIPT_PREFIX + 'modal-close', textContent: '×' }),
                    ]),
                    createEl('div', { className: SCRIPT_PREFIX + 'modal-body' }, [
                        createEl('div', { className: SCRIPT_PREFIX + 'form-group' }, [
                            createEl('label', { textContent: 'REST API 地址' }),
                            createEl('input', { type: 'text', id: SCRIPT_PREFIX + 'api-url', value: Config.getApiUrl(), placeholder: 'http://127.0.0.1:27124' }),
                        ]),
                        createEl('div', { className: SCRIPT_PREFIX + 'form-group' }, [
                            createEl('label', { textContent: 'API Key' }),
                            createEl('input', { type: 'password', id: SCRIPT_PREFIX + 'api-key', value: Config.getApiKey(), placeholder: '输入 API Key' }),
                        ]),
                        createEl('button', { className: SCRIPT_PREFIX + 'btn ' + SCRIPT_PREFIX + 'btn-secondary', id: SCRIPT_PREFIX + 'test-btn', style: { width: '100%' }, textContent: '🔗 测试连接' }),
                        createEl('div', { className: SCRIPT_PREFIX + 'connection-status', id: SCRIPT_PREFIX + 'conn-status' }),
                        createEl('div', { className: SCRIPT_PREFIX + 'help-text' }, [
                            createEl('strong', { textContent: 'v' + SCRIPT_VERSION + ' 模板类型：' }),
                            createEl('br'),
                            '📹 视频笔记 - B站/YouTube 截图',
                            createEl('br'),
                            '📖 读书笔记 - 微信读书摘录',
                            createEl('br'),
                            '📦 资源笔记 - 网盘链接收集',
                            createEl('br'),
                            createEl('br'),
                            createEl('strong', { textContent: 'Obsidian 自定义模板：' }),
                            createEl('br'),
                            '将模板文件放入 .obsidian/templates/：',
                            createEl('br'),
                            '  video-note-template.md',
                            createEl('br'),
                            '  reading-note-template.md',
                            createEl('br'),
                            '  resource-note-template.md',
                            createEl('br'),
                            '模板中用 {{field}} 占位，脚本自动替换',
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

            const closeModal = () => { this.modal.remove(); this.modal = null; };
            this.modal.querySelector('.' + SCRIPT_PREFIX + 'modal-close').addEventListener('click', closeModal);
            this.modal.querySelector('#' + SCRIPT_PREFIX + 'cancel-btn').addEventListener('click', closeModal);
            this.modal.addEventListener('click', (e) => { if (e.target === this.modal) closeModal(); });
            this.modal.querySelector('#' + SCRIPT_PREFIX + 'test-btn').addEventListener('click', () => this.testConnection());
            this.modal.querySelector('#' + SCRIPT_PREFIX + 'save-btn').addEventListener('click', () => { this.saveSettings(); closeModal(); });
            if (Config.getApiKey()) this.testConnection();
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
                statusEl.textContent = '✓ 连接成功' + (info && info.name ? '（Vault: ' + info.name + '）' : '');
            } catch (e) {
                statusEl.className = SCRIPT_PREFIX + 'connection-status show error';
                statusEl.textContent = '✗ 连接失败: ' + e.message;
            }
        },

        saveSettings() {
            Config.set('API_URL', document.querySelector('#' + SCRIPT_PREFIX + 'api-url').value.trim());
            Config.set('API_KEY', document.querySelector('#' + SCRIPT_PREFIX + 'api-key').value.trim());
            this.showToast('设置已保存', 'success');
            this.updateMenu();
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
                overlay.querySelector('.' + SCRIPT_PREFIX + 'loading-text').textContent = text || '处理中...';
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
            if (!toast) { toast = createEl('div', { className: SCRIPT_PREFIX + 'toast' }); document.body.appendChild(toast); }
            toast.className = SCRIPT_PREFIX + 'toast ' + type;
            toast.textContent = msg;
            requestAnimationFrame(() => toast.classList.add('show'));
            this.toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
        },

        showFloatingButton() { if (this.floatingBtn) this.floatingBtn.style.display = 'flex'; },

        hideFloatingButton() { if (this.floatingBtn) { this.floatingBtn.style.display = 'none'; this.hideMenu(); } },
    };

    // ============================================================
    // 第十部分：核心功能
    // ============================================================

    const Core = {
        async captureAndSend() {
            if (!Config.isConfigured()) { UI.showToast('请先配置', 'warning'); UI.showSettings(); return; }
            const typeId = TemplateManager.detectType();
            if (!typeId) { UI.showToast('当前页面未匹配任何模板', 'warning'); return; }

            UI.showLoading('正在采集数据...');
            try {
                const { filePath, isNew, pageData, templateType } = await NoteManager.getOrCreateNote();

                if (templateType === 'video-note') {
                    UI.showLoading('正在截图...');
                    const dataURL = await (TEMPLATE_TYPES[templateType].capture());
                    if (!dataURL) { UI.hideLoading(); UI.showToast('截图失败', 'error', 5000); return; }
                    pageData.dataURL = dataURL;
                }

                UI.showLoading('正在写入笔记...');
                await NoteManager.appendContent(filePath, pageData, templateType);

                UI.hideLoading();
                UI.showToast(isNew ? '✓ 笔记已创建' : '✓ 内容已追加', 'success');
            } catch (e) {
                UI.hideLoading();
                console.error(e);
                UI.showToast('失败: ' + e.message, 'error', 5000);
            }
        },

        async createNote() {
            if (!Config.isConfigured()) { UI.showToast('请先配置', 'warning'); UI.showSettings(); return; }
            UI.showLoading('正在创建...');
            try {
                const { filePath } = await NoteManager.getOrCreateNote();
                UI.hideLoading();
                UI.showToast('✓ 笔记已创建: ' + filePath, 'success', 5000);
            } catch (e) {
                UI.hideLoading();
                UI.showToast('失败: ' + e.message, 'error', 5000);
            }
        },
    };

    // ============================================================
    // 第十一部分：初始化
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

    function init() {
        console.log('[截图笔记助手] v' + SCRIPT_VERSION + ' 已加载 | 模板: ' + (TemplateManager.detectType() || '无'));

        GM_registerMenuCommand('⚙️ 设置', () => UI.showSettings());
        GM_registerMenuCommand('📸 采集并发送 (Ctrl+Shift+S)', () => Core.captureAndSend());
        GM_registerMenuCommand('📄 创建新笔记', () => Core.createNote());

        setupHotkeys();
        setTimeout(() => { UI.createFloatingButton(); UI.showFloatingButton(); }, 500);

        const observer = new MutationObserver(() => setTimeout(() => UI.createFloatingButton(), 300));
        observer.observe(document.documentElement, { childList: true, subtree: true });

        let lastURL = window.location.href;
        setInterval(() => {
            if (window.location.href !== lastURL) { lastURL = window.location.href; UI.createFloatingButton(); }
        }, 1000);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
