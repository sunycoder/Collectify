const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(fn) {
    const end = Date.now() + 12000;
    while (Date.now() < end) {
        if (await fn()) return;
        await delay(100);
    }
    throw new Error('等待验证结果超时');
}

exports.run = async ({ win, store, tabs, openEntry, closeTab, home }) => {
    const artifacts = require('./verification-output').directory;
    fs.mkdirSync(artifacts, { recursive: true });
    const js = (script) => win.webContents.executeJavaScript(script);
    const errors = [];
    win.webContents.on('console-message', (event) => {
        if (event.level === 3 || event.level === 'error') errors.push(event.message);
    });
    await until(() => js("document.querySelectorAll('.bookmark-card').length === 2"));
    await js("document.querySelector('#new-category').click()");
    await until(() => js("document.querySelector('#category-dialog').open"));
    await js(
        "document.querySelector('#category-form').elements.name.value = '测试分类'; document.querySelector('#category-form').requestSubmit()"
    );
    await until(() => store.categories.some((c) => c.name === '测试分类'));
    const category = store.categories.find((c) => c.name === '测试分类');
    await until(() =>
        js("!document.querySelector('#empty').hidden && !document.querySelector('#category-dialog').open")
    );
    await js("document.querySelector('#empty-add').click()");
    await until(() => js("document.querySelector('#entry-dialog').open"));
    await js(
        `(() => { const f = document.querySelector('#entry-form'); f.elements.name.value = '冒烟测试'; f.elements.url.value = 'http://127.0.0.1:1/'; f.requestSubmit(); })()`
    );
    await until(() => store.entries.length === 3);
    const bookmark = store.entries.at(-1);
    assert.equal(bookmark.categoryId, category.id);
    assert.equal(bookmark.environment, '');
    await until(() => js("document.querySelectorAll('.bookmark-card').length === 1"));
    await js(
        "document.querySelector('#search').value = '冒烟测试'; document.querySelector('#search').dispatchEvent(new Event('input'))"
    );
    assert.equal(await js("document.querySelectorAll('.bookmark-card').length"), 1);
    await js('document.querySelector(\'.bookmark-card button[title="置顶收藏"]\').click()');
    await until(() => store.entries.at(-1).favorite);
    const entryMenu = async (title) => {
        await until(() => js(`!!document.querySelector('.bookmark-card[data-id="${bookmark.id}"]')`));
        await js(`document.querySelector('.bookmark-card[data-id="${bookmark.id}"] button[title="更多操作"]').click()`);
        await js(`document.querySelector('#popup-menu button[title=${JSON.stringify(title)}]').click()`);
    };
    await entryMenu('编辑收藏');
    await until(() => js("document.querySelector('#entry-dialog').open"));
    await js(
        "document.querySelector('#entry-form').elements.note.value = '修改成功'; document.querySelector('#entry-form').requestSubmit()"
    );
    await until(() => store.entries.at(-1).note === '修改成功');
    // 通过真实拖放事件路径验证分类移动与撤销；不直接调用数据层替代交互。
    await until(() => js("!document.querySelector('#entry-dialog').open"));
    await js(
        `(() => { const dt = new DataTransfer(); const card = document.querySelector('.bookmark-card[data-id="${bookmark.id}"]'); card.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true })); document.querySelector('.category-row[data-id="jenkins"]').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); })()`
    );
    await until(() => store.entries.at(-1).categoryId === 'jenkins');
    await until(() => js("!!document.querySelector('#toast button')"));
    await js("document.querySelector('#toast button').click()");
    await until(() => store.entries.at(-1).categoryId === category.id);
    // 分类改名保留收藏，删除分类通过接收分类转移收藏。
    await js(`document.querySelector('.category-row[data-id="${category.id}"] .category-more').click()`);
    await js('document.querySelector(\'#popup-menu button[title="编辑分类"]\').click()');
    await until(() => js("document.querySelector('#category-dialog').open"));
    await js(
        "document.querySelector('#category-form').elements.name.value = '改名后的分类'; document.querySelector('#category-form').requestSubmit()"
    );
    await until(() => store.categories.some((c) => c.id === category.id && c.name === '改名后的分类'));
    assert.equal(store.entries.at(-1).categoryId, category.id);
    await js(`document.querySelector('.category-row[data-id="${category.id}"] .category-more').click()`);
    await js('document.querySelector(\'#popup-menu button[title="删除分类"]\').click()');
    await until(() => js("document.querySelector('#action-dialog').open"));
    await js(
        "document.querySelector('#target-category').value = 'gm'; document.querySelector('#action-confirm').click()"
    );
    await until(() => !store.categories.some((c) => c.id === category.id));
    assert.equal(store.entries.at(-1).categoryId, 'gm');
    await js("document.querySelector('#all-nav').click()");
    await entryMenu('删除收藏');
    await until(() => js("document.querySelector('#action-dialog').open"));
    await js("document.querySelector('#action-confirm').click()");
    await until(() => store.entries.length === 2);
    await js("document.querySelector('#all-nav').click()");
    await js("document.querySelector('#list-view').click()");
    assert.equal(await js("document.querySelector('#entries').classList.contains('list')"), true);
    await js("document.querySelector('#grid-view').click()");
    // 写盘成功早于 IPC 回包和 dialog close 事件；先等真实交互结束再测试快捷键。
    await until(() => js("!document.querySelector('dialog[open]')"));
    await js("call('overlay',false)");
    // 在本地 HTTP 站点真实验证页面加载、会话隔离和远程页面权限。
    const server = http.createServer((req, res) => {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(
            '<!doctype html><html><head><title>本地验证站点</title></head><body><h1>网页加载成功</h1><a href="/next">下一页</a></body></html>'
        );
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
        const url = `http://127.0.0.1:${server.address().port}/`;
        await openEntry({ ...store.entries[0], url });
        const a = [...tabs.values()].at(-1);
        assert.equal(a.view.webContents.getTitle(), '本地验证站点');
        assert.equal(await a.view.webContents.executeJavaScript('typeof process'), 'undefined');
        assert.equal(await a.view.webContents.executeJavaScript('typeof window.workbench'), 'undefined');
        const preferences = a.view.webContents.getLastWebPreferences();
        assert.equal(preferences.sandbox, true);
        assert.equal(preferences.nodeIntegration, false);
        // 离屏窗口没有稳定的系统键盘焦点，直接覆盖生产 before-input-event 处理链。
        a.view.webContents.emit(
            'before-input-event',
            {
                preventDefault() {}
            },
            { type: 'keyDown', control: true, meta: false, key: 'k' }
        );
        // 离屏渲染不能承诺 OS 活动焦点；这里断言快捷键确实返回收藏页，搜索输入的视觉焦点由有界面运行验证。
        await until(() => js("!document.querySelector('#dashboard').hidden"));
        await a.view.webContents.executeJavaScript("document.cookie = 'smoke=first; path=/'");
        await openEntry({ ...store.entries[1], url });
        const b = [...tabs.values()].at(-1);
        assert.equal(await b.view.webContents.executeJavaScript('document.cookie'), '');
        assert.ok((await a.view.webContents.executeJavaScript('document.cookie')).includes('smoke=first'));
        assert.notEqual(a.view.webContents.session, b.view.webContents.session);
        await b.view.webContents.loadURL(`${url}next`);
        assert.equal(b.view.webContents.navigationHistory.canGoBack(), true);
        const popupPromise = new Promise((resolve) => {
            const end = setTimeout(() => resolve(false), 8000);
            const timer = setInterval(() => {
                if (tabs.size === 3) {
                    clearTimeout(end);
                    clearInterval(timer);
                    resolve(true);
                }
            }, 100);
        });
        await b.view.webContents.executeJavaScript(`window.open(${JSON.stringify(url + 'popup')})`);
        assert.equal(await popupPromise, true);
        for (const id of [...tabs.keys()]) closeTab(id);
        await openEntry({ ...store.entries[0], url: 'http://127.0.0.1:1/' });
        assert.ok([...tabs.values()][0].error);
        for (const id of [...tabs.keys()]) closeTab(id);
        home();
        const loaded = once(win.webContents, 'did-finish-load');
        win.webContents.reload();
        await loaded;
        await until(() => js("document.querySelectorAll('.bookmark-card').length === 2"));
        await delay(500);
        console.log('Capturing home');
        fs.writeFileSync(
            path.join(artifacts, 'home-v2.png'),
            (await win.webContents.capturePage(undefined, { stayAwake: true })).toPNG()
        );
        await js('document.querySelector(\'.category-row[data-id="jenkins"] .nav-item\').click()');
        await delay(150);
        fs.writeFileSync(path.join(artifacts, 'empty-category-v2.png'), (await win.webContents.capturePage()).toPNG());
        await js('document.querySelector(\'.category-row[data-id="gm"] .nav-item\').click()');
        await js("document.querySelector('#add-button').click()");
        await until(() => js("document.querySelector('#entry-dialog').open"));
        await delay(250);
        fs.writeFileSync(path.join(artifacts, 'entry-dialog-v2.png'), (await win.webContents.capturePage()).toPNG());
        assert.deepEqual(errors, []);
        console.log(
            'SMOKE PASS: category create/rename/delete-transfer; bookmark create/search/pin/edit/delete; drag-to-category/undo; grid/list; HTTP navigation/popup; remote and cookie isolation; error state; v2 screenshots.'
        );
    } finally {
        server.close();
    }
};
