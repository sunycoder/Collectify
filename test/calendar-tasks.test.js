const { test } = require('node:test');
const assert = require('node:assert/strict');
const { project, createTaskBridge } = require('../src/plugin-library/chinese-calendar/tasks-bridge');
const iso = (day, hour = 9) => new Date(2026, 10, day, hour).toISOString();
test('日历按计划、截止与跨日区间展示待办，不重复计数，不泄露备注、附件和其他日期', () => {
    const tasks = [
        {
            id: 'plan',
            title: '跨日计划',
            startAt: iso(16, 22),
            endAt: iso(18, 0),
            status: 'doing',
            dueAt: iso(19),
            note: 'private',
            attachments: ['C:/private']
        },
        { id: 'due', title: '截止', dueAt: iso(17), status: 'todo' },
        { id: 'same', title: '计划当天截止', startAt: iso(17), endAt: iso(17, 10), dueAt: iso(17, 12), status: 'todo' },
        { id: 'all', title: '全天', startAt: iso(17, 0), endAt: iso(19), allDay: true, status: 'todo' },
        { id: 'done', title: '完成', dueAt: iso(17), status: 'done' },
        { id: 'archived', title: '归档', dueAt: iso(17), archived: true },
        { id: 'none', title: '无日期', status: 'inbox' },
        { id: 'reminder', title: '只有提醒', remindAt: iso(17) },
        { id: 'other', title: '另一个月', dueAt: new Date(2026, 9, 1).toISOString() }
    ];
    const response = project(tasks, '2026-11-16', '2026-11-19', Date.parse(iso(20)));
    assert.equal(response.unscheduled, 2);
    assert.equal(response.days['2026-11-17'].length, 5);
    assert.equal(response.days['2026-11-17'].filter((t) => t.id === 'same').length, 1);
    assert.ok(response.days['2026-11-16'].some((t) => t.id === 'plan'));
    assert.equal(response.days['2026-11-18'], undefined, '午夜结束不覆盖下一天，全天遵循现有待办日历单日语义');
    assert.equal(response.days['2026-11-19'][0].kind, 'deadline');
    assert.equal(response.days['2026-11-17'].at(-1).status, 'done');
    assert.equal(response.days['2026-11-17'].find((t) => t.id === 'due').overdue, true);
    assert.equal(response.days['2026-11-17'].find((t) => t.id === 'done').overdue, false);
    assert.ok(!JSON.stringify(response).includes('private'));
    assert.equal(
        response.days['2026-11-17'].some((t) => t.id === 'reminder'),
        false
    );
    for (const [startDate, endDate] of [
        ['2026-02-30', '2026-03-01'],
        ['2026-11-20', '2026-11-10'],
        ['2026-01-01', '2026-12-31']
    ])
        assert.throws(() => project([], startDate, endDate));
});
test('可选待办缺失、停用、异常和读取中卸载均清空展示，不读取文件或调用对方', async () => {
    let active = true,
        available = false,
        calls = 0,
        resolve;
    const context = {
        available: () => available,
        invoke: () => {
            calls++;
            return new Promise((r) => (resolve = r));
        }
    };
    const bridge = createTaskBridge(context, () => active),
        range = { startDate: '2026-11-01', endDate: '2026-11-30' };
    assert.equal((await bridge.read(range)).available, false);
    assert.equal(calls, 0);
    available = true;
    const pending = bridge.read(range);
    available = false;
    resolve({ tasks: [{ id: 'old', title: '旧数据', dueAt: iso(17) }] });
    assert.deepEqual((await pending).days, {});
    available = true;
    const stopping = bridge.read(range),
        checked = assert.rejects(stopping, /停用/);
    active = false;
    resolve({ tasks: [] });
    await checked;
    active = true;
    context.invoke = () => Promise.reject(Error('old contract'));
    assert.equal((await bridge.read(range)).available, false);
    context.invoke = () => Promise.resolve({ tasks: [] });
    assert.equal((await bridge.read(range)).available, true);
    available = false;
    await assert.rejects(bridge.open(), /未安装/);
});
test('可选联动通过上下文调用原待办契约，超时可重试，打开操作只导航不修改数据', async (t) => {
    let args, opened;
    const context = {
        available: (id) => id === 'collectify.tasks',
        invoke: (...input) => {
            args = input;
            return Promise.resolve({ tasks: [{ id: 'x', title: '展示', dueAt: iso(17) }] });
        },
        open: (...input) => (opened = input)
    };
    const bridge = createTaskBridge(context, () => true),
        range = { startDate: '2026-11-01', endDate: '2026-11-30' };
    assert.equal((await bridge.read(range)).days['2026-11-17'][0].title, '展示');
    assert.deepEqual(args, ['collectify.tasks', 'state']);
    await bridge.open();
    assert.deepEqual(opened, ['collectify.tasks', 'list']);
    t.mock.timers.enable({ apis: ['setTimeout'] });
    context.invoke = () => new Promise(() => {});
    const pending = bridge.read(range);
    t.mock.timers.tick(5001);
    assert.match((await pending).message, /刷新/);
});
