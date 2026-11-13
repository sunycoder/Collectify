const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { deflateRawSync, inflateRawSync } = require('node:zlib');
const { readManifest } = require('./manifest');

const LIMIT = 10 * 1024 * 1024;
const ARCHIVE_LIMIT = 64 * 1024 * 1024;
const NATIVE_LIMIT = 96 * 1024 * 1024;
const TYPES = /\.(html|js|mjs|css|json|svg|png|jpe?g|webp|woff2|txt|md)$/i;

// 安装包只装程序资源。数据目录、凭据、宿主配置均不属于这个格式。
function safeName(name, { native = false } = {}) {
    if (
        typeof name !== 'string' ||
        !name ||
        name.length > 240 ||
        name.includes('\\') ||
        name.includes('\0') ||
        name
            .split('/')
            .some(
                (p) =>
                    !p ||
                    p === '.' ||
                    p === '..' ||
                    p.startsWith('.') ||
                    /[<>:"|?*\x00-\x1f]/.test(p) ||
                    /[. ]$/.test(p) ||
                    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p) ||
                    p === 'node_modules'
            ) ||
        name.split('/').length > 21
    )
        throw Error('插件包资源路径不合法');
    if (
        !TYPES.test(name) &&
        !(native && /\.(cjs|exe|dll|lng|bcmap|pfb|ttf|woff|otf|icc|map|xz|LICENSE|markdown)$/i.test(name)) &&
        !(native && /(?:^|[-_.])(LICENSE|NOTICE)$/i.test(path.posix.basename(name))) &&
        !/^(LICENSE|NOTICE)(?:[._-][\w.-]+)?$/i.test(path.posix.basename(name))
    )
        throw Error('插件包包含不支持的文件类型');
    return name;
}
function crc32(buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
    return (crc ^ 0xffffffff) >>> 0;
}
function sha256(buffer) {
    return createHash('sha256').update(buffer).digest('hex');
}
function collectFiles(root, { signing = false } = {}) {
    const input = fs.existsSync(path.join(root, 'manifest.json'))
        ? JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'))
        : {};
    const native = input.runtime === 'native';
    if (native && !signing) readManifest(root);
    else if (!native && fs.existsSync(path.join(root, 'manifest.json')))
        require('./source-install').assertPageSource(root);
    const files = [],
        names = new Set();
    let total = 0,
        entries = 0;
    function walk(folder, prefix = '', depth = 0) {
        if (depth > 20) throw Error('插件目录嵌套过深');
        for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
            if (['.gitignore', '.gitattributes', '.gitkeep'].includes(entry.name)) continue;
            if (++entries > 500) throw Error('插件目录项过多');
            const name = prefix + entry.name,
                file = path.join(folder, entry.name);
            if (entry.isSymbolicLink()) throw Error('插件包不允许符号链接');
            if (entry.isDirectory()) {
                safeName(name + '/placeholder.txt', { native });
                walk(file, name + '/', depth + 1);
                continue;
            }
            if (!entry.isFile()) throw Error('插件包包含特殊文件');
            safeName(name, { native });
            if (names.has(name.toLowerCase())) throw Error('插件资源名称重复');
            names.add(name.toLowerCase());
            const size = fs.statSync(file).size;
            if ((total += size) > (native ? NATIVE_LIMIT : LIMIT) || files.length >= 300)
                throw Error('插件包超过大小或 300 个文件限制');
            const data = fs.readFileSync(file);
            if (data.length !== size) throw Error('打包期间文件发生变化');
            files.push({ name, data });
        }
    }
    walk(root);
    return files.sort((a, b) => a.name.localeCompare(b.name));
}

