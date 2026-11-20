const fs = require('node:fs'),
    path = require('node:path');
// 只认宿主自身已登记的随包目录，不因清单 ID 相同就信任任意复制目录。
function builtinSource(source, registry) {
    const canonical = (file) => {
        const real = fs.realpathSync(file);
        return process.platform === 'win32' ? real.toLowerCase() : real;
    };
    const selected = canonical(source);
    return registry.defaults().find((plugin) => canonical(plugin.directory) === selected) || null;
}
function assertPageSource(source) {
    const file = path.join(source, 'manifest.json');
    if (!fs.existsSync(file) || fs.statSync(file).size > 32000) throw Error('请选择包含有效 manifest.json 的插件目录');
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    if (manifest.backend)
        throw Error(
            `“${String(manifest.name || manifest.id || '此插件').slice(0, 100)}”包含原生后台，不能通过页面插件入口安装。请使用发布者签名的原生插件包，或选择默认插件原目录以启用/恢复。`
        );
    return manifest;
}
// 只扫描常见源码集合和两层子目录，不遍历依赖、版本库或用户数据目录。
function discoverSources(selected) {
    const root = fs.realpathSync(selected),
        candidates = [],
        seen = new Set();
    const ignore = new Set(['node_modules', 'vendor', 'dist', 'build', 'target', 'data', 'artifacts']);
    let entries = 0;
    function visit(folder, depth) {
        const stat = fs.lstatSync(folder);
        if (!stat.isDirectory() || stat.isSymbolicLink()) return;
        if (fs.existsSync(path.join(folder, 'manifest.json'))) {
            try {
                const manifest = readSource(folder);
                const prior = candidates.find((p) => p.id === manifest.id);
                // 同项目优先选择构建好的默认插件包，原始默认源码依赖共享构建不能直接加载。
                const row = {
                    id: manifest.id,
                    name: manifest.name,
                    version: manifest.version,
                    path: folder,
                    permissions: manifest.permissions,
                    runtime: manifest.runtime,
                    publisher: manifest.publisher
                };
                if (prior) {
                    if (folder.includes(path.sep + 'default-packages' + path.sep)) Object.assign(prior, row);
                } else candidates.push(row);
            } catch (error) {
                candidates.push({ path: folder, name: path.basename(folder), error: error.message });
            }
            return;
        }
        if (depth === 0) return;
        for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
            if (++entries > 1000) throw Error('开发目录过大，请选择插件集合目录');
            if (
                entry.isDirectory() &&
                !entry.isSymbolicLink() &&
                !entry.name.startsWith('.') &&
                !ignore.has(entry.name)
            )
                visit(path.join(folder, entry.name), depth - 1);
        }
    }
    const roots = [
        'src/default-packages',
        'src/plugin-library',
        ...(fs.existsSync(path.join(root, 'src/default-packages')) ? [] : ['src/plugins'])
    ]
        .map((p) => path.join(root, p))
        .filter((p) => fs.existsSync(p));
    for (const folder of roots.length ? roots : [root]) {
        const canonical = fs.realpathSync(folder);
        if (!seen.has(canonical)) {
            seen.add(canonical);
            visit(canonical, 2);
        }
    }
    return candidates.slice(0, 100);
}
function readSource(folder) {
    return require('./manifest').readManifest(folder);
}
module.exports = { builtinSource, assertPageSource, discoverSources };
