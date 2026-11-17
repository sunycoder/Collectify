const assert = require('node:assert/strict'),
    fs = require('node:fs'),
    path = require('node:path'),
    { dialog } = require('electron');
exports.run = async ({ registry, runtime, services, hostAction, win }) => {
    const id = 'collectify.diff',
        root = path.resolve(__dirname, '../..'),
        directory = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'product-export-'));
    fs.mkdirSync(directory, { recursive: true });
    const host = (code) => win.webContents.executeJavaScript(code),
        delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const until = async (predicate) => {
        for (let i = 0; i < 100; i++) {
            if (await predicate()) return;
            await delay(30);
        }
        throw Error('产品流程等待超时');
    };
    await host('shellReady');
    registry.install(path.join(root, 'src/plugin-library/diff'));
    await services.load();
    await hostAction('plugin-open', { id, route: 'text' });
    const page = runtime.views.get(id).view.webContents,
        js = (code) => page.executeJavaScript(code);
    await js('DiffApp.ready');
    await js("DiffApp.setTexts(['original','unsaved content'])");
    const original = { message: dialog.showMessageBox, save: dialog.showSaveDialog };
    try {
        dialog.showMessageBox = async () => ({ response: 0, checkboxChecked: false });
        assert.equal(await hostAction('plugin-enable', { id, enabled: false }), false);
        assert.equal(registry.get(id).enabled, true);
        assert.equal(page.isDestroyed(), false);
        dialog.showMessageBox = async (...args) => ({
            response: args.at(-1).buttons.includes('卸载') ? 1 : 0,
            checkboxChecked: false
        });
        assert.equal(await hostAction('plugin-uninstall', id), false);
        assert.equal(registry.plugins.has(id), true);
        dialog.showMessageBox = async () => ({ response: 2, checkboxChecked: false });
        await hostAction('plugin-enable', { id, enabled: false });
        assert.equal(registry.get(id).enabled, false);
        await hostAction('plugin-enable', { id, enabled: true });
        await hostAction('plugin-open', { id });
        const reopened = runtime.views.get(id).view.webContents;
        await reopened.executeJavaScript('DiffApp.ready');
        assert.equal(await reopened.executeJavaScript("document.querySelector('#draft-notice').hidden"), false);
        await reopened.executeJavaScript("document.querySelector('#restore-draft').click()");
        await until(() => reopened.executeJavaScript("DiffApp.models[1].getValue()==='unsaved content'"));
        dialog.showMessageBox = async () => ({ response: 0 });
        assert.equal(await hostAction('plugin-reload'), false);
        assert.equal(reopened.isDestroyed(), false);
        const preferencesBackup = path.join(directory, 'workspace.json');
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: preferencesBackup });
        await hostAction('export', { ids: [id], settings: true, includeCredentials: false });
        const data = JSON.parse(fs.readFileSync(preferencesBackup, 'utf8'));
        assert.equal(data.plugins[0].data.schemaVersion, 1);
        assert.equal(JSON.stringify(data).includes('unsaved content'), false);
        assert.ok(Array.isArray(data.settings.pluginOrder));
        await host("openSettings('plugins')");
        await host("openPluginDetails('collectify.diff')");
        assert.match(await host("document.querySelector('#plugin-details-body').textContent"), /最低宿主/);
        const remoteCatalog = JSON.parse(fs.readFileSync(path.join(root, 'plugins/catalog.json'), 'utf8'));
        await host(
            `catalogState={...catalogState,loaded:true,updatedAt:new Date().toISOString(),plugins:${JSON.stringify(remoteCatalog.plugins)}};openPluginDetails('collectify.diff')`
        );
        await until(() =>
            host(
                "document.querySelectorAll('.plugin-detail-screenshot').length>0 && [...document.querySelectorAll('.plugin-detail-screenshot')].every(image=>image.naturalWidth>0)"
            )
        );
        await delay(150);
        assert.equal(
            await host(
                "(()=>{const r=document.querySelector('#plugin-details-action').getBoundingClientRect();return r.bottom<=innerHeight&&r.top>=0})()"
            ),
            true,
            '详情主操作必须保持可见'
        );
        fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
        fs.writeFileSync(path.join(root, 'dist/plugin-details.png'), (await win.webContents.capturePage()).toPNG());
        await host("document.querySelector('#plugin-details-close').click()");
        let canceled = false;
        const provider = services.providers.get(id),
            originalTasks = provider.tasks,
            originalCancel = provider.cancelTask;
        provider.tasks = () =>
            canceled
                ? []
                : [
                      {
                          id: 'fixture-scan',
                          title: '目录扫描验证',
                          progress: null,
                          startedAt: Date.now(),
                          cancellable: true
                      }
                  ];
        provider.cancelTask = (task) => {
            assert.equal(task, 'fixture-scan');
            canceled = true;
        };
        await host('refresh()');
        assert.equal(await host("document.querySelector('#plugin-tasks-open').hidden"), false);
        await host("document.querySelector('#plugin-tasks-open').click()");
        await until(() => host("document.querySelector('#plugin-tasks-dialog').open"));
        await delay(150);
        fs.writeFileSync(path.join(root, 'dist/plugin-tasks.png'), (await win.webContents.capturePage()).toPNG());
        assert.equal(await host("document.querySelector('#plugin-tasks-list progress').hasAttribute('value')"), false);
        await host(
            "[...document.querySelectorAll('#plugin-tasks-list button')].find(b=>b.textContent==='取消任务').click()"
        );
        await until(() => canceled);
        await until(() => host("document.querySelector('#plugin-tasks-list').textContent.includes('当前没有')"));
        await host("document.querySelector('#plugin-tasks-dialog').close()");
        provider.tasks = originalTasks;
        provider.cancelTask = originalCancel;
        await host('closeDialogsForPlugin()');
        dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
        await hostAction('plugin-enable', { id, enabled: false });
        await services.unload(id);
        registry.uninstall(id, { deleteData: true });
        console.log('PRODUCT SAFETY PASS：真实停用/卸载/重载取消、草稿恢复、备份不含文本、详情页和统一任务取消。');
    } finally {
        dialog.showMessageBox = original.message;
        dialog.showSaveDialog = original.save;
    }
};
