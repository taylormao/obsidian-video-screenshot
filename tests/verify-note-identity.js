/* 笔记身份判定回归测试：Node vm + 最小 DOM/GM/Obsidian REST 模拟环境\n * 用法：node tests/verify-note-identity.js <脚本路径>\n * 例：  node tests/verify-note-identity.js video-screenshot-obsidian-v3.user.js\n * 三个活跃脚本均可传入；全部断言通过时输出 FAILED = 0。\n */
const fs = require('fs');
const vm = require('vm');

const scriptPath = process.argv[2];
if (!scriptPath) {
    console.error('用法: node tests/verify-note-identity.js <脚本路径>');
    process.exit(1);
}
if (!fs.existsSync(scriptPath)) {
    console.error('文件不存在: ' + scriptPath);
    process.exit(1);
}
const source = fs.readFileSync(scriptPath, 'utf8');

const vault = new Map();
const writes = [];
const runtimeErrors = [];
const menuCommands = [];

class FakeElement {
    constructor(tag) {
        this.tagName = String(tag || 'div').toUpperCase();
        this.children = [];
        this.attrs = {};
        this.style = {};
        this.className = '';
        this.textContent = '';
        this.parentNode = null;
        this.ownerDocument = null;
        this._set = new Set();
        this.classList = {
            add: (...c) => c.forEach(x => this._set.add(x)),
            remove: (...c) => c.forEach(x => this._set.delete(x)),
            contains: c => this._set.has(c),
        };
    }
    setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.id = v; }
    getAttribute(k) { return this.attrs[k]; }
    appendChild(c) { if (c && typeof c === 'object') c.parentNode = this; this.children.push(c); return c; }
    removeChild(c) { this.children = this.children.filter(x => x !== c); return c; }
    get firstChild() { return this.children[0] || null; }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
    contains(node) {
        if (node === this) return true;
        for (const c of this.children) {
            if (c === node) return true;
            if (c && typeof c.contains === 'function' && c.contains(node)) return true;
        }
        return false;
    }
    addEventListener() {}
    querySelector() { return null; }
    querySelectorAll() { return []; }
    getBoundingClientRect() { return { width: 1280, height: 720, top: 0, left: 0 }; }
}

const video = new FakeElement('video');
Object.assign(video, {
    videoWidth: 1280, videoHeight: 720, readyState: 4, paused: false, ended: false,
    currentTime: 65, duration: 300, className: 'html5-main-video',
    src: 'blob:https://example.com/abc', currentSrc: 'blob:https://example.com/abc',
});

const documentStub = {
    title: '同一标题',
    readyState: 'complete',
    body: new FakeElement('body'),
    documentElement: new FakeElement('html'),
    defaultView: null,
    querySelector(sel) { return sel === 'video' ? video : null; },
    querySelectorAll(sel) { return sel === 'video' ? [video] : []; },
    createElement(tag) {
        const el = new FakeElement(tag);
        el.ownerDocument = documentStub;
        if (tag === 'canvas') {
            el.getContext = () => ({ drawImage() {} });
            el.toDataURL = () => 'data:image/jpeg;base64,RkFLRUZSQU1F';
        }
        return el;
    },
    createTextNode(t) { return { nodeType: 3, textContent: String(t), contains: () => false }; },
    addEventListener() {},
    getSelection() { return { toString: () => '' }; },
};
video.ownerDocument = documentStub;

const windowStub = {
    location: { href: 'https://example.com/watch?viewkey=AAA', hostname: 'example.com' },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    addEventListener() {},
    removeEventListener() {},
};
windowStub.top = windowStub;
windowStub.self = windowStub;
documentStub.defaultView = windowStub;

const gmStore = new Map([
    ['obsidian_api_url', 'http://127.0.0.1:27123'],
    ['obsidian_api_key', 'test-token'],
]);

