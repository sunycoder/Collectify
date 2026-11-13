// 用法：node scripts/package-plugin.cjs <源码目录> <输出目录> [HTTPS 下载目录]
// 仅生成产物，不上传 GitHub，不读取插件用户数据库。
const fs = require('node:fs'),
    path = require('node:path');
const { readManifest } = require('../src/plugin-system/manifest');
const { collectFiles, encodeZip, sha256 } = require('../src/plugin-system/package');
const { validateCatalog, httpsUrl } = require('../src/plugin-system/catalog');
try {
    const [source, output, base] = process.argv.slice(2);
    if (!source || !output) throw Error('用法：node scripts/package-plugin.cjs <源码目录> <输出目录> [HTTPS 下载目录]');
    const root = path.resolve(source),
        target = path.resolve(output);
    if (target === root || target.startsWith(root + path.sep)) throw Error('输出目录不能位于插件源码目录内');
    const manifest = readManifest(root),
        buffer = encodeZip(collectFiles(root)),
        name = `${manifest.id}-${manifest.version}.collectify-plugin`;
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(target, name), buffer);
    if (base) {
        const url = new URL(encodeURIComponent(name), httpsUrl(base.endsWith('/') ? base : base + '/')).href;
        const file = path.join(target, 'catalog.json'),
            old = fs.existsSync(file)
                ? JSON.parse(fs.readFileSync(file, 'utf8'))
                : { format: 'collectify-plugin-catalog', version: 1, plugins: [] };
        const plugins = validateCatalog(old).filter((p) => p.id !== manifest.id);
        plugins.push({
            id: manifest.id,
            name: manifest.name,
            description: manifest.description,
            version: manifest.version,
            apiVersion: manifest.apiVersion,
            size: buffer.length,
            sha256: sha256(buffer),
            url
        });
        const next = { format: 'collectify-plugin-catalog', version: 1, plugins };
        validateCatalog(next);
        fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n', 'utf8');
    }
    console.log(`已生成 ${path.join(target, name)}\nSHA-256: ${sha256(buffer)}`);
} catch (error) {
    console.error(error.message);
    process.exitCode = 1;
}
