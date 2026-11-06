// ==UserScript==
// @name         截图笔记助手 - Obsidian（模板版）
// @namespace    https://github.com/taylormao/video-screenshot-obsidian
// @version      3.2.0
// @description  多模板笔记助手（视频/读书/资源）+ 任意网址视频捕获 + 可选图床外链
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
    const SCRIPT_VERSION = '3.2.0';

    const CONFIG_KEYS = {
        API_URL: 'obsidian_api_url',
        API_KEY: 'obsidian_api_key',
        NOTE_INDEX: 'obsidian_note_index_v4',
        CURRENT_TEMPLATE: 'current_template_type',
        IMG_BED_ENABLED: 'obsidian_imgbed_enabled',
        IMG_BED_URL: 'obsidian_imgbed_url',
        IMG_BED_TOKEN: 'obsidian_imgbed_token',
    };

    const DEFAULTS = {
        API_URL: 'http://127.0.0.1:27123',
        API_KEY: '',
        IMG_BED_ENABLED: '',
        IMG_BED_URL: '',
        IMG_BED_TOKEN: '',
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
                    title: { label: '标题', source: 'page.pageTitle' },
                    source_url: { label: '视频链接', source: 'page.sourceUrl' },
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
                    '{{image_block}}',
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
                    title: { label: '页面标题', source: 'page.pageTitle' },
                    book_title: { label: '书名', source: 'page.bookTitle' },
                    author: { label: '作者', source: 'page.author' },
                    source_url: { label: '阅读链接', source: 'page.sourceUrl' },
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
                    title: { label: '页面标题', source: 'page.pageTitle' },
                    source_url: { label: '资源链接', source: 'page.sourceUrl' },
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

    // ============================================================
    // 可选图床：截图上传为外链，避免 base64 撑大笔记（默认关闭）
    // 合并自 master 2.1.0，地址与令牌改为设置项，不再硬编码
    // ============================================================
    const ImgBed = {
        enabled() { return Config.get('IMG_BED_ENABLED') === '1'; },

        upload(dataURL) {
            return new Promise((resolve, reject) => {
                const endpoint = Config.get('IMG_BED_URL');
                const token = Config.get('IMG_BED_TOKEN');
                if (!endpoint) { reject(new Error('未配置图床地址')); return; }

                const parts = dataURL.split(',');
                const mime = (parts[0].match(/:(.*?);/) || [])[1] || 'image/jpeg';
                let u8;
                try {
                    const bin = atob(parts[1] || '');
                    u8 = new Uint8Array(bin.length);
                    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
                } catch (e) { reject(new Error('截图数据无效')); return; }

                const fd = new FormData();
                fd.append('file', new Blob([u8], { type: mime }), 'screenshot-' + Date.now() + '.png');

                GM_xmlhttpRequest({
                    method: 'POST',
                    url: endpoint,
                    headers: token ? { 'Authorization': 'Bearer ' + token } : {},
                    data: fd,
                    timeout: 30000,
                    onload(res) {
                        try {
                            const parsed = JSON.parse(res.responseText);
                            const item = Array.isArray(parsed) ? parsed[0] : (parsed.data || parsed);
                            let url = null;
                            if (typeof item === 'string') url = item;
                            else if (item && typeof item === 'object') url = item.publicUrl || item.src || item.url || item.link;
                            if (url) resolve(url);
                            else reject(new Error('图床响应中未找到图片 URL'));
                        } catch (e) {
                            reject(new Error('解析图床响应失败: ' + String(res.responseText).slice(0, 160)));
                        }
                    },
                    onerror() { reject(new Error('图床请求失败')); },
                    ontimeout() { reject(new Error('图床上传超时')); },
                });
            });
        },
    };

    const PageCollectors = {

        /** ---------- 视频页面 ---------- */

        videoPage() {
            const video = VideoProbe.pick();
            const title = this._getVideoTitle();
            const source = window.location.hostname.replace('www.', '');
            const url = new URL(window.location.href);
            const cleanUrl = PageIdentity.currentUrl();
            const duration = video ? formatTime(video.duration) : '';

            return {
                videoTitle: title.replace(/[\\/:*?"<>|]/g, '-'),
                pageTitle: PageIdentity.currentTitle(),
                pageURL: url.href,
                cleanUrl: cleanUrl,
                sourceUrl: cleanUrl,
                source: source,
                videoDuration: duration,
                currentTimeSeconds: video ? video.currentTime : 0,
                currentTime: formatTime(video ? video.currentTime : 0),
                timestamp: new Date().toISOString(),
            };
        },

        async captureVideoFrame() {
            const shot = await VideoProbe.capture();
            this.lastCapture = shot;
            return shot.dataURL;
        },

        _getVideo() {
            return VideoProbe.pick();
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

        /** 兼容旧调用：现在一律返回当前页面完整 URL，身份比对交给 PageIdentity */
        _getCleanUrl() {
            return PageIdentity.currentUrl();
        },

        /** ---------- 读书页面 ---------- */

        readingPage() {
            const source = window.location.hostname.replace('www.', '');
            const fullUrl = PageIdentity.currentUrl();
            return {
                bookTitle: this._getBookTitle(),
                author: this._getBookAuthor(),
                pageTitle: PageIdentity.currentTitle(),
                source: source,
                sourceUrl: fullUrl,
                cleanUrl: fullUrl,
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
            const fullUrl = PageIdentity.currentUrl();
            return {
                title: document.title || '未命名资源',
                pageTitle: PageIdentity.currentTitle(),
                source: source,
                sourceUrl: fullUrl,
                cleanUrl: fullUrl,
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
                try {
                    if (template.urlMatcher(url)) return typeId;
                } catch (e) { /* 忽略异常 URL 下的匹配器错误 */ }
            }
            // 任意网址：只要探测到 video（含 Shadow DOM / iframe 播放器特征），一律走视频笔记
            if (VideoProbe.looksLikeVideoPage()) return 'video-note';
            // 其余网址用通用资源笔记兜底，保证任何网页都能创建/追加笔记
            return 'resource-note';
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
                lines.push(key + ': ' + PageIdentity.yamlQuote(val));
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

    /** 生成带时间戳的回跳链接（兼容原本没有 query 的 URL） */
    function buildTimestampedURL(pageURL, seconds) {
        try {
            const u = new URL(pageURL || window.location.href);
            u.hash = '';
            if (typeof seconds === 'number' && isFinite(seconds) && seconds >= 0) {
                u.searchParams.set('t', Math.floor(seconds));
            }
            return u.href;
        } catch (e) { return pageURL || window.location.href; }
    }

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
        const km = match[1].match(new RegExp('^' + key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ':\\s*(.+)$', 'm'));
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

        getNoteByIdentity(key) {
            const idx = this._getIndex();
            return idx[key] || null;
        },

        setNoteByIdentity(key, filePath, title, templateType) {
            const idx = this._getIndex();
            idx[key] = { filePath, title, templateType, updatedAt: new Date().toISOString() };
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
         * 🔑 在目录中按「归一 URL + title」双条件搜索笔记
         */
        async findNoteByIdentity(folderName, sourceUrl, pageTitle) {
            try {
                const entries = await this.listVault(folderName);
                if (!Array.isArray(entries)) return null;
                const getName = x => (typeof x === 'string') ? x : (x.name || x.path || '');
                const mdFiles = entries.filter(e => getName(e).toLowerCase().endsWith('.md')).slice(0, 50);
                for (const f of mdFiles) {
                    const fp = folderName + '/' + getName(f);
                    try {
                        const content = await this.readFile(fp);
                        const fmUrl = getFrontmatterValue(content, 'source_url');
                        const fmTitle = getFrontmatterValue(content, 'title');
                        if (PageIdentity.matches(fmUrl, fmTitle, sourceUrl, pageTitle)) return fp;
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
            const pageTitle = pageData.pageTitle || PageIdentity.currentTitle();
            const identityKey = PageIdentity.makeKey(sourceUrl, pageTitle);
            const folderName = tmpl.folder;

            // Step 1: 检查索引（归一 URL + title 双条件）
            let indexEntry = Config.getNoteByIdentity(identityKey);
            if (indexEntry) {
                try {
                    await ObsidianAPI.request('/vault/' + encodeFilePath(indexEntry.filePath), { method: 'HEAD' });
                    return { filePath: indexEntry.filePath, isNew: false, pageData, templateType: typeId };
                } catch (e) { /* 文件改名，继续搜索 */ }
            }

            // Step 2: 在 Vault 中按双条件搜索
            const foundPath = await ObsidianAPI.findNoteByIdentity(folderName, sourceUrl, pageTitle);
            if (foundPath) {
                Config.setNoteByIdentity(identityKey, foundPath, pageData.videoTitle || pageData.bookTitle || pageData.title, typeId);
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
            Config.setNoteByIdentity(identityKey, filePath, noteName, typeId);
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
                    current_time: pageData.currentTime || formatTime(0),
                    image_block: pageData.imageMarkdown || '> ⚠️ 未能捕获画面（视频可能受跨域保护）',
                    timestamped_url: buildTimestampedURL(pageData.pageURL, pageData.currentTimeSeconds),
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
            if (this.floatingBtn && document.body && document.body.contains(this.floatingBtn)) return;
            // 按钮被 SPA 移除时允许重建（合并自 master 2.1.0 的防抖修复）
            this.floatingBtn = null;
            const tmpl = TemplateManager.detectType();
            const icon = tmpl ? TEMPLATE_TYPES[tmpl].icon : '📝';
            this.floatingBtn = createEl('button', {
                className: SCRIPT_PREFIX + 'floating-btn',
                textContent: icon,
                title: '截图笔记助手 v' + SCRIPT_VERSION,
            });
            this.floatingBtn.addEventListener('click', (e) => { e.stopPropagation(); this.toggleMenu(); });
            document.body.appendChild(this.floatingBtn);
            if (!document.querySelector('.' + SCRIPT_PREFIX + 'version-badge')) {
                const badge = createEl('div', { className: SCRIPT_PREFIX + 'version-badge', textContent: 'v' + SCRIPT_VERSION });
                document.body.appendChild(badge);
            }
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
                        createEl('div', { className: SCRIPT_PREFIX + 'form-group' }, [
                            createEl('label', { textContent: '截图存储方式' }),
                            createEl('select', { id: SCRIPT_PREFIX + 'imgbed-enabled' }, [
                                createEl('option', { value: '0', textContent: '内嵌 base64（默认）' }),
                                createEl('option', { value: '1', textContent: '上传图床，写入外链' }),
                            ]),
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
                            createEl('strong', { textContent: 'v' + SCRIPT_VERSION + ' 模板类型：' }),
                            createEl('br'),
                            '📹 视频笔记 - 任意含视频的网页（含 Shadow DOM / iframe 播放器）',
                            createEl('br'),
                            '📖 读书笔记 - 微信读书摘录',
                            createEl('br'),
                            '📦 资源笔记 - 网盘与任意网页兜底',
                            createEl('br'),
                            createEl('br'),
                            createEl('strong', { textContent: '截图捕获：' }),
                            createEl('br'),
                            '自动择优主播放器、等待延迟加载、跨域污染时尝试 CORS 重载；',
                            createEl('br'),
                            '完全无法捕获时仍写入时间戳记录。',
                            createEl('br'),
                            createEl('br'),
                            '注：Obsidian 自定义模板读取接口仍为预留，暂未启用。',
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
            this.modal.querySelector('#' + SCRIPT_PREFIX + 'imgbed-enabled').value = Config.get('IMG_BED_ENABLED') === '1' ? '1' : '0';
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
            Config.set('IMG_BED_ENABLED', document.querySelector('#' + SCRIPT_PREFIX + 'imgbed-enabled').value);
            Config.set('IMG_BED_URL', document.querySelector('#' + SCRIPT_PREFIX + 'imgbed-url').value.trim());
            Config.set('IMG_BED_TOKEN', document.querySelector('#' + SCRIPT_PREFIX + 'imgbed-token').value.trim());
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
            const typeId = TemplateManager.detectType();   // 任意网址都有兜底模板

            UI.showLoading('正在采集数据...');
            try {
                const { filePath, isNew, pageData, templateType } = await NoteManager.getOrCreateNote(typeId);

                if (templateType === 'video-note') {
                    UI.showLoading('正在捕获视频画面...');
                    const shot = await VideoProbe.capture();

                    // 视频在 iframe 内时顶层读不到进度，用捕获结果回补时间戳
                    if (shot.video) {
                        pageData.currentTimeSeconds = shot.video.currentTime;
                        pageData.currentTime = formatTime(shot.video.currentTime);
                    } else if (shot.info && typeof shot.info.currentTime === 'number') {
                        pageData.currentTimeSeconds = shot.info.currentTime;
                        pageData.currentTime = formatTime(shot.info.currentTime);
                    }

                    let imageRef = shot.dataURL;
                    if (imageRef && ImgBed.enabled()) {
                        UI.showLoading('正在上传截图到图床...');
                        try {
                            imageRef = await ImgBed.upload(imageRef);
                        } catch (e) {
                            UI.showToast('图床上传失败，改用内嵌图片：' + e.message, 'warning', 5000);
                        }
                    }

                    if (imageRef && /^data:/.test(imageRef)) {
                        pageData.imageMarkdown = '<img src="' + imageRef + '" width="400" alt="' + pageData.currentTime + '" />';
                    } else if (imageRef) {
                        pageData.imageMarkdown = '![' + pageData.currentTime + '|400](' + imageRef + ')';
                    } else {
                        UI.showToast('未能捕获画面，仍会写入时间戳记录', 'warning', 5000);
                    }
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
        // iframe 内实例只作为跨域播放器捕获端，不重复注入 UI 和快捷键
        if (!VideoProbe.isTop) {
            console.log('[截图笔记助手] iframe 捕获端已就绪');
            return;
        }

        console.log('[截图笔记助手] v' + SCRIPT_VERSION + ' 已加载 | 模板: ' + TemplateManager.detectType());

        GM_registerMenuCommand('⚙️ 设置', () => UI.showSettings());
        GM_registerMenuCommand('📸 采集并发送 (Ctrl+Shift+S)', () => Core.captureAndSend());
        GM_registerMenuCommand('📄 创建新笔记', () => Core.createNote());

        setupHotkeys();

        function ensureButton() {
            if (UI.floatingBtn && document.body && document.body.contains(UI.floatingBtn)) return;
            if (!document.body) return;
            UI.createFloatingButton();
            UI.showFloatingButton();
        }
        ensureButton();

        let debounce = null;
        const observer = new MutationObserver(() => {
            if (debounce) clearTimeout(debounce);
            debounce = setTimeout(ensureButton, 100);
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });

        let lastURL = window.location.href;
        setInterval(() => {
            if (window.location.href !== lastURL) { lastURL = window.location.href; ensureButton(); }
        }, 1000);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
