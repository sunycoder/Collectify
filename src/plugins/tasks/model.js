const { randomUUID } = require('node:crypto');
const STATUSES = ['inbox', 'todo', 'doing', 'done'];

function string(value, max = 10000) {
    if (typeof value !== 'string') return '';
    if (value.length > max) throw new Error('内容过长');
    return value.trim();
}

function date(value) {
    if (!value) return '';
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error('日期不正确');
    return new Date(value).toISOString();
}

function validateTask(input) {
    const title = string(input?.title, 160);
    if (!title) throw new Error('请填写待办标题');
    const dueAt = date(input.dueAt),
        remindAt = date(input.remindAt),
        startAt = date(input.startAt),
        endAt = date(input.endAt);
    if (endAt && (!startAt || Date.parse(endAt) <= Date.parse(startAt))) throw new Error('结束时间必须晚于开始时间');
    const repeat = input.repeat || 'none';
    if (!require('./recurrence').RULES.includes(repeat)) throw Error('重复规则无效');
    if (repeat !== 'none' && !startAt && !dueAt) throw Error('重复待办需要计划时间或截止时间');
    const attachments = (input.attachments || []).map((p) => string(p, 2048));
    const path = require('node:path');
    if (attachments.length > 20 || attachments.some((p) => !path.posix.isAbsolute(p) && !path.win32.isAbsolute(p)))
        throw new Error('请选择有效的本地文件或文件夹，最多 20 项');
    return {
        id: input.id || randomUUID(),
        title,
        status: STATUSES.includes(input.status) ? input.status : 'inbox',
        priority: ['high', 'medium', 'low'].includes(input.priority) ? input.priority : 'medium',
        note: string(input.note),
        dueAt,
        remindAt,
        startAt,
        endAt,
        allDay: input.allDay === true,
        important: input.important === undefined ? input.priority === 'high' : input.important === true,
        urgent: input.urgent === true,
        attachments,
        bookmarkId: string(input.bookmarkId, 80),
        archived: input.archived === true,
        notifiedAt: date(input.notifiedAt),
        createdAt: date(input.createdAt) || new Date().toISOString(),
        completedAt: date(input.completedAt),
        repeat,
        repeatDay:
            Number.isInteger(input.repeatDay) && input.repeatDay >= 1 && input.repeatDay <= 31
                ? input.repeatDay
                : new Date(startAt || dueAt || Date.now()).getDate(),
        nextTaskId: string(input.nextTaskId, 80),
        skipped: input.skipped === true
    };
}

function saveTask(store, input) {
    const previous = (store.data || store.snapshot()).tasks.find((t) => t.id === input.id);
    if (input.id && !previous) throw new Error('待办不存在');
    const next = validateTask({ ...previous, ...input });
    // 后继关系由本次完成事务维护，旧页面提交的空值不能再次生成同一轮任务。
    next.nextTaskId = previous?.nextTaskId || '';
    if (
        !previous ||
        previous.repeat !== next.repeat ||
        previous.startAt !== next.startAt ||
        previous.dueAt !== next.dueAt
    )
        next.repeatDay = new Date(next.startAt || next.dueAt || Date.now()).getDate();
    // 修改提醒或重新打开任务会重新激活提醒；纯编辑备注不会重复提醒。
    if (
        previous &&
        (next.remindAt !== previous.remindAt ||
            (previous.status === 'done' && next.status !== 'done') ||
            (previous.archived && !next.archived))
    )
        next.notifiedAt = '';
    if (next.status === 'done') next.completedAt = previous?.completedAt || new Date().toISOString();
    else {
        next.completedAt = '';
        next.skipped = false;
    }
    if (next.archived && next.status !== 'done') throw new Error('请先完成待办，再归档');
    if (previous?.status !== 'done' && next.status === 'done' && next.repeat !== 'none' && !next.nextTaskId) {
        const following = validateTask(require('./recurrence').nextOccurrence(next));
        next.nextTaskId = following.id;
        const data = store.snapshot();
        const position = data.tasks.findIndex((t) => t.id === next.id);
        if (position >= 0) data.tasks[position] = next;
        else data.tasks.push(next);
        data.tasks.push(following);
        store.commit(data);
        return next;
    }
    if (store.updateEntities) store.updateEntities('tasks', [next]);
    else {
        const data = store.snapshot();
        if (previous) data.tasks = data.tasks.map((t) => (t.id === next.id ? next : t));
        else data.tasks.push(next);
        store.commit(data);
    }
    return next;
}

function dueReminders(tasks, now = Date.now()) {
    return tasks.filter(
        (t) => !t.archived && t.status !== 'done' && t.remindAt && Date.parse(t.remindAt) <= now && !t.notifiedAt
    );
}

module.exports = { validateTask, saveTask, dueReminders, STATUSES };