const uploads = [];
function fakeXhr(opts) {
    const u = new URL(opts.url);
    const method = opts.method || 'GET';
    const rel = decodeURIComponent(u.pathname.replace(/^\/vault\/?/, ''));
    let status = 200, text = '';
    if (u.hostname === 'imgbed.example') {
        const f = opts.data && opts.data.get ? opts.data.get('file') : null;
        const name = f && f.name ? f.name : 'unknown';
        if (u.pathname.includes('fail502')) {
            status = 502;
            text = JSON.stringify([{ publicUrl: 'https://imgbed.example/err-502.png' }]);
        } else {
            uploads.push(name);
            text = JSON.stringify([{ publicUrl: 'https://imgbed.example/file/' + name }]);
        }
    } else if (u.pathname === '/') {
        text = JSON.stringify({ ok: true, name: 'MockVault' });
    } else if (method === 'PUT') {
        vault.set(rel, String(opts.data));
        writes.push({ op: 'PUT', path: rel });
        text = '';
    } else if (method === 'HEAD') {
        status = vault.has(rel) ? 200 : 404;
    } else if (vault.has(rel)) {
        text = vault.get(rel);
    } else if (!/\.md$/i.test(rel)) {
        const names = [...vault.keys()]
            .filter(k => k.startsWith(rel + '/') && !k.slice(rel.length + 1).includes('/'))
            .map(k => k.slice(rel.length + 1));
        text = JSON.stringify({ files: names });
    } else {
        status = 404;
    }
    setTimeout(() => {
        try { opts.onload({ status, responseText: text }); }
        catch (e) { runtimeErrors.push('xhr onload: ' + e.message); }
    }, 0);
}

const sandbox = {
    window: windowStub,
    document: documentStub,
    URL, URLSearchParams, Math, JSON, Date, Promise,
    atob: global.atob, Blob: global.Blob, FormData: global.FormData,
    console: {
        log() {},
        warn() {},
        error(...a) { runtimeErrors.push('console.error: ' + a.map(String).join(' ')); },
    },
    GM_getValue: (k, d) => gmStore.has(k) ? gmStore.get(k) : d,
    GM_setValue: (k, v) => gmStore.set(k, v),
    GM_deleteValue: k => gmStore.delete(k),
    GM_addStyle: () => {},
    GM_registerMenuCommand: (name, cb) => menuCommands.push({ name, cb }),
    GM_xmlhttpRequest: fakeXhr,
    MutationObserver: class { constructor(cb) { this.cb = cb; } observe() {} disconnect() {} },
    requestAnimationFrame: cb => { cb(); return 1; },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: id => clearTimeout(id),
    setInterval: () => 0,
    clearInterval: () => {},
};

const ctx = vm.createContext(sandbox);
try {
    vm.runInContext(source, ctx, { filename: 'v3.user.js' });
} catch (e) {
    console.log('FATAL 脚本加载/初始化异常: ' + e.stack);
    process.exit(1);
}

console.log('LOAD OK | 已注册菜单命令: ' + menuCommands.map(m => m.name).join(' / '));
const capture = menuCommands.find(m => m.name.includes('采集并发送') || m.name.includes('截图并发送'));
if (!capture) { console.log('FATAL 未找到「采集并发送」命令'); process.exit(1); }

function fm(content, key) {
    const m = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
    if (!m) return null;
    const km = m[1].match(new RegExp('^' + key + ':\\s*(.*?)\\r?$', 'm'));
    if (!km) return null;
    let v = km[1].trim();
    if (!v) return null;
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    return v;
}

async function run(label, href, title) {
    windowStub.location.href = href;
    windowStub.location.hostname = new URL(href).hostname;
    documentStub.title = title;
    const before = writes.length;
    const errBefore = runtimeErrors.length;
    try { await capture.cb(); }
    catch (e) { runtimeErrors.push('capture: ' + e.message); }
    await new Promise(r => setTimeout(r, 30));
    const newWrites = writes.slice(before).filter(w => w.op === 'PUT');
    const errs = runtimeErrors.slice(errBefore);
    console.log('\n--- ' + label + ' ---');
    console.log('  URL    = ' + href);
    console.log('  title  = ' + title);
    console.log('  PUT    = ' + newWrites.map(w => w.path).join(', '));
    console.log('  errors = ' + (errs.length ? errs.join(' | ') : 'none'));
    return { newWrites, errs };
}

