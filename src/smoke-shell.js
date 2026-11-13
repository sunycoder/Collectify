const assert = require('node:assert/strict');
const fs = require('node:fs'),
    path = require('node:path');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
exports.startup = async ({ registry, runtime, services, development, hostAction }) => {
    assert.deepEqual([...services.errors], []);
    assert.equal(registry.list().length, 6);
    for (const plugin of registry.list()) {
        await hostAction('plugin-open', { id: plugin.id });
        await delay(120);
        const record = runtime.views.get(plugin.id);
        assert.equal(record.error, '');
        assert.deepEqual(record.errors, []);
        assert.equal(await record.view.webContents.executeJavaScript('typeof collectify.context'), 'function');
    }
    const tasks = services.providers.get('collectify.tasks');
    await services.call('collectify.tasks', 'widget-open', 'floating');
    assert.equal(await tasks.widget.win.webContents.executeJavaScript('typeof ShiyueTheme.apply'), 'function');
    assert.equal(await tasks.widget.win.webContents.executeJavaScript('!!data && Array.isArray(data.tasks)'), true);
    const draft = development.create({
        pluginId: 'example.packaged-extension',
        name: '打包扩展验证',
        description: '验证程序包内的模板、编译线程与安装链路',
        template: 'basic'
    });
    const validation = await development.validate(draft.draftId, 1);
    assert.equal(validation.valid, true, JSON.stringify(validation.issues));
    const installed = await development.install({
        draftId: draft.draftId,
        expectedRevision: 1,
        validationToken: validation.validationToken,
        enable: true,
        open: true
    });
    assert.equal(installed.runtime.state, 'ready');
    assert.equal(runtime.views.get('example.packaged-extension').errors.length, 0);
    console.log('PACKAGED DEVELOPMENT PASS：包内模板、受限编译线程、校验、安装和自有插件加载通过。');
    console.log('PACKAGED STARTUP PASS：宿主、五个插件、原生后台、共享模块、SDK、页面样式和桌面组件可从应用包加载。');
};
exports.run = async ({ win, registry, runtime, services, backup, mcp, hostAction }) => {
    if (process.argv.includes('--smoke-visible')) {
        win.setPosition(50, 50);
        win.showInactive();
    }
    const host = (code) => win.webContents.executeJavaScript(code);
    async function until(fn, message = '等待插件界面超时') {
        for (let i = 0; i < 100; i++) {
            if (await fn()) return;
            await delay(80);
        }
        throw Error(message);
    }
    const page = (id, code) => runtime.views.get(id).view.webContents.executeJavaScript(code);
    for (const id of [
        'collectify.bookmarks',
        'collectify.tasks',
        'collectify.notes',
        'collectify.json',
        'collectify.timestamp'
    ]) {
        await hostAction('plugin-open', { id });
        await until(() => !runtime.active()?.loading);
        await delay(120);
        assert.equal(runtime.active().error, '');
        assert.deepEqual(runtime.views.get(id).errors, []);
    }
    assert.equal(await host("document.querySelectorAll('#plugin-rail [data-plugin-id]').length"), 6);
    assert.equal(await host("document.querySelector('#tasks-page')"), null);
    assert.deepEqual([...services.errors], []);
    const books = services.providers.get('collectify.bookmarks'),
        tasks = services.providers.get('collectify.tasks'),
        notes = services.providers.get('collectify.notes');
    await hostAction('plugin-open', { id: 'collectify.bookmarks' });
    await page('collectify.bookmarks', "document.querySelector('#new-category').click()");
    await until(() => page('collectify.bookmarks', "document.querySelector('#category-dialog').open"));
    await page(
        'collectify.bookmarks',
        "document.querySelector('#category-form').elements.name.value='验证分类';document.querySelector('#category-form').requestSubmit()"
    );
    await until(() => books.store.categories.some((c) => c.name === '验证分类'), '创建分类失败');
    await until(() => page('collectify.bookmarks', "!document.querySelector('#category-dialog').open"));
    await page('collectify.bookmarks', "document.querySelector('#add-button').click()");
    await until(() => page('collectify.bookmarks', "document.querySelector('#entry-dialog').open"));
    await page(
        'collectify.bookmarks',
        "const form=document.querySelector('#entry-form');form.elements.name.value='插件收藏';form.elements.url.value='http://127.0.0.1:1/';form.elements.username.value='demo';form.elements.password.value='demo-secret';form.requestSubmit()"
    );
    try {
        await until(() => books.store.entries.length === 1, '创建收藏失败');
    } catch (error) {
        console.log(
            '收藏表单诊断',
            await page(
                'collectify.bookmarks',
                "({error:document.querySelector('#entry-form .form-error').textContent,invalid:[...document.querySelector('#entry-form').elements].filter(e=>e.validity&&!e.validity.valid).map(e=>({name:e.name,message:e.validationMessage}))})"
            )
        );
        throw error;
    }
    const bookmark = books.store.entries[0];
    await until(() => page('collectify.bookmarks', "document.querySelectorAll('.bookmark-card').length===1"));
    const server = require('node:http').createServer((_request, response) => {
        response.end('<h1>isolated browser</h1>');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
        await services.call('collectify.bookmarks', 'save', {
            ...books.store.entries[0],
            url: `http://127.0.0.1:${server.address().port}/`
        });
        await services.call('collectify.bookmarks', 'open', { id: bookmark.id });
        const remote = [...books.browser.tabs.values()][0];
        assert.ok(remote);
        assert.equal(
            await remote.view.webContents.executeJavaScript("typeof require+':'+typeof collectify"),
            'undefined:undefined'
        );
        await host("document.querySelector('#settings-button').click()");
        await until(() => host("document.querySelector('#settings-dialog').open"));
        assert.equal(remote.view.getVisible(), false);
        await host("document.querySelector('#settings-dialog').close()");
        await services.call('collectify.bookmarks', 'home');
    } finally {
        await new Promise((resolve) => server.close(resolve));
    }
    await hostAction('plugin-open', { id: 'collectify.bookmarks', route: 'favorite' });
    await until(() => page('collectify.bookmarks', "document.querySelector('#heading').textContent==='已置顶'"));
    await hostAction('plugin-open', { id: 'collectify.tasks', route: 'list' });
    await page('collectify.tasks', "document.querySelector('#new-task').click()");
    await until(() => page('collectify.tasks', "document.querySelector('#task-dialog').open"));
    await page(
        'collectify.tasks',
        "const form=document.querySelector('#task-form');form.elements.title.value='插件待办';form.requestSubmit()"
    );
    await until(() => tasks.store.data.tasks.length === 1, '创建待办失败');
    await until(() => page('collectify.tasks', "!document.querySelector('#task-dialog').open"));
    for (const route of ['matrix', 'board', 'calendar', 'list']) {
        await hostAction('plugin-open', { id: 'collectify.tasks', route });
        await until(
            () => page('collectify.tasks', `document.querySelector('#task-${route}').hidden===false`),
            route + '视图失败'
        );
    }
    await page('collectify.tasks', "document.querySelector('.checklist-row .checklist-content').click()");
    await until(() => page('collectify.tasks', "document.querySelector('#task-dialog').open"));
    await page('collectify.tasks', "document.querySelector('#task-dialog').close()");
    await services.call('collectify.tasks', 'widget-open', 'floating');
    assert.ok(tasks.widget.win);
    assert.equal(tasks.widget.win.isAlwaysOnTop(), true);
    await hostAction('plugin-open', { id: 'collectify.notes' });
    await page('collectify.notes', "document.querySelector('#new-note').click()");
    await until(() => page('collectify.notes', "document.querySelector('#note-dialog').open"));
    await page(
        'collectify.notes',
        "const form=document.querySelector('#note-form');form.elements.title.value='插件便签';form.elements.content.value='保留便签内容';form.requestSubmit()"
    );
    await until(() => notes.store.data.notes.length === 1, '创建便签失败');
    await until(() => page('collectify.notes', "document.querySelectorAll('.sticky-note').length===1"));
    await page('collectify.notes', "document.querySelector('.sticky-actions button:nth-child(2)').click()");
    await until(() => runtime.activeId === 'collectify.tasks', '便签转待办未切换插件');
    await until(() => page('collectify.tasks', "document.querySelector('#task-dialog').open"));
    assert.equal(
        await page('collectify.tasks', "document.querySelector('#task-form').elements.title.value"),
        '插件便签'
    );
    await page('collectify.tasks', "document.querySelector('#task-dialog').close()");
    await host("document.querySelector('#settings-button').click()");
    await until(() => host("document.querySelector('#settings-dialog').open"));
    assert.equal(runtime.views.get('collectify.tasks').view.getVisible(), false);
    await host("document.querySelector('#settings-dialog').close()");
    await hostAction('plugin-open', { id: 'collectify.json' });
    await page(
        'collectify.json',
        "document.querySelector('#input').value='{\"plugins\":true}';document.querySelector('#format').click()"
    );
    assert.equal(await page('collectify.json', "document.querySelector('#output').value"), '{\n  "plugins": true\n}');
    assert.equal(await page('collectify.json', "collectify.invoke('state').then(()=>false).catch(()=>true)"), true);
    const withSecrets = backup.export(['collectify.bookmarks', 'collectify.tasks', 'collectify.notes'], true, true);
    const redacted = backup.export(['collectify.bookmarks'], false, false);
    assert.equal(redacted.plugins[0].data.entries[0].password, undefined);
    await mcp.start(0);
    const { Client } = require('@modelcontextprotocol/sdk/client/index.js'),
        { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
    const client = new Client({ name: 'shell-smoke', version: '1.0.0' });
    await client.connect(
        new StreamableHTTPClientTransport(new URL(mcp.status().url), {
            requestInit: { headers: { Authorization: `Bearer ${mcp.config.token}` } }
        })
    );
    assert.ok((await client.listTools()).tools.some((t) => t.name === 'save_tasks'));
    const resources = await client.callTool({ name: 'list_bookmarks', arguments: {} });
    assert.equal(JSON.stringify(resources).includes('demo-secret'), false);
    assert.equal(JSON.stringify(resources).includes('"username"'), false);
    const before = tasks.store.data.tasks.length;
    const bad = await client.callTool({
        name: 'save_tasks',
        arguments: { tasks: [{ title: '不应部分写入' }, { title: '' }] }
    });
    assert.equal(bad.isError, true);
    assert.equal(tasks.store.data.tasks.length, before);
    await hostAction('plugin-enable', { id: 'collectify.tasks', enabled: false });
    assert.equal(tasks.widget.win, null);
    assert.equal(services.active.has('collectify.tasks'), false);
    assert.equal(
        (await client.listTools()).tools.some((t) => t.name === 'save_tasks'),
        false
    );
    await assert.rejects(services.call('collectify.tasks', 'task-save', { title: '禁止写入' }), /停用/);
    await client.close();
    await mcp.stop();
    for (const p of registry.list()) if (p.enabled) await hostAction('plugin-enable', { id: p.id, enabled: false });
    await until(() => host("document.querySelectorAll('#plugin-rail [data-plugin-id]').length===0"));
    assert.equal(runtime.views.size, 0);
    assert.equal(services.active.size, 0);
    assert.equal(await host("document.querySelector('#plugin-state').hidden"), false);
    for (const p of registry.list()) await hostAction('plugin-enable', { id: p.id, enabled: true });
    assert.equal(books.store.entries[0].id, bookmark.id);
    assert.equal(tasks.store.data.tasks.length, 1);
    backup.import(withSecrets, { ids: ['collectify.notes'], settings: false, mode: 'replace' });
    assert.equal(books.store.entries[0].password, 'demo-secret');
    // 原生后台只属于默认插件；新增本地页面插件自动进入同一层导航，不能越权调用。
    const { dialog } = require('electron'),
        source = path.join(path.dirname(registry.hostFile), 'local-plugin-source');
    fs.mkdirSync(source);
    fs.writeFileSync(
        path.join(source, 'manifest.json'),
        JSON.stringify({
            id: 'example.verify',
            name: '验证插件',
            description: '本地扩展',
            version: '1.0.0',
            apiVersion: 1,
            entry: 'index.html',
            permissions: [],
            commands: [{ id: 'open', title: '打开' }],
            navigation: [
                { id: 'first', label: '第一页' },
                { id: 'second', label: '第二页' }
            ]
        })
    );
    fs.writeFileSync(
        path.join(source, 'index.html'),
        '<html><head><meta charset="UTF-8"></head><body>自有插件</body></html>'
    );
    const originalOpen = dialog.showOpenDialog,
        originalMessage = dialog.showMessageBox;
    try {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] });
        dialog.showMessageBox = async () => ({ response: 1 });
        await hostAction('plugin-install');
        await hostAction('plugin-open', { id: 'example.verify', route: 'second' });
        assert.equal(await host("document.querySelectorAll('#plugin-navigation [data-route]').length"), 2);
        assert.equal(await page('example.verify', "collectify.invoke('state').then(()=>false).catch(()=>true)"), true);
        assert.equal(await page('example.verify', "collectify.storage.get('x').then(()=>false).catch(()=>true)"), true);
        await hostAction('plugin-uninstall', 'example.verify');
        assert.equal(registry.plugins.has('example.verify'), false);
        assert.equal(runtime.views.has('example.verify'), false);
        assert.ok(backup.export(['example.verify'], false, false).plugins.some((p) => p.id === 'example.verify'));
    } finally {
        dialog.showOpenDialog = originalOpen;
        dialog.showMessageBox = originalMessage;
    }
    const directory = require('./verification-output').directory;
    await hostAction('plugin-open', { id: 'collectify.bookmarks', route: 'all' });
    await delay(150);
    fs.writeFileSync(path.join(directory, 'shell-navigation.png'), (await win.webContents.capturePage()).toPNG());
    fs.writeFileSync(
        path.join(directory, 'plugin-bookmarks.png'),
        (await runtime.views.get('collectify.bookmarks').view.webContents.capturePage()).toPNG()
    );
    if (process.argv.includes('--smoke-visible')) {
        await delay(400);
        const { desktopCapturer, screen } = require('electron'),
            b = win.getBounds(),
            display = screen.getDisplayMatching(b);
        const sources = await desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: {
                width: Math.round(display.size.width * display.scaleFactor),
                height: Math.round(display.size.height * display.scaleFactor)
            }
        });
        const source = sources.find((s) => s.display_id === String(display.id)) || sources[0],
            scale = source.thumbnail.getSize().width / display.bounds.width;
        const image = source.thumbnail.crop({
                x: Math.round((b.x - display.bounds.x) * scale),
                y: Math.round((b.y - display.bounds.y) * scale),
                width: Math.round(b.width * scale),
                height: Math.round(b.height * scale)
            }),
            pixels = image.toBitmap();
        let nonzero = 0;
        for (let i = 0; i < pixels.length; i += 400)
            if (pixels[i] > 10 || pixels[i + 1] > 10 || pixels[i + 2] > 10) nonzero++;
        const file = path.join(directory, 'shell-composed.png');
        if (nonzero > 100) fs.writeFileSync(file, image.toPNG());
        else {
            if (fs.existsSync(file)) fs.unlinkSync(file);
            console.log('桌面捕获当前为纯色，未用作视觉验证；页面及交互检查单独完成。');
        }
    }
    for (const [id, record] of runtime.views) assert.deepEqual(record.errors, [], id + '页面存在错误');
    console.log(
        'SHELL PASS：五个统一插件、动态二级导航、收藏/待办/便签 CRUD、多视图、跨插件转换、桌面组件、MCP 动态回收、权限边界、全局备份和全部停用。'
    );
};
