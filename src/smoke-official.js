const assert = require('node:assert/strict');
const { dialog } = require('electron');
exports.run = async ({ registry, runtime, hostAction }) => {
    const original = dialog.showMessageBox;
    try {
        await hostAction('plugin-catalog-configure', '');
        const catalog = await hostAction('plugin-catalog-refresh');
        const plugin = catalog.plugins.find((p) => p.id === 'collectify.clipboard-history');
        assert.ok(plugin, '官方目录缺少剪贴板插件');
        dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: true });
        await hostAction('plugin-catalog-install', plugin.id);
        assert.equal(registry.get(plugin.id).version, plugin.version);
        await hostAction('plugin-open', { id: plugin.id });
        const record = runtime.views.get(plugin.id);
        assert.equal(record.error, '');
        assert.deepEqual(record.errors, []);
        assert.equal(
            await record.view.webContents.executeJavaScript("document.querySelector('h1').textContent"),
            '剪贴板'
        );
        await record.view.webContents.executeJavaScript("collectify.storage.set('publish-check',true)");
        assert.equal(registry.storage.get(plugin.id, 'publish-check'), true);
        await hostAction('plugin-uninstall', plugin.id);
        assert.ok(!registry.plugins.has(plugin.id));
        console.log(
            `OFFICIAL SOURCE PASS：公开目录、真实 Release 下载、SHA-256、安装、沙箱页面加载、隔离存储与卸载通过（${plugin.version}）；未读取真实剪贴板。`
        );
    } finally {
        dialog.showMessageBox = original;
    }
};
