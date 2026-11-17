const TASKS_ID = 'collectify.tasks';
function date(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw Error('待办查询日期格式不正确');
    const [year, month, day] = value.split('-').map(Number),
        d = new Date(year, month - 1, day);
    if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day)
        throw Error('待办查询日期不存在');
    return d;
}
function dayKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function project(tasks, startDate, endDate, now = Date.now()) {
    const start = date(startDate),
        end = date(endDate);
    if (
        end < start ||
        (Date.UTC(end.getFullYear(), end.getMonth(), end.getDate()) -
            Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) /
            86400000 >
            61
    )
        throw Error('待办日期范围最多 62 天');
    if (!Array.isArray(tasks)) throw Error('待办插件数据格式不受支持');
    const days = {};
    let unscheduled = 0;
    const time = (v) => (typeof v === 'string' && v && Number.isFinite(Date.parse(v)) ? new Date(v) : null);
    for (const task of tasks) {
        if (!task || task.archived || typeof task.id !== 'string' || typeof task.title !== 'string') continue;
        const planned = time(task.startAt),
            due = time(task.dueAt),
            finish = planned ? time(task.endAt) : null;
        if (!planned && !due) {
            unscheduled++;
            continue;
        }
        for (let current = new Date(start); current <= end; current.setDate(current.getDate() + 1)) {
            const tomorrow = new Date(current);
            tomorrow.setDate(tomorrow.getDate() + 1);
            const key = dayKey(current),
                anchor = planned || due;
            const onPlan = planned
                ? task.allDay
                    ? dayKey(planned) === key
                    : finish && finish > planned
                      ? planned < tomorrow && finish > current
                      : dayKey(planned) === key
                : false;
            const onDue = due && dayKey(due) === key;
            if (!onPlan && !onDue) continue;
            const kind = onPlan ? 'plan' : 'deadline';
            let overdue = false;
            if (due && task.status !== 'done') {
                const boundary = new Date(due);
                if (task.allDay) boundary.setHours(24, 0, 0, 0);
                overdue = boundary.getTime() < now;
            }
            const item = {
                id: task.id,
                title: task.title.slice(0, 160),
                status: ['inbox', 'todo', 'doing', 'done'].includes(task.status) ? task.status : 'todo',
                important: task.important === true || task.priority === 'high',
                allDay: task.allDay === true,
                kind,
                startAt: planned?.toISOString() || '',
                endAt: finish?.toISOString() || '',
                dueAt: due?.toISOString() || '',
                overdue
            };
            (days[key] ||= []).push(item);
        }
    }
    for (const items of Object.values(days))
        items.sort(
            (a, b) =>
                (a.status === 'done') - (b.status === 'done') ||
                Number(b.important) - Number(a.important) ||
                Number(b.allDay) - Number(a.allDay) ||
                (Date.parse(a.kind === 'plan' ? a.startAt : a.dueAt) || 0) -
                    (Date.parse(b.kind === 'plan' ? b.startAt : b.dueAt) || 0) ||
                a.title.localeCompare(b.title)
        );
    return { days, unscheduled };
}
function createTaskBridge(context, allowed) {
    const pending = new Set();
    return {
        cancel() {
            for (const controller of pending) controller.abort(Error('待办读取已取消'));
            pending.clear();
        },
        async read(input) {
            // 先校验范围，无依赖时不调用对方、不初始化它的数据库。
            project([], input.startDate, input.endDate);
            const missing = () => ({
                available: false,
                days: {},
                unscheduled: 0,
                message: '待办插件未安装或未启用，日历仍可独立使用。'
            });
            if (!allowed()) throw Error('日历插件已停用');
            if (!context.available?.(TASKS_ID) || !context.invoke) return missing();
            let timer;
            const controller = new AbortController();
            pending.add(controller);
            let cancelled;
            const stop = new Promise((_, reject) => {
                cancelled = () => reject(controller.signal.reason);
                controller.signal.addEventListener('abort', cancelled, { once: true });
            });
            try {
                const response = await Promise.race([
                    context.invoke(TASKS_ID, 'state'),
                    stop,
                    new Promise((_, reject) => {
                        timer = setTimeout(() => reject(Error('待办读取超时')), 5000);
                    })
                ]);
                if (!allowed()) throw Error('日历插件已停用');
                if (!context.available(TASKS_ID)) return missing();
                return { available: true, ...project(response.tasks, input.startDate, input.endDate), message: '' };
            } catch (error) {
                if (!allowed()) throw Error('日历插件已停用');
                return {
                    available: false,
                    days: {},
                    unscheduled: 0,
                    message: context.available?.(TASKS_ID) ? '暂时无法读取待办，点击刷新重试。' : missing().message
                };
            } finally {
                clearTimeout(timer);
                controller.signal.removeEventListener('abort', cancelled);
                pending.delete(controller);
            }
        },
        async open() {
            if (!allowed()) throw Error('日历插件已停用');
            if (!context.available?.(TASKS_ID) || !context.open) throw Error('待办插件未安装或未启用');
            await context.open(TASKS_ID, 'list');
        }
    };
}
module.exports = { project, createTaskBridge };
