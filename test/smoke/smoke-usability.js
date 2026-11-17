const assert = require('node:assert/strict');
const { dialog } = require('electron');
const path = require('node:path');
exports.run = async ({ registry, services, runtime, hostAction, win }) => {
    const host = (code) =>
        win.webContents.executeJavaScript(code).catch((error) => {
            throw new Error(code);
        });
    const until = async (action) => {
        for (let i = 0; i < 100; i++) {
            if (await action()) return;
            await new Promise((r) => setTimeout(r, 30));
        }
        throw Error('操作体验等待超时');
    };
    const open = async (id) => {
        await hostAction('plugin-open', { id });
        return (code) => runtime.views.get(id).view.webContents.executeJavaScript(code);
    };
    await host('shellReady');
    const previous = dialog.showMessageBox;
    let choice = 0,
        prompts = 0;
    dialog.showMessageBox = async () => {
        prompts++;
        return { response: choice };
    };
    try {
        const notes = await open('collectify.notes');
        await notes('ready');
        await notes('showNote();');
        await until(() => notes("document.querySelector('#note-dialog').open"));
        await notes(
            "document.querySelector('#note-form').elements.title.value='未保存测试';document.querySelector('#note-dialog').close()"
        );
        await until(() => prompts > 0);
        assert.equal(await notes("document.querySelector('#note-dialog').open"), true);
        await assert.rejects(hostAction('plugin-enable', { id: 'collectify.notes', enabled: false }), /取消/);
        assert.equal(registry.get('collectify.notes').enabled, true);
        choice = 2;
        await notes("document.querySelector('#note-dialog').close()");
        await until(() => notes("!document.querySelector('#note-dialog').open"));
        assert.ok((await services.call('collectify.notes', 'state')).notes.some((n) => n.title === '未保存测试'));
        await notes("document.querySelector('#note-search').value='does not exist';renderNotes()");
        assert.match(await notes("document.querySelector('#notes-grid').textContent"), /清除筛选/);
        const tasks = await open('collectify.tasks');
        await tasks('ready');
        await tasks('showTask()');
        await until(() => tasks("document.querySelector('#task-dialog').open"));
        choice = 0;
        const priorPrompts = prompts;
        await tasks("taskAttachments.push('C:/fixture.txt');document.querySelector('#task-dialog').close()");
        await until(() => prompts > priorPrompts);
        assert.equal(await tasks("document.querySelector('#task-dialog').open"), true);
        choice = 1;
        await tasks("document.querySelector('#task-dialog').close()");
        await until(() => tasks("!document.querySelector('#task-dialog').open"));
        const json = await open('collectify.json');
        await json("document.querySelector('#input').value='invalid';document.querySelector('#format').click()");
        await until(() => json("!document.querySelector('#jump-error').hidden"));
        await json("document.querySelector('#jump-error').click()");
        assert.equal(await json('document.activeElement.id'), 'input');
        assert.equal(await json("document.querySelectorAll('.json-gutter').length"), 2);
        await json("document.querySelector('.json-enlarge').click()");
        assert.equal(await json('document.body.dataset.editorFocus'), 'input');
        await json("document.querySelector('.json-enlarge').click()");
        await json("document.querySelector('#clear').click();document.querySelector('#undo-clear').click()");
        assert.equal(await json("document.querySelector('#input').value"), 'invalid');
        registry.install(path.resolve(__dirname, '../../src/plugin-library/calculator'));
        await services.load();
        await hostAction('plugin-open', { id: 'collectify.calculator' });
        await host('refresh()');
        assert.equal(await host("document.body.classList.contains('navigation-collapsed')"), true);
        await host("document.querySelector('#expand-navigation').click()");
        await until(() => host("!document.body.classList.contains('navigation-collapsed')"));
        await host(
            "catalogState={...catalogState,loaded:true,plugins:[{id:'collectify.calculator',version:'9.0.0',name:'计算稿纸',description:'更新测试',size:100,compatible:true}]};pluginManagerSignature='';renderPluginManager()"
        );
        assert.match(await host("document.querySelector('#plugin-manager').textContent"), /可更新/);
        console.log(
            'USABILITY PASS：便签保存/取消、停用保护、待办附件保护、空筛选恢复、JSON 定位撤销、单入口导航与已安装更新。'
        );
    } finally {
        dialog.showMessageBox = previous;
    }
};
