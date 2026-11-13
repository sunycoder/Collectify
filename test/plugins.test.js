const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'),
    path = require('node:path'),
    os = require('node:os');
const { PluginRegistry } = require('../src/plugin-system/registry');
const { readManifest, assetPath } = require('../src/plugin-system/manifest');
const timestamp = require('../src/plugins/timestamp/convert');
const json = require('../src/plugins/json/format');
function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'collectify-plugins-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const builtinRoot = path.join(root, 'builtin');
    fs.mkdirSync(builtinRoot);
    for (const name of ['json', 'timestamp'])
        fs.cpSync(path.resolve(__dirname, '../src/plugins', name), path.join(builtinRoot, name), { recursive: true });
    const options = {
        builtinRoot,
        userRoot: path.join(root, 'packages'),
        dataRoot: path.join(root, 'data'),
        hostFile: path.join(root, 'host.sqlite')
    };
    return { root, options, registry: new PluginRegistry(options) };
}
test('插件清单自动发现，启停持久化、命令回收，不影响原业务库', (t) => {
    const { registry, options, root } = fixture(t);
    assert.equal(registry.list().length, 2);
    assert.deepEqual(registry.diagnostics, []);
    assert.equal(registry.commands().length, 2);
    registry.setEnabled('collectify.json', false);
    assert.equal(registry.commands().length, 1);
    assert.throws(() => registry.get('collectify.json', true), /停用/);
    assert.equal(new PluginRegistry(options).get('collectify.json').enabled, false);
    assert.equal(fs.existsSync(path.join(root, 'collectify.sqlite')), false);
});
test('插件存储按身份分库，参数、配额和未来版本拒绝，不覆盖其他插件数据', (t) => {
    const { registry } = fixture(t),
        storage = registry.storage;
    storage.set('collectify.json', 'preferences', { indent: '4' });
    assert.equal(storage.get('collectify.timestamp', 'preferences'), null);
    assert.deepEqual(storage.get('collectify.json', 'preferences'), { indent: '4' });
    assert.throws(() => storage.set('../escape', 'preferences', {}), /ID/);
    assert.throws(() => storage.set('collectify.json', '', {}), /存储键/);
    assert.throws(() => storage.set('collectify.json', 'huge', 'x'.repeat(300000)), /256 KB/);
    assert.throws(() => storage.replace('collectify.json', { '': 'invalid' }), /存储键/);
    assert.deepEqual(storage.get('collectify.json', 'preferences'), { indent: '4' });
    const { DatabaseSync } = require('node:sqlite'),
        db = new DatabaseSync(storage.file('collectify.timestamp'));
    db.exec('PRAGMA user_version=99');
    db.close();
    assert.throws(() => storage.get('collectify.timestamp', 'preferences'), /版本/);
});
test('新增自有插件通过目录安装、更新、卸载与重装，无需修改宿主注册代码', (t) => {
    const { registry, options, root } = fixture(t),
        source = path.join(root, 'source');
    fs.mkdirSync(source);
    const manifest = {
        ...readManifest(path.resolve(__dirname, '../src/plugins/json')),
        id: 'example.hello',
        name: '扩展验证',
        permissions: []
    };
    fs.writeFileSync(path.join(source, 'manifest.json'), JSON.stringify(manifest));
    fs.writeFileSync(path.join(source, 'index.html'), '<h1>Hello</h1>');
    registry.install(source);
    assert.equal(registry.commands().length, 3);
    registry.storage.set(manifest.id, 'keep', 123);
    manifest.version = '1.1.0';
    fs.writeFileSync(path.join(source, 'manifest.json'), JSON.stringify(manifest));
    registry.install(source);
    assert.equal(registry.get(manifest.id).version, '1.1.0');
    assert.equal(registry.storage.get(manifest.id, 'keep'), 123);
    registry.uninstall(manifest.id);
    assert.throws(() => registry.get(manifest.id), /未安装/);
    registry.install(source);
    assert.equal(registry.storage.get(manifest.id, 'keep'), 123);
    assert.equal(new PluginRegistry(options).list().length, 3);
    registry.uninstall('collectify.json');
    assert.ok(registry.availableDefaults().some((p) => p.id === 'collectify.json'));
});
test('清单越界、未知权限、未来 API、目录链接和坏插件隔离', (t) => {
    const { registry, root } = fixture(t),
        source = path.join(root, 'bad');
    fs.mkdirSync(source);
    const manifest = {
        ...readManifest(path.resolve(__dirname, '../src/plugins/json')),
        id: 'example.bad',
        entry: '../outside.html'
    };
    fs.writeFileSync(path.join(source, 'manifest.json'), JSON.stringify(manifest));
    assert.throws(() => readManifest(source), /路径/);
    assert.throws(() => assetPath(source, '..\\outside'), /路径/);
    manifest.entry = 'index.html';
    manifest.permissions = ['fs'];
    fs.writeFileSync(path.join(source, 'index.html'), '');
    fs.writeFileSync(path.join(source, 'manifest.json'), JSON.stringify(manifest));
    assert.throws(() => readManifest(source), /权限/);
    manifest.permissions = [];
    manifest.apiVersion = 99;
    fs.writeFileSync(path.join(source, 'manifest.json'), JSON.stringify(manifest));
    assert.throws(() => readManifest(source), /API/);
    const linked = path.join(registry.userRoot, 'linked');
    fs.symlinkSync(source, linked, process.platform === 'win32' ? 'junction' : 'dir');
    registry.discover();
    assert.equal(registry.list().length, 2);
    assert.equal(registry.diagnostics.length, 1);
});
test('时间戳秒毫秒、负数、闰日和明确时区转换，非法日期不能被自动修正', () => {
    assert.equal(timestamp.fromTimestamp('0', 'seconds').utc, '1970-01-01T00:00:00.000Z');
    assert.equal(timestamp.fromTimestamp('-1', 'milliseconds').utc, '1969-12-31T23:59:59.999Z');
    assert.equal(timestamp.fromDate('2024-02-29T12:34:56.123', 'utc').utc, '2024-02-29T12:34:56.123Z');
    for (const bad of ['2025-02-29T12:00', '2024-13-01T12:00', '2024-01-01T24:01'])
        assert.throws(() => timestamp.fromDate(bad, 'utc'), /日期/);
    assert.throws(() => timestamp.fromTimestamp('1.2', 'seconds'), /整数/);
    assert.throws(() => timestamp.fromTimestamp('999999999999999999', 'seconds'), /范围/);
});
test('JSON 对象、标量、Unicode、语法定位和大整数保护，格式化不执行输入', () => {
    assert.equal(json.transform('{"中文":[true,null]}', 'compact').text, '{"中文":[true,null]}');
    assert.equal(json.transform('null', 'format').text, 'null');
    assert.equal(json.transform('{"a":1}', 'format', '4').text, '{\n    "a": 1\n}');
    assert.throws(() => json.transform('{"n":9007199254740993}', 'format'), /精确整数/);
    assert.match(json.transform('{"n":9007199254740993}', 'validate').message, /语法有效/);
    assert.throws(() => json.transform('{\n"x": }', 'format'), /语法错误/);
    assert.throws(() => json.transform('(()=>process.exit())()', 'format'), /语法错误/);
    assert.throws(() => json.transform('"' + 'x'.repeat(1048576) + '"', 'format'), /1 MB/);
});
test('插件数据随全局选择性导入导出，不自动启用插件，也不安装程序', (t) => {
    const { registry, root } = fixture(t);
    const { Store } = require('../src/store'),
        { exportWorkspace, importWorkspace } = require('../src/workspace-transfer');
    const store = new Store(path.join(root, 'business.sqlite'));
    registry.storage.set('collectify.json', 'preferences', { indent: '4' });
    const file = exportWorkspace(store, ['plugins'], false, registry);
    assert.deepEqual(file.sections, ['plugins']);
    assert.equal(file.data.entries, undefined);
    registry.setEnabled('collectify.json', false);
    registry.storage.set('collectify.json', 'preferences', { indent: '2' });
    importWorkspace(store, file, { sections: ['plugins'], mode: 'replace' }, registry);
    assert.deepEqual(registry.storage.get('collectify.json', 'preferences'), { indent: '4' });
    assert.equal(registry.get('collectify.json').enabled, false);
    assert.ok(fs.existsSync(`${store.file}.plugins-before-import.json`));
    const unknown = structuredClone(file);
    unknown.data.plugins.plugins.push({
        id: 'example.absent',
        version: '1.0.0',
        enabled: true,
        values: { preference: 123 }
    });
    importWorkspace(store, unknown, { sections: ['plugins'], mode: 'merge' }, registry);
    assert.equal(registry.plugins.has('example.absent'), false);
    assert.equal(registry.storage.get('example.absent', 'preference'), 123);
    assert.equal(registry.snapshot().plugins.find((p) => p.id === 'example.absent').enabled, false);
});
test('插件全局导入：坏数据不部分落盘，业务提交失败恢复全部插件及原业务快照', (t) => {
    const { registry, root } = fixture(t);
    const { Store } = require('../src/store'),
        { exportWorkspace, importWorkspace } = require('../src/workspace-transfer');
    const store = new Store(path.join(root, 'business.sqlite'));
    registry.storage.set('collectify.json', 'preferences', { indent: '4' });
    const before = registry.snapshot(),
        workspaceBefore = store.snapshot();
    const file = exportWorkspace(store, ['plugins', 'notes'], true, registry);
    file.data.plugins.plugins.find((p) => p.id === 'collectify.json').values.preferences = { indent: '2' };
    file.data.notes = [
        { id: 'invalid-note', title: '合法便签', content: '正文', color: 'yellow', updatedAt: new Date().toISOString() }
    ];
    const bad = structuredClone(file);
    bad.data.plugins.plugins[0].values = { '': 1 };
    assert.throws(
        () => importWorkspace(store, bad, { sections: ['plugins', 'notes'], mode: 'replace' }, registry),
        /存储键/
    );
    assert.deepEqual(registry.snapshot(), before);
    assert.deepEqual(store.snapshot(), workspaceBefore);
    const commit = store.commit.bind(store);
    let fail = true;
    store.commit = (data) => {
        if (fail) {
            fail = false;
            throw Error('模拟业务库写入失败');
        }
        return commit(data);
    };
    assert.throws(
        () => importWorkspace(store, file, { sections: ['plugins', 'notes'], mode: 'replace' }, registry),
        /模拟业务库/
    );
    assert.deepEqual(registry.snapshot(), before);
    assert.deepEqual(store.snapshot(), workspaceBefore);
    assert.equal(fs.existsSync(`${store.file}.plugin-import-recovery.json`), false);
});
test('中断的跨库导入在重启时恢复，恢复完成后幂等且不残留新插件数据', (t) => {
    const { registry, options, root } = fixture(t);
    const { Store } = require('../src/store'),
        { recoverWorkspaceImport } = require('../src/workspace-transfer');
    const store = new Store(path.join(root, 'business.sqlite'));
    registry.storage.set('collectify.json', 'preferences', { indent: '4' });
    const previous = registry.snapshot();
    fs.writeFileSync(
        `${store.file}.plugin-import-recovery.json`,
        JSON.stringify({
            workspace: store.snapshot(),
            plugins: previous,
            pluginIds: [...previous.plugins.map((p) => p.id), 'example.partial']
        })
    );
    registry.storage.set('collectify.json', 'preferences', { indent: '2' });
    registry.storage.set('example.partial', 'leaked', true);
    const reopened = new PluginRegistry(options);
    assert.equal(recoverWorkspaceImport(store, reopened), true);
    assert.deepEqual(reopened.snapshot(), previous);
    assert.equal(reopened.storage.get('example.partial', 'leaked'), null);
    assert.equal(recoverWorkspaceImport(store, reopened), false);
});
