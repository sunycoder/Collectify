const { test } = require('node:test'),
    assert = require('node:assert/strict');
const fs = require('node:fs'),
    os = require('node:os'),
    path = require('node:path');
const { discoverSources } = require('../src/plugin-system/source-install');
const { PluginRegistry } = require('../src/plugin-system/registry');
function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'collectify-local-batch-'));
    t.after(() => fs.rmSync(root, { force: true, recursive: true }));
    return root;
}
function plugin(folder, id) {
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(
        path.join(folder, 'manifest.json'),
        JSON.stringify({
            id,
            name: id,
            description: '批量调试',
            version: '1.0.0',
            apiVersion: 1,
            entry: 'index.html',
            permissions: ['storage'],
            commands: [{ id: 'open', title: '打开' }]
        })
    );
    fs.writeFileSync(path.join(folder, 'index.html'), '<h1>初始页面</h1>');
}
test('开发目录批量发现多个插件，忽略依赖目录并单独报告坏清单', (t) => {
    const root = fixture(t);
    plugin(path.join(root, 'src/plugin-library/one'), 'example.one');
    plugin(path.join(root, 'src/plugin-library/two'), 'example.two');
    plugin(path.join(root, 'src/plugin-library/node_modules/hidden'), 'example.hidden');
    fs.mkdirSync(path.join(root, 'src/plugin-library/bad'));
    fs.writeFileSync(path.join(root, 'src/plugin-library/bad/manifest.json'), '{bad');
    const found = discoverSources(root);
    assert.deepEqual(
        found
            .filter((p) => !p.error)
            .map((p) => p.id)
            .sort(),
        ['example.one', 'example.two']
    );
    assert.equal(found.filter((p) => p.error).length, 1);
});
test('开发加载允许同版本重新载入且保留数据和停用状态，正常安装仍拒绝同版本不同内容', (t) => {
    const root = fixture(t),
        source = path.join(root, 'source');
    plugin(source, 'example.local');
    const registry = new PluginRegistry({
        builtinRoot: path.resolve('src/plugins'),
        userRoot: path.join(root, 'packages'),
        dataRoot: path.join(root, 'data'),
        hostFile: path.join(root, 'host.sqlite')
    });
    registry.install(source);
    registry.storage.set('example.local', 'keep', { value: 42 });
    registry.setEnabled('example.local', false);
    fs.writeFileSync(path.join(source, 'index.html'), '<h1>修改后的页面</h1>');
    assert.throws(() => registry.install(source), /提高插件版本号/);
    registry.install(source, undefined, { development: true });
    assert.equal(registry.get('example.local').enabled, false);
    assert.deepEqual(registry.storage.get('example.local', 'keep'), { value: 42 });
    assert.match(fs.readFileSync(path.join(registry.get('example.local').directory, 'index.html'), 'utf8'), /修改后/);
});
