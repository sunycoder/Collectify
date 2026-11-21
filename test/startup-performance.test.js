const { test } = require('node:test'),
    assert = require('node:assert/strict');
const { LazyMcpService } = require('../src/lazy-mcp-service');
const fs = require('node:fs'),
    path = require('node:path'),
    os = require('node:os');
const { DatabaseSync } = require('node:sqlite');
test('公共资源缓存合并并发读取，按容量淘汰，失败可重试', async () => {
    const { ResourceCache } = require('../src/plugin-system/resource-cache');
    const cache = new ResourceCache(8);
    let reads = 0;
    const read = async () => {
        reads++;
        await new Promise((r) => setImmediate(r));
        return Buffer.from('1234');
    };
    await Promise.all([cache.get('a', read), cache.get('a', read)]);
    assert.equal(reads, 1);
    await cache.get('b', read);
    await cache.get('a', read);
    await cache.get('c', read);
    assert.equal(cache.items.has('b'), false);
    assert.equal(cache.bytes, 8);
    await assert.rejects(
        cache.get('bad', async () => {
            throw Error('read failed');
        })
    );
    assert.equal((await cache.get('bad', async () => Buffer.from('ok'))).toString(), 'ok');
    await cache.get('huge', async () => Buffer.alloc(9));
    assert.equal(cache.items.has('huge'), false);
});
test('开发资源缓存复用未改文件，编辑后下一次读取立即生效', async (t) => {
    const { ResourceCache } = require('../src/plugin-system/resource-cache');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'collectify-dev-assets-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const file = path.join(root, 'script.js'),
        cache = new ResourceCache();
    fs.writeFileSync(file, 'old');
    const before = await cache.readFile('script.js', file);
    assert.strictEqual(await cache.readFile('script.js', file), before);
    fs.writeFileSync(file, 'new content');
    assert.equal((await cache.readFile('script.js', file)).toString(), 'new content');
    fs.rmSync(file);
    assert.throws(() => cache.readFile('script.js', file));
});
test('首插件准备不创建其他后台，按需请求合并初始化，备份准备加载全部处理器', async (t) => {
    const { PluginServices } = require('../src/plugin-system/services');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'collectify-priority-load-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const plugins = new Map();
    for (const id of ['example.fast', 'example.slow']) {
        const directory = path.join(root, id);
        fs.mkdirSync(directory);
        fs.writeFileSync(
            path.join(directory, 'backend.cjs'),
            `exports.created=0;exports.create=async()=>{exports.created++;await new Promise(r=>setTimeout(r,20));return {call:()=>exports.created,exportData:()=>({loaded:true})};};`
        );
        plugins.set(id, { id, name: id, directory, backend: 'backend.cjs', enabled: true });
    }
    const registry = {
        plugins,
        dataRoot: root,
        diagnostics: [],
        getSetting: () => [],
        get: (id) => plugins.get(id),
        retainedDefaults: () => []
    };
    const services = new PluginServices(registry, {});
    await services.load({ activate: false, ids: ['example.fast'] });
    assert.equal(services.providers.has('example.fast'), true);
    assert.equal(services.providers.has('example.slow'), false);
    assert.equal(require.cache[path.join(root, 'example.slow/backend.cjs')], undefined);
    const results = await Promise.all([services.call('example.slow', 'state'), services.call('example.slow', 'state')]);
    assert.deepEqual(results, [1, 1]);
    await services.load({ activate: false, yieldBetween: true });
    assert.equal(registry.providers.size, 2);
    assert.deepEqual(registry.providers.get('example.slow').exportData(), { loaded: true });
    await services.dispose();
});
test('初始化期间卸载会等待准备并释放，不能遗留后台对象', async (t) => {
    const { PluginServices } = require('../src/plugin-system/services');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'collectify-load-stop-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const file = path.join(root, 'backend.cjs');
    fs.writeFileSync(
        file,
        `exports.disposed=false;exports.create=async()=>{await new Promise(r=>exports.release=r);return {dispose:()=>{exports.disposed=true;}};};`
    );
    const plugin = { id: 'example.pending', name: 'pending', directory: root, backend: 'backend.cjs', enabled: true };
    const registry = {
        plugins: new Map([[plugin.id, plugin]]),
        dataRoot: root,
        diagnostics: [],
        getSetting: () => [],
        get: () => plugin,
        retainedDefaults: () => []
    };
    const services = new PluginServices(registry, {});
    const preparing = services.load({ activate: false });
    await new Promise((r) => setImmediate(r));
    const module = require(file),
        removing = services.unload(plugin.id);
    assert.equal(module.disposed, false);
    module.release();
    await Promise.all([preparing, removing]);
    assert.equal(module.disposed, true);
    assert.equal(services.providers.has(plugin.id), false);
});
function registryFixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'collectify-startup-io-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    return new (require('../src/plugin-system/registry').PluginRegistry)({
        builtinRoot: path.resolve('src/plugins'),
        userRoot: path.join(root, 'packages'),
        dataRoot: path.join(root, 'data'),
        hostFile: path.join(root, 'host.sqlite')
    });
}
test('宿主设置反复读取不重新打开数据库，返回值相互隔离，未变设置不落盘', (t) => {
    const registry = registryFixture(t);
    registry.setSetting('theme-test', { color: 'blue' });
    const original = registry.database.bind(registry);
    let opens = 0;
    registry.database = (run) => {
        opens++;
        return original(run);
    };
    const baseline = { 'theme-test': {}, missing: ['fallback'] };
    registry.readSettings(baseline);
    opens = 0;
    for (let n = 0; n < 100; n++) {
        const result = registry.readSettings(baseline);
        result['theme-test'].color = 'red';
        result.missing.push('changed');
    }
    assert.equal(opens, 0);
    assert.equal(registry.getSetting('theme-test').color, 'blue');
    assert.deepEqual(registry.getSetting('missing', ['fallback']), ['fallback']);
    registry.setSetting('theme-test', { color: 'blue' });
    assert.equal(opens, 0);
    registry.setSetting('theme-test', { color: 'green' });
    assert.equal(opens, 1);
    assert.equal(registry.getSetting('theme-test').color, 'green');
});
test('重复发现已有插件不写宿主数据库，首次发现和版本变更仍持久化', (t) => {
    const registry = registryFixture(t),
        observer = new DatabaseSync(registry.hostFile);
    const version = () => observer.prepare('PRAGMA data_version').get().data_version;
    const before = version();
    registry.discover();
    assert.equal(version(), before);
    const folder = path.join(registry.userRoot, 'example.fast');
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, 'index.html'), '<p>test</p>');
    const manifest = {
        id: 'example.fast',
        name: 'test',
        description: 'test',
        version: '1.0.0',
        apiVersion: 1,
        entry: 'index.html',
        permissions: [],
        commands: [{ id: 'open', title: 'open' }]
    };
    fs.writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify(manifest));
    registry.discover();
    assert.ok(version() > before);
    registry.setEnabled('example.fast', false);
    manifest.version = '1.0.1';
    fs.writeFileSync(path.join(folder, 'manifest.json'), JSON.stringify(manifest));
    registry.discover();
    assert.equal(registry.get('example.fast').enabled, false);
    assert.equal(
        observer.prepare('SELECT version FROM installed_plugins WHERE id=?').get('example.fast').version,
        '1.0.1'
    );
    observer.close();
});
test('插件连续读取 SDK 数据不再重写 SQLite 版本页', (t) => {
    const registry = registryFixture(t);
    registry.storage.set('example.read', 'value', 42);
    const observer = new DatabaseSync(registry.storage.file('example.read'));
    const before = observer.prepare('PRAGMA data_version').get().data_version;
    for (let n = 0; n < 20; n++) assert.equal(registry.storage.get('example.read', 'value'), 42);
    assert.equal(observer.prepare('PRAGMA data_version').get().data_version, before);
    observer.close();
});
test('异步资源路径检查保持越界、目录和符号链接拒绝', async (t) => {
    const { assetPathAsync } = require('../src/plugin-system/manifest');
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'collectify-path-async-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.writeFileSync(path.join(root, 'index.html'), 'test');
    fs.mkdirSync(path.join(root, 'directory'));
    assert.equal(await assetPathAsync(root, 'index.html'), fs.realpathSync.native(path.join(root, 'index.html')));
    await assert.rejects(assetPathAsync(root, '../index.html'));
    await assert.rejects(assetPathAsync(root, 'directory'));
    fs.symlinkSync(path.join(root, 'directory'), path.join(root, 'link'), 'junction');
    await assert.rejects(assetPathAsync(root, 'link'), /链接/);
});
test('未启用 AI 的状态查询不加载 SDK，首次启用才加载一次', async () => {
    let loads = 0;
    const service = new LazyMcpService(
        { readMcpConfig: () => null, saveMcpConfig: () => {} },
        () => {},
        () => [],
        () => {
            loads++;
            return {
                z: {},
                LocalMcpService: class {
                    status() {
                        return { enabled: true };
                    }
                    async start() {
                        return this.status();
                    }
                    async stop() {}
                }
            };
        }
    );
    assert.equal(service.status().enabled, false);
    assert.equal(loads, 0);
    await service.start();
    assert.equal(loads, 1);
    service.status();
    await service.start();
    assert.equal(loads, 1);
});
test('网页和插件视图的同状态布局不重复刷新可见性和尺寸', () => {
    const { layoutView } = require('../src/window-lifecycle');
    let visible = true,
        bounds = { x: 0, y: 0, width: 800, height: 600 },
        changes = 0;
    const view = {
        getVisible: () => visible,
        setVisible: (v) => {
            visible = v;
            changes++;
        },
        getBounds: () => bounds,
        setBounds: (b) => {
            bounds = b;
            changes++;
        }
    };
    layoutView(view, true, { ...bounds });
    layoutView(view, true, { ...bounds });
    assert.equal(changes, 0);
    layoutView(view, true, { ...bounds, width: 900 });
    assert.equal(changes, 1);
    layoutView(view, false, bounds);
    layoutView(view, false, bounds);
    assert.equal(changes, 2);
});
test('并发启动 AI 只启动一次监听，紧接着停止会等待启动完成', async () => {
    let starts = 0,
        release,
        stopped = false;
    const service = new LazyMcpService(
        { readMcpConfig: () => null },
        () => {},
        () => [],
        () => ({
            z: {},
            LocalMcpService: class {
                async start() {
                    starts++;
                    await new Promise((resolve) => (release = resolve));
                    return { enabled: true };
                }
                async stop() {
                    stopped = true;
                }
            }
        })
    );
    const first = service.start(),
        second = service.start();
    await new Promise((resolve) => setImmediate(resolve));
    const stopping = service.stop();
    assert.equal(starts, 1);
    assert.equal(stopped, false);
    release();
    await Promise.all([first, second, stopping]);
    assert.equal(stopped, true);
});
