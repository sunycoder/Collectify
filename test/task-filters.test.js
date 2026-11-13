const { test } = require('node:test'),
    assert = require('node:assert/strict');
const { matchesFilters } = require('../src/task-query');
test('无截止日任务被截止日筛选隐藏，但清除筛选后恢复；开始时间不冒充截止时间', () => {
    const task = {
        title: '喝水',
        note: '',
        status: 'inbox',
        priority: 'medium',
        archived: false,
        startAt: new Date(2026, 10, 12, 16, 51).toISOString(),
        dueAt: ''
    };
    assert.equal(matchesFilters(task, { date: '2026-11-12', dateField: 'dueAt' }), false);
    assert.equal(matchesFilters(task, { date: '2026-11-12', dateField: 'startAt' }), true);
    assert.equal(matchesFilters(task, {}), true);
    assert.equal(matchesFilters(task, { filter: 'high' }), false);
    assert.equal(matchesFilters(task, { query: '其他任务' }), false);
});
test('归档、全天到期与逾期筛选采用相同业务语义', () => {
    const task = {
        title: '全天安排',
        note: '',
        status: 'todo',
        priority: 'high',
        archived: false,
        allDay: true,
        dueAt: new Date(2026, 10, 12).toISOString()
    };
    assert.equal(matchesFilters(task, { filter: 'overdue' }, new Date(2026, 10, 12, 20)), false);
    assert.equal(matchesFilters(task, { filter: 'overdue' }, new Date(2026, 10, 13, 1)), true);
    assert.equal(matchesFilters({ ...task, status: 'done' }, { filter: 'overdue' }, new Date(2026, 10, 13, 1)), false);
    assert.equal(matchesFilters({ ...task, status: 'done', archived: true }, {}), false);
    assert.equal(matchesFilters({ ...task, status: 'done', archived: true }, { filter: 'archive' }), true);
});
