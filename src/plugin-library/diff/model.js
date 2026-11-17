const fs = require('node:fs'),
    path = require('node:path'),
    { createHash } = require('node:crypto');
const MAX_FILE = 32 * 1024 * 1024,
    MAX_ENTRIES = 20000;
const IMAGES = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp'
};
const language = (name) =>
    ({
        js: 'javascript',
        mjs: 'javascript',
        cjs: 'javascript',
        ts: 'typescript',
        tsx: 'typescript',
        jsx: 'javascript',
        json: 'json',
        java: 'java',
        go: 'go',
        py: 'python',
        rb: 'ruby',
        rs: 'rust',
        c: 'c',
        h: 'cpp',
        cpp: 'cpp',
        cs: 'csharp',
        sh: 'shell',
        ps1: 'powershell',
        yaml: 'yaml',
        yml: 'yaml',
        md: 'markdown',
        html: 'html',
        xml: 'xml',
        svg: 'xml',
        css: 'css',
        scss: 'scss',
        sql: 'sql',
        php: 'php',
        kt: 'kotlin',
        swift: 'swift',
        lua: 'lua',
        dockerfile: 'dockerfile',
        toml: 'ini'
    })[path.basename(name).toLowerCase().split('.').pop()] || 'plaintext';
function decode(bytes) {
    if (bytes[0] === 255 && bytes[1] === 254)
        return new TextDecoder('utf-16le', { fatal: true }).decode(bytes.subarray(2));
    if (bytes[0] === 254 && bytes[1] === 255)
        return new TextDecoder('utf-16be', { fatal: true }).decode(bytes.subarray(2));
    if (bytes.includes(0)) throw Error('二进制文件不支持文本对比，请选择图片或文档格式');
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
        return new TextDecoder('gb18030', { fatal: true }).decode(bytes);
    }
}
async function readFile(file) {
    const handle = await fs.promises.open(file, 'r');
    try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > MAX_FILE) throw Error('文件不是普通文件或超过 32 MiB');
        const bytes = Buffer.alloc(Math.min(stat.size + 1, MAX_FILE + 1));
        let used = 0;
        while (used < bytes.length) {
            const { bytesRead } = await handle.read(bytes, used, bytes.length - used, used);
            if (!bytesRead) break;
            used += bytesRead;
        }
        if (used > MAX_FILE) throw Error('文件读取期间增大，已停止');
        const after = await handle.stat();
        if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs)
            throw Error('文件正在修改，请稍后重试');
        return bytes.subarray(0, used);
    } finally {
        await handle.close();
    }
}
async function fingerprint(file, stat, cache, force) {
    const key = file + '\0' + stat.size + '\0' + stat.mtimeMs + '\0' + stat.ctimeMs;
    if (!force && cache[key]) return cache[key];
    const hash = createHash('sha256');
    const handle = await fs.promises.open(file, 'r');
    try {
        const before = await handle.stat();
        if (before.size !== stat.size || before.ctimeMs !== stat.ctimeMs) throw Error('扫描期间文件发生变化');
        const chunk = Buffer.alloc(256 * 1024);
        let offset = 0;
        while (true) {
            const { bytesRead } = await handle.read(chunk, 0, chunk.length, offset);
            if (!bytesRead) break;
            hash.update(chunk.subarray(0, bytesRead));
            offset += bytesRead;
        }
        const after = await handle.stat();
        if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs)
            throw Error('扫描期间文件发生变化');
        return (cache[key] = hash.digest('hex'));
    } finally {
        await handle.close();
    }
}
async function scan({ roots, cache = {}, force = false }, progress = () => {}) {
    const maps = [new Map(), new Map()],
        warnings = [],
        currentCache = {};
    for (let side = 0; side < 2; side++) {
        if (!roots[side]) continue;
        const root = await fs.promises.realpath(roots[side]);
        let count = 0;
        const limit = (message) => Object.assign(Error(message), { code: 'DIFF_LIMIT' });
        async function walk(folder, relative = '', depth = 0) {
            if (depth > 64) throw limit('目录超过 64 层，扫描已停止');
            const directory = await fs.promises.opendir(folder);
            for await (const entry of directory) {
                if (++count > MAX_ENTRIES) throw limit('单侧目录超过 20000 项，请选择更小的子目录');
                const rel = relative ? relative + '/' + entry.name : entry.name,
                    file = path.join(folder, entry.name);
                let record = { relative: rel, name: entry.name, directory: entry.isDirectory(), size: 0, modified: 0 };
                try {
                    // 不跟随链接，避免递归环和越过用户选择的目录读取文件。
                    const stat = await fs.promises.lstat(file);
                    record = { ...record, size: stat.size, modified: stat.mtimeMs };
                    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()))
                        throw Error('链接或特殊文件已跳过');
                    if (stat.isFile()) {
                        record.hash = await fingerprint(file, stat, cache, force);
                        currentCache[file + '\0' + stat.size + '\0' + stat.mtimeMs + '\0' + stat.ctimeMs] = record.hash;
                    }
                    maps[side].set(rel, record);
                    if (stat.isDirectory()) await walk(file, rel, depth + 1);
                } catch (error) {
                    if (error.code === 'DIFF_LIMIT') throw error;
                    record.error = error.message;
                    maps[side].set(rel, record);
                    warnings.push(rel + '：' + error.message);
                }
                if (count % 100 === 0) progress({ side, count });
            }
        }
        await walk(root);
    }
    const rows = [...new Set([...maps[0].keys(), ...maps[1].keys()])].sort().map((relative) => {
        const left = maps[0].get(relative),
            right = maps[1].get(relative);
        const state =
            left?.error || right?.error
                ? 'error'
                : !right
                  ? 'left'
                  : !left
                    ? 'right'
                    : left.directory !== right.directory
                      ? 'type'
                      : left.directory
                        ? 'same'
                        : left.hash !== right.hash
                          ? 'changed'
                          : left.modified !== right.modified
                            ? 'metadata'
                            : 'same';
        return { relative, left, right, state, differences: 0 };
    });
    const indexes = new Map(rows.map((r) => [r.relative, r]));
    let differences = 0;
    for (const row of rows) {
        const leaf =
            (!row.left?.directory && !!row.left) ||
            (!row.right?.directory && !!row.right) ||
            row.state === 'type' ||
            row.state === 'error';
        if (row.state === 'same' || !leaf) continue;
        differences++;
        let parent = path.posix.dirname(row.relative);
        while (parent !== '.') {
            const r = indexes.get(parent);
            if (r) r.differences++;
            parent = path.posix.dirname(parent);
        }
    }
    return { rows, differences, warnings, cache: currentCache };
}
function escape(value) {
    return String(value ?? '').replace(
        /[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
    );
}
function reportHTML(report) {
    const rows = report.rows || [];
    return (
        '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data:"><title>Diff 差异报告</title><style>body{font:14px system-ui;margin:36px;color:#263835}h1{font-size:24px}pre{white-space:pre-wrap;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%;table-layout:fixed}td,th{border:1px solid #ddd;padding:7px;text-align:left;overflow-wrap:anywhere}.left,.removed{background:#fff0ed}.right,.added{background:#e5f6f1}.changed,.metadata{background:#fff3db}.type{background:#f3e8ff}small{color:#667}img{max-width:100%;height:auto}</style><h1>Diff 差异报告</h1><p>' +
        escape(report.title || '本地内容对比') +
        '</p><small>' +
        escape(report.createdAt || new Date().toISOString()) +
        '</small>' +
        (rows.length
            ? '<table><tr><th>路径 / 位置</th><th>状态</th><th>左侧</th><th>右侧</th></tr>' +
              rows
                  .map(
                      (r) =>
                          '<tr class="' +
                          escape(r.state) +
                          '"><td>' +
                          escape(r.relative || r.position) +
                          '</td><td>' +
                          escape(r.state) +
                          '</td><td><pre>' +
                          escape(r.before ?? r.left?.size ?? '') +
                          '</pre></td><td><pre>' +
                          escape(r.after ?? r.right?.size ?? '') +
                          '</pre></td></tr>'
                  )
                  .join('') +
              '</table>'
            : '') +
        (report.parts
            ? report.parts
                  .map(
                      (p) =>
                          '<pre class="' +
                          (p.added ? 'added' : p.removed ? 'removed' : '') +
                          '">' +
                          escape(p.value) +
                          '</pre>'
                  )
                  .join('')
            : '') +
        (report.image &&
        report.image.length < 9 * 1024 * 1024 &&
        /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(report.image)
            ? '<figure><img alt="当前对比画面" src="' +
              report.image +
              '"><figcaption>当前对比画面 / 当前页差异</figcaption></figure>'
            : '') +
        (report.warnings?.length ? '<p>扫描警告：' + report.warnings.map(escape).join('<br>') + '</p>' : '') +
        (report.note ? '<p>' + escape(report.note) + '</p>' : '')
    );
}
module.exports = { MAX_FILE, MAX_ENTRIES, IMAGES, language, decode, readFile, scan, reportHTML };
