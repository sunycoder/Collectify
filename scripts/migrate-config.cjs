const fs = require('node:fs'),
    path = require('node:path');
function migrate(root = path.resolve(__dirname, '..')) {
    const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8').replace(/^\uFEFF/, ''));
    const baseFile = 'config/app-defaults.json',
        localFile = 'config/local.json';
    const base = read(baseFile),
        local = fs.existsSync(path.join(root, localFile)) ? read(localFile) : {};
    if (!base.initialData && fs.existsSync(path.join(root, 'config/default-config.json')))
        base.initialData = read('config/default-config.json');
    if (fs.existsSync(path.join(root, 'default-config.json'))) {
        const initial = read('default-config.json');
        if (local.initialData && JSON.stringify(local.initialData) !== JSON.stringify(initial))
            throw Error('本机初始数据与旧文件冲突，保留全部原文件，请先核对');
        local.initialData = initial;
        if (initial.settings) local.settings = { ...initial.settings, ...local.settings };
    }
    for (const file of ['distribution.json', 'config/distribution.json']) {
        if (!fs.existsSync(path.join(root, file))) continue;
        const source = read(file);
        local.sources ||= {};
        if (local.sources[source.provider] && JSON.stringify(local.sources[source.provider]) !== JSON.stringify(source))
            throw Error('同平台发布源存在不同配置，保留全部原文件，请先核对');
        if (source.provider === base.distribution.provider) {
            if (local.distribution && JSON.stringify(local.distribution) !== JSON.stringify(source))
                throw Error('发布源与本机覆盖冲突');
            local.distribution = source;
        } else local.sources[source.provider] = source;
    }
    const old = [
        'default-config.json',
        'distribution.json',
        'config/default-config.json',
        'config/distribution.json',
        'config/distribution.example.json'
    ].filter((file) => fs.existsSync(path.join(root, file)));
    const backup = path.join(root, 'dist', 'config-migration-' + Date.now());
    fs.mkdirSync(backup, { recursive: true });
    for (const file of [...old, baseFile, ...(fs.existsSync(path.join(root, localFile)) ? [localFile] : [])]) {
        const target = path.join(backup, file);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(path.join(root, file), target);
    }
    fs.writeFileSync(path.join(root, baseFile), JSON.stringify(base, null, 2) + '\n', 'utf8');
    fs.writeFileSync(path.join(root, localFile), JSON.stringify(local, null, 2) + '\n', 'utf8');
    fs.mkdirSync(path.join(root, 'examples'), { recursive: true });
    if (fs.existsSync(path.join(root, 'config/example-import.json')))
        fs.renameSync(path.join(root, 'config/example-import.json'), path.join(root, 'examples/bookmarks-import.json'));
    for (const file of old) fs.unlinkSync(path.join(root, file));
    console.log('已合并旧配置并保留备份：' + backup);
}
if (require.main === module) {
    try {
        migrate();
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
module.exports = { migrate };