(async () => {
    const r1 = await run('场景1 页面 A', 'https://example.com/watch?viewkey=AAA', '同一标题');
    const r2 = await run('场景2 页面 B（不同 viewkey，同 title）', 'https://example.com/watch?viewkey=BBB', '同一标题');
    const r3 = await run('场景3 页面 A + 跟踪参数', 'https://example.com/watch?viewkey=AAA&utm_source=share', '同一标题');
    const r4 = await run('场景4 页面 A 但 title 不同', 'https://example.com/watch?viewkey=AAA', '不同标题');

    gmStore.set('obsidian_imgbed_enabled', '1');
    gmStore.set('obsidian_imgbed_url', 'https://imgbed.example/upload');
    gmStore.set('obsidian_imgbed_token', 'test-token');
    const r5 = await run('场景5 图床外链', 'https://example.com/watch?viewkey=CCC', '外链标题');

    // 场景6：同名多级去冲突（三个不同路径且最后一个参数均为 id=1，title 相同）
    const r6a = await run('场景6a 多级冲突-A', 'https://example.com/a?id=1', '二次冲突标题');
    const r6b = await run('场景6b 多级冲突-B', 'https://example.com/b?id=1', '二次冲突标题');
    const r6c = await run('场景6c 多级冲突-C（二级哈希兜底）', 'https://example.com/c?id=1', '二次冲突标题');

    // 场景7：图床返回 HTTP 502 时必须拒绝并回退 base64，不写入错误外链
    const hasImgBed = source.includes('const ImgBed =');
    let r7 = { newWrites: [], errs: [] };
    if (hasImgBed) {
        gmStore.set('obsidian_imgbed_url', 'https://imgbed.example/fail502');
        r7 = await run('场景7 图床 HTTP 502 回退', 'https://example.com/watch?viewkey=FAIL502', '图床失败回退');
        gmStore.set('obsidian_imgbed_url', 'https://imgbed.example/upload');
    }

    // 场景8：Vault 目录超过 50 篇笔记且索引失效时，仍能匹配第 61 篇
    for (let i = 1; i <= 60; i++) {
        const idx = String(i).padStart(2, '0');
        vault.set('视频笔记/占位-' + idx + '.md', '---\ntitle: "占位' + idx + '"\nsource_url: "https://example.com/stub/' + idx + '"\n---\n');
    }
    vault.set('视频笔记/第六十一篇.md', '---\ntitle: "第六十一篇"\nsource_url: "https://example.com/watch?viewkey=OVER50"\n---\n\n# 第六十一篇\n');
    gmStore.delete('obsidian_note_index_v4');
    const r8 = await run('场景8 超过50篇笔记的Vault匹配', 'https://example.com/watch?viewkey=OVER50', '第六十一篇');

    // 场景9：v3 自定义模板接线（仅在支持 loadObsidianTemplate 时验证）
    const hasCustomTmpl = source.includes('renderCustomTemplate');
    let r9 = { newWrites: [], errs: [] };
    if (hasCustomTmpl) {
        vault.set('.obsidian/templates/video-note-template.md', '---\ntitle: "{{title}}"\nsource_url: {{source_url}}\n---\n\n# 自定义模板-{{title}}\n');
        r9 = await run('场景9 自定义模板接线', 'https://example.com/watch?viewkey=CUSTOM1', '自定义模板测试');
    }

    // 场景10：Windows CRLF (\r\n) 换行的已有笔记读写兼容
    vault.set('视频笔记/CRLF笔记.md', [
        '---',
        'title: "CRLF标题"',
        'source_url: "https://example.com/watch?viewkey=CRLF1"',
        'modified: 2026-11-01 00:00:00',
        'date: 2026-11-01',
        'edit_count: 2',
        '---',
        '',
        '# CRLF标题',
        '',
    ].join('\r\n'));
    gmStore.delete('obsidian_note_index_v4');
    const r10 = await run('场景10 CRLF笔记读写兼容', 'https://example.com/watch?viewkey=CRLF1', 'CRLF标题');

    const paths = r => [...new Set(r.newWrites.map(w => w.path))];
    const r5Content = () => { const p = paths(r5)[0]; return p ? (vault.get(p) || '') : ''; };
    const r7Content = () => { const p = paths(r7)[0]; return p ? (vault.get(p) || '') : ''; };
    const r9Content = () => { const p = paths(r9)[0]; return p ? (vault.get(p) || '') : ''; };
    const A = 'https://example.com/watch?viewkey=AAA';
    const B = 'https://example.com/watch?viewkey=BBB';
    const A6 = 'https://example.com/a?id=1';
    const B6 = 'https://example.com/b?id=1';
    const C6 = 'https://example.com/c?id=1';

    console.log('\n=== VAULT 最终状态（' + vault.size + ' 个文件）===');
    for (const [p, content] of vault) {
        if (p.startsWith('视频笔记/占位-')) continue;
        console.log(p + ' => source_url=' + fm(content, 'source_url') + ' | title=' + fm(content, 'title') +
            ' | 截图块=' + (content.includes('data:image/jpeg;base64,') || content.includes('imgbed.example') ? '有' : '无'));
    }
    if (hasImgBed) console.log('图床上传文件名: ' + (uploads.join(', ') || 'none'));

    const checks = [
        ['场景1 frontmatter 写入完整 URL', () => [...vault.values()].some(c => fm(c, 'source_url') === A)],
        ['场景1 frontmatter 写入页面 title', () => [...vault.values()].some(c => fm(c, 'title') === '同一标题')],
        ['场景1 笔记未被场景2 覆盖', () => {
            const p = paths(r1)[0];
            return p && fm(vault.get(p), 'source_url') === A;
        }],
        ['场景2 不同 viewkey 写到不同文件路径', () => {
            const p1 = paths(r1), p2 = paths(r2);
            return p2.length > 0 && p2.every(p => !p1.includes(p));
        }],
        ['场景2 的 source_url 是 BBB 的完整 URL', () => [...vault.values()].some(c => fm(c, 'source_url') === B)],
        ['场景3 复用场景1 的文件（跟踪参数不影响）', () => {
            const p1 = paths(r1), p3 = paths(r3);
            return p3.length === 1 && p3[0] === p1[0];
        }],
        ['场景4 同 URL 不同 title 新建文件', () => {
            const p1 = paths(r1), p4 = paths(r4);
            return p4.length > 0 && p4.every(p => !p1.includes(p));
        }],
        ['场景6 三方同参数多级去冲突互不覆盖', () => {
            const p6a = paths(r6a)[0], p6b = paths(r6b)[0], p6c = paths(r6c)[0];
            return p6a && p6b && p6c && new Set([p6a, p6b, p6c]).size === 3 &&
                fm(vault.get(p6a), 'source_url') === A6 &&
                fm(vault.get(p6b), 'source_url') === B6 &&
                fm(vault.get(p6c), 'source_url') === C6;
        }],
        ['场景7 图床 HTTP 502 拒绝并回退 base64', () => !hasImgBed || (
            !r7Content().includes('err-502.png') &&
            /<img src="data:image\/jpeg;base64,[^"]+" width="400"/.test(r7Content())
        )],
        ['场景8 超过50篇笔记仍复用目标文件', () => {
            const p8 = paths(r8);
            return p8.length === 1 && p8[0] === '视频笔记/第六十一篇.md';
        }],
        ['场景9 v3 自定义模板接线生效', () => !hasCustomTmpl || (
            r9Content().includes('# 自定义模板-自定义模板测试') &&
            fm(r9Content(), 'source_url') === 'https://example.com/watch?viewkey=CUSTOM1'
        )],
        ['场景10 CRLF笔记复用且edit_count递增为3', () => {
            const p10 = paths(r10);
            const content = vault.get('视频笔记/CRLF笔记.md') || '';
            const ecMatches = content.match(/^edit_count:/gm) || [];
            return p10.length === 1 && p10[0] === '视频笔记/CRLF笔记.md' &&
                fm(content, 'edit_count') === '3' && ecMatches.length === 1;
        }],
        ['截图内容已写入笔记', () => [...vault.values()].some(c => c.includes('data:image/jpeg;base64,') || c.includes('imgbed.example'))],
        ['base64 截图用 <img> 内嵌', () => [...vault.values()].some(c => /<img src="data:image\/jpeg;base64,[^"]+" width="400"/.test(c))],
        ['图床外链沿用 ![alt|400](url) 语法', () => !hasImgBed || /!\[[^\]]*\|400\]\(https:\/\/imgbed\.example\/file\//.test(r5Content())],
        ['图床上传文件名有效', () => !hasImgBed || (uploads.length > 0 && uploads.every(n => /\.(png|jpg)$/i.test(n)))],
        ['运行期无异常', () => runtimeErrors.length === 0],
    ];
    let failed = 0;
    console.log('\n=== 断言 ===');
    for (const [name, fn] of checks) {
        let ok = false;
        try { ok = !!fn(); } catch (e) { ok = false; }
        if (!ok) failed++;
        console.log((ok ? 'PASS' : 'FAIL') + ' | ' + name);
    }
    if (runtimeErrors.length) console.log('\n运行期错误: ' + runtimeErrors.join(' | '));
    console.log('FAILED = ' + failed);
    process.exit(failed > 0 ? 1 : 0);
})();
