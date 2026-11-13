const assert = require('node:assert/strict'),
    fs = require('node:fs'),
    path = require('node:path'),
    http = require('node:http');
const { once } = require('node:events');
const { clipboard } = require('electron');
const credentials = require('./credentials');
const { Store } = require('./store');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(fn, label = 'condition') {
    const end = Date.now() + 15000;
    while (Date.now() < end) {
        if (await fn()) return;
        await delay(80);
    }
    throw Error(`V6 timeout: ${label}`);
}

exports.run = async ({ win, store, tabs, openEntry, closeTab, loginHelper }) => {
    const js = (code) =>
            win.webContents.executeJavaScript(code).catch((e) => {
                console.error('V6 script:', code);
                throw e;
            }),
        artifacts = require('./verification-output').directory;
    const errors = [];
    win.webContents.on('console-message', (event) => {
        if (event.level === 3) errors.push(event.message);
    });

    async function click(selector, where = {}) {
        const point = await js(
            `(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('missing '+${JSON.stringify(selector)});const r=e.getBoundingClientRect();const x=r.left+r.width*${where.x || 0.5},y=r.top+r.height*${where.y || 0.5};const hit=document.elementFromPoint(x,y);return {x:Math.round(x),y:Math.round(y),hit:!!hit&&(e===hit||e.contains(hit)),hitElement:hit?.outerHTML.slice(0,200),rect:{x:r.x,y:r.y,w:r.width,h:r.height}};})()`
        );
        assert.ok(point.hit, `${selector} must be hit-testable ${JSON.stringify(point)}`);
        const factor = win.webContents.getZoomFactor(),
            x = Math.round(point.x * factor),
            y = Math.round(point.y * factor);
        win.webContents.sendInputEvent({ type: 'mouseMove', x, y });
        win.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
        win.webContents.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
        await delay(120);
    }

    async function assertOverlay(selector) {
        await delay(160);
        const r = await js(
            `(()=>{const e=document.querySelector(${JSON.stringify(selector)});const r=e.getBoundingClientRect();const v=visualViewport;const hit=document.elementFromPoint(r.left+r.width/2,r.bottom-15);return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,w:innerWidth,h:innerHeight,pop:e.matches(':popover-open'),hit:!!hit&&e.contains(hit),height:r.height}})()`
        );
        assert.ok(
            r.pop && r.left >= 8 && r.top >= 8 && r.right <= r.w - 8 && r.bottom <= r.h - 8 && r.hit,
            JSON.stringify(r)
        );
        return r;
    }

    const bounds = win.getBounds();
    await js(
        "document.querySelector('dialog[open]')?.close();document.querySelector('#tasks-nav').click();document.querySelector('#new-task').click()"
    );
    await until(() => js("document.querySelector('#task-dialog').open"));
    for (const field of ['startAt', 'endAt', 'dueAt', 'remindAt']) {
        await js(
            `(()=>{const e=document.querySelector('#task-form').elements.${field};e._flatpickr.setDate('2026-11-12T10:21',false);e._flatpickr.altInput.scrollIntoView({block:'center'});})()`
        );
        await delay(220);
        await click(`#task-form [name=${field}] + input`);
        await until(
            () => js(`document.querySelector('#task-form').elements.${field}._flatpickr.isOpen`),
            'picker open'
        );
        await assertOverlay('.flatpickr-calendar.open');
        const before = await js(
            `document.querySelector('#task-form').elements.${field}._flatpickr.minuteElement.value`
        );
        const beforeDate = await js(
            `document.querySelector('#task-form').elements.${field}._flatpickr.selectedDates[0].toDateString()`
        );
        await click('.flatpickr-calendar.open .flatpickr-minute');
        const selected = await js(
            `document.querySelector('#task-form').elements.${field}._flatpickr.minuteElement.selectionStart`
        ); // input type number may return null; click still must retain popup.
        assert.ok(await js(`document.querySelector('#task-form').elements.${field}._flatpickr.isOpen`));
        await click('.flatpickr-calendar.open .flatpickr-time .numInputWrapper:nth-child(3) .arrowUp');
        const after = await js(`document.querySelector('#task-form').elements.${field}._flatpickr.minuteElement.value`);
        assert.notEqual(after, before);
        await click('.flatpickr-calendar.open .flatpickr-time .numInputWrapper:nth-child(3) .arrowDown');
        assert.equal(
            await js(`document.querySelector('#task-form').elements.${field}._flatpickr.minuteElement.value`),
            before
        );
        assert.equal(
            await js(
                `document.querySelector('#task-form').elements.${field}._flatpickr.selectedDates[0].toDateString()`
            ),
            beforeDate,
            'time arrows must not change date'
        );
        const aligned = await js(
            "(()=>{const c=document.querySelector('.flatpickr-calendar.open');const h=c.querySelector('.flatpickr-hour').getBoundingClientRect(),m=c.querySelector('.flatpickr-minute').getBoundingClientRect();return Math.abs(h.y-m.y)<1&&Math.abs(h.height-m.height)<1})()"
        );
        assert.ok(aligned, 'hour/minute aligned');
        await assertOverlay('.flatpickr-calendar.open');
        await js(`document.querySelector('#task-form').elements.${field}._flatpickr.close()`);
    }
    // 小窗口与缩放：弹层仍在视觉视口内，底部动作可点击。
    for (const [width, height, zoom] of [
        [1050, 720, 1],
        [1200, 780, 1.25]
    ]) {
        win.setSize(width, height);
        win.webContents.setZoomFactor(zoom);
        await delay(300);
        await js(
            "document.querySelector('#task-form').elements.remindAt._flatpickr.altInput.scrollIntoView({block:'end'})"
        );
        await delay(120);
        await click('#task-form [name=remindAt] + input');
        await assertOverlay('.flatpickr-calendar.open');
        await click('.flatpickr-calendar.open .picker-actions button:last-child');
        assert.ok(await js("!document.querySelector('#task-form').elements.remindAt._flatpickr.isOpen"));
    }
    await js('OfficeUI.close()');
    win.webContents.setZoomFactor(1);
    win.setBounds(bounds);
    await delay(350);
    await js(
        "document.querySelector('#task-form').elements.remindAt._flatpickr.altInput.scrollIntoView({block:'center'})"
    );
    await delay(120);
    await click('#task-form [name=remindAt] + input');
    await assertOverlay('.flatpickr-calendar.open');
    fs.writeFileSync(path.join(artifacts, 'picker-boundaries-v6.png'), (await win.webContents.capturePage()).toPNG());
    await js(
        "document.querySelector('#task-form').elements.remindAt._flatpickr.close();document.querySelector('#task-form').elements.bookmarkId.tomselect.control.scrollIntoView({block:'end'})"
    );
    await delay(150);
    await click('#task-form [name=bookmarkId] + .ts-wrapper .ts-control');
    await assertOverlay('.ts-dropdown:popover-open');
    await js(
        "document.querySelector('#task-form').elements.bookmarkId.tomselect.close();document.querySelector('#task-dialog').close()"
    );
    // 验证普通、重要、完成日程样式由前景色决定，普通事件不能落回白字。
    const day = new Date();
    day.setHours(10, 0, 0, 0);
    const normal = store.saveTask({
        title: '长时间普通日程',
        status: 'todo',
        startAt: day.toISOString(),
        endAt: new Date(day.getTime() + 4 * 3600000).toISOString()
    });
    await js(
        "refresh().then(()=>{document.querySelector('#tasks-nav').click();document.querySelector('#task-calendar-button').click()})"
    );
    await until(() => js("!!document.querySelector('.fc-timegrid')"));
    await delay(200);
    const appearance = await js(
        `(()=>{const e=[...document.querySelectorAll('.fc-event')].find(n=>n.querySelector('.fc-event-title')?.textContent==='长时间普通日程');const title=e.querySelector('.fc-event-title'),frame=e.querySelector('.fc-event-main-frame');return {fg:getComputedStyle(title).color,bg:getComputedStyle(e).backgroundColor,center:getComputedStyle(frame).justifyContent,align:getComputedStyle(frame).alignItems,mini:document.querySelector('#mini-calendar .flatpickr-day').getBoundingClientRect().width}})()`
    );
    assert.notEqual(appearance.fg, 'rgb(255, 255, 255)');
    assert.equal(appearance.center, 'center');
    assert.equal(appearance.align, 'center');
    assert.ok(appearance.mini >= 29);
    assert.ok(
        await js(
            "[...document.querySelectorAll('.fc-scrollgrid-section-header .fc-scroller')].every(e=>getComputedStyle(e).overflowY==='hidden')"
        )
    );
    fs.writeFileSync(
        path.join(artifacts, 'calendar-readability-v6.png'),
        (await win.webContents.capturePage()).toPNG()
    );
    // SQLite 中明文凭据的重启、编辑及复制回归。
    const server = http.createServer((_req, res) => {
        res.setHeader('Content-Type', 'text/html');
        res.end('<title>普通网页登录</title><input name="username"><input type="password" name="password">');
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
        const result = await js(
            `window.workbench.call('save',{name:'表单登录测试',url:'http://127.0.0.1:${server.address().port}/',categoryId:'gm',username:'demo-user',password:'visible-test-only',authMode:'basic'})`
        );
        assert.ok(result.ok);
        const id = result.data.id;
        assert.equal(new Store(store.file).entries.find((e) => e.id === id).password, 'visible-test-only');
        await js(`refresh().then(()=>showEditor(state.entries.find(e=>e.id===${JSON.stringify(id)})))`);
        await until(() => js("document.querySelector('#entry-dialog').open"));
        assert.ok(await js("document.querySelector('#entry-form').elements.password.value==='visible-test-only'"));
        const nativeClipboardWindow = new (require('electron').BrowserWindow)({ show: false });
        await nativeClipboardWindow.loadURL('about:blank');
        await clipboard.writeText('clipboard-baseline');
        await delay(100);
        await js("document.querySelector('#editor-copy-password').click()");
        try {
            await until(async () => (await clipboard.readText()) === 'visible-test-only', 'editor clipboard');
        } catch (error) {
            console.error(
                'Clipboard diagnostic:',
                await js(
                    "({buttonDisabled:document.querySelector('#editor-copy-password').disabled,toast:document.querySelector('#toast').textContent})"
                )
            );
            throw error;
        }
        nativeClipboardWindow.destroy();
        await js("document.querySelector('#entry-dialog').close()");
        await delay(100);
        await js(`window.workbench.call('open',${JSON.stringify(id)})`);
        await until(() => !!loginHelper.win);
        const helperJs = (code) => loginHelper.win.webContents.executeJavaScript(code);
        await until(() => helperJs("document.querySelector('#password').value==='visible-test-only'"));
        assert.ok(await helperJs("document.querySelector('#help').textContent.includes('网页表单')"));
        await helperJs("document.querySelector('#copy-user').click()");
        await until(async () => (await clipboard.readText()) === 'demo-user');
        await helperJs("document.querySelector('#copy-password').click()");
        await until(async () => (await clipboard.readText()) === 'visible-test-only');
        fs.writeFileSync(
            path.join(artifacts, 'login-card-v6.png'),
            (await loginHelper.win.webContents.capturePage()).toPNG()
        );
        await helperJs("document.querySelector('#close').click()");
        await until(() => !loginHelper.allowed);
        await js("document.querySelector('#login-card-button').click()");
        await until(() => loginHelper.allowed);
        for (const tab of [...tabs.keys()]) closeTab(tab);
        loginHelper.destroy();
    } finally {
        server.close();
        await clipboard.clear();
    }
    assert.deepEqual(errors, []);
    console.log(
        'V6 PASS: trusted clicks on 4 time pickers, aligned fields and increment/decrement, small viewport/125% zoom, top-layer dropdown, calendar contrast/centering/mini size, SQLite plaintext restart, editor copy and webpage login card.'
    );
};
