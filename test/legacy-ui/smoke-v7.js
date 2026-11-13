const assert = require('node:assert/strict'),
    fs = require('node:fs'),
    path = require('node:path');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(fn) {
    const end = Date.now() + 15000;
    while (Date.now() < end) {
        if (await fn()) return;
        await delay(90);
    }
    throw Error('V7 UI timeout');
}

exports.run = async ({ win, store, loginHelper, desktopWidget, localMcp }) => {
    const js = (code) => win.webContents.executeJavaScript(code),
        artifacts = require('./verification-output').directory;
    await js("document.querySelector('dialog[open]')?.close();document.querySelector('#all-nav').click()");
    assert.equal(loginHelper.win?.isVisible() || false, false);
    assert.equal(await js("document.querySelectorAll('.kicker,.sidebar-note,.title-dot').length"), 0);
    assert.ok(
        await js(
            "document.querySelector('.brand-logo').complete && document.querySelector('.brand-logo').naturalWidth>0"
        )
    );
    await js("document.querySelector('#notes-nav').click()");
    await until(() => js("!document.querySelector('#notes-page').hidden"));
    const note = store.saveNote({
        title: '版本验证记录',
        content: '核对发布配置与回滚步骤。\n完成后整理验证结果。',
        color: 'blue'
    });
    await js('refresh()');
    const sizes = await js(
        "(()=>{const n=document.querySelector('.sticky-note'),title=n.querySelector('h2'),p=n.querySelector('p');return {title:parseFloat(getComputedStyle(title).fontSize),body:parseFloat(getComputedStyle(p).fontSize),height:n.getBoundingClientRect().height}})()"
    );
    assert.ok(sizes.title >= 18 && sizes.body >= 15 && sizes.height < 350);
    await delay(180);
    fs.writeFileSync(path.join(artifacts, 'notes-readable-v7.png'), (await win.webContents.capturePage()).toPNG());
    await js("document.querySelector('#tasks-nav').click();document.querySelector('#task-board-button').click()");
    await delay(120);
    assert.ok(
        await js("[...document.querySelectorAll('.task-title')].every(e=>parseFloat(getComputedStyle(e).fontSize)>=15)")
    );
    assert.ok(
        await js(
            "[...document.querySelectorAll('.reminded-label')].every(e=>parseFloat(getComputedStyle(e).fontSize)>=12)"
        )
    );
    const colors = await js("[...document.querySelectorAll('.task-stat')].map(e=>getComputedStyle(e).backgroundColor)");
    assert.equal(new Set(colors).size, 4);
    await delay(180);
    fs.writeFileSync(path.join(artifacts, 'board-readable-v7.png'), (await win.webContents.capturePage()).toPNG());
    await js("document.querySelector('#settings-button').click()");
    await until(() => js("document.querySelector('#settings-dialog').open"));
    assert.equal(await js("document.querySelector('#data-file').textContent"), store.file);
    assert.equal(fs.readFileSync(store.file).subarray(0, 15).toString(), 'SQLite format 3');
    assert.equal(
        store.repository.withDatabase((db) => db.prepare('PRAGMA integrity_check').get().integrity_check),
        'ok'
    );
    const backupFile = path.join(artifacts, `settings-backup-${Date.now()}.sqlite`),
        nativeDialog = require('electron').dialog,
        originalSaveDialog = nativeDialog.showSaveDialog;
    try {
        nativeDialog.showSaveDialog = async () => ({ canceled: false, filePath: backupFile });
        await js("document.querySelector('#backup-database').click()");
        await until(() => fs.existsSync(backupFile));
        assert.equal(new (require('./store').Store)(backupFile).data.tasks.length, store.data.tasks.length);
    } finally {
        nativeDialog.showSaveDialog = originalSaveDialog;
    }
    await localMcp.start(0);
    await js("call('workspace-info').then(info=>renderMcpStatus(info.mcp))");
    assert.ok(await js("document.querySelector('#mcp-status').textContent.includes('已开启')"));
    let rpcId = 1;

    async function rpc(method, params) {
        const response = await fetch(localMcp.status().url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${localMcp.config.token}`,
                'Content-Type': 'application/json',
                Accept: 'application/json, text/event-stream'
            },
            body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params })
        });
        assert.equal(response.status, 200);
        return response.json();
    }

    const initialized = await rpc('initialize', {
        protocolVersion: '2025-03-26',
        capabilities: {},
        clientInfo: { name: 'packaged-smoke', version: '1' }
    });
    assert.ok(initialized.result?.serverInfo);
    assert.equal((await rpc('tools/list', {})).result.tools.length, 6);
    const scheduled = await rpc('tools/call', {
        name: 'save_tasks',
        arguments: { tasks: [{ title: 'MCP窗口同步测试', status: 'todo', dueAt: '2026-11-13T18:00:00+08:00' }] }
    });
    assert.ok(!scheduled.result.isError);
    assert.ok(store.data.tasks.some((t) => t.title === 'MCP窗口同步测试'));
    await delay(150);
    fs.writeFileSync(path.join(artifacts, 'settings-mcp-v7.png'), (await win.webContents.capturePage()).toPNG());
    await localMcp.stop();
    await js("document.querySelector('#settings-dialog').close()");
    // 未加载完成的辅助窗口不能露出白板，用户在加载期间收起后也不能再次显示。
    loginHelper.destroy();
    const entry = store.entries.find((e) => e.password || e.username);
    const showing = loginHelper.show(entry);
    loginHelper.hide(true);
    await showing;
    assert.equal(loginHelper.allowed, false);
    assert.equal(loginHelper.win?.isVisible() || false, false);
    assert.ok(
        await loginHelper.win.webContents.executeJavaScript("document.querySelector('#site').textContent.length>=0")
    );
    loginHelper.destroy();
    await desktopWidget.open('floating');
    assert.ok(
        await desktopWidget.win.webContents.executeJavaScript(
            "document.querySelector('header').textContent.includes('手边待办')"
        )
    );
    desktopWidget.hide();
    desktopWidget.destroy();
    console.log(
        'V7 PASS: auxiliary readiness/cancel, canonical logo, notes and board typography, colored stats, data location and MCP settings.'
    );
};
