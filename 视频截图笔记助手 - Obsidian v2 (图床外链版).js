// ==UserScript==
// @name         视频截图笔记助手 - Obsidian v2 (图床外链版)
// @namespace    https://github.com/taylormao/video-screenshot-obsidian
// @version      2.3.0
// @description  截图上传到图床后把外链写入 Obsidian（任意网址视频捕获，图床地址与令牌可配置）
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
    const SCRIPT_VERSION = '2.3.0';

    const CONFIG_KEYS = {
        API_URL: 'obsidian_api_url',
        API_KEY: 'obsidian_api_key',
        FOLDER_NAME: 'obsidian_folder_name',
        NOTE_INDEX: 'obsidian_note_index_v4',  // v2: 用 source_url 做键
        IMG_BED_URL: 'obsidian_imgbed_url',
        IMG_BED_TOKEN: 'obsidian_imgbed_token',
    };

    // 密钥不再硬编码在公开仓库中，请在脚本设置面板填写
    const DEFAULTS = {
        API_URL: 'http://127.0.0.1:27123',
        API_KEY: '',
        FOLDER_NAME: '视频笔记',
        IMG_BED_URL: '',
        IMG_BED_TOKEN: '',
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

    // 【修改点】：新增将 base64 转换成 Blob 对象的工具函数，供 FormData 上传使用
    function dataURLtoBlob(dataurl) {
        let arr = dataurl.split(','), mime = arr[0].match(/:(.*?);/)[1],
            bstr = atob(arr[1]), n = bstr.length, u8arr = new Uint8Array(n);
        while (n--) {
            u8arr[n] = bstr.charCodeAt(n);
        }
        return new Blob([u8arr], { type: mime });
    }

    /** 兼容旧调用：source_url 现在一律返回当前页面完整 URL */
    function getCleanUrl() {
        return PageIdentity.currentUrl();
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

        getNoteByIdentity(key) {
            const index = this._getIndex();
            return index[key] || null;
        },

        setNoteByIdentity(key, filePath, title) {
            const index = this._getIndex();
            index[key] = {
                filePath: filePath,
                title: title,
                updatedAt: new Date().toISOString(),
            };
            this._setIndex(index);
        },
    };

    // ============================================================
    // 第三部分附加：Cloudflare 图床 API 封装
    // ============================================================

    const ImgBed = {
        /**
         * 上传图片到外部图床
         * @param {string} dataURL - 截图的 base64
         * @returns {Promise<string>} 返回图床的公网图片 URL
         */
        upload(dataURL) {
            return new Promise((resolve, reject) => {
                const endpoint = Config.get('IMG_BED_URL');
                if (!endpoint) { reject(new Error('请先在设置中填写图床上传接口 URL')); return; }
                const token = Config.get('IMG_BED_TOKEN');

                const blob = dataURLtoBlob(dataURL);
                const formData = new FormData();
                formData.append('file', blob, `video-screenshot-${Date.now()}.png`);

                GM_xmlhttpRequest({
                    method: 'POST',
                    url: endpoint,
                    headers: token ? { 'Authorization': 'Bearer ' + token } : {},
                    data: formData,
                    timeout: 30000,
                    onload: function (response) {
                        try {
                            const result = JSON.parse(response.responseText);
                            const item = Array.isArray(result) ? result[0] : (result.data || result);
                            let imgUrl = null;
                            if (typeof item === 'string') imgUrl = item;
                            else if (item && typeof item === 'object') imgUrl = item.publicUrl || item.src || item.url || item.link;
                            if (imgUrl) resolve(imgUrl);
                            else reject(new Error('图床返回的数据格式异常'));
                        } catch (e) {
                            reject(new Error('解析图床响应失败: ' + String(response.responseText).slice(0, 160)));
                        }
                    },
                    onerror: function (err) {
                        reject(new Error('请求图床网络错误'));
                    },
                    ontimeout: function () {
                        reject(new Error('图床上传超时'));
                    }
                });
            });
        }
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
            } catch (e) { }
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

        async findNoteByIdentity(folderName, sourceUrl, pageTitle) {
            try {
                const entries = await this.listVault(folderName);
                if (!Array.isArray(entries)) return null;

                const mdFiles = entries.filter(e => {
                    const name = (typeof e === 'string' ? e : (e.name || e.path || '')).toLowerCase();
                    return name.endsWith('.md');
                });

                const checkFiles = mdFiles.slice(0, 50);
                for (const f of checkFiles) {
                    const name = (typeof f === 'string') ? f : (f.name || f.path || '');
                    const filePath = folderName + '/' + name;
                    try {
                        const content = await this.readFile(filePath);
                        const fmSourceUrl = getFrontmatterValue(content, 'source_url');
                        const fmTitle = getFrontmatterValue(content, 'title');
                        if (PageIdentity.matches(fmSourceUrl, fmTitle, sourceUrl, pageTitle)) {
                            return filePath;
                        }
                    } catch (e) {
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

    // ============================================================
    // 通用视频探测与截图（v2.x / v3.x 共用实现 v1.0.0）
    //
    // 覆盖以下旧版失效场景：
    //   1. Shadow DOM 内的 <video>          → 递归遍历 shadowRoot
    //   2. 同源 iframe 内的 <video>         → 递归遍历 contentDocument
    //   3. 跨域 iframe 播放器               → postMessage 让 iframe 内的脚本实例代截
    //   4. 播放器延迟插入 / SPA 切换         → MutationObserver + 轮询等待
    //   5. 页面多个 <video>（广告/预览）     → 按尺寸、播放状态、可见性打分择优
    //   6. 跨域视频污染 canvas              → 克隆带 crossOrigin 的 video 重载同一帧
    //   7. 未知视频站点                     → 播放器特征探测，不再依赖网址白名单
    //
    // 注意：脚本头部不要加 @noframes，iframe 内实例是跨域播放器的捕获端。
    // ============================================================
    // ============================================================
    // 页面身份判定（v2.3.0 / v3.2.0 共用实现 v1.0.0）
    //
    // 旧问题：source_url 会清掉查询参数，导致同路径下 viewkey / id 不同的
    //         两个页面被归为同一篇笔记，截图串到同一个 md 文件里。
    //
    // 新规则：
    //   1. source_url = 当前页面完整 URL（保留全部查询参数，仅去掉 # 锚点）
    //   2. frontmatter 的 title = 当前页面 <title> 内容
    //   3. 只有「归一 URL」与「规范化 title」两者都相同，才复用同一篇笔记
    //   4. 归一 URL 仅剔除纯跟踪/时间参数，内容参数一律保留并排序，
    //      因此「只多了 utm_* 的同一视频」仍能归到一篇笔记
    //   5. 旧笔记若没有 title 字段，退化为「完整 URL 精确相等」，避免误合并
    // ============================================================
    const PageIdentity = (function () {
        /** 与内容无关的参数：比对身份时剔除 */
        const TRACKING_PARAMS = [
            'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
            'spm', 'scm', 'from', 'ref', 'referer', 'referrer',
            'share_source', 'share_medium', 'share_plat', 'share_tag', 'share_session_id',
            'vd_source', 'bbid', 'buvid', 'unique_k', 'autoplay', 'player_rotate',
            'timestamp', 'ts', '_t', 't', 'time', 'callback', '_', 'random',
        ];

        function currentUrl(href) {
            try {
                const u = new URL(href || window.location.href);
                u.hash = '';
                return u.href;
            } catch (e) {
                return String(href || window.location.href || '').split('#')[0];
            }
        }

        function normalizeTitle(title) {
            return String(title == null ? '' : title).replace(/\s+/g, ' ').trim();
        }

        function currentTitle() {
            return normalizeTitle(document.title || '');
        }

        /** URL 归一化：剔除跟踪参数、参数按名排序，内容参数（含 viewkey）全部保留 */
        function normalizeUrl(url) {
            try {
                const u = new URL(String(url || '').trim());
                u.hash = '';
                const keep = [];
                u.searchParams.forEach((val, key) => {
                    if (TRACKING_PARAMS.indexOf(key.toLowerCase()) === -1) keep.push([key, val]);
                });
                keep.sort((a, b) => {
                    if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
                    if (a[1] !== b[1]) return a[1] < b[1] ? -1 : 1;
                    return 0;
                });
                u.search = '';
                for (const pair of keep) u.searchParams.append(pair[0], pair[1]);
                return u.href.replace(/\?$/, '');
            } catch (e) {
                return String(url || '').split('#')[0].trim();
            }
        }

        /** 身份键 = 归一 URL + 规范化 title */
        function makeKey(url, title) {
            return normalizeUrl(url) + '\n' + normalizeTitle(title);
        }

        function keyForCurrentPage() {
            return makeKey(currentUrl(), currentTitle());
        }

        /** 还原 yamlQuote 写入的转义，保证读回的 title 与 document.title 一致 */
        function unescapeYaml(value) {
            const s = String(value == null ? '' : value);
            let out = '';
            for (let i = 0; i < s.length; i++) {
                if (s[i] === '\\' && i + 1 < s.length && (s[i + 1] === '"' || s[i + 1] === '\\')) {
                    out += s[i + 1]; i++; continue;
                }
                out += s[i];
            }
            return out;
        }

        /** 用笔记 frontmatter 中的 source_url / title 与当前页面做双条件比对 */
        function matches(noteUrl, noteTitle, url, title) {
            const nu = unescapeYaml(String(noteUrl || '').trim());
            if (!nu) return false;
            const nt = normalizeTitle(unescapeYaml(noteTitle));
            if (!nt) {
                // 旧笔记缺 title：只在完整 URL 精确相等时复用，避免误合并
                return nu === String(url || '').trim();
            }
            return makeKey(nu, nt) === makeKey(url, title);
        }

        /** YAML 双引号字符串转义，供 frontmatter 的 title / source_url 使用 */
        function yamlQuote(value) {
            return '"' + String(value == null ? '' : value)
                .replace(/\\/g, '\\\\')
                .replace(/"/g, '\\"')
                .replace(/\r/g, ' ')
                .replace(/\n/g, ' ') + '"';
        }

        return {
            TRACKING_PARAMS, currentUrl, currentTitle, normalizeTitle,
            normalizeUrl, makeKey, keyForCurrentPage, matches, yamlQuote,
        };
    })();

    const VideoProbe = (function () {
        const REQ = '__sno_probe_req__', RES = '__sno_probe_res__';
        const MAX_DEPTH = 5, MAX_NODES = 6000;
        const isTop = (() => { try { return window.top === window.self; } catch (e) { return false; } })();

        /** 递归收集当前文档、shadow roots、同源 iframe 中的所有 video */
        function walk(root, out, depth, st) {
            if (!root || depth > MAX_DEPTH || st.n > MAX_NODES) return;
            try { root.querySelectorAll('video').forEach(v => out.push({ el: v, depth: depth })); } catch (e) { return; }
            let nodes;
            try { nodes = root.querySelectorAll('*'); } catch (e) { return; }
            for (const el of nodes) {
                if (++st.n > MAX_NODES) break;
                if (el.shadowRoot) walk(el.shadowRoot, out, depth + 1, st);
                if (el.tagName === 'IFRAME') {
                    try {
                        if (el.contentDocument) walk(el.contentDocument, out, depth + 1, st);
                    } catch (e) { /* 跨域 iframe 交给 postMessage */ }
                }
            }
        }

        function collect() {
            const out = [];
            walk(document, out, 0, { n: 0 });
            return out;
        }

        /** 给候选视频打分，分数最高者最可能是主播放器 */
        function score(item) {
            const v = item.el, w = v.videoWidth || 0, h = v.videoHeight || 0;
            if (!w && !h && v.readyState < 2) return -Infinity;
            let s = Math.min(w * h / 1000, 4000);
            if (!w || !h) s -= 500;
            if (v.readyState >= 2) s += 300;
            if (v.readyState >= 3) s += 100;
            if (!v.paused && !v.ended) s += 400;
            if (v.currentTime > 0) s += 100;
            try {
                const view = v.ownerDocument.defaultView;
                const r = v.getBoundingClientRect(), cs = view.getComputedStyle(v);
                if (r.width > 0 && r.height > 0) s += 300;
                if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) s -= 800;
            } catch (e) { /* ignore */ }
            if (/html5-main-video|bpx-player|bilibili-player|vjs-tech|plyr|jw-video|dplayer|art-video|player-video|mplayer|prism-player/i.test(v.className || '')) s += 250;
            if (w && h && (w < 200 || h < 120)) s -= 600;
            return s - item.depth * 50;
        }

        function pick() {
            let best = null, top = -Infinity;
            for (const item of collect()) {
                const s = score(item);
                if (s > top) { top = s; best = item.el; }
            }
            return best;
        }

        /** 不依赖网址白名单：判断当前页面是否可能是视频播放页 */
        function looksLikeVideoPage() {
            if (collect().length) return true;
            for (const f of document.querySelectorAll('iframe')) {
                if (/player|embed|youtube|bilibili|vimeo|youku|iqiyi|douyin|video|live|m3u8|mp4/i.test((f.src || '') + ' ' + (f.id || '') + ' ' + (f.className || ''))) return true;
            }
            return !!document.querySelector('#movie_player, .bpx-player, .bilibili-player, .dplayer, .artplayer, .plyr, .video-js, .jwplayer, .prism-player, .txp_player, [data-player]');
        }

        function draw(v) {
            const c = document.createElement('canvas');
            c.width = v.videoWidth || v.clientWidth || 1280;
            c.height = v.videoHeight || v.clientHeight || 720;
            c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
            return c.toDataURL('image/jpeg', 0.85);
        }

        /** canvas 被跨域视频污染时的降级：克隆带 CORS 的 video 并 seek 到同一时间点 */
        function viaClone(v) {
            return new Promise((resolve) => {
                const src = v.currentSrc || v.src;
                if (!src || /^blob:/i.test(src)) { resolve(null); return; }
                const clone = document.createElement('video');
                let done = false, timer = null;
                const finish = (val) => {
                    if (done) return;
                    done = true;
                    clearTimeout(timer);
                    try { clone.removeAttribute('src'); clone.load(); } catch (e) { /* ignore */ }
                    resolve(val);
                };
                timer = setTimeout(() => finish(null), 3500);
                clone.crossOrigin = 'anonymous';
                clone.muted = true;
                clone.playsInline = true;
                clone.preload = 'auto';
                clone.addEventListener('error', () => finish(null));
                clone.addEventListener('loadeddata', () => {
                    const grab = () => { try { finish(draw(clone)); } catch (e) { finish(null); } };
                    clone.addEventListener('seeked', grab, { once: true });
                    try { clone.currentTime = v.currentTime || 0; } catch (e) { grab(); }
                    setTimeout(grab, 900);
                }, { once: true });
                clone.src = src;
                clone.load();
            });
        }

        async function snapshot(v) {
            if (!v) return null;
            try { return draw(v); } catch (e) {
                console.warn('[截图笔记] 直接绘制失败（canvas 被跨域污染），尝试 CORS 重载', e);
            }
            return await viaClone(v);
        }

        /** 等待视频出现（点击播放才插入 / SPA 路由切换） */
        function wait(ms) {
            return new Promise((resolve) => {
                const found = pick();
                if (found) { resolve(found); return; }
                let settled = false, obs = null, ticker = null, stop = null;
                const done = (val) => {
                    if (settled) return;
                    settled = true;
                    clearInterval(ticker); clearTimeout(stop);
                    if (obs) obs.disconnect();
                    resolve(val);
                };
                const check = () => { const v = pick(); if (v) done(v); };
                try {
                    obs = new MutationObserver(check);
                    obs.observe(document.documentElement || document, { childList: true, subtree: true });
                } catch (e) { /* ignore */ }
                ticker = setInterval(check, 250);
                stop = setTimeout(() => done(pick()), ms || 3000);
                check();
            });
        }

        /** 顶层向所有 iframe 广播截图请求，等待任一 iframe 实例回传画面 */
        function askFrames(timeout) {
            if (!isTop) return Promise.resolve(null);
            const frames = Array.from(document.querySelectorAll('iframe'));
            if (!frames.length) return Promise.resolve(null);
            const id = Date.now() + '-' + Math.random().toString(36).slice(2);
            return new Promise((resolve) => {
                let settled = false, timer = null;
                const finish = (val) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    window.removeEventListener('message', onMsg);
                    resolve(val);
                };
                const onMsg = (e) => {
                    const d = e.data;
                    if (d && d.__type === RES && d.id === id && d.dataURL) finish(d);
                };
                window.addEventListener('message', onMsg);
                timer = setTimeout(() => finish(null), timeout || 1800);
                frames.forEach(f => {
                    try { f.contentWindow.postMessage({ __type: REQ, id: id }, '*'); } catch (e) { /* ignore */ }
                });
            });
        }

        /**
         * 完整捕获流程：本地择优 → 跨域 iframe 兜底 → 全部失败返回 dataURL: null
         * 调用方应把「无画面」当作降级而非致命错误，仍写入时间戳笔记。
         */
        async function capture(opts) {
            const o = opts || {};
            const local = await wait(o.waitMs || 2500);
            const weak = local && ((local.videoWidth || 0) < 300 || (local.videoHeight || 0) < 180);
            if (weak) {
                const fr = await askFrames(o.frameMs || 1800);
                if (fr) return { dataURL: fr.dataURL, video: null, info: fr, source: 'iframe' };
            }
            if (local) {
                const dataURL = await snapshot(local);
                if (dataURL) return { dataURL: dataURL, video: local, info: null, source: 'local' };
            }
            const fr2 = await askFrames(o.frameMs || 1800);
            if (fr2) return { dataURL: fr2.dataURL, video: null, info: fr2, source: 'iframe' };
            return { dataURL: null, video: local, info: null, source: 'none' };
        }

        /** iframe 内的脚本实例只做捕获响应，不注入任何 UI */
        function startResponder() {
            if (isTop) return;
            window.addEventListener('message', async (e) => {
                const d = e.data;
                if (!d || d.__type !== REQ || !e.source) return;
                const v = await wait(1200);
                const dataURL = v ? await snapshot(v) : null;
                try {
                    e.source.postMessage({
                        __type: RES, id: d.id, dataURL: dataURL,
                        title: document.title,
                        currentTime: v ? v.currentTime : 0,
                        href: location.href,
                    }, '*');
                } catch (err) { /* ignore */ }
            });
        }

        startResponder();
        return { isTop, collect, pick, looksLikeVideoPage, snapshot, wait, capture };
    })();

    const VideoUtils = {
        getVideo() { return VideoProbe.pick(); },

        /** 不再依赖网址白名单，任意含视频/播放器的页面都允许触发 */
        hasVideo() { return VideoProbe.looksLikeVideoPage(); },

        getCurrentTime() {
            const v = VideoProbe.pick();
            return v ? v.currentTime : 0;
        },

        /** 异步捕获：本地择优 → iframe 兜底 → CORS 重载；失败返回 null 由调用方降级 */
        async capture() {
            const shot = await VideoProbe.capture();
            this._lastShot = shot;
            return shot.dataURL;
        },

        lastShot() { return this._lastShot || null; },
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
            const currentTimeSeconds = VideoUtils.getCurrentTime();
            const pageURL = this.getCurrentURL();
            const cleanUrl = PageIdentity.currentUrl();
            const videoTitle = this.getVideoTitle().replace(/[\\/:*?"<>|]/g, '-');

            return {
                videoTitle: videoTitle,
                pageTitle: PageIdentity.currentTitle(),
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

            return [
                '---',
                'title: ' + PageIdentity.yamlQuote(meta.pageTitle),
                'source_url: ' + PageIdentity.yamlQuote(meta.sourceUrl),
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

        buildHeader(meta) {
            let md = this.buildFrontmatter(meta, 1);
            md += '# ' + meta.videoTitle + '\n\n';
            md += '> **来源**: [' + meta.source + '](' + meta.pageURL + ')\n';
            md += '> **创建时间**: ' + new Date().toLocaleString('zh-CN') + '\n\n';
            md += '---\n\n';
            md += '## 📸 视频截图\n\n';
            return md;
        },

        /** 生成截图块：自动区分 base64 内嵌 / 图床外链 / 捕获失败 */
        buildScreenshotBlock(imageRef, meta) {
            let md = '### ⏱ ' + meta.currentTime + '\n\n';
            if (!imageRef) {
                md += '> ⚠️ 未能捕获画面（视频可能受跨域保护）\n\n';
            } else if (/^data:/.test(imageRef)) {
                md += '<img src="' + imageRef + '" width="400" alt="' + meta.currentTime + '" />\n\n';
            } else {
                md += '![' + meta.currentTime + '|400](' + imageRef + ')\n\n';
            }
            md += '> 📌 [跳转到视频 ' + meta.currentTime + '](' + PageMeta.getTimestampedURL(meta.currentTimeSeconds) + ')\n\n';
            md += '---\n\n';
            return md;
        },
    };

    // ============================================================
    // 第八部分：笔记管理器
    // ============================================================

    const NoteManager = {
        async getOrCreateNote() {
            const meta = PageMeta.collect();
            if (!meta) throw new Error('无法获取页面信息');

            const sourceUrl = meta.sourceUrl;
            const pageTitle = meta.pageTitle;
            const identityKey = PageIdentity.makeKey(sourceUrl, pageTitle);
            const folderName = Config.getFolderName();

            let indexEntry = Config.getNoteByIdentity(identityKey);

            if (indexEntry) {
                try {
                    await ObsidianAPI.request('/vault/' + encodeFilePath(indexEntry.filePath), { method: 'HEAD' });
                    return { filePath: indexEntry.filePath, isNew: false, meta: meta };
                } catch (e) {
                    console.log('[视频截图笔记] 索引文件已失效，搜索 Vault 中...');
                }
            }

            const foundPath = await ObsidianAPI.findNoteByIdentity(folderName, sourceUrl, pageTitle);
            if (foundPath) {
                Config.setNoteByIdentity(identityKey, foundPath, meta.videoTitle);
                return { filePath: foundPath, isNew: false, meta: meta };
            }

            // 注意：不再按文件名/标题兜底复用，否则不同 URL 只要标题相同
            // 就会被错误地写进同一个 md 文件（身份判定统一由 PageIdentity 负责）

            const filePath = folderName + '/' + meta.videoTitle + '.md';
            const header = NoteTemplate.buildHeader(meta);
            await ObsidianAPI.writeFile(filePath, header);

            Config.setNoteByIdentity(identityKey, filePath, meta.videoTitle);

            return { filePath: filePath, isNew: true, meta: meta };
        },

        // 【修改点】：参数更改为图床 url (imageURL)
        async appendScreenshot(filePath, imageURL, meta) {
            let content = '';
            try {
                content = await ObsidianAPI.readFile(filePath);
            } catch (e) { }

            const now = new Date();
            const modifiedStr = now.toISOString().replace('T', ' ').substring(0, 19);
            const dateStr = now.toISOString().substring(0, 10);

            let editCount = 1;
            const ecStr = getFrontmatterValue(content, 'edit_count');
            if (ecStr) editCount = parseInt(ecStr) + 1;

            content = setFrontmatterValue(content, 'modified', modifiedStr);
            content = setFrontmatterValue(content, 'date', dateStr);
            content = setFrontmatterValue(content, 'edit_count', String(editCount));

            if (!content.endsWith('\n')) content += '\n';
            const block = NoteTemplate.buildScreenshotBlock(imageURL, meta);
            content += '\n' + block;

            await ObsidianAPI.writeFile(filePath, content);
        },

        async createNote() {
            const meta = PageMeta.collect();
            if (!meta) throw new Error('无法获取页面信息');

            const sourceUrl = meta.sourceUrl;
            const pageTitle = meta.pageTitle;
            const identityKey = PageIdentity.makeKey(sourceUrl, pageTitle);
            const folderName = Config.getFolderName();

            const existing = Config.getNoteByIdentity(identityKey);
            if (existing) {
                try {
                    await ObsidianAPI.request('/vault/' + encodeFilePath(existing.filePath), { method: 'HEAD' });
                    throw new Error('该视频笔记已存在：' + existing.filePath);
                } catch (e) {
                    if (e.message.includes('已存在')) throw e;
                }
            }

            const foundPath = await ObsidianAPI.findNoteByIdentity(folderName, sourceUrl, pageTitle);
            if (foundPath) {
                Config.setNoteByIdentity(identityKey, foundPath, meta.videoTitle);
                throw new Error('该视频笔记已存在：' + foundPath);
            }

            const filePath = folderName + '/' + meta.videoTitle + '.md';
            const header = NoteTemplate.buildHeader(meta);
            await ObsidianAPI.writeFile(filePath, header);

            Config.setNoteByIdentity(identityKey, filePath, meta.videoTitle);
            return filePath;
        },
    };

    // ============================================================
    // 第九部分：UI 样式
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
            if (this.floatingBtn && document.body && document.body.contains(this.floatingBtn)) return;
            this.floatingBtn = null;
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
            const disabled = !configured;   // 任意网址均可触发，捕获层自行降级

            while (this.menu.firstChild) this.menu.removeChild(this.menu.firstChild);

            this.menu.appendChild(createEl('div', {
                className: SCRIPT_PREFIX + 'menu-status ' + (configured ? 'ok' : 'warn'),
                textContent: configured ? '✓ Obsidian 已连接' : '⚠ 请先配置 Obsidian',
            }));

            if (!hasVideo) {
                this.menu.appendChild(createEl('div', {
                    className: SCRIPT_PREFIX + 'menu-status warn',
                    textContent: '⚠ 顶层未见视频，将尝试 iframe / 延迟加载捕获',
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
                            createEl('label', {}, ['REST API 地址 ', createEl('span', { className: 'hint', textContent: '（默认 http://127.0.0.1:27123）' })]),
                            createEl('input', { type: 'text', id: SCRIPT_PREFIX + 'api-url', value: Config.getApiUrl(), placeholder: 'http://127.0.0.1:27123' }),
                        ]),
                        createEl('div', { className: SCRIPT_PREFIX + 'form-group' }, [
                            createEl('label', {}, ['API Key ', createEl('span', { className: 'hint', textContent: '（Local REST API 插件设置中查看）' })]),
                            createEl('input', { type: 'password', id: SCRIPT_PREFIX + 'api-key', value: Config.getApiKey(), placeholder: '输入 API Key' }),
                        ]),
                        createEl('div', { className: SCRIPT_PREFIX + 'form-group' }, [
                            createEl('label', {}, ['笔记目录 ', createEl('span', { className: 'hint', textContent: '（Vault 内的文件夹名，默认 视频笔记）' })]),
                            createEl('input', { type: 'text', id: SCRIPT_PREFIX + 'folder-name', value: Config.getFolderName(), placeholder: '视频笔记' }),
                        ]),
                        createEl('div', { className: SCRIPT_PREFIX + 'form-group' }, [
                            createEl('label', { textContent: '图床上传接口 URL' }),
                            createEl('input', { type: 'text', id: SCRIPT_PREFIX + 'imgbed-url', value: Config.get('IMG_BED_URL'), placeholder: 'https://your-imgbed/upload' }),
                        ]),
                        createEl('div', { className: SCRIPT_PREFIX + 'form-group' }, [
                            createEl('label', { textContent: '图床 Bearer Token（可选）' }),
                            createEl('input', { type: 'password', id: SCRIPT_PREFIX + 'imgbed-token', value: Config.get('IMG_BED_TOKEN'), placeholder: '留空则不发送 Authorization 头' }),
                        ]),
                        createEl('button', { className: SCRIPT_PREFIX + 'btn ' + SCRIPT_PREFIX + 'btn-secondary', id: SCRIPT_PREFIX + 'test-btn', style: { width: '100%' }, textContent: '🔗 测试连接' }),
                        createEl('div', { className: SCRIPT_PREFIX + 'connection-status', id: SCRIPT_PREFIX + 'conn-status' }),
                        createEl('div', { className: SCRIPT_PREFIX + 'help-text' }, [
                            createEl('strong', { textContent: 'v' + SCRIPT_VERSION + ' 更新说明：' }),
                            createEl('br'),
                            '• 任意网址视频捕获：Shadow DOM / iframe / 动态加载 / 多视频择优',
                            createEl('br'),
                            '• 跨域污染自动降级；完全失败时仍写入时间戳记录',
                            createEl('br'),
                            '• 图床地址与令牌改为设置项，不再硬编码在脚本中',
                            createEl('br'),
                            '• 图床不可用时自动回退为 base64 内嵌',
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
            Config.set('IMG_BED_URL', document.querySelector('#' + SCRIPT_PREFIX + 'imgbed-url').value.trim());
            Config.set('IMG_BED_TOKEN', document.querySelector('#' + SCRIPT_PREFIX + 'imgbed-token').value.trim());
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
            const meta = PageMeta.collect();

            UI.showLoading('正在捕获视频画面...');
            const dataURL = await VideoUtils.capture();
            const shot = VideoUtils.lastShot();
            if (shot && shot.video) {
                meta.currentTimeSeconds = shot.video.currentTime;
                meta.currentTime = formatTime(meta.currentTimeSeconds);
            } else if (shot && shot.info && typeof shot.info.currentTime === 'number') {
                meta.currentTimeSeconds = shot.info.currentTime;
                meta.currentTime = formatTime(meta.currentTimeSeconds);
            }
            if (!dataURL) {
                UI.showToast('未能捕获画面，仍会写入时间戳记录', 'warning', 5000);
            }

            try {
                let imageRef = dataURL;
                if (imageRef) {
                    UI.showLoading('正在上传截图到图床...');
                    try {
                        imageRef = await ImgBed.upload(imageRef);
                    } catch (e) {
                        UI.showToast('图床上传失败，改用内嵌图片：' + e.message, 'warning', 5000);
                    }
                }

                UI.showLoading('正在获取/创建笔记...');
                const { filePath, isNew } = await NoteManager.getOrCreateNote();

                UI.showLoading('正在写入笔记...');
                await NoteManager.appendScreenshot(filePath, imageRef, meta);

                UI.hideLoading();
                const msg = isNew
                    ? '✓ 已创建新笔记并添加截图 (' + meta.currentTime + ')'
                    : '✓ 截图已追加到笔记 (' + meta.currentTime + ')';
                UI.showToast(msg, 'success');
            } catch (e) {
                UI.hideLoading();
                console.error('[视频截图笔记] 处理失败:', e);
                UI.showToast('处理失败: ' + e.message, 'error', 5000);
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
        // iframe 内实例只作为跨域播放器捕获端，不重复注入 UI 和快捷键
        if (!VideoProbe.isTop) {
            console.log('[视频截图笔记-Obsidian] iframe 捕获端已就绪');
            return;
        }
        console.log('[视频截图笔记-Obsidian] v' + SCRIPT_VERSION + ' 已加载');

        GM_registerMenuCommand('⚙️ Obsidian 设置', () => UI.showSettings());
        GM_registerMenuCommand('📸 截图并发送 (Ctrl+Shift+S)', () => Core.captureAndSend());
        GM_registerMenuCommand('📝 创建视频笔记', () => Core.createVideoNote());

        setupHotkeys();

        let checkTimer = null;
        function checkVideo() {
            // 【核心修复】：如果按钮已经存在于页面上，直接返回，不再重置定时器
            // 避免 B站/YouTube 页面元素频繁变动导致防抖定时器被无限推迟
            if (UI.floatingBtn && document.body && document.body.contains(UI.floatingBtn)) {
                return;
            }

            if (checkTimer) clearTimeout(checkTimer);
            checkTimer = setTimeout(() => {
                if (document.body) {
                    UI.createFloatingButton();
                    UI.showFloatingButton();
                }
            }, 100); // 将 500ms 缩短到 100ms
        }
        
        // 1. 脚本加载时立刻尝试创建一次，不再干等
        if (document.body) {
            UI.createFloatingButton();
            UI.showFloatingButton();
        } else {
            checkVideo();
        }

        // 2. 监听页面结构变化（主要用于单页面应用 SPA 跳转后的重新注入）
        const observer = new MutationObserver(() => checkVideo());
        observer.observe(document.documentElement, { childList: true, subtree: true });

        // 3. 监听 URL 变化
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