// 标准 ZIP，支持 Store/Deflate。严格约束目录与文件头，避免解压路径穿透和资源耗尽。
function encodeZip(files, { store = false, native = false } = {}) {
    const local = [],
        central = [];
    let offset = 0;
    for (const { name, data } of files) {
        safeName(name, { native });
        const filename = Buffer.from(name, 'utf8'),
            compressed = store ? data : deflateRawSync(data),
            crc = crc32(data);
        const head = Buffer.alloc(30);
        head.writeUInt32LE(0x04034b50);
        head.writeUInt16LE(20, 4);
        head.writeUInt16LE(0x800, 6);
        head.writeUInt16LE(store ? 0 : 8, 8);
        head.writeUInt32LE(crc, 14);
        head.writeUInt32LE(compressed.length, 18);
        head.writeUInt32LE(data.length, 22);
        head.writeUInt16LE(filename.length, 26);
        local.push(head, filename, compressed);
        const record = Buffer.alloc(46);
        record.writeUInt32LE(0x02014b50);
        record.writeUInt16LE(20, 4);
        record.writeUInt16LE(20, 6);
        record.writeUInt16LE(0x800, 8);
        record.writeUInt16LE(store ? 0 : 8, 10);
        record.writeUInt32LE(crc, 16);
        record.writeUInt32LE(compressed.length, 20);
        record.writeUInt32LE(data.length, 24);
        record.writeUInt16LE(filename.length, 28);
        record.writeUInt32LE(offset, 42);
        central.push(record, filename);
        offset += head.length + filename.length + compressed.length;
    }
    const directory = Buffer.concat(central),
        end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50);
    end.writeUInt16LE(files.length, 8);
    end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...local, directory, end]);
}
function decodeZip(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 22 || buffer.length > ARCHIVE_LIMIT)
        throw Error('插件安装包大小不正确');
    let end = buffer.length - 22;
    while (
        end >= Math.max(0, buffer.length - 65557) &&
        !(buffer.readUInt32LE(end) === 0x06054b50 && end + 22 + buffer.readUInt16LE(end + 20) === buffer.length)
    )
        end--;
    if (end < Math.max(0, buffer.length - 65557)) throw Error('插件安装包不是有效的 ZIP');
    const count = buffer.readUInt16LE(end + 10),
        start = buffer.readUInt32LE(end + 16),
        size = buffer.readUInt32LE(end + 12);
    if (
        buffer.readUInt16LE(end + 4) ||
        buffer.readUInt16LE(end + 6) ||
        count !== buffer.readUInt16LE(end + 8) ||
        !count ||
        count > 500 ||
        start + size !== end
    )
        throw Error('插件包目录结构不受支持');
    const files = [],
        names = new Set(),
        ranges = [];
    let at = start,
        total = 0;
    for (let i = 0; i < count; i++) {
        if (at + 46 > end || buffer.readUInt32LE(at) !== 0x02014b50) throw Error('插件包目录损坏');
        const flags = buffer.readUInt16LE(at + 8),
            method = buffer.readUInt16LE(at + 10),
            crc = buffer.readUInt32LE(at + 16),
            packed = buffer.readUInt32LE(at + 20),
            length = buffer.readUInt32LE(at + 24),
            n = buffer.readUInt16LE(at + 28),
            extra = buffer.readUInt16LE(at + 30),
            comment = buffer.readUInt16LE(at + 32),
            attrs = buffer.readUInt32LE(at + 38),
            position = buffer.readUInt32LE(at + 42);
        if (
            at + 46 + n + extra + comment > end ||
            buffer.readUInt16LE(at + 34) ||
            flags & ~0x808 ||
            ![0, 8].includes(method) ||
            ((attrs >>> 16) & 0xf000) === 0xa000 ||
            attrs & 0x400
        )
            throw Error('插件包包含加密、链接或不支持的格式');
        const rawName = buffer.subarray(at + 46, at + 46 + n);
        const name = new TextDecoder('utf-8', { fatal: true }).decode(rawName),
            directory = name.endsWith('/');
        safeName(directory ? name + 'placeholder.txt' : name, { native: true });
        const normalized = (directory ? name.slice(0, -1) : name).toLowerCase();
        if (names.has(normalized)) throw Error('插件包文件路径重复');
        names.add(normalized);
        if ((total += length) > NATIVE_LIMIT || (!directory && files.length >= 300) || (directory && length))
            throw Error('插件包展开后超过限制');
        if (position + 30 > start || buffer.readUInt32LE(position) !== 0x04034b50) throw Error('插件文件头损坏');
        const localName = buffer.readUInt16LE(position + 26),
            localExtra = buffer.readUInt16LE(position + 28),
            body = position + 30 + localName + localExtra;
        if (
            body + packed > start ||
            !buffer.subarray(position + 30, position + 30 + localName).equals(rawName) ||
            buffer.readUInt16LE(position + 6) !== flags ||
            buffer.readUInt16LE(position + 8) !== method
        )
            throw Error('插件包文件头不一致');
        if (
            !(flags & 8) &&
            (buffer.readUInt32LE(position + 14) !== crc ||
                buffer.readUInt32LE(position + 18) !== packed ||
                buffer.readUInt32LE(position + 22) !== length)
        )
            throw Error('插件包大小或校验信息不一致');
        const data =
            method === 8
                ? inflateRawSync(buffer.subarray(body, body + packed), { maxOutputLength: Math.max(1, length) })
                : buffer.subarray(body, body + packed);
        if (data.length !== length || crc32(data) !== crc) throw Error('插件包文件校验失败');
        ranges.push([position, body + packed]);
        if (!directory) files.push({ name, data });
        at += 46 + n + extra + comment;
    }
    if (at !== end) throw Error('插件包目录长度不正确');
    ranges.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < ranges.length; i++) if (ranges[i][0] < ranges[i - 1][1]) throw Error('插件包文件区域重叠');
    for (const { name } of files) {
        let prefix = name;
        while (prefix.includes('/')) {
            prefix = prefix.slice(0, prefix.lastIndexOf('/'));
            if (files.some((f) => f.name.toLowerCase() === prefix.toLowerCase())) throw Error('插件包文件与目录冲突');
        }
    }
    const manifestFile = files.find((f) => f.name === 'manifest.json');
    let native = false;
    try {
        native = JSON.parse(manifestFile?.data).runtime === 'native';
    } catch {
        /* readManifest 提供清单错误。 */
    }
    if (native) require('./native-signature').verifyFiles(files);
    else {
        if (total > LIMIT) throw Error('页面插件包展开后超过限制');
        for (const file of files) safeName(file.name);
    }
    return files;
}

