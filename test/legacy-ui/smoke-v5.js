const assert = require('node:assert/strict'),
    fs = require('node:fs'),
    path = require('node:path');
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(fn) {
    const end = Date.now() + 15000;
    while (Date.now() < end) {
        if (await fn()) return;
        await delay(90);
    }
    throw Error('V5 UI timeout');
}

exports.run = async ({ win, store, desktopWidget }) => {
    const js = (code) =>
            win.webContents.executeJavaScript(code).catch((e) => {
                console.error('V5 step:', code);
                throw e;
            }),
        artifacts = require('./verification-output').directory;
    const errors = [];
    win.webContents.on('console-message', (event) => {
        if (event.level === 3) errors.push(event.message);
    });
    await js(
        "document.querySelector('dialog[open]')?.close();document.querySelector('#tasks-nav').click();document.querySelector('#task-list-button').click()"
    );
    await until(() => js("!document.querySelector('#task-list').hidden"));
    // 不改变真实用户数据：所有测试运行于主进程的临时 userData。
    const start = new Date();
    start.setHours(10, 0, 0, 0);
    const end = new Date(start.getTime() + 3600000);
    let t = store.saveTask({
        title: '版本发布评审',
        status: 'todo',
        important: true,
        urgent: true,
        startAt: start.toISOString(),
        endAt: end.toISOString(),
        dueAt: end.toISOString(),
        note: '确认发布窗口与回滚方案'
    });
    store.saveTask({
        title: '整理下周测试计划',
        status: 'todo',
        important: true,
        urgent: false,
        dueAt: new Date(start.getTime() + 86400000).toISOString()
    });
    store.saveTask({
        title: '回复联调信息',
        status: 'doing',
        important: false,
        urgent: true,
        allDay: true,
        dueAt: start.toISOString()
    });
    await js(
        "window.workbench.call('theme-save',{preset:'office'}).then(()=>refresh()).then(()=>document.querySelector('#all-nav').click())"
    );
    await js("document.querySelector('#tasks-nav').click();document.querySelector('#task-list-button').click()");
    await until(() => js("document.querySelectorAll('.checklist-row').length>=5"));
    await js('OfficeUI.refresh()');
    assert.equal(await js("!!document.querySelector('#task-date-field').tomselect"), true);
    assert.equal(await js("document.querySelector('#task-date-field').classList.contains('tomselected')"), true);
    await js("document.querySelector('#task-date-field').tomselect.open()");
    await delay(180);
    const dropdown = await js(
        "(()=>{const r=document.querySelector('#task-date-field').tomselect.dropdown.getBoundingClientRect();return{w:r.width,h:r.height,x:r.x,y:r.y}})()"
    );
    assert.ok(dropdown.w > 100 && dropdown.w < 350 && dropdown.h > 60);
    fs.writeFileSync(path.join(artifacts, 'select-v5.png'), (await win.webContents.capturePage()).toPNG());
    await js(
        "document.querySelector('#task-date-field').tomselect.setValue('createdAt');document.querySelector('#task-date-field').tomselect.close()"
    );
    assert.equal(await js("document.querySelector('#task-date-field').value"), 'createdAt');
    await js(
        "document.querySelector('#task-date-field').tomselect.setValue('dueAt');document.querySelector('#task-date-query')._flatpickr.open()"
    );
    await delay(180);
    assert.equal(await js("document.querySelector('#task-date-query').type"), 'hidden');
    fs.writeFileSync(path.join(artifacts, 'datepicker-v5.png'), (await win.webContents.capturePage()).toPNG());
    await js(
        "document.querySelector('#task-date-query')._flatpickr.setDate(new Date(),true);document.querySelector('#task-date-query')._flatpickr.close()"
    );
    assert.ok(await js("!!document.querySelector('#task-date-query').value"));
    await js("document.querySelector('#clear-task-date').click()");
    await js("document.querySelector('#task-matrix-button').click()");
    assert.equal(await js("document.querySelectorAll('.quadrant').length"), 4);
    await js(
        `(()=>{const dt=new DataTransfer();document.querySelector('.quadrant [data-id="${t.id}"]').dispatchEvent(new DragEvent('dragstart',{dataTransfer:dt,bubbles:true}));document.querySelector('.quadrant[data-quadrant="plan"]').dispatchEvent(new DragEvent('drop',{dataTransfer:dt,bubbles:true,cancelable:true}));})()`
    );
    await until(
        () =>
            store.data.tasks.find((x) => x.id === t.id).important && !store.data.tasks.find((x) => x.id === t.id).urgent
    );
    await delay(180);
    fs.writeFileSync(path.join(artifacts, 'matrix-v5.png'), (await win.webContents.capturePage()).toPNG());
    await js("document.querySelector('#task-list-button').click()");
    await delay(180);
    fs.writeFileSync(path.join(artifacts, 'list-v5.png'), (await win.webContents.capturePage()).toPNG());
    await js("document.querySelector('#task-board-button').click()");
    await delay(120);
    assert.ok(
        await js(
            "[...document.querySelectorAll('.task-card select')].every(s=>s.tomselect&&!s.tomselect.wrapper.hidden)"
        )
    );
    await js("document.querySelector('#task-list-button').click()");
    await js("document.querySelector('#new-task').click()");
    await until(() => js("document.querySelector('#task-dialog').open"));
    await delay(140);
    await js("document.querySelector('#task-form').elements.priority.tomselect.open()");
    await delay(140);
    const dialogSelect = await js(
        "(()=>{const p=document.querySelector('#task-form').elements.priority.tomselect.dropdown.getBoundingClientRect();const d=document.querySelector('#task-dialog').getBoundingClientRect();return{y:p.y,bottom:p.bottom,dy:d.y,db:d.bottom}})()"
    );
    assert.ok(dialogSelect.y >= 0 && dialogSelect.bottom <= 940);
    await js(
        "document.querySelector('#task-form').elements.priority.tomselect.close();document.querySelector('#task-form').elements.startAt._flatpickr.open()"
    );
    await delay(180);
    assert.ok(
        await js(
            "document.querySelector('#task-form').elements.startAt._flatpickr.calendarContainer.querySelector('.flatpickr-time')!==null"
        )
    );
    fs.writeFileSync(path.join(artifacts, 'task-editor-v5.png'), (await win.webContents.capturePage()).toPNG());
    await js("document.querySelector('#task-dialog .dialog-close').click()");
    await js("document.querySelector('#task-calendar-button').click()");
    await until(() => js("!!document.querySelector('.fc-timegrid')"));
    await delay(350);
    fs.writeFileSync(path.join(artifacts, 'week-calendar-v5.png'), (await win.webContents.capturePage()).toPNG());
    assert.ok(await js("document.querySelector('.fc-view-harness').getBoundingClientRect().height>450"));
    assert.ok(
        await js(
            "document.querySelector('.fc-timegrid .fc-scroller-liquid-absolute').getBoundingClientRect().height>350"
        )
    );
    await js("document.querySelector('.fc-dayGridMonth-button').click()");
    await until(() => js("!!document.querySelector('.fc-daygrid-body')"));
    await delay(180);
    fs.writeFileSync(path.join(artifacts, 'month-calendar-v5.png'), (await win.webContents.capturePage()).toPNG());
    await js("document.querySelector('.fc-timeGridDay-button').click()");
    await until(() => js("document.querySelectorAll('.fc-timegrid-col[data-date]').length===1"));
    await js(
        `officeCalendar.getEventById(${JSON.stringify(t.id)}).setStart(new Date(${JSON.stringify(start.toISOString())}))`
    );
    // 验证真实 FullCalendar 的持久化 drop 回调，不只修改视觉事件。
    await js(
        `(()=>{const e=officeCalendar.getEventById(${JSON.stringify(t.id)});e.setDates(new Date(${JSON.stringify(new Date(start.getTime() + 86400000).toISOString())}),new Date(${JSON.stringify(new Date(end.getTime() + 86400000).toISOString())}));return officeCalendar.getOption('eventDrop')({event:e,revert:()=>{throw Error('drop reverted')}})})()`
    );
    assert.equal(
        store.data.tasks.find((x) => x.id === t.id).startAt,
        new Date(start.getTime() + 86400000).toISOString()
    );
    await desktopWidget.open('floating');
    const widgetJs = (code) => desktopWidget.win.webContents.executeJavaScript(code);
    await until(() => widgetJs("document.querySelectorAll('.timeline-day').length>0"));
    assert.ok(await widgetJs("document.querySelectorAll('.timeline-time').length>=5"));
    await delay(250);
    fs.writeFileSync(
        path.join(artifacts, 'timeline-widget-v5.png'),
        (await desktopWidget.win.webContents.capturePage()).toPNG()
    );
    desktopWidget.hide();
    desktopWidget.destroy();
    await js("document.querySelector('#all-nav').click();document.querySelector('#toast').hidden=true");
    await delay(200);
    fs.writeFileSync(path.join(artifacts, 'office-home-v5.png'), (await win.webContents.capturePage()).toPNG());
    console.log(
        'V5 SMOKE PASS: Tom Select visible/selection; Flatpickr custom picker; list; quadrant drag persistence; FullCalendar day/week/month and move callback; grouped desktop timeline.'
    );
    assert.deepEqual(errors, []);
};
