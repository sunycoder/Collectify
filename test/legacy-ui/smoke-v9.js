const assert = require('node:assert/strict'),
    path = require('node:path'),
    fs = require('node:fs');
const { Store } = require('./store');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
exports.run = async ({ win, store }) => {
    // 单独创建新库验证实际内置配置，再将该快照投影到隔离的 smoke 工作空间。
    const file = path.join(path.dirname(store.file), 'initial-defaults.sqlite');
    const initialized = new Store(file, { defaults: path.join(__dirname, '..', 'config', 'default-config.json') });
    assert.equal(initialized.entries.length, 11);
    assert.equal(initialized.data.tasks.length, 6);
    assert.equal(initialized.data.notes.length, 3);
    store.commit(initialized.snapshot());
    const js = (code) => win.webContents.executeJavaScript(code);
    win.setSize(1440, 960);
    await js(
        "document.querySelector('dialog[open]')?.close();refresh().then(()=>document.querySelector('#all-nav').click())"
    );
    await delay(200);
    assert.equal(await js("document.querySelectorAll('.bookmark-card').length"), 11);
    await js("document.querySelector('#notes-nav').click()");
    await delay(100);
    assert.equal(await js("document.querySelectorAll('.sticky-note').length"), 3);
    await js(
        "document.querySelector('#tasks-nav').click();document.querySelector('#task-filter').value='active';document.querySelector('#task-search').value='';document.querySelector('#task-date-query').value='';document.querySelector('#task-board-button').click()"
    );
    await delay(200);
    assert.equal(await js("document.querySelectorAll('#task-board .task-card').length"), 6);
    assert.ok(
        await js(
            "[...document.querySelectorAll('#task-board .task-column-body')].every(column=>column.querySelector('.task-card'))"
        )
    );
    await js("document.querySelector('#task-calendar-button').click()");
    await delay(250);
    assert.equal(await js('officeCalendar.getEvents().length'), 4);
    assert.ok(await js("document.querySelectorAll('.fc-event').length>0"));
    assert.equal(new Store(file).data.tasks.length, 6);
    console.log(
        'V9 PASS: bundled default resources, fresh SQLite initialization, example notes/board/calendar, restart without duplicate seeds.'
    );
};