class PluginPackages {
    constructor(registry, stagingRoot) {
        this.registry = registry;
        this.root = stagingRoot;
        fs.mkdirSync(this.root, { recursive: true });
    }
    export(id) {
        const plugin = this.registry.get(id);
        if (plugin.builtin) throw Error('默认插件请通过 Collectify 安装包分发或在插件管理中恢复');
        readManifest(plugin.directory);
        return encodeZip(collectFiles(plugin.directory), { native: plugin.runtime === 'native' });
    }
    prepare(buffer, expected) {
        if (expected?.sha256 && sha256(buffer) !== expected.sha256) throw Error('下载的插件包 SHA-256 校验失败');
        const files = decodeZip(buffer),
            directory = path.join(this.root, randomUUID());
        fs.mkdirSync(directory);
        try {
            for (const { name, data } of files) {
                const file = path.join(directory, name);
                fs.mkdirSync(path.dirname(file), { recursive: true });
                fs.writeFileSync(file, data, { flag: 'wx' });
            }
            const manifest = readManifest(directory);
            if (expected && (manifest.id !== expected.id || manifest.version !== expected.version))
                throw Error('插件包 ID 或版本与下载目录不一致');
            return { directory, manifest, digest: sha256(buffer) };
        } catch (error) {
            fs.rmSync(directory, { recursive: true, force: true });
            throw error;
        }
    }
    cleanup(prepared) {
        const target = path.resolve(prepared.directory);
        if (path.dirname(target) !== path.resolve(this.root)) throw Error('插件暂存路径越界');
        fs.rmSync(target, { recursive: true, force: true });
    }
}
module.exports = { PluginPackages, collectFiles, encodeZip, decodeZip, safeName, sha256, ARCHIVE_LIMIT };
