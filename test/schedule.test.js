const { test } = require('node:test'),
    assert = require('node:assert/strict');
const { validateTask } = require('../src/productivity');
const { anchor, quadrant, moveSchedule, event } = require('../src/task-schedule');
test('四象限由重要紧急独立决定，旧高优先级迁移重要性', () => {
    assert.equal(quadrant(validateTask({ title: 'a', important: true, urgent: true })), 'do');
    assert.equal(quadrant(validateTask({ title: 'a', important: true, urgent: false })), 'plan');
    assert.equal(quadrant(validateTask({ title: 'a', important: false, urgent: true })), 'delegate');
    assert.equal(quadrant(validateTask({ title: 'a', important: false, urgent: false })), 'later');
    assert.equal(validateTask({ title: 'old', priority: 'high' }).important, true);
});
test('排期开始结束契约、全天事件、截止事项默认时长', () => {
    assert.throws(() => validateTask({ title: 'bad', startAt: '2026-11-12T10:00:00Z', endAt: '2026-11-12T09:00:00Z' }));
    assert.throws(() => validateTask({ title: 'bad', endAt: '2026-11-12T10:00:00Z' }));
    const t = validateTask({ title: 'ok', dueAt: '2026-11-12T10:00:00Z' });
    const e = event(t);
    assert.equal(Date.parse(e.end) - Date.parse(e.start), 1800000);
    assert.equal(anchor(t), t.dueAt);
    assert.equal(event({ ...t, allDay: true }).allDay, true);
    assert.equal(event({ title: 'none' }), null);
});
test('改期移动计划与截止日保持偏移，提醒时间不静默移动', () => {
    const t = validateTask({
        title: 'task',
        startAt: '2026-11-12T10:00:00Z',
        endAt: '2026-11-12T11:00:00Z',
        dueAt: '2026-11-12T12:00:00Z',
        remindAt: '2026-11-12T09:00:00Z'
    });
    const moved = moveSchedule(t, '2026-11-13T10:00:00Z', '2026-11-13T11:00:00Z', false);
    assert.equal(moved.dueAt, '2026-11-13T12:00:00.000Z');
    assert.equal(moved.remindAt, t.remindAt);
    const deadline = moveSchedule(
        { title: 'only due', dueAt: '2026-11-12T10:00:00Z' },
        '2026-11-14T10:00:00Z',
        null,
        false
    );
    assert.equal(deadline.dueAt, '2026-11-14T10:00:00.000Z');
    assert.equal(deadline.startAt, undefined);
});
test('全天事项在本地日期结束后才逾期，完成归档均不逾期', () => {
    const { overdue } = require('../src/task-schedule');
    const due = new Date(2026, 10, 12, 0).toISOString(),
        t = { dueAt: due, allDay: true, status: 'todo' };
    assert.equal(overdue(t, new Date(2026, 10, 12, 23, 59).getTime()), false);
    assert.equal(overdue(t, new Date(2026, 10, 13, 0, 1).getTime()), true);
    assert.equal(overdue({ ...t, status: 'done' }, new Date(2026, 10, 13).getTime()), false);
});
