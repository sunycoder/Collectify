const { dueReminders } = require('./model');

// 先展示后落盘；展示失败不确认，下次轮询重试。通知时间保存在任务上，重启不会反复弹出。
async function deliverReminders(store, deliver, now = Date.now()) {
    const due = dueReminders(store.snapshot().tasks, now);
    for (const task of due) {
        await deliver(task);
        const current = store.data.tasks.find((t) => t.id === task.id);
        if (current && current.remindAt === task.remindAt && !current.archived && current.status !== 'done') {
            const data = store.snapshot();
            data.tasks.find((t) => t.id === task.id).notifiedAt = new Date(now).toISOString();
            store.commit(data);
        }
    }
    return due.length;
}

module.exports = { deliverReminders };
