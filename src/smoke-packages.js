const assert = require('node:assert/strict');
const fs = require('node:fs'),
    path = require('node:path'),
    os = require('node:os');
const { PluginRegistry } = require('./plugin-system/registry');
const { encodeZip, sha256 } = require('./plugin-system/package');
const { dialog } = require('electron');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 独立临时 userData，网络和原生选择框注入测试输入，不触碰真实插件或用户数据。
exports.run = async ({ win, registry, runtime, services, pluginCatalog, hostAction }) => {
    const host = (code) => win.webContents.executeJavaScript(code),
        root = path.dirname(registry.hostFile);
    const exportRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'collectify-export-'));
    const original = {
        open: dialog.showOpenDialog,
        save: dialog.showSaveDialog,
        message: dialog.showMessageBox,
        options: pluginCatalog.options
    };
    let version = '1.0.0',
        confirmed = true,
        deleteData = false;
    const bundle = () =>
        encodeZip([
            {
                name: 'manifest.json',
                data: Buffer.from(
                    JSON.stringify({
                        id: 'example.downloaded',
                        name: '下载验证插件',
                        description: '离线与在线分发验证',
                        version,
                        apiVersion: 1,
                        entry: 'index.html',
                        permissions: ['storage'],
                        commands: [{ id: 'open', title: '打开' }]
                    })
                )
            },
            { name: 'index.html', data: Buffer.from('<!doctype html><meta charset="UTF-8"><h1>插件分发验证</h1>') }
        ]);
    try {
        dialog.showMessageBox = async () => ({ response: confirmed ? 1 : 0, checkboxChecked: deleteData });
        pluginCatalog.options = {
            fetcher: async (url) => {
                const data = bundle();
                return url.endsWith('catalog.json')
                    ? new Response(
                          JSON.stringify({
                              format: 'collectify-plugin-catalog',
                              version: 1,
                              plugins: [
                                  {
                                      id: 'example.downloaded',
                                      name: '下载验证插件',
                                      description: '可下载扩展',
                                      version,
                                      apiVersion: 1,
                                      size: data.length,
                                      sha256: sha256(data),
                                      url: 'https://plugins.example/plugin.collectify-plugin'
                                  }
                              ]
                          })
                      )
                    : new Response(data);
            }
        };
        await hostAction('plugin-catalog-configure', 'https://plugins.example/catalog.json');
        await hostAction('plugin-catalog-refresh');
        await host("openSettings('plugins')");
        await host("document.querySelector('[data-plugin-tab=catalog]').click()");
        assert.equal(await host("document.querySelectorAll('.catalog-plugin').length"), 1);
        confirmed = false;
        assert.equal(await hostAction('plugin-catalog-install', 'example.downloaded'), null);
        assert.ok(!registry.plugins.has('example.downloaded'));
        confirmed = true;
        await hostAction('plugin-catalog-install', 'example.downloaded');
        registry.storage.set('example.downloaded', 'retained', '保持用户数据');
        await hostAction('plugin-enable', { id: 'example.downloaded', enabled: false });
        version = '1.1.0';
        await hostAction('plugin-catalog-refresh');
        await hostAction('plugin-catalog-install', 'example.downloaded');
        assert.equal(registry.get('example.downloaded').version, '1.1.0');
        assert.equal(registry.get('example.downloaded').enabled, false);
        const exported = path.join(exportRoot, 'export.collectify-plugin');
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: exported });
        await hostAction('plugin-package-export', 'example.downloaded');
        assert.ok(fs.existsSync(exported));
        await hostAction('plugin-uninstall', 'example.downloaded');
        assert.ok(!registry.plugins.has('example.downloaded'));
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [exported] });
        await hostAction('plugin-package-install');
        assert.equal(registry.storage.get('example.downloaded', 'retained'), '保持用户数据');
        await host('closeDialogsForPlugin()');
        await hostAction('plugin-enable', { id: 'example.downloaded', enabled: true });
        await hostAction('plugin-open', { id: 'example.downloaded' });
        assert.equal(
            await runtime.views
                .get('example.downloaded')
                .view.webContents.executeJavaScript('document.querySelector("h1").textContent'),
            '插件分发验证'
        );
        // 默认原生插件的生命周期也覆盖卸载与恢复，恢复后的实体 ID 保持。
        const before = services.providers.get('collectify.tasks').store.data.tasks.map((t) => t.id);
        await hostAction('plugin-uninstall', 'collectify.tasks');
        assert.ok(!services.active.has('collectify.tasks'));
        assert.ok(!registry.plugins.has('collectify.tasks'));
        assert.deepEqual([...services.errors], []);
        assert.deepEqual(
            registry.snapshot(true, ['collectify.tasks']).plugins[0].data.tasks.map((t) => t.id),
            before
        );
        const reopened = new PluginRegistry({
            builtinRoot: registry.builtinRoot,
            userRoot: registry.userRoot,
            dataRoot: registry.dataRoot,
            hostFile: registry.hostFile
        });
        assert.ok(!reopened.plugins.has('collectify.tasks'));
        await hostAction('plugin-restore', 'collectify.tasks');
        assert.deepEqual([...services.errors], []);
        assert.deepEqual(
            services.providers.get('collectify.tasks').store.data.tasks.map((t) => t.id),
            before
        );
        for (const id of ['collectify.bookmarks', 'collectify.notes']) {
            await hostAction('plugin-uninstall', id);
            assert.ok(!services.active.has(id));
            await hostAction('plugin-restore', id);
            assert.deepEqual([...services.errors], []);
            assert.ok(services.active.has(id));
        }
        await host("openSettings('plugins')");
        await delay(60);
        assert.equal(
            await host("document.querySelectorAll('#plugin-manager .plugin-manager-row').length"),
            registry.list().length
        );
        const verification = require('./verification-output').directory;
        await host("document.querySelector('[data-plugin-tab=installed]').click()");
        await delay(250);
        fs.writeFileSync(path.join(verification, 'plugin-manager.png'), (await win.webContents.capturePage()).toPNG());
        await host("document.querySelector('[data-plugin-tab=catalog]').click()");
        await delay(250);
        fs.writeFileSync(path.join(verification, 'plugin-catalog.png'), (await win.webContents.capturePage()).toPNG());
        await host('closeDialogsForPlugin()');
        deleteData = true;
        await hostAction('plugin-uninstall', 'example.downloaded');
        assert.ok(!fs.existsSync(path.join(registry.dataRoot, 'example.downloaded')));
        // 明确删除后，默认插件恢复也不能把示例或旧库数据重新灌回来。
        await hostAction('plugin-uninstall', 'collectify.tasks');
        await hostAction('plugin-restore', 'collectify.tasks');
        assert.deepEqual([...services.errors], []);
        assert.equal(services.providers.get('collectify.tasks').store.data.tasks.length, 0);
        assert.equal((await hostAction('plugin-catalog-status')).plugins.length, 1);
        await hostAction('plugin-catalog-configure', '');
        console.log(
            'PLUGIN PACKAGES PASS：目录发现、下载安装与取消、更新保留数据和停用状态、导出、离线重装、真实页面加载、默认插件卸载恢复、彻底删除均通过。'
        );
    } finally {
        dialog.showOpenDialog = original.open;
        dialog.showSaveDialog = original.save;
        dialog.showMessageBox = original.message;
        pluginCatalog.options = original.options;
        fs.rmSync(exportRoot, { recursive: true, force: true });
    }
};
