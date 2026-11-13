const fs = require('node:fs'),
    path = require('node:path'),
    { Worker } = require('node:worker_threads');
const { randomUUID } = require('node:crypto');
const { Readable } = require('node:stream');
const { run } = require('./engine');
const MEDIA = {
    '.mp4': 'video/mp4',
    '.ogv': 'video/ogg',
    '.ogm': 'video/ogg',
    '.webm': 'video/webm',
    '.flac': 'audio/flac',
    '.m4a': 'audio/mp4',
    '.mp3': 'audio/mpeg',
    '.ogg': 'audio/ogg',
    '.oga': 'audio/ogg',
    '.opus': 'audio/ogg',
    '.wav': 'audio/wav'
};
const IMAGES = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.bmp': 'image/bmp',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.webp': 'image/webp'
};
class PreviewService {
    constructor(engine, { thumbnail = null } = {}) {
        this.engine = engine;
        this.thumbnail = thumbnail;
        this.tokens = new Map();
        this.workers = new Set();
    }
    link(file, mime) {
        const id = randomUUID();
        this.tokens.set(id, { file, mime, expires: Date.now() + 10 * 60 * 1000 });
        for (const [key, value] of this.tokens) if (value.expires < Date.now()) this.tokens.delete(key);
        while (this.tokens.size > 100) this.tokens.delete(this.tokens.keys().next().value);
        return `collectify-plugin://collectify.local-search/__resources/${id}`;
    }
    async document(file, type, sheetIndex) {
        return new Promise((resolve, reject) => {
            const worker = new Worker(path.join(__dirname, 'vendor', 'preview-worker.cjs'), {
                workerData: { file, type, sheetIndex },
                resourceLimits: { maxOldGenerationSizeMb: 192 }
            });
            this.workers.add(worker);
            const timer = setTimeout(() => {
                void worker.terminate();
                reject(Error('文件预览耗时过长，已停止解析'));
            }, 7000);
            worker.once('message', (message) => {
                clearTimeout(timer);
                this.workers.delete(worker);
                void worker.terminate();
                message.error ? reject(Error(message.error)) : resolve(message.result);
            });
            worker.once('error', (error) => {
                clearTimeout(timer);
                this.workers.delete(worker);
                reject(Error('文件预览失败：' + error.message));
            });
            worker.once('exit', (code) => {
                clearTimeout(timer);
                this.workers.delete(worker);
                if (code !== 0) reject(Error('文件预览已停止'));
            });
        });
    }
    async preview(file, { sheetIndex = 0 } = {}) {
        const stat = await fs.promises.stat(file),
            ext = path.extname(file).toLowerCase();
        const metadata = {
            name: path.basename(file),
            path: file,
            size: stat.size,
            modified: stat.mtimeMs,
            directory: stat.isDirectory(),
            extension: ext
        };
        if (stat.isDirectory()) return { ...metadata, kind: 'metadata', message: '文件夹：双击或点击“打开”浏览内容。' };
        if (MEDIA[ext])
            return {
                ...metadata,
                kind: MEDIA[ext].startsWith('audio') ? 'audio' : 'video',
                url: this.link(file, MEDIA[ext])
            };
        if (IMAGES[ext]) {
            if (stat.size > 24 * 1024 * 1024)
                return { ...metadata, kind: 'metadata', message: '图片超过 24 MB，请使用外部程序打开。' };
            return { ...metadata, kind: 'image', url: this.link(file, IMAGES[ext]) };
        }
        if (ext === '.pdf' || ext === '.ai') {
            const handle = await fs.promises.open(file, 'r');
            const head = Buffer.alloc(1024);
            try {
                await handle.read(head, 0, 1024, 0);
            } finally {
                await handle.close();
            }
            if (head.includes(Buffer.from('%PDF-')))
                return { ...metadata, kind: 'pdf', url: this.link(file, 'application/pdf') };
            if (ext === '.ai' && this.thumbnail) {
                try {
                    const image = await this.thumbnail(file);
                    if (image) return { ...metadata, kind: 'image', url: image };
                } catch {}
            }
            return {
                ...metadata,
                kind: 'metadata',
                message: '此 AI 文件不是 PDF 兼容格式，且系统没有可用缩略图。请用 Illustrator 打开。'
            };
        }
        if (['.xlsx', '.xls', '.csv', '.docx', '.psd'].includes(ext)) {
            if (stat.size > 32 * 1024 * 1024)
                return { ...metadata, kind: 'metadata', message: '文档超过 32 MB，已跳过内容解析。' };
            try {
                const result = await this.document(file, ext.slice(1), sheetIndex);
                if (result.data) {
                    result.url = 'data:image/png;base64,' + result.data;
                    delete result.data;
                }
                return { ...metadata, ...result };
            } catch (error) {
                return { ...metadata, kind: 'metadata', message: error.message };
            }
        }
        if (['.zip', '.gz', '.7z', '.rar', '.tar', '.xz', '.bz2'].includes(ext)) {
            try {
                const executable = this.engine.native('7z.exe');
                this.engine.native('7z.dll');
                const output = await run(executable, ['l', '-slt', '-ba', '-sccUTF-8', '-p-', '--', file], {
                    timeout: 5000,
                    maxBuffer: 2 * 1024 * 1024
                });
                const rows = output
                    .split(/\r?\n\r?\n/)
                    .map((block) =>
                        Object.fromEntries(
                            block
                                .split(/\r?\n/)
                                .filter((line) => line.includes(' = '))
                                .map((line) => {
                                    const index = line.indexOf(' = ');
                                    return [line.slice(0, index), line.slice(index + 3)];
                                })
                        )
                    )
                    .filter((row) => row.Path)
                    .slice(0, 1000)
                    .map((row) => ({
                        name: row.Path,
                        size: row.Size || '',
                        directory: row.Folder === '+' || row.Attributes?.startsWith('D')
                    }));
                return { ...metadata, kind: 'archive', rows, truncated: rows.length === 1000 };
            } catch (error) {
                return {
                    ...metadata,
                    kind: 'metadata',
                    message: '无法读取压缩目录，文件可能加密或格式不支持。' + error.message
                };
            }
        }
        // 对其他文件按有限字节探测文本，绝不作为 HTML 执行。
        const handle = await fs.promises.open(file, 'r');
        let bytes = Buffer.alloc(Math.min(stat.size, 256 * 1024));
        try {
            const read = await handle.read(bytes, 0, bytes.length, 0);
            bytes = bytes.subarray(0, read.bytesRead);
        } finally {
            await handle.close();
        }
        let encoding = 'utf-8',
            text;
        if (bytes[0] === 0xff && bytes[1] === 0xfe) {
            encoding = 'utf-16le';
            text = new TextDecoder(encoding).decode(bytes.subarray(2));
        } else if (bytes[0] === 0xfe && bytes[1] === 0xff) {
            encoding = 'utf-16be';
            text = new TextDecoder(encoding).decode(bytes.subarray(2));
        } else if (bytes.includes(0))
            return { ...metadata, kind: 'metadata', message: '此文件是二进制格式，未找到可读的文本预览。' };
        else {
            try {
                text = new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: stat.size > bytes.length });
            } catch {
                encoding = 'gb18030';
                text = new TextDecoder(encoding).decode(bytes);
            }
        }
        return { ...metadata, kind: 'text', text, encoding, truncated: stat.size > bytes.length };
    }
    async resource(relative, request) {
        if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 });
        const id = relative.slice('__resources/'.length),
            record = this.tokens.get(id);
        if (!record || record.expires < Date.now()) return new Response('Preview expired', { status: 404 });
        let handle;
        try {
            handle = await fs.promises.open(record.file, 'r');
            const stat = await handle.stat();
            if (!stat.isFile()) {
                await handle.close();
                return new Response('Not a file', { status: 404 });
            }
            const range = request.headers.get('range');
            let start = 0,
                end = stat.size - 1,
                status = 200;
            if (range) {
                const match = range.match(/^bytes=(\d*)-(\d*)$/);
                if (!match || (!match[1] && !match[2])) {
                    await handle.close();
                    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
                }
                if (match[1]) {
                    start = Number(match[1]);
                    end = match[2] ? Math.min(Number(match[2]), end) : end;
                } else start = Math.max(0, stat.size - Number(match[2]));
                status = 206;
                if (start > end || start >= stat.size) {
                    await handle.close();
                    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${stat.size}` } });
                }
            }
            const headers = {
                'Content-Type': record.mime,
                'Content-Length': String(Math.max(0, end - start + 1)),
                'Accept-Ranges': 'bytes',
                'Cache-Control': 'no-store',
                'Content-Security-Policy': "default-src 'none'; sandbox",
                'X-Content-Type-Options': 'nosniff'
            };
            if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
            if (request.method === 'HEAD' || !stat.size) {
                await handle.close();
                return new Response(null, { status, headers });
            }
            return new Response(Readable.toWeb(handle.createReadStream({ start, end, autoClose: true })), {
                status,
                headers
            });
        } catch {
            await handle?.close().catch(() => {});
            return new Response('Preview file unavailable', { status: 404 });
        }
    }
    dispose() {
        for (const worker of this.workers) void worker.terminate();
        this.workers.clear();
        this.tokens.clear();
    }
}
module.exports = { PreviewService };
