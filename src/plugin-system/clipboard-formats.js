const { createHash } = require('node:crypto');
const { fileURLToPath } = require('node:url');
const MAX_BINARY = 4 * 1024 * 1024;
const RAW_DROP = 'electron application/osclipboard;format="CF_HDROP"';
const RAW_FILENAME = 'electron application/osclipboard;format="FileNameW"';
const FILE_TYPES = [
    'text/uri-list',
    'electron application/osclipboard;format="public.file-url"',
    RAW_DROP,
    RAW_FILENAME
];
function fingerprint(snapshot, nativeImage) {
    let content = snapshot.text || snapshot.format + '\0' + snapshot.data;
    if (snapshot.kind === 'image' && nativeImage) {
        const image = nativeImage.createFromBuffer(Buffer.from(snapshot.data, 'base64')),
            size = image.getSize();
        if (!image.isEmpty() && image.toBitmap)
            content = Buffer.concat([Buffer.from(`${size.width}x${size.height}\0`), image.toBitmap()]);
    }
    if (snapshot.kind === 'files')
        content = filePaths(snapshot.format, Buffer.from(snapshot.data, 'base64')).join('\n');
    return createHash('sha256')
        .update(snapshot.kind + '\0')
        .update(content)
        .digest('hex');
}
function filePaths(type, buffer) {
    let text;
    if (type === RAW_DROP) {
        if (buffer.length < 20) throw Error('文件剪贴板格式损坏');
        const offset = buffer.readUInt32LE(0);
        if (offset < 20 || offset > buffer.length || buffer.readUInt32LE(16) !== 1)
            throw Error('文件剪贴板编码不受支持');
        text = buffer.subarray(offset).toString('utf16le');
    } else text = buffer.toString(type === RAW_FILENAME ? 'utf16le' : 'utf8');
    const lines = text.split(/[\0\r\n]+/).filter((line) => line && !line.startsWith('#'));
    const files = lines
        .map((line) => (line.startsWith('file:') ? fileURLToPath(line) : line))
        .filter((p) => /^(?:[a-z]:[\\/]|\\\\|\/)/i.test(p));
    if (files.length > 100) throw Error('一次最多记录 100 个文件');
    return files;
}
async function captureClipboard({ clipboard, nativeImage, allowed }) {
    if (!allowed()) throw Error('剪贴板采集已停止');
    const items = await clipboard.read();
    let result = null;
    for (const item of items) {
        for (const type of FILE_TYPES) {
            if (!item.types.includes(type)) continue;
            const blob = await item.getType(type);
            if (blob.size > 256 * 1024) throw Error('文件列表过大');
            const data = Buffer.from(await blob.arrayBuffer()),
                files = filePaths(type, data);
            if (files.length) {
                result = { kind: 'files', files, format: type, data: data.toString('base64'), bytes: data.length };
                break;
            }
        }
        if (result) break;
        const type = item.types.find((t) => ['image/png', 'image/jpeg'].includes(t));
        if (type) {
            const blob = await item.getType(type);
            if (blob.size > MAX_BINARY) throw Error('图片超过 4 MB，未采集');
            const data = Buffer.from(await blob.arrayBuffer()),
                image = nativeImage.createFromBuffer(data),
                size = image.getSize();
            if (image.isEmpty() || size.width * size.height > 40000000) throw Error('图片尺寸不受支持');
            result = {
                kind: 'image',
                format: type,
                data: data.toString('base64'),
                bytes: data.length,
                width: size.width,
                height: size.height
            };
            break;
        }
        if (item.types.includes('text/plain')) {
            const blob = await item.getType('text/plain');
            if (blob.size > 64 * 1024) throw Error('文本超过 64 KB，未采集');
            const text = await blob.text();
            if (text) result = { kind: 'text', text, bytes: Buffer.byteLength(text) };
        }
    }
    if (!allowed()) throw Error('剪贴板采集已停止');
    if (!result) return null;
    result.fingerprint = fingerprint(result, nativeImage);
    return result;
}
async function writeSnapshot({ clipboard, ClipboardItem, nativeImage }, snapshot) {
    if (snapshot?.kind === 'text') {
        if (typeof snapshot.text !== 'string' || Buffer.byteLength(snapshot.text) > 64 * 1024)
            throw Error('文本格式不正确');
        await clipboard.writeText(snapshot.text);
        return { fingerprint: fingerprint(snapshot, nativeImage) };
    }
    if (
        !snapshot ||
        !['image', 'files'].includes(snapshot.kind) ||
        typeof snapshot.data !== 'string' ||
        snapshot.data.length > 6 * 1024 * 1024
    )
        throw Error('剪贴板内容不正确');
    if (
        (snapshot.kind === 'image' && !['image/png', 'image/jpeg'].includes(snapshot.format)) ||
        (snapshot.kind === 'files' && !FILE_TYPES.includes(snapshot.format))
    )
        throw Error('剪贴板格式未授权');
    const data = Buffer.from(snapshot.data, 'base64');
    if (data.length > MAX_BINARY) throw Error('剪贴板内容过大');
    if (snapshot.kind === 'files' && !filePaths(snapshot.format, data).length) throw Error('文件列表为空');
    await clipboard.write([
        new ClipboardItem({ [snapshot.format]: new Blob([new Uint8Array(data)], { type: snapshot.format }) })
    ]);
    return { fingerprint: fingerprint(snapshot, nativeImage) };
}
module.exports = { captureClipboard, writeSnapshot, filePaths, FILE_TYPES, RAW_DROP, RAW_FILENAME };
