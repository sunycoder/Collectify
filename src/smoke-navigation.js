const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { shell } = require('electron');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

exports.run = async ({ win, registry, runtime, services, hostAction }) => {
    const host = (code) => win.webContents.executeJavaScript(code);
    const until = async (predicate) => {
        for (let i = 0; i < 60; i++) {
            if (await predicate()) return;
            await delay(30);
        }
        throw Error('导航界面更新超时');
    };
    await host('shellReady');
    await hostAction('plugin-open', { id: 'collectify.json' });
    await until(() => host("document.querySelectorAll('.plugin-asset-icon').length===6"));
    const rail = await host(
        "(()=>{const rail=document.querySelector('#plugin-rail');return{width:rail.clientWidth,scrollWidth:rail.scrollWidth,height:rail.clientHeight,scrollHeight:rail.scrollHeight,select:getComputedStyle(rail).userSelect,icon:document.querySelector('.plugin-asset-icon').getAttribute('src')};})()"
    );
    assert.equal(rail.scrollWidth, rail.width);
    assert.ok(rail.scrollHeight <= rail.height);
    assert.equal(rail.select, 'none');
    assert.match(rail.icon, /svg/);
    // 原生插件视图不能在两个宿主弹窗之间的空档重新显示。
    const layout = runtime.layout.bind(runtime),
        visibility = [];
    let watching = false;
    runtime.layout = (visible) => {
        if (watching) visibility.push(visible);
        return layout(visible);
    };
    try {
        await host("openSettings('general')");
        watching = true;
        for (let attempt = 0; attempt < 3; attempt++) {
            await host("document.querySelector('#theme-button').click()");
            await until(() => host("document.querySelector('#theme-dialog').open"));
            await delay(60);
            assert.equal(runtime.views.get('collectify.json').view.getVisible(), false);
            await host("document.querySelector('#appearance-back').click()");
            await until(() => host("document.querySelector('#settings-dialog').open"));
            await delay(60);
            assert.equal(runtime.views.get('collectify.json').view.getVisible(), false);
        }
        assert.equal(visibility.includes(true), false, '切换弹窗期间插件视图被恢复');
        await host("openTransfer('export')");
        await until(() => host("document.querySelector('#transfer-dialog').open"));
        assert.equal(runtime.views.get('collectify.json').view.getVisible(), false);
        assert.equal(visibility.includes(true), false);
        watching = false;
        await host("document.querySelector('#transfer-dialog').close()");
        await until(() => runtime.views.get('collectify.json').view.getVisible());
    } finally {
        watching = false;
        runtime.layout = layout;
    }
    const last = await host(
        "(()=>{const r=document.querySelector('#plugin-rail button:last-child').getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()"
    );
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...last });
    await delay(550);
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...last });
    assert.equal(await host('window.getSelection().toString()'), '');
    await host("document.querySelector('#toggle-navigation').click()");
    await until(() => host("document.querySelector('#plugin-stage').getBoundingClientRect().x===76"));
    await until(() => runtime.bounds.x === 76);
    assert.equal(registry.getSetting('navigationCollapsed'), true);
    assert.equal(await host("getComputedStyle(document.querySelector('#collapsed-settings-button')).display"), 'grid');
    await host("document.querySelector('#collapsed-settings-button').click()");
    await until(() => host("document.querySelector('#settings-dialog').open"));
    assert.equal(await host("document.querySelector('#browser-open-mode').value"), 'internal');
    const opened = [],
        original = shell.openExternal;
    try {
        shell.openExternal = async (url) => opened.push(url);
        const entry = await services.call('collectify.bookmarks', 'save', {
            name: '浏览器设置验证',
            url: 'https://example.invalid/navigation-test'
        });
        await host(
            "document.querySelector('#browser-open-mode').value='external';document.querySelector('#browser-open-mode').dispatchEvent(new Event('change'))"
        );
        await until(() => registry.getSetting('browserOpenMode') === 'external');
        await services.call('collectify.bookmarks', 'open', { id: entry.id });
        assert.deepEqual(opened, [entry.url]);
        await hostAction('settings', { browserOpenMode: 'internal' });
        assert.equal(registry.getSetting('navigationCollapsed'), true);
        // 显式菜单操作仍可覆盖全局选项；不会真正启动系统浏览器。
        await services.call('collectify.bookmarks', 'open', { id: entry.id, mode: 'external' });
        assert.equal(opened.length, 2);
        await services.call('collectify.bookmarks', 'save', { ...entry, url: 'http://127.0.0.1:1/' });
        await services.call('collectify.bookmarks', 'open', { id: entry.id });
        assert.equal(opened.length, 2);
        assert.equal(services.providers.get('collectify.bookmarks').browser.tabs.size, 1);
        await services.call('collectify.bookmarks', 'home');
    } finally {
        shell.openExternal = original;
    }
    await host(
        "document.querySelector('#settings-dialog').close();document.querySelector('#expand-navigation').click()"
    );
    await until(() => runtime.bounds.x === 300);
    assert.equal(registry.getSetting('navigationCollapsed'), false);
    const output = require('./verification-output').directory;
    await until(() => runtime.active() && !runtime.active().loading);
    await hostAction('plugin-open', { id: 'collectify.json' });
    await delay(120);
    fs.writeFileSync(path.join(output, 'navigation-expanded.png'), (await win.webContents.capturePage()).toPNG());
    for (const record of runtime.views.values()) assert.deepEqual(record.errors, []);
    // 本地搜索分类必须由宿主二级导航承载，不在内容区重复占一列。
    await hostAction('plugin-open', { id: 'collectify.local-search', route: 'all' });
    await until(() => runtime.active()?.id === 'collectify.local-search' && !runtime.active()?.loading);
    const local = (code) => runtime.views.get('collectify.local-search').view.webContents.executeJavaScript(code);
    await until(() => host("document.querySelectorAll('#plugin-navigation .plugin-subnav').length===11"));
    assert.equal(await local("document.querySelector('#filters')"), null);
    assert.equal(await host("document.querySelectorAll('#plugin-navigation .plugin-subnav svg').length"), 11);
    await host("document.querySelector('#plugin-navigation [data-route=image]').click()");
    await until(() => local("filter==='image'"));
    assert.equal(await host("document.querySelector('#plugin-navigation .selected').dataset.route"), 'image');
    const provider = services.providers.get('collectify.local-search'),
        previous = await provider.call('state');
    await services.call('collectify.local-search', 'settings', {
        ...previous.settings,
        filters: previous.settings.filters.map((item) => ({ ...item, enabled: item.id !== 'image' }))
    });
    await until(() => host("!document.querySelector('#plugin-navigation [data-route=image]')"));
    await services.call('collectify.local-search', 'settings', previous.settings);
    await until(() => host("!!document.querySelector('#plugin-navigation [data-route=image]')"));
    // 真实目录入口可恢复随包插件，不复制/执行任意外部后台。
    const nativeDialog = require('electron').dialog,
        originalOpen = nativeDialog.showOpenDialog,
        originalMessage = nativeDialog.showMessageBox;
    nativeDialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [path.join(__dirname, 'plugins', 'local-search')]
    });
    nativeDialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
    try {
        await hostAction('plugin-uninstall', 'collectify.local-search');
        assert.equal(registry.plugins.has('collectify.local-search'), false);
        const restored = await hostAction('plugin-install');
        assert.equal(restored.builtin, true);
        assert.equal(registry.get('collectify.local-search').enabled, true);
        await until(() => runtime.active()?.id === 'collectify.local-search' && !runtime.active()?.loading);
    } finally {
        nativeDialog.showOpenDialog = originalOpen;
        nativeDialog.showMessageBox = originalMessage;
    }
    assert.equal(runtime.views.get('collectify.local-search').view.getVisible(), true);
    await until(() =>
        runtime.views
            .get('collectify.local-search')
            .view.webContents.executeJavaScript("typeof settings!=='undefined'&&!!settings")
    );
    await delay(200);
    fs.writeFileSync(
        path.join(output, 'local-search-host-navigation.png'),
        (await win.webContents.capturePage()).toPNG()
    );
    console.log(
        'NAVIGATION PASS：弹窗连续切换不恢复插件视图、SVG 图标、长按无文本选中、无横向溢出、导航收放与实际插件区域同步、折叠设置入口、浏览器偏好持久化和显式覆盖通过；系统浏览器调用使用测试替身。'
    );
};
