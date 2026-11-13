const { test } = require('node:test'),
    assert = require('node:assert/strict'),
    fs = require('node:fs'),
    os = require('node:os'),
    path = require('node:path');
const { PluginPackages, collectFiles, encodeZip, decodeZip } = require('../src/plugin-system/package');
const { PluginRegistry } = require('../src/plugin-system/registry');
const { PluginServices } = require('../src/plugin-system/services');
const { readManifest } = require('../src/plugin-system/manifest');
const source = path.resolve(__dirname, '../src/plugin-library/local-search');
function temporary(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'collectify-native-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return dir;
}
test('独立原生包校验签名；改清单、代码、二进制或去掉签名都不能加载，不影响页面插件限制', (t) => {
    const root = temporary(t),
        files = collectFiles(source),
        bytes = encodeZip(files, { native: true, store: true });
    const packages = new PluginPackages(null, path.join(root, 'staging')),
        prepared = packages.prepare(bytes);
    assert.equal(prepared.manifest.runtime, 'native');
    assert.equal(prepared.manifest.backend, 'backend.js');
    packages.cleanup(prepared);
    for (const filename of ['manifest.json', 'backend.js', 'vendor/native/Everything.exe']) {
        const changed = files.map((f) => ({
            ...f,
            data: f.name === filename ? Buffer.concat([f.data, Buffer.from(' ')]) : f.data
        }));
        assert.throws(() => decodeZip(encodeZip(changed, { native: true, store: true })), /签名/);
    }
    assert.throws(
        () =>
            decodeZip(
                encodeZip(
                    files.filter((f) => f.name !== 'native-signature.json'),
                    { native: true }
                )
            ),
        /签名/
    );
    assert.throws(() => encodeZip([{ name: 'evil.exe', data: Buffer.from('exe') }]), /文件类型/);
});
test('新工作台只有五个默认插件；原生插件独立安装、启停、导出、卸载和重装保留数据', async (t) => {
    const root = temporary(t),
        registry = new PluginRegistry({
            builtinRoot: path.resolve(__dirname, '../src/plugins'),
            userRoot: path.join(root, 'packages'),
            dataRoot: path.join(root, 'data'),
            hostFile: path.join(root, 'host.sqlite')
        });
    assert.equal(registry.defaults().length, 5);
    assert.equal(registry.plugins.has('collectify.local-search'), false);
    const packages = new PluginPackages(registry, path.join(root, 'staging')),
        prepared = packages.prepare(encodeZip(collectFiles(source), { native: true }));
    const id = registry.install(prepared.directory, prepared.manifest);
    packages.cleanup(prepared);
    assert.equal(registry.get(id).builtin, false);
    assert.equal(registry.list().find((p) => p.id === id).distributable, true);
    assert.equal(readManifest(registry.get(id).directory).runtime, 'native');
    const exported = packages.export(id);
    assert.ok(exported.length > 0);
    const services = new PluginServices(registry, {});
    const p = registry.get(id),
        context = { id, file: path.join(registry.dataRoot, id, 'data.sqlite'), changed: () => {} };
    const backend = await require(path.join(p.directory, p.backend)).create(context, { electron: {} });
    services.providers.set(id, backend);
    await services.enable(id);
    await services.call(id, 'settings', { ...(await services.call(id, 'default-settings')), preview: false });
    await services.unload(id);
    registry.uninstall(id);
    assert.equal(registry.plugins.has(id), false);
    const reinstall = packages.prepare(exported);
    registry.install(reinstall.directory, reinstall.manifest);
    packages.cleanup(reinstall);
    const reopened = await require(path.join(registry.get(id).directory, 'backend.js')).create(context, {
        electron: {}
    });
    assert.equal((await reopened.call('state')).settings.preview, false);
    await reopened.dispose();
    registry.uninstall(id, { deleteData: true });
    assert.equal(fs.existsSync(path.dirname(context.file)), false);
});
