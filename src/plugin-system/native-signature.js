const fs = require('node:fs');
const path = require('node:path');
const { createHash, verify } = require('node:crypto');
const keys = require('./trusted-publishers.json');
const SIGNATURE_FILE = 'native-signature.json';
function payload(files) {
    return Buffer.from(
        JSON.stringify(
            files
                .filter((f) => f.name !== SIGNATURE_FILE)
                .map((f) => [f.name, createHash('sha256').update(f.data).digest('hex')])
                .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        )
    );
}
function verifyFiles(files) {
    const file = files.find((f) => f.name === SIGNATURE_FILE);
    if (!file || file.data.length > 4000) throw Error('原生插件缺少可信发布者签名');
    let signature;
    try {
        signature = JSON.parse(file.data);
    } catch {
        throw Error('原生插件签名格式不正确');
    }
    const publicKey = keys[signature.keyId];
    if (
        !publicKey ||
        !/^[A-Za-z0-9+/]{86}==$/.test(signature.value || '') ||
        !verify(null, payload(files), publicKey, Buffer.from(signature.value, 'base64'))
    )
        throw Error('原生插件签名不可信或程序已被篡改');
    return signature.keyId;
}
function verifyDirectory(root) {
    const files = [];
    let size = 0,
        entries = 0;
    function walk(folder, prefix = '', depth = 0) {
        if (depth > 20) throw Error('插件目录嵌套过深');
        for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
            if (['.gitignore', '.gitattributes', '.gitkeep'].includes(entry.name)) continue;
            if (++entries > 1000 || entry.isSymbolicLink()) throw Error('原生插件包含链接或过多文件');
            const file = path.join(folder, entry.name),
                name = prefix + entry.name;
            if (entry.isDirectory()) walk(file, name + '/', depth + 1);
            else if (entry.isFile()) {
                size += fs.statSync(file).size;
                if (size > 96 * 1024 * 1024) throw Error('原生插件超过大小限制');
                files.push({ name, data: fs.readFileSync(file) });
            } else throw Error('原生插件包含特殊文件');
        }
    }
    walk(root);
    return verifyFiles(files);
}
module.exports = { SIGNATURE_FILE, payload, verifyFiles, verifyDirectory };
