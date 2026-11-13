const fs = require('node:fs'),
    path = require('node:path'),
    assert = require('node:assert/strict');
const { dialog } = require('electron');
exports.run = async ({ registry, services, runtime, hostAction, pluginCatalog }) => {
    assert.equal(registry.plugins.has('collectify.local-search'), false, '全新安装不应自带本地搜索');
    assert.equal(
        registry.defaults().some((p) => p.id === 'collectify.local-search'),
        false
    );
    const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '../plugins/catalog.json'), 'utf8'));
    const item = catalog.plugins.find((p) => p.id === 'collectify.local-search');
    assert.ok(item, '市场缺少本地搜索');
    const bytes = fs.readFileSync(
        path.join(__dirname, `../.plugin-release/${item.id}-${item.version}.collectify-plugin`)
    );
    const original = pluginCatalog.options.download,
        answer = dialog.showMessageBox;
    try {
        pluginCatalog.items = [item];
        pluginCatalog.loaded = true;
        pluginCatalog.options.download = async () => bytes;
        dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
        await hostAction('plugin-catalog-install', item.id);
        assert.equal(registry.get(item.id).builtin, false);
        assert.ok(services.providers.has(item.id));
        await hostAction('plugin-open', { id: item.id });
        const view = runtime.views.get(item.id);
        for (let i = 0; i < 80 && view.loading; i++) await new Promise((r) => setTimeout(r, 30));
        assert.equal(view.error, '');
        assert.deepEqual(view.errors, []);
        await services.call(item.id, 'settings', {
            ...(await services.call(item.id, 'default-settings')),
            preview: false
        });
        assert.equal((await services.call(item.id, 'state')).settings.preview, false);
        await hostAction('plugin-uninstall', item.id);
        assert.equal(registry.plugins.has(item.id), false);
        assert.equal(services.providers.has(item.id), false);
        await hostAction('plugin-catalog-install', item.id);
        await hostAction('plugin-enable', { id: item.id, enabled: true });
        assert.equal((await services.call(item.id, 'state')).settings.preview, false, '重装保留偏好');
        dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: true });
        await hostAction('plugin-uninstall', item.id);
        assert.equal(fs.existsSync(path.join(registry.dataRoot, item.id)), false);
        console.log(
            'MARKET PASS：本地搜索不是默认插件，市场包签名、安装、真实后台与页面加载、卸载、重装保留数据和彻底删除通过；未连接真实 Everything 或读取个人文件。'
        );
    } finally {
        pluginCatalog.options.download = original;
        dialog.showMessageBox = answer;
    }
};
