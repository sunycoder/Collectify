const assert = require('node:assert/strict');
const fs = require('node:fs'),
    path = require('node:path');
const { clipboard, dialog } = require('electron');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
exports.run = async ({ win, store, pluginRegistry, pluginRuntime }) => {
    const js = (code) => win.webContents.executeJavaScript(code);
    async function until(fn) {
        for (let i = 0; i < 120; i++) {
            if (await fn()) return;
            await delay(80);
        }
        throw Error('插件验证等待超时');
    }
    await until(() => js("document.querySelectorAll('#plugin-nav [data-plugin-id]').length===2"));
    const pluginJs = (code) => pluginRuntime.views.get(pluginRuntime.activeId).view.webContents.executeJavaScript(code);
    await js('document.querySelector(\'[data-plugin-id="collectify.timestamp"]\').click()');
    await until(() => pluginRuntime.activeId === 'collectify.timestamp' && !pluginRuntime.active()?.loading);
    await until(() => pluginJs("typeof TimestampTool==='object' && !!document.querySelector('#unit').onchange"));
    await pluginJs(
        "document.querySelector('#timestamp').value='0';document.querySelector('#convert-timestamp').click()"
    );
    assert.match(await pluginJs("document.querySelector('#date-result').textContent"), /1970-01-01T00:00:00.000Z/);
    assert.equal(await pluginJs("typeof require + ':' + typeof window.workbench"), 'undefined:undefined');
    await assert.rejects(
        pluginRuntime.invoke({ sender: win.webContents, senderFrame: win.webContents.mainFrame }, 'context'),
        /无权/
    );
    await pluginJs(
        "document.querySelector('#unit').value='milliseconds';document.querySelector('#unit').dispatchEvent(new Event('change'))"
    );
    await until(() => pluginRegistry.storage.get('collectify.timestamp', 'preferences')?.unit === 'milliseconds');
    await js("document.querySelector('#settings-button').click()");
    await until(() => js("document.querySelector('#settings-dialog').open"));
    assert.equal(
        pluginRuntime.views.get('collectify.timestamp').view.getVisible(),
        false,
        '设置弹窗必须覆盖原生插件视图'
    );
    await js("document.querySelector('#settings-dialog').close()");
    await delay(200);
    await js('document.querySelector(\'[data-plugin-id="collectify.json"]\').click()');
    await until(() => pluginRuntime.activeId === 'collectify.json' && !pluginRuntime.active()?.loading);
    await until(() => pluginJs("typeof JsonTool==='object' && !!document.querySelector('#indent').onchange"));
    await pluginJs("document.querySelector('#input').value='{\"hello\":1}';document.querySelector('#format').click()");
    assert.equal(await pluginJs("document.querySelector('#output').value"), '{\n  "hello": 1\n}');
    await pluginJs("document.querySelector('#copy').click()");
    await until(async () => (await clipboard.readText()).includes('"hello"'));
    const isolated = await pluginJs("collectify.storage.get('preferences')");
    assert.equal(isolated, null, '插件之间不能共享偏好');
    const network = await pluginJs("fetch('https://example.com').then(()=>false).catch(()=>true)");
    assert.equal(network, true);
    await pluginJs("document.querySelector('#input').value='{bad';document.querySelector('#format').click()");
    assert.equal(await pluginJs("document.querySelector('#output').value"), '');
    assert.match(await pluginJs("document.querySelector('#message').textContent"), /语法错误/);
    await pluginJs(
        'document.querySelector(\'#input\').value=\'{"plugins":["timestamp","json"]}\';document.querySelector(\'#format\').click()'
    );
    const directory = require('./verification-output').directory;
    fs.writeFileSync(
        path.join(directory, 'plugin-json.png'),
        (await pluginRuntime.views.get('collectify.json').view.webContents.capturePage()).toPNG()
    );
    await js("call('plugin-enable',{id:'collectify.json',enabled:false})");
    assert.equal(pluginRuntime.views.has('collectify.json'), false);
    await until(() => js('!document.querySelector(\'[data-plugin-id="collectify.json"]\')'));
    await assert.rejects(pluginRuntime.open('collectify.json'), /停用/);
    await js("call('plugin-enable',{id:'collectify.json',enabled:true})");
    await until(() => js('!!document.querySelector(\'[data-plugin-id="collectify.json"]\')'));
    pluginRuntime.close('collectify.timestamp');
    await js("call('plugin-open',{id:'collectify.timestamp'})");
    await until(() => pluginJs("document.querySelector('#unit')?.value==='milliseconds'"));
    const before = JSON.stringify(store.snapshot());
    await js("document.querySelector('#all-nav').click()");
    await delay(100);
    assert.equal(pluginRuntime.activeId, null);
    assert.equal(JSON.stringify(store.snapshot()), before);
    // 第三个插件通过应用安装入口添加，不增加任何宿主业务分支或入口代码。
    const source = path.join(path.dirname(pluginRegistry.hostFile), 'test-plugin-source');
    fs.mkdirSync(source);
    fs.writeFileSync(
        path.join(source, 'manifest.json'),
        JSON.stringify({
            id: 'example.verify',
            name: '自有插件验证',
            description: '验证动态安装和权限边界',
            version: '1.0.0',
            apiVersion: 1,
            entry: 'index.html',
            permissions: [],
            commands: [{ id: 'open', title: '打开验证插件' }]
        })
    );
    fs.writeFileSync(
        path.join(source, 'index.html'),
        '<!doctype html><html><head><meta charset="UTF-8"><title>验证</title></head><body><h1>自有插件加载成功</h1></body></html>'
    );
    const openDialog = dialog.showOpenDialog,
        messageDialog = dialog.showMessageBox;
    try {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] });
        dialog.showMessageBox = async () => ({ response: 1 });
        await js("call('plugin-install')");
        await until(() => js('!!document.querySelector(\'[data-plugin-id="example.verify"]\')'));
        await js("call('plugin-open',{id:'example.verify'})");
        assert.equal(await pluginJs("document.querySelector('h1').textContent"), '自有插件加载成功');
        assert.equal(
            await pluginJs("collectify.storage.get('x').then(()=>false).catch(e=>e.message.includes('权限'))"),
            true
        );
        assert.equal(
            await pluginJs(
                "collectify.clipboard.writeText('blocked').then(()=>false).catch(e=>e.message.includes('权限'))"
            ),
            true
        );
        await js("call('plugin-uninstall','example.verify')");
        await until(() => js('!document.querySelector(\'[data-plugin-id="example.verify"]\')'));
    } finally {
        dialog.showOpenDialog = openDialog;
        dialog.showMessageBox = messageDialog;
    }
    console.log('插件验证通过：自动入口、实际工具操作、复制、独立存储、权限隔离、遮罩、启停、重开和原业务切换。');
};
