const { test } = require('node:test'),
    assert = require('node:assert/strict');
const fs = require('node:fs'),
    path = require('node:path'),
    os = require('node:os');
const { DatabaseSync } = require('node:sqlite');
const { PluginRegistry } = require('../src/plugin-system/registry');
const { PluginPackages } = require('../src/plugin-system/package');
test('默认安装包与插件市场同版本字节一致，避免同版本重装被错误拒绝', (t) => {
    const { root, options } = fixture(t),
        registry = new PluginRegistry(options);
    const built = require('../scripts/build-plugin-catalog.cjs').buildCatalog({ output: path.join(root, 'published') });
    const { sha256, decodeZip, encodeZip } = require('../src/plugin-system/package');
    const exporter = new PluginPackages(registry, path.join(root, 'stage'));
    for (const plugin of registry.list()) {
        const item = built.plugins.find((p) => p.id === plugin.id),
            data = exporter.export(plugin.id);
        assert.equal(sha256(encodeZip(decodeZip(data), { store: true, native: !!plugin.runtime })), item.sha256);
    }
});
function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'default-independent-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const options = {
        builtinRoot: path.resolve('src/plugins'),
        userRoot: path.join(root, 'packages'),
        dataRoot: path.join(root, 'data'),
        hostFile: path.join(root, 'host.sqlite')
    };
    return { root, options };
}
test('五个默认安装插件均位于用户目录，可导出，单独更新后主程序重启不覆盖', (t) => {
    const { root, options } = fixture(t);
    let registry = new PluginRegistry(options);
    assert.equal(registry.list().length, 5);
    for (const plugin of registry.list()) {
        assert.equal(plugin.builtin, false);
        assert.equal(plugin.distributable, true);
        assert.equal(plugin.defaultInstalled, true);
        assert.equal(path.dirname(registry.get(plugin.id).directory), options.userRoot);
        assert.ok(new PluginPackages(registry, path.join(root, 'stage')).export(plugin.id).length > 0);
    }
    const original = registry.get('collectify.json'),
        copy = path.join(root, 'updated');
    fs.cpSync(original.directory, copy, { recursive: true });
    const manifest = JSON.parse(fs.readFileSync(path.join(copy, 'manifest.json')));
    manifest.version = '9.0.0';
    fs.writeFileSync(path.join(copy, 'manifest.json'), JSON.stringify(manifest));
    registry.storage.set(original.id, 'keep', { indent: 4 });
    registry.setEnabled(original.id, false);
    registry.install(copy);
    assert.equal(registry.get(original.id).version, '9.0.0');
    assert.equal(registry.get(original.id).enabled, false);
    registry = new PluginRegistry(options);
    assert.equal(registry.get(original.id).version, '9.0.0');
    assert.deepEqual(registry.storage.get(original.id, 'keep'), { indent: 4 });
    registry.uninstall(original.id);
    registry = new PluginRegistry(options);
    assert.equal(registry.plugins.has(original.id), false);
    registry.restore(original.id);
    assert.equal(registry.get(original.id).version, '9.0.0', '离线恢复使用保留版本而不是初始旧包');
});
test('旧版停用、卸载记录、排序与插件数据迁移后保留；彻底删除后恢复不灌回旧数据', (t) => {
    const { options } = fixture(t);
    fs.mkdirSync(path.dirname(options.hostFile), { recursive: true });
    const db = new DatabaseSync(options.hostFile);
    db.exec(
        'CREATE TABLE installed_plugins(id TEXT PRIMARY KEY,enabled INTEGER NOT NULL,version TEXT NOT NULL,installed_at TEXT NOT NULL);CREATE TABLE host_settings(key TEXT PRIMARY KEY,value_json TEXT NOT NULL);PRAGMA user_version=2'
    );
    db.prepare('INSERT INTO installed_plugins VALUES(?,?,?,?)').run('collectify.tasks', 0, '1.0.2', 'old');
    for (const [key, value] of Object.entries({
        removedDefaultPlugins: ['collectify.notes'],
        pluginOrder: ['collectify.json', 'collectify.tasks']
    }))
        db.prepare('INSERT INTO host_settings VALUES(?,?)').run(key, JSON.stringify(value));
    db.close();
    let registry = new PluginRegistry(options);
    assert.equal(registry.get('collectify.tasks').enabled, false);
    assert.equal(registry.plugins.has('collectify.notes'), false);
    assert.equal(registry.list()[0].id, 'collectify.json');
    registry.storage.set('collectify.tasks', 'keep', 123);
    registry.uninstall('collectify.tasks', { deleteData: true });
    registry = new PluginRegistry(options);
    assert.equal(registry.plugins.has('collectify.tasks'), false);
    assert.equal(registry.getSetting('emptyPluginData').includes('collectify.tasks'), true);
    registry.restore('collectify.tasks');
    assert.equal(registry.storage.get('collectify.tasks', 'keep'), null);
    assert.equal(registry.get('collectify.tasks').enabled, true);
});
