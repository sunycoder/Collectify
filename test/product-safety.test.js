const { test } = require('node:test'),
    assert = require('node:assert/strict'),
    fs = require('node:fs'),
    os = require('node:os'),
    path = require('node:path');
const { validateDetails } = require('../src/plugin-system/details'),
    { validateOrder } = require('../src/plugin-system/navigation-order'),
    { PluginServices } = require('../src/plugin-system/services');
const { PluginRegistry } = require('../src/plugin-system/registry'),
    { WorkspaceBackup } = require('../src/plugin-system/backup');
function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'collectify-product-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    return root;
}
test('Diff 偏好备份回滚与重启保持，草稿与本机自动保存策略不夹入备份', async (t) => {
    const root = fixture(t),
        file = path.join(root, 'diff/data.sqlite'),
        backend = await require('../src/plugin-library/diff/backend').create({ file });
    t.after(() => backend.dispose());
    await backend.call('settings', { language: 'java', ignoreRules: ['private'], localDrafts: true });
    await backend.call('workspace-state', { dirty: true, texts: ['SECRET', 'new'], names: ['A', 'B'] });
    const exported = backend.exportData();
    assert.equal(JSON.stringify(exported).includes('SECRET'), false);
    assert.equal(exported.preferences.localDrafts, undefined);
    const old = JSON.stringify(backend.exportData());
    assert.throws(() => backend.planData({ schemaVersion: 1, preferences: { fontSize: 99 } }));
    assert.equal(JSON.stringify(backend.exportData()), old);
    backend.importData(backend.planData({ schemaVersion: 1, preferences: { language: 'python' } }));
    assert.equal((await backend.call('state')).settings.language, 'python');
    backend.importData(backend.planData(exported));
    assert.equal((await backend.call('state')).settings.language, 'java');
    const again = await require('../src/plugin-library/diff/backend').create({ file });
    assert.equal((await again.call('draft-read')).texts[0], 'SECRET');
    await again.call('settings', { localDrafts: false });
    assert.equal(await again.call('draft-read'), null);
    await again.dispose();
});
test('Diff 默认不写工作文本，取消关闭保持内存，保存草稿后可恢复，重新编辑再次检查', async (t) => {
    const root = fixture(t),
        file = path.join(root, 'data/data.sqlite');
    let response = 0,
        count = 0;
    const backend = await require('../src/plugin-library/diff/backend').create(
        { file },
        {
            electron: {
                dialog: {
                    showMessageBox: async () => {
                        count++;
                        return { response };
                    }
                }
            }
        }
    );
    t.after(() => backend.dispose());
    const value = { dirty: true, texts: ['last input', 'new text'], names: ['A', 'B'] };
    await backend.call('workspace-state', value);
    assert.equal(fs.existsSync(path.dirname(file)), false);
    assert.equal(await backend.beforeClose('quit'), false);
    assert.equal(count, 1);
    assert.equal(await backend.call('draft-read'), null);
    response = 2;
    assert.equal(await backend.beforeClose('disable'), true);
    assert.equal((await backend.call('draft-read')).texts[0], 'last input');
    await backend.call('settings', { language: 'go' });
    assert.equal((await backend.call('draft-read')).texts[0], 'last input', '调整语言不得删除手动保存的草稿');
    await backend.call('workspace-state', { ...value, texts: ['changed again', 'new'] });
    response = 0;
    assert.equal(await backend.beforeClose('update'), false);
    response = 1;
    assert.equal(await backend.beforeClose('uninstall'), true);
    assert.equal((await backend.call('draft-read')).texts[0], 'last input', '放弃不覆盖已保存草稿');
    await assert.rejects(backend.call('workspace-state', { ...value, texts: ['x', null] }));
});
test('统一任务只接受受限描述，取消准确指向所属插件，离开钩子拒绝会中止', async () => {
    const registry = {
            plugins: new Map([
                ['example.a', { id: 'example.a', name: 'A' }],
                ['example.b', { id: 'example.b', name: 'B' }]
            ])
        },
        services = new PluginServices(registry, {});
    let canceled;
    services.active.add('example.a');
    services.providers.set('example.a', {
        tasks: () => [{ id: 'scan', title: '扫描', progress: 2, cancellable: true, private: 'secret' }],
        cancelTask: (id) => {
            canceled = id;
        },
        beforeClose: () => false
    });
    services.providers.set('example.b', {
        beforeClose: () => {
            throw Error('不应继续检查');
        }
    });
    const tasks = services.tasks();
    assert.equal(tasks[0].progress, 1);
    assert.equal(tasks[0].private, undefined);
    await services.cancelTask('example.a', 'scan');
    assert.equal(canceled, 'scan');
    await assert.rejects(services.cancelTask('example.b', 'scan'));
    assert.equal(await services.beforeClose(['example.a', 'example.b'], 'quit'), false);
});
test('多个插件关闭检查中后一个取消时，撤销前一个的临时关闭许可', async () => {
    const services = new PluginServices({ plugins: new Map() }, {});
    let reset = 0;
    services.providers.set('a', { beforeClose: () => true, closeCheckCanceled: () => reset++ });
    services.providers.set('b', { beforeClose: () => false });
    assert.equal(await services.beforeClose(['a', 'b'], 'quit'), false);
    assert.equal(reset, 1);
});
test('详情拒绝脚本媒体与坏平台记录，顺序接受缺失插件但拒绝重复或越界 ID', () => {
    assert.throws(() => validateDetails({ screenshots: ['https://example.com/image.png'] }));
    assert.throws(() => validateDetails({ screenshots: ['data:text/html;base64,AAAA'] }));
    assert.throws(() =>
        validateDetails({ verification: [{ platform: 'windows', status: 'local', date: '2026-11-17', scope: 'test' }] })
    );
    assert.deepEqual(validateOrder(['example.missing', 'collectify.tasks']), ['example.missing', 'collectify.tasks']);
    assert.throws(() => validateOrder(['collectify.tasks', 'collectify.tasks']));
    assert.throws(() => validateOrder(['../path']));
});
test('导航顺序随统一设置备份迁移，不安装缺失插件，恢复仍可回滚', (t) => {
    const root = fixture(t),
        options = {
            builtinRoot: path.resolve(__dirname, '../src/plugins'),
            userRoot: path.join(root, 'packages'),
            dataRoot: path.join(root, 'data'),
            hostFile: path.join(root, 'host.sqlite')
        },
        registry = new PluginRegistry(options);
    registry.move('collectify.json', 'collectify.bookmarks', 'before');
    const get = () => ({ pluginOrder: [...registry.pluginOrder] }),
        set = (value, validateOnly = false) => {
            const clean = { pluginOrder: validateOrder(value.pluginOrder ?? registry.pluginOrder) };
            if (!validateOnly) registry.setSetting('pluginOrder', clean.pluginOrder);
            return clean;
        },
        backup = new WorkspaceBackup(registry, get, set);
    const exported = backup.export([], true, false);
    registry.resetOrder();
    backup.import(exported, { ids: [], settings: true, mode: 'merge' });
    assert.equal(registry.list()[0].id, 'collectify.json');
    const missing = { ...exported, settings: { pluginOrder: ['example.missing', 'collectify.tasks'] } };
    backup.import(missing, { ids: [], settings: true, mode: 'merge' });
    assert.equal(registry.plugins.has('example.missing'), false);
    assert.equal(registry.list()[0].id, 'collectify.tasks');
    assert.equal(new PluginRegistry(options).list()[0].id, 'collectify.tasks');
    assert.throws(() =>
        backup.import({ ...exported, settings: { pluginOrder: ['bad'] } }, { ids: [], settings: true, mode: 'replace' })
    );
    assert.equal(registry.list()[0].id, 'collectify.tasks');
});
test('Diff 接入真实插件统一备份，导入后半段失败会恢复偏好', async (t) => {
    const root = fixture(t),
        registry = new PluginRegistry({
            builtinRoot: path.resolve(__dirname, '../src/plugins'),
            userRoot: path.join(root, 'packages'),
            dataRoot: path.join(root, 'data'),
            hostFile: path.join(root, 'host.sqlite')
        });
    registry.install(path.resolve(__dirname, '../src/plugin-library/diff'));
    const services = new PluginServices(registry, {});
    await services.load({ activate: false });
    t.after(() => services.dispose());
    const provider = services.providers.get('collectify.diff');
    await provider.call('settings', { language: 'java' });
    let fail = false;
    const backup = new WorkspaceBackup(
        registry,
        () => ({ pluginOrder: [] }),
        (_value, validateOnly) => {
            if (!validateOnly && fail) {
                fail = false;
                throw Error('模拟设置失败');
            }
            return { pluginOrder: [] };
        }
    );
    const raw = backup.export(['collectify.diff'], true, false);
    raw.plugins[0].data.preferences.language = 'python';
    fail = true;
    assert.throws(
        () => backup.import(raw, { ids: ['collectify.diff'], settings: true, mode: 'replace' }),
        /模拟设置失败/
    );
    assert.equal((await provider.call('state')).settings.language, 'java');
    backup.import(raw, { ids: ['collectify.diff'], settings: true, mode: 'replace' });
    assert.equal((await provider.call('state')).settings.language, 'python');
});
