/* 笔记身份判定回归测试：Node vm + 最小 DOM/GM/Obsidian REST 模拟环境\n * 用法：node tests/verify-note-identity.js <脚本路径>\n * 例：  node tests/verify-note-identity.js video-screenshot-obsidian-v3.user.js\n * 三个活跃脚本均可传入；全部断言通过时输出 FAILED = 0。\n */
const fs = require('fs');
const vm = require('vm');

const scriptPath = process.argv[2];
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
        uploads.push(name);
        text = JSON.stringify([{ publicUrl: 'https://imgbed.example/file/' + name }]);
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
    const m = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!m) return null;
    const km = m[1].match(new RegExp('^' + key + ':\\s*(.+)$', 'm'));
    if (!km) return null;
    let v = km[1].trim();
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

    const paths = r => [...new Set(r.newWrites.map(w => w.path))];
    const r5Content = () => { const p = paths(r5)[0]; return p ? (vault.get(p) || '') : ''; };
    const hasImgBed = source.includes('const ImgBed =');
    const A = 'https://example.com/watch?viewkey=AAA';
    const B = 'https://example.com/watch?viewkey=BBB';

    console.log('\n=== VAULT 最终状态（' + vault.size + ' 个文件）===');
    for (const [p, content] of vault) {
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
        ['截图内容已写入笔记', () => [...vault.values()].some(c => c.includes('data:image/jpeg;base64,') || c.includes('imgbed.example'))],
        ['笔记不再使用私有图片尺寸语法 ![alt|400](url)', () => ![...vault.values()].some(c => /!\[[^\]]*\|\d+\]\(/.test(c))],
        ['笔记用 HTML <img width=400> 写图片', () => [...vault.values()].some(c => /<img src="[^"]+" width="400"/.test(c))],
        ['图床场景写入外链 <img>', () => !hasImgBed || /<img src="https:\/\/imgbed\.example\/file\/[^"]+" width="400"/.test(r5Content())],
        ['图床上传文件名与 JPEG 内容一致（.jpg）', () => !hasImgBed || (uploads.length > 0 && uploads.every(n => /\.jpg$/i.test(n)))],
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
    process.exit(0);
})();
