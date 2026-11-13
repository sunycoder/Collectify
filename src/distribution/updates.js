const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { webUrl } = require('./config');
const { compareVersion } = require('../plugin-system/catalog');
const VERSION = /^\d+\.\d+\.\d+$/;
function selectUpdate(input, { version, platform = process.platform, arch = process.arch, config }) {
    if (
        input?.format !== 'collectify-app-update' ||
        input.schemaVersion !== 1 ||
        !VERSION.test(input.version) ||
        input.version.length > 60 ||
        !Array.isArray(input.files) ||
        input.files.length > 20 ||
        typeof input.notes !== 'string' ||
        input.notes.length > 30000
    )
        throw Error('主程序更新清单格式不正确');
    const extensions =
        platform === 'win32'
            ? ['exe']
            : platform === 'darwin'
              ? ['dmg']
              : process.env.APPIMAGE
                ? ['AppImage', 'deb']
                : ['deb', 'AppImage'];
    const candidates = input.files.filter((f) => f.platform === platform && f.arch === arch);
    const file = extensions.map((ext) => candidates.find((f) => f.name?.endsWith('.' + ext))).find(Boolean);
    if (!file) throw Error('该版本尚未发布当前系统与架构的安装包');
    if (
        !/^Collectify-[\w.-]+\.(exe|dmg|deb|AppImage)$/.test(file.name) ||
        !/^[a-f0-9]{64}$/.test(file.sha256) ||
        !Number.isSafeInteger(file.size) ||
        file.size < 1 ||
        file.size > 1024 * 1024 * 1024
    )
        throw Error('更新文件信息不正确');
    webUrl(file.url, config);
    return {
        version: input.version,
        notes: input.notes,
        available: compareVersion(input.version, version) > 0,
        file: { name: file.name, url: file.url, size: file.size, sha256: file.sha256, platform, arch }
    };
}
async function downloadUpdate(client, update, directory, { signal, progress } = {}) {
    fs.mkdirSync(directory, { recursive: true });
    const temporary = path.join(directory, randomUUID() + '.partial'),
        target = path.join(directory, update.file.name);
    const handle = await fs.promises.open(temporary, 'wx', 0o600),
        hash = createHash('sha256');
    try {
        const received = await client.download(update.file.url, {
            signal,
            limit: update.file.size,
            progress,
            sink: async (bytes) => {
                hash.update(bytes);
                let offset = 0;
                while (offset < bytes.length) {
                    const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset);
                    offset += bytesWritten;
                }
            }
        });
        await handle.close();
        if (received !== update.file.size || hash.digest('hex') !== update.file.sha256)
            throw Error('安装包大小或 SHA-256 校验失败');
        client.controller.signal.throwIfAborted();
        signal?.throwIfAborted();
        fs.renameSync(temporary, target);
        return target;
    } finally {
        await handle.close().catch(() => {});
        if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
    }
}
async function verifyInstaller(file, update) {
    const hash = createHash('sha256');
    let size = 0;
    for await (const chunk of fs.createReadStream(file)) {
        size += chunk.length;
        hash.update(chunk);
    }
    if (size !== update.file.size || hash.digest('hex') !== update.file.sha256)
        throw Error('安装包已发生变化，请重新下载');
}
module.exports = { selectUpdate, downloadUpdate, verifyInstaller };
