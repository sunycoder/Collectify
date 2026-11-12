const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const {once} = require('node:events');
const {dialog} = require('electron');
const {Store} = require('./store');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

async function until(fn) {
    const end = Date.now() + 15000;
    while (Date.now() < end) {
        if (await fn()) return;
        await delay(80);
    }
    throw Error('V3 窗口验证超时');
}

exports.run = async ({win, store, tabs, openEntry, closeTab}) => {
    const js = script => win.webContents.executeJavaScript(script);
    const artifacts = require('./verification-output').directory;
    const errors = [];
    win.webContents.on('console-message', event => {
        if (event.level === 3) errors.push(event.message);
    });
    await js("document.querySelector('dialog[open]')?.close()");
    await js("document.querySelector('#tasks-nav').click()");
    await until(() => js("!document.querySelector('#tasks-page').hidden"));
    await js("document.querySelector('#task-board-button').click()");
    await js("document.querySelector('#new-task').click()");
    await until(() => js("document.querySelector('#task-dialog').open"));
    await js("(() => { const f=document.querySelector('#task-form'); f.elements.title.value='检查发布前配置'; f.elements.priority.value='high'; f.elements.dueAt.value='2026-11-12T18:00'; f.elements.note.value='核对服务地址与版本号，再执行发布。'; f.requestSubmit(); })()");
    await until(() => store.data.tasks.length === 1);
    const taskId = store.data.tasks[0].id;
    await until(() => js("!!document.querySelector('.task-card') && !document.querySelector('#task-dialog').open"));
    await js(`(() => { const dt=new DataTransfer();document.querySelector('.task-card[data-id="${taskId}"]').dispatchEvent(new DragEvent('dragstart',{dataTransfer:dt,bubbles:true}));document.querySelector('.task-column[data-status="doing"]').dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true})); })()`);
    await until(() => store.data.tasks[0].status === 'doing');
    await js(`(() => { const s=document.querySelector('.task-card[data-id="${taskId}"] select');s.value='done';s.dispatchEvent(new Event('change')); })()`);
    await until(() => store.data.tasks[0].status === 'done');
    await until(() => js("!!document.querySelector('.task-card button[title=\"归档\"]')"));
    await js("document.querySelector('.task-card button[title=\"归档\"]').click()");
    await until(() => store.data.tasks[0].archived);
    await js("document.querySelector('#task-filter').value='archive';document.querySelector('#task-filter').dispatchEvent(new Event('change'))");
    await js("document.querySelector('.task-card button[title=\"恢复到看板\"]').click()");
    await until(() => !store.data.tasks[0].archived);
    await js("document.querySelector('#task-filter').value='active';document.querySelector('#task-filter').dispatchEvent(new Event('change'));document.querySelector('#task-calendar-button').click()");
    await until(() => js("!!document.querySelector('.fc-event')"));
    assert.equal(await js("document.querySelectorAll('.fc-event').length"), 1);
    await js("document.querySelector('.fc-event').click()");
    await until(() => js("document.querySelector('#task-dialog').open"));
    await js("document.querySelector('#task-form').elements.status.value='doing';document.querySelector('#task-form').requestSubmit()");
    await until(() => store.data.tasks[0].status === 'doing');
    await js("document.querySelector('#notes-nav').click();document.querySelector('#new-note').click()");
    await until(() => js("document.querySelector('#note-dialog').open"));
    await js("document.querySelector('#note-form').elements.title.value='发布备忘';document.querySelector('#note-form').elements.content.value='记录环境差异，完成后补充发布记录。';document.querySelector('#note-form').requestSubmit()");
    await until(() => store.data.notes.length === 1);
    await until(() => js("!!document.querySelector('.sticky-note')"));
    await js("document.querySelector('.sticky-note button[title=\"转为待办\"]').click()");
    await until(() => js("document.querySelector('#task-dialog').open"));
    assert.equal(await js("document.querySelector('#task-form').elements.title.value"), '发布备忘');
    await js("document.querySelector('#task-form').requestSubmit()");
    await until(() => store.data.tasks.length === 2);
    assert.equal(store.data.notes.length, 1);
    // 使用真实原生 IPC 路径测试 JSON 导入，只替代操作系统文件选择器。
    const originalOpen = dialog.showOpenDialog, originalSave = dialog.showSaveDialog;
    const importFile = path.join(artifacts, 'smoke-import.json'),
        exportFile = path.join(artifacts, 'smoke-export.json');
    try {
        const incoming = {
            version: 2, categories: [{id: 'gm', name: 'GM', color: 'blue', icon: 'game'}], entries: [
                {
                    name: '导入配置 · trunk',
                    url: 'http://101.43.147.105:8093/',
                    categoryId: 'gm',
                    username: 'demo',
                    password: 'test-only-not-a-real-password'
                }
            ]
        };
        fs.writeFileSync(importFile, JSON.stringify(incoming));
        dialog.showOpenDialog = async () => ({canceled: false, filePaths: [importFile]});
        const result = await js("window.workbench.call('import',{mode:'replace'})");
        assert.equal(result.ok, true);
        assert.equal(store.entries.length, 1);
        assert.equal(store.data.tasks.length, 2);
        assert.equal(store.data.notes.length, 1);
        assert.equal(store.entries[0].password, 'test-only-not-a-real-password');
        assert.ok(fs.readFileSync(store.file, 'utf8').includes('test-only-not-a-real-password'));
        const reopened = new Store(store.file);
        assert.equal(reopened.entries[0].name, '导入配置 · trunk');
        assert.equal(reopened.data.configSource, 'imported');
        const passwordMatches = await js("window.workbench.call('password'," + JSON.stringify(store.entries[0].id) + ").then(r=>r.ok && r.data==='test-only-not-a-real-password')");
        assert.equal(passwordMatches, true);
        dialog.showSaveDialog = async () => ({canceled: false, filePath: exportFile});
        assert.equal((await js("window.workbench.call('export')")).ok, true);
        assert.ok(!fs.readFileSync(exportFile, 'utf8').includes('passwordEncrypted'));
        const before = fs.readFileSync(store.file, 'utf8');
        fs.writeFileSync(importFile, '{bad json');
        assert.equal((await js("window.workbench.call('import',{mode:'replace'})")).ok, false);
        assert.equal(fs.readFileSync(store.file, 'utf8'), before);
    } finally {
        dialog.showOpenDialog = originalOpen;
        dialog.showSaveDialog = originalSave;
        if (fs.existsSync(importFile)) fs.unlinkSync(importFile);
    }
    // 账号密码 URL 自动拆分，HTTP Basic 仅对原站点发起。
    const server = http.createServer((req, res) => {
        if (req.headers.authorization !== `Basic ${Buffer.from('demo:test-secret').toString('base64')}`) {
            res.writeHead(401, {'WWW-Authenticate': 'Basic realm="smoke"'});
            res.end('Unauthorized');
        } else {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.end('<title>Basic 验证成功</title>OK');
        }
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    let basicId;
    try {
        const result = await js(`window.workbench.call('save',{name:'Basic 测试',url:'http://demo:test-secret@127.0.0.1:${server.address().port}/',categoryId:'gm'})`);
        assert.equal(result.ok, true);
        basicId = result.data.id;
        assert.equal(result.data.hasPassword, true);
        assert.equal(result.data.url.includes('@'), false);
        await openEntry(store.entries.find(e => e.id === basicId));
        assert.equal([...tabs.values()].at(-1).view.webContents.getTitle(), 'Basic 验证成功');
        for (const id of [...tabs.keys()]) closeTab(id);
        await js(`window.workbench.call('delete',${JSON.stringify(basicId)})`);
    } finally {
        server.close();
    }
    // 重新载入页面，验证真实持久化后的 UI 与新增内容。
    const loaded = once(win.webContents, 'did-finish-load');
    win.webContents.reload();
    await loaded;
    await until(() => js("document.querySelectorAll('.bookmark-card').length === 1"));
    assert.equal(await js("document.querySelector('#config-source').textContent.includes('已导入')"), true);
    await delay(250);
    fs.writeFileSync(path.join(artifacts, 'home-v3.png'), (await win.webContents.capturePage()).toPNG());
    await js("document.querySelector('#tasks-nav').click()");
    await until(() => js("!document.querySelector('#tasks-page').hidden"));
    await delay(200);
    fs.writeFileSync(path.join(artifacts, 'tasks-v3.png'), (await win.webContents.capturePage()).toPNG());
    await js("document.querySelector('#task-calendar-button').click()");
    await delay(150);
    fs.writeFileSync(path.join(artifacts, 'calendar-v3.png'), (await win.webContents.capturePage()).toPNG());
    await js("document.querySelector('#notes-nav').click()");
    await delay(150);
    fs.writeFileSync(path.join(artifacts, 'notes-v3.png'), (await win.webContents.capturePage()).toPNG());
    assert.deepEqual(errors, []);
    console.log('V3 SMOKE PASS: task UI/drag/status/archive/calendar; notes to tasks; JSON import/export/restart; editable credentials; HTTP Basic; screenshots.');
};
