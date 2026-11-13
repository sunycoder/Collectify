const assert = require('node:assert/strict');
const fs = require('node:fs'),
    path = require('node:path');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
exports.run = async ({ win, store }) => {
    const js = (code) =>
        win.webContents.executeJavaScript(code).catch((error) => {
            console.error('V8 step:', code);
            throw error;
        });
    await js("document.querySelector('dialog[open]')?.close();document.querySelector('#tasks-nav').click()");
    const data = store.snapshot();
    const { validateTask } = require('./productivity');
    for (let i = 0; i < 18; i++)
        data.tasks.push(
            validateTask({
                title: `版本发布核对 ${i + 1}`,
                status: 'todo',
                priority: i % 3 === 0 ? 'high' : 'medium',
                note: i % 2 ? '核对安装包、登录资料与日程。' : '',
                dueAt: '2026-11-13T10:00:00+08:00'
            })
        );
    data.tasks.push(
        validateTask({
            title: '整理版本发布清单',
            status: 'doing',
            priority: 'high',
            important: true,
            note: '核对变更范围和上线时间。',
            dueAt: '2026-11-13T12:00:00+08:00'
        })
    );
    data.tasks.push(validateTask({ title: '更新收藏分类', status: 'done', note: 'GM 与 Jenkins 地址已归类。' }));
    store.commit(data);
    await js(
        "refresh().then(()=>{document.querySelector('#task-filter').value='active';document.querySelector('#task-date-query').value='';document.querySelector('#task-search').value='';document.querySelector('#task-board-button').click();window.scrollTo(0,0)})"
    );
    win.setSize(1440, 960);
    await delay(400);
    const geometry = await js(`(()=>{
    const board=document.querySelector('#task-board'),columns=[...board.querySelectorAll('.task-column')],body=columns[1].querySelector('.task-column-body');
    return {heights:columns.map(n=>Math.round(n.getBoundingClientRect().height)),bottom:board.getBoundingClientRect().bottom,screen:innerHeight,scrolls:body.scrollHeight>body.clientHeight,title:document.title,brand:document.querySelector('.brand strong').textContent,font:parseFloat(getComputedStyle(body.querySelector('.task-title')).fontSize)};
  })()`);
    assert.equal(new Set(geometry.heights).size, 1);
    assert.ok(geometry.bottom <= geometry.screen);
    assert.ok(geometry.scrolls);
    assert.ok(geometry.font >= 15);
    assert.ok(geometry.title.includes('Collectify'));
    assert.ok(geometry.brand.includes('Collectify'));
    // 用真实滚轮输入验证列滚动；不能只检查 CSS 声称可滚动。
    const center = await js(
        "(()=>{const r=document.querySelector('.task-column.todo .task-column-body').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()"
    );
    win.webContents.sendInputEvent({ type: 'mouseMove', ...center });
    win.webContents.sendInputEvent({ type: 'mouseWheel', ...center, deltaY: -450, deltaX: 0, canScroll: true });
    await delay(250);
    assert.ok(await js("document.querySelector('.task-column.todo .task-column-body').scrollTop>0"));
    await js("document.querySelector('.task-column.todo .task-column-body').scrollTop=0");
    fs.writeFileSync(
        path.join(require('./verification-output').directory, 'collectify-board.png'),
        (await win.webContents.capturePage()).toPNG()
    );
    // 点击标题进入详情仍可编辑，弹层继续沿用统一组件。
    await js("document.querySelector('.task-column.doing .task-title').click()");
    await delay(100);
    assert.ok(await js("document.querySelector('#task-dialog').open"));
    await js("document.querySelector('#task-dialog').close()");
    win.setSize(1080, 760);
    await delay(250);
    assert.ok(
        await js("document.querySelector('#task-board').scrollWidth>document.querySelector('#task-board').clientWidth")
    );
    console.log(
        'V8 PASS: Collectify branding, equal-height independent board scroll, compact readable cards, edit and narrow-screen overflow.'
    );
};
