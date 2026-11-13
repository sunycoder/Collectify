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
    await hostAction('plugin-open', { id: 'collectify.json' });
    await until(() => host("document.querySelectorAll('.plugin-asset-icon').length===5"));
    const rail = await host(
        "(()=>{const rail=document.querySelector('#plugin-rail');return{width:rail.clientWidth,scrollWidth:rail.scrollWidth,height:rail.clientHeight,scrollHeight:rail.scrollHeight,select:getComputedStyle(rail).userSelect,icon:document.querySelector('.plugin-asset-icon').getAttribute('src')};})()"
    );
    assert.equal(rail.scrollWidth, rail.width);
    assert.ok(rail.scrollHeight <= rail.height);
    assert.equal(rail.select, 'none');
    assert.match(rail.icon, /svg/);
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
        "document.querySelector('#settings-dialog').close();document.querySelector('#toggle-navigation').click()"
    );
    await until(() => runtime.bounds.x === 300);
    assert.equal(registry.getSetting('navigationCollapsed'), false);
    const output = require('./verification-output').directory;
    await hostAction('plugin-open', { id: 'collectify.json' });
    await delay(120);
    fs.writeFileSync(path.join(output, 'navigation-expanded.png'), (await win.webContents.capturePage()).toPNG());
    for (const record of runtime.views.values()) assert.deepEqual(record.errors, []);
    console.log(
        'NAVIGATION PASS：SVG 图标、长按无文本选中、无横向溢出、导航收放与实际插件区域同步、折叠设置入口、浏览器偏好持久化和显式覆盖通过；系统浏览器调用使用测试替身。'
    );
};
