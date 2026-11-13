const assert = require('node:assert/strict');
const { once } = require('node:events');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

exports.run = async ({ win, store }) => {
    const js = (code) => win.webContents.executeJavaScript(code);
    const data = store.snapshot();
    data.tasks = [];
    store.commit(data);
    for (const status of ['inbox', 'todo', 'doing', 'done'])
        store.saveTask({ title: `侧栏计数验证 ${status}`, status });
    store.saveTask({ title: '已归档任务不计入', status: 'done', archived: true });
    const reload = async (expected) => {
        const loaded = once(win.webContents, 'did-finish-load');
        win.webContents.reload();
        await loaded;
        for (let i = 0; i < 100; i++) {
            if (await js(`state.tasks?.length === ${expected}`)) break;
            await delay(50);
        }
        assert.equal(await js('currentSection'), 'bookmarks');
        assert.equal(
            await js("document.querySelector('#tasks-count').textContent"),
            expected === 5 ? '3' : '0',
            '未点击待办导航时侧栏就应显示未完成、未归档数量'
        );
        assert.equal(
            await js("document.querySelector('#task-stats strong').textContent"),
            expected === 5 ? '3' : '0',
            '首次刷新也应初始化待办统计'
        );
    };
    // 连续重新加载页面，覆盖已有数据启动时的脚本与 IPC 加载时序。
    await reload(5);
    await reload(5);
    await js("document.querySelector('#tasks-nav').click()");
    await delay(150);
    assert.equal(await js("document.querySelector('#tasks-count').textContent"), '3');
    const empty = store.snapshot();
    empty.tasks = [];
    store.commit(empty);
    await reload(0);
    console.log('V14 通过：首次收藏页显示正确待办数量，重新加载、进入待办和空数据计数一致，完成及归档任务不计入。');
};
