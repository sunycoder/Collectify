const assert = require('node:assert/strict');
const { dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs'),
    os = require('node:os');
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
        return async (code) => {
            try {
                return await runtime.views.get(id).view.webContents.executeJavaScript(code);
            } catch (error) {
                throw Error(id + ': ' + code + '\n' + error.message);
            }
        };
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
        const bookmarkPage = await open('collectify.bookmarks');
        await bookmarkPage('refresh()');
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'collectify-repair-'));
        const originalPick = dialog.showOpenDialog;
        try {
            const replacement = path.join(directory, 'moved.txt');
            fs.writeFileSync(replacement, 'repair fixture');
            const resource = await services.call('collectify.bookmarks', 'save', {
                name: '待修复文件',
                type: 'file',
                categoryId: 'inbox',
                localPath: path.join(directory, 'missing.txt'),
                note: '保留备注',
                username: '账号',
                password: 'repair-test-password'
            });
            await bookmarkPage('refresh()');
            await bookmarkPage(`open(state.entries.find(e=>e.id===${JSON.stringify(resource.id)}))`);
            assert.match(await bookmarkPage("document.querySelector('#action-title').textContent"), /找不到/);
            dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
            await bookmarkPage("document.querySelector('#action-confirm').click()");
            await until(() => bookmarkPage("!document.querySelector('#action-confirm').disabled"));
            assert.equal(
                (await services.call('collectify.bookmarks', 'state')).entries.find((e) => e.id === resource.id)
                    .localPath,
                resource.localPath
            );
            await bookmarkPage(`open(state.entries.find(e=>e.id===${JSON.stringify(resource.id)}))`);
            dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [replacement] });
            // 后台真实修复并核对持久化；不在冒烟中启动用户的外部编辑器。
            await services.call('collectify.bookmarks', 'relocate-resource', resource.id);
            await bookmarkPage("document.querySelector('#action-dialog').close()");
            const repaired = (await services.call('collectify.bookmarks', 'state')).entries.find(
                (e) => e.id === resource.id
            );
            assert.equal(repaired.localPath, replacement);
            assert.equal(repaired.note, '保留备注');
            assert.equal(await services.call('collectify.bookmarks', 'password', resource.id), 'repair-test-password');
            const target = await services.call('collectify.bookmarks', 'category-save', {
                name: '批量目标',
                color: 'sage',
                icon: 'link'
            });
            await assert.rejects(
                services.call('collectify.bookmarks', 'move-many', {
                    ids: [resource.id, 'missing'],
                    categoryId: target.id
                }),
                /已删除/
            );
            assert.equal(
                (await services.call('collectify.bookmarks', 'state')).entries.find((e) => e.id === resource.id)
                    .categoryId,
                'inbox'
            );
            await bookmarkPage('refresh()');
            await bookmarkPage(
                `document.querySelector('#batch-toggle').click();toggleBookmark(${JSON.stringify(resource.id)});document.querySelector('#search').value='不会匹配';render()`
            );
            assert.match(await bookmarkPage("document.querySelector('#batch-summary').textContent"), /隐藏 1 条/);
            await runtime.views
                .get('collectify.bookmarks')
                .view.webContents.capturePage()
                .then((image) => fs.writeFileSync(path.resolve('dist/bookmark-batch-preview.png'), image.toPNG()));
            await bookmarkPage("document.querySelector('#batch-move').click()");
            await until(() => bookmarkPage("document.querySelector('#action-dialog').open"));
            await until(() =>
                bookmarkPage(
                    `!!document.querySelector('#target-category').tomselect.options[${JSON.stringify(target.id)}]`
                )
            );
            await bookmarkPage(
                `document.querySelector('#target-category').tomselect.setValue(${JSON.stringify(target.id)});document.querySelector('#action-confirm').click()`
            );
            await until(async () => {
                const error = await bookmarkPage("document.querySelector('#action-dialog .form-error').textContent");
                if (error) throw Error('批量移动失败：' + error);
                return (
                    (await services.call('collectify.bookmarks', 'state')).entries.find((e) => e.id === resource.id)
                        .categoryId === target.id
                );
            });
            assert.equal(await services.call('collectify.bookmarks', 'password', resource.id), 'repair-test-password');
            await bookmarkPage(
                "document.querySelector('#batch-toggle').click();document.querySelector('#search').value='';render()"
            );
        } finally {
            dialog.showOpenDialog = originalPick;
            fs.rmSync(directory, { recursive: true, force: true });
        }
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
        await services.call('collectify.notes', 'note-sort', 'manual');
        const beforeOrder = (await services.call('collectify.notes', 'state')).notes.map((n) => n.id);
        const note = (await services.call('collectify.notes', 'state')).notes[0];
        await services.call('collectify.notes', 'note-save', { ...note, content: '编辑后不移动' });
        assert.deepEqual(
            (await services.call('collectify.notes', 'state')).notes.map((n) => n.id),
            beforeOrder
        );
        if (beforeOrder.length > 1) {
            await services.call('collectify.notes', 'note-move', { id: beforeOrder.at(-1), before: beforeOrder[0] });
            assert.equal((await services.call('collectify.notes', 'state')).notes[0].id, beforeOrder.at(-1));
        }
        await notes("document.querySelector('#note-search').value='does not exist';renderNotes()");
        assert.match(await notes("document.querySelector('#notes-grid').textContent"), /清除筛选/);
        const noteStore = services.providers.get('collectify.notes').store;
        noteStore.commit({
            ...noteStore.data,
            notes: [
                ...noteStore.data.notes,
                ...Array.from({ length: 201 }, (_, i) => ({
                    id: 'performance-note-' + i,
                    title: '批量便签' + i,
                    content: '内容',
                    color: 'yellow',
                    updatedAt: new Date().toISOString()
                }))
            ]
        });
        await notes("document.querySelector('#note-search').value='';renderNotes();refresh()");
        assert.equal(await notes("document.querySelectorAll('.sticky-note').length"), 100);
        await notes("document.querySelector('#more-notes').click()");
        assert.equal(await notes("document.querySelectorAll('.sticky-note').length"), 200);
        await notes("document.querySelector('#note-search').value='未保存测试';renderNotes()");
        await until(() => runtime.views.get('collectify.notes')?.reclaimable === true);
        const previousNotePage = runtime.views.get('collectify.notes').view.webContents.id;
        await open('collectify.json');
        await runtime.prunePages({ maxPages: 0, idleMs: 0 });
        assert.equal(runtime.views.has('collectify.notes'), false);
        const restoredNotes = await open('collectify.notes');
        await restoredNotes('ready');
        await until(() => restoredNotes("document.querySelector('#note-search').value==='未保存测试'"));
        assert.notEqual(runtime.views.get('collectify.notes').view.webContents.id, previousNotePage);
        const tasks = await open('collectify.tasks');
        await tasks('ready');
        const dueAt = new Date(Date.now() + 86400000).toISOString();
        const reminder = await services.call('collectify.tasks', 'task-save', { title: '提醒改期测试', dueAt });
        await tasks('refresh()');
        await tasks(
            `document.querySelector('.checklist-row[data-id="${reminder.id}"] button[title="调整提醒时间"]').click()`
        );
        await until(() => tasks("document.querySelector('#reminder-dialog').open"));
        await new Promise((resolve) => setTimeout(resolve, 150));
        await runtime.views
            .get('collectify.tasks')
            .view.webContents.capturePage()
            .then((image) => fs.writeFileSync(path.resolve('dist/task-reminder-preview.png'), image.toPNG()));
        await tasks(
            "document.querySelector('[data-remind-delay=\"tomorrow\"]').click();document.querySelector('#reminder-save').click()"
        );
        await until(() => tasks("!document.querySelector('#reminder-dialog').open"));
        const adjusted = (await services.call('collectify.tasks', 'state')).tasks.find((t) => t.id === reminder.id);
        assert.equal(adjusted.dueAt, dueAt);
        assert.equal(new Date(adjusted.remindAt).getHours(), 9);
        await assert.rejects(
            services.call('collectify.tasks', 'task-remind', { id: reminder.id, remindAt: '2000-01-01' }),
            /未来/
        );
        await services.call('collectify.tasks', 'task-save', { ...adjusted, status: 'done' });
        await assert.rejects(
            services.call('collectify.tasks', 'task-remind', { id: reminder.id, remindAt: dueAt }),
            /完成/
        );
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
        const calculatorPage = runtime.views.get('collectify.calculator').view.webContents;
        await until(() => calculatorPage.executeJavaScript('initialized'));
        const keyboard = () =>
            [...runtime.popouts.values()].find((record) => record.pluginId === 'collectify.calculator');
        await until(() => !!keyboard() && !keyboard().loading);
        win.show();
        await hostAction('overlay', false);
        await until(() => keyboard().window.isVisible());
        win.hide();
        await until(() => !keyboard().window.isVisible());
        win.show();
        await until(() => keyboard().window.isVisible());
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
