const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { readManifest, pluginId } = require('../src/plugin-system/manifest');
const { collectFiles, encodeZip, sha256, PluginPackages } = require('../src/plugin-system/package');
const { validateCatalog } = require('../src/plugin-system/catalog');

// 发布配置只引用仓库中的静态源码，构建不会执行插件脚本或读取用户数据。
function buildCatalog({
    root = path.resolve(__dirname, '..'),
    output = path.join(root, '.plugin-release'),
    check = false
} = {}) {
    const definition = JSON.parse(fs.readFileSync(path.join(root, 'plugins', 'definitions.json'), 'utf8'));
    if (
        !/^[\w.-]+\/[\w.-]+$/.test(definition.repository) ||
        !/^plugins-[\w.-]+$/.test(definition.releaseTag) ||
        !Array.isArray(definition.plugins) ||
        !definition.plugins.length
    )
        throw Error('插件发布配置不正确');
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'collectify-publish-')),
        entries = [],
        packages = [];
    const catalogFile = path.join(root, 'plugins', 'catalog.json');
    const previous = fs.existsSync(catalogFile)
        ? validateCatalog(JSON.parse(fs.readFileSync(catalogFile, 'utf8')))
        : [];
    try {
        const validator = new PluginPackages(null, path.join(temp, 'validate'));
        for (const item of definition.plugins) {
            pluginId(item.id);
            if (
                typeof item.source !== 'string' ||
                !item.source.startsWith('src/') ||
                item.source.includes('\\') ||
                item.source.split('/').some((p) => p === '..' || p === '.' || !p)
            )
                throw Error('插件源码必须位于仓库 src 目录');
            const source = path.resolve(root, item.source),
                manifest = readManifest(source),
                files = collectFiles(source);
            const published = {
                ...manifest,
                id: item.id,
                name: item.name,
                version: item.version,
                ...(item.iconAsset ? { iconAsset: item.iconAsset } : {})
            };
            files.find((f) => f.name === 'manifest.json').data = Buffer.from(JSON.stringify(published, null, 2) + '\n');
            // 官方包使用 ZIP Store，确保不同 Node/zlib 版本生成的字节与校验值相同。
            const data = encodeZip(files, { store: true }),
                prepared = validator.prepare(data);
            validator.cleanup(prepared);
            const filename = `${published.id}-${published.version}.collectify-plugin`,
                digest = sha256(data),
                prior = previous.find((p) => p.id === published.id);
            if (prior && prior.version === published.version && prior.sha256 !== digest)
                throw Error(`插件 ${published.id} 的程序改变，请提高版本号后发布`);
            packages.push({ filename, data });
            entries.push({
                id: published.id,
                name: published.name,
                description: published.description,
                version: published.version,
                apiVersion: published.apiVersion,
                size: data.length,
                sha256: digest,
                url: `https://github.com/${definition.repository}/releases/download/${definition.releaseTag}/${filename}`
            });
        }
        const catalog = { format: 'collectify-plugin-catalog', version: 1, plugins: entries };
        validateCatalog(catalog);
        const text = JSON.stringify(catalog, null, 2) + '\n';
        if (check && (!fs.existsSync(catalogFile) || fs.readFileSync(catalogFile, 'utf8') !== text))
            throw Error('plugins/catalog.json 与源码不一致，请运行 npm run plugins:build 并提交目录');
        fs.mkdirSync(output, { recursive: true });
        for (const { filename, data } of packages) fs.writeFileSync(path.join(output, filename), data);
        fs.writeFileSync(path.join(output, 'catalog.json'), text, 'utf8');
        if (!check) fs.writeFileSync(catalogFile, text, 'utf8');
        return { tag: definition.releaseTag, repository: definition.repository, plugins: entries, output };
    } finally {
        fs.rmSync(temp, { recursive: true, force: true });
    }
}
if (require.main === module) {
    try {
        const result = buildCatalog({ check: process.argv.includes('--check') });
        console.log(`已校验并生成 ${result.plugins.length} 个插件包：${result.output}`);
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
module.exports = { buildCatalog };
