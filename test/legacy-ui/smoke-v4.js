const assert = require('node:assert/strict');
const fs = require('node:fs'),
    path = require('node:path'),
    http = require('node:http');
const { once } = require('node:events');
const { dialog, shell } = require('electron');
const { Store } = require('./store');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(fn) {
    const end = Date.now() + 15000;
    while (Date.now() < end) {
        if (await fn()) return;
        await delay(80);
    }
    throw Error('V4 验证超时');
}

exports.run = async ({ win, store, tabs, openEntry, closeTab, desktopWidget }) => {
    const js = (script) =>
            win.webContents.executeJavaScript(script).catch((error) => {
                console.error('V4 failed step:', script);
                throw error;
            }),
        artifacts = require('./verification-output').directory;
    const errors = [];
    win.webContents.on('console-message', (e) => {
        if (e.level === 3) {
            errors.push(e.message);
            console.error('V4 renderer:', e.message);
        }
    });
    await js("document.querySelector('#all-nav').click()");
    await until(() => js("!document.querySelector('#dashboard').hidden"));
    await js('document.querySelector(\'.bookmark-card button[title="更多操作"]\').click()');
    await delay(240);
    const menu = await js(
        "(()=>{const r=document.querySelector('#popup-menu').getBoundingClientRect();return {width:r.width,x:r.x,y:r.y,right:r.right,bottom:r.bottom,h:innerHeight,w:innerWidth}})()"
    );
    assert.equal(menu.width, 228);
    assert.ok(menu.x >= 0 && menu.y >= 0 && menu.right <= menu.w && menu.bottom <= menu.h);
    await js("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))");
    // 新建非网页资源：走真实表单和 IPC，确认 URL 不是必填。
    await js("document.querySelector('#add-button').click()");
    await until(() => js("document.querySelector('#entry-dialog').open"));
    await js(
        `(()=>{const f=document.querySelector('#entry-form');f.elements.type.value='text';f.elements.type.dispatchEvent(new Event('change'));f.elements.name.value='常用片段';f.elements.content.value=${JSON.stringify('  echo hello\n')};f.requestSubmit()})()`
    );
    await until(() => store.entries.some((e) => e.type === 'text'));
    const textEntry = store.entries.find((e) => e.type === 'text');
    await until(() => js(`!!document.querySelector('.bookmark-card[data-id="${textEntry.id}"]')`));
    await js(`document.querySelector('.bookmark-card[data-id="${textEntry.id}"]').click()`);
    await until(() => js("document.querySelector('#resource-dialog').open"));
    assert.equal(await js("document.querySelector('#resource-body').textContent"), '  echo hello\n');
    await js("document.querySelector('#resource-dialog .dialog-close').click()");
    const local = path.join(artifacts, 'smoke-local.txt');
    fs.writeFileSync(local, 'local');
    const originalOpen = dialog.showOpenDialog,
        originalOpenPath = shell.openPath;
    let openedPath = '';
    try {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [local] });
        shell.openPath = async (p) => {
            openedPath = p;
            return '';
        };
        await js("document.querySelector('#add-button').click()");
        await until(() => js("document.querySelector('#entry-dialog').open"));
        await js(
            "const f=document.querySelector('#entry-form');f.elements.type.value='file';f.elements.type.dispatchEvent(new Event('change'));document.querySelector('#choose-resource').click()"
        );
        await until(() => js("!!document.querySelector('#entry-form').elements.localPath.value"));
        await js("document.querySelector('#entry-form').requestSubmit()");
        await until(() => store.entries.some((e) => e.type === 'file'));
        const fileEntry = store.entries.find((e) => e.type === 'file');
        await until(() => js(`!!document.querySelector('.bookmark-card[data-id="${fileEntry.id}"]')`));
        await js(`document.querySelector('.bookmark-card[data-id="${fileEntry.id}"]').click()`);
        await until(() => openedPath === local);
    } finally {
        dialog.showOpenDialog = originalOpen;
        shell.openPath = originalOpenPath;
    }
    // 进入网页再返回到原收藏视图；网页后退与返回收藏是独立操作。
    const server = http.createServer((_req, res) => {
        res.setHeader('Content-Type', 'text/html');
        res.end('<title>return test</title>page');
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
        const originalWeb = store.entries.find((e) => e.type === 'web');
        await openEntry({ ...originalWeb, url: `http://127.0.0.1:${server.address().port}/` });
        await until(() => js("!document.querySelector('#workspace').hidden"));
        const button = await js(
            "(()=>{const r=document.querySelector('#back-to-library').getBoundingClientRect();return {w:r.width,h:r.height,y:r.y}})()"
        );
        assert.ok(button.w > 60 && button.h > 20 && button.y < 168);
        await js("document.querySelector('#back-to-library').click()");
        await until(() =>
            js("!document.querySelector('#dashboard').hidden && document.querySelector('#workspace').hidden")
        );
        assert.equal(tabs.size, 1);
        for (const id of [...tabs.keys()]) closeTab(id);
    } finally {
        server.close();
    }
    await js("document.querySelector('#tasks-nav').click()");
    await until(() => js("!document.querySelector('#tasks-page').hidden"));
    const scheduled = store.data.tasks.find((t) => t.dueAt);
    const expected = require('./task-query').localDay(scheduled.dueAt);
    await js(
        `document.querySelector('#task-date-query').value=${JSON.stringify(expected)};document.querySelector('#task-date-query').dispatchEvent(new Event('change'))`
    );
    assert.equal(await js("document.querySelectorAll('.task-card').length"), 1);
    await js(
        "document.querySelector('#task-date-query').value='2099-01-01';document.querySelector('#task-date-query').dispatchEvent(new Event('change'))"
    );
    assert.equal(await js("document.querySelectorAll('.task-card').length"), 0);
    await js("document.querySelector('#clear-task-date').click()");
    await desktopWidget.open('floating');
    await until(() => desktopWidget.win.isAlwaysOnTop());
    const widgetJs = (code) => desktopWidget.win.webContents.executeJavaScript(code);
    await until(() => widgetJs("!!document.querySelector('.widget-task')"));
    const firstId = await widgetJs("document.querySelector('.widget-task').dataset.id");
    await widgetJs("document.querySelector('.widget-task input').click()");
    await until(() => store.data.tasks.find((t) => t.id === firstId).status === 'done');
    await desktopWidget.open('desktop');
    await until(() => !desktopWidget.win.isAlwaysOnTop());
    assert.equal(store.data.settings.widget.mode, 'desktop');
    await js("document.querySelector('#theme-button').click()");
    await until(() => js("document.querySelector('#theme-dialog').open"));
    assert.equal(await js("document.querySelectorAll('.theme-preset').length"), 7);
    await js(
        "document.querySelectorAll('.theme-preset')[2].click();document.querySelector('#theme-radius').value='19';document.querySelector('#theme-radius').dispatchEvent(new Event('input'))"
    );
    assert.equal(await js("getComputedStyle(document.documentElement).getPropertyValue('--radius').trim()"), '19px');
    await js("document.querySelector('#save-theme').click()");
    await until(() => store.data.settings.theme.radius === 19);
    assert.equal(new Store(store.file).data.settings.theme.preset, 'mist');
    await until(() =>
        widgetJs("getComputedStyle(document.documentElement).getPropertyValue('--radius').trim()==='19px'")
    );
    await js("document.querySelector('#theme-button').click()");
    await until(() => js("document.querySelector('#theme-dialog').open"));
    await js(
        "document.querySelectorAll('.theme-preset')[2].click();document.querySelector('#theme-dialog .cancel-dialog').click()"
    );
    await until(() =>
        js(
            `getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()===${JSON.stringify(store.data.settings.theme.accent)}`
        )
    );
    assert.equal(
        await js("getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()"),
        store.data.settings.theme.accent
    );
    await js("document.querySelector('#theme-button').click()");
    await until(() => js("document.querySelector('#theme-dialog').open"));
    await delay(250);
    fs.writeFileSync(path.join(artifacts, 'appearance-v4.png'), (await win.webContents.capturePage()).toPNG());
    await js(
        "document.querySelector('#theme-dialog .cancel-dialog').click();document.querySelector('#all-nav').click()"
    );
    await delay(250);
    await js("document.querySelector('#toast').hidden=true");
    fs.writeFileSync(path.join(artifacts, 'home-v4.png'), (await win.webContents.capturePage()).toPNG());
    await js('document.querySelector(\'.bookmark-card button[title="更多操作"]\').click()');
    await delay(220);
    fs.writeFileSync(path.join(artifacts, 'menu-v4.png'), (await win.webContents.capturePage()).toPNG());
    await delay(150);
    fs.writeFileSync(
        path.join(artifacts, 'widget-v4.png'),
        (await desktopWidget.win.webContents.capturePage()).toPNG()
    );
    await js(
        "document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));document.querySelector('#theme-button').click()"
    );
    await until(() => js("document.querySelector('#theme-dialog').open"));
    await js("document.querySelectorAll('.theme-preset')[4].click()");
    await delay(220);
    fs.writeFileSync(path.join(artifacts, 'night-theme-v4.png'), (await win.webContents.capturePage()).toPNG());
    await js("document.querySelector('#theme-dialog .cancel-dialog').click()");
    desktopWidget.hide();
    assert.equal(store.data.settings.widget.visible, false);
    desktopWidget.destroy();
    assert.deepEqual(errors, []);
    console.log(
        'V4 SMOKE PASS: compact menu; local/text resources; explicit webpage return; daily query; desktop always-on-top modes and task sync; theme preview/save/cancel/restart/widget sync.'
    );
};
