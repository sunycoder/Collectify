const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'),
    path = require('node:path'),
    os = require('node:os');
const { PluginRegistry } = require('../src/plugin-system/registry');
const { readManifest } = require('../src/plugin-system/manifest');
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/></svg>';
function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'collectify-icon-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const directory = path.join(root, 'packages', 'example.icons');
    fs.mkdirSync(path.join(directory, 'icon'), { recursive: true });
    fs.mkdirSync(path.join(root, 'builtin'));
    const manifest = {
        id: 'example.icons',
        name: '自有图标',
        description: '测试',
        version: '1.0.0',
        apiVersion: 1,
        entry: 'index.html',
        permissions: [],
        commands: [{ id: 'open', title: '打开' }],
        icon: 'icon/icon.svg'
    };
    fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
    fs.writeFileSync(path.join(directory, 'index.html'), '<!doctype html><h1>test</h1>');
    fs.writeFileSync(path.join(directory, manifest.icon), svg);
    const registry = new PluginRegistry({
        builtinRoot: path.join(root, 'builtin'),
        userRoot: path.join(root, 'packages'),
        dataRoot: path.join(root, 'data'),
        hostFile: path.join(root, 'host.sqlite')
    });
    return { registry, directory, manifest };
}
test('插件自有图标延迟读取并缓存，公开信息不暴露文件路径，旧 iconAsset 保持兼容', async (t) => {
    const { registry, directory, manifest } = fixture(t);
    const original = fs.promises.open;
    let opened = 0;
    t.mock.method(fs.promises, 'open', (...args) => {
        opened++;
        return original(...args);
    });
    assert.equal(registry.list()[0].icon, 'icon/icon.svg');
    assert.equal(registry.list()[0].directory, undefined);
    assert.equal(opened, 0);
    const values = await Promise.all([registry.icon(manifest.id), registry.icon(manifest.id)]);
    assert.equal(opened, 1);
    assert.equal(values[0], values[1]);
    assert.equal(Buffer.from(values[0].split(',')[1], 'base64').toString(), svg);
    assert.equal(await registry.icon(manifest.id), values[0]);
    assert.equal(opened, 1);
    delete manifest.icon;
    manifest.iconAsset = '收藏.svg';
    fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
    registry.discover();
    assert.equal(registry.get(manifest.id).iconAsset, '收藏.svg');
    assert.equal(await registry.icon(manifest.id), null);
});
test('插件图标拒绝外部 URL、越界、非 SVG、超大内容，读取中停用不可交付旧图标', async (t) => {
    const { registry, directory, manifest } = fixture(t);
    for (const icon of ['../outside.svg', 'https://example.com/icon.svg', 'icon/../icon.svg', 'index.html']) {
        fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({ ...manifest, icon }));
        assert.throws(() => readManifest(directory));
    }
    fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest));
    fs.writeFileSync(path.join(directory, manifest.icon), 'x'.repeat(65537));
    assert.throws(() => readManifest(directory), /64 KiB/);
    await assert.rejects(registry.icon(manifest.id), /64 KiB/);
    fs.writeFileSync(path.join(directory, manifest.icon), svg);
    const pending = registry.icon(manifest.id);
    registry.setEnabled(manifest.id, false);
    await assert.rejects(pending, /停用/);
    await assert.rejects(registry.icon(manifest.id), /停用/);
    registry.setEnabled(manifest.id, true);
    assert.ok(await registry.icon(manifest.id));
});
test('全部随包与官方独立插件均声明自有图标，无需宿主 assets 注册', (t) => {
    const builtins = path.resolve(__dirname, '../src/plugins');
    const manifests = fs
        .readdirSync(builtins, { withFileTypes: true })
        .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
        .map((d) => path.join(builtins, d.name, 'manifest.json'));
    const definitions = require('../plugins/definitions.json');
    for (const plugin of definitions.plugins)
        manifests.push(path.resolve(__dirname, '..', plugin.source, 'manifest.json'));
    for (const file of manifests) {
        const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
        assert.ok(manifest.icon, file);
        assert.equal(manifest.iconAsset, undefined, file);
        assert.ok(fs.existsSync(path.join(path.dirname(file), manifest.icon)), file);
    }
});
