const assert = require('node:assert/strict'),
    path = require('node:path'),
    fs = require('node:fs'),
    os = require('node:os');
exports.run = async ({ registry, services, hostAction, win }) => {
    await win.webContents.executeJavaScript('shellReady');
    for (const plugin of registry.list().filter((p) => p.defaultInstalled)) {
        assert.equal(plugin.builtin, false);
        assert.equal(plugin.distributable, true);
        assert.equal(path.dirname(registry.get(plugin.id).directory), registry.userRoot);
    }
    assert.equal(registry.list().filter((p) => p.defaultInstalled).length, 5);
    const item = await services.call('collectify.tasks', 'task-save', { title: '独立默认插件测试', status: 'todo' });
    const exported = registry.providers.get('collectify.tasks').exportData();
    assert.ok(exported.tasks.some((t) => t.id === item.id));
    const tasks = registry.get('collectify.tasks');
    assert.equal(tasks.runtime, 'native');
    await services.call('collectify.tasks', 'widget-open', 'floating');
    await hostAction('plugin-open', { id: 'collectify.json' });
    const before = registry.get('collectify.json').version;
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'default-update-smoke-'));
    try {
        fs.cpSync(registry.get('collectify.json').directory, directory, { recursive: true });
        const file = path.join(directory, 'manifest.json'),
            manifest = JSON.parse(fs.readFileSync(file));
        manifest.version = '9.0.0';
        fs.writeFileSync(file, JSON.stringify(manifest));
        registry.storage.set(manifest.id, 'retained', 'keep');
        registry.setEnabled(manifest.id, false);
        registry.install(directory);
        assert.notEqual(registry.get(manifest.id).version, before);
        assert.equal(registry.get(manifest.id).enabled, false);
        assert.equal(registry.storage.get(manifest.id, 'retained'), 'keep');
    } finally {
        fs.rmSync(directory, { recursive: true, force: true });
    }
    console.log('DEFAULT PLUGINS PASS：五个默认插件独立安装、原生后台和桌面待办加载、单插件更新保留数据与停用状态。');
};
