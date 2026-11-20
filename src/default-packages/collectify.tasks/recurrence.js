const RULES = ['none', 'daily', 'workdays', 'weekly', 'monthly'];
function nextOccurrence(task) {
    const anchor = task.startAt || task.dueAt;
    if (!anchor || !RULES.includes(task.repeat) || task.repeat === 'none') return null;
    const source = new Date(anchor),
        next = new Date(source);
    if (task.repeat === 'monthly') {
        next.setDate(1);
        next.setMonth(next.getMonth() + 1);
        const last = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
        next.setDate(Math.min(task.repeatDay || source.getDate(), last));
    } else {
        next.setDate(next.getDate() + (task.repeat === 'weekly' ? 7 : 1));
        if (task.repeat === 'workdays') while ([0, 6].includes(next.getDay())) next.setDate(next.getDate() + 1);
    }
    const days = Math.round(
        (Date.UTC(next.getFullYear(), next.getMonth(), next.getDate()) -
            Date.UTC(source.getFullYear(), source.getMonth(), source.getDate())) /
            86400000
    );
    const shift = (value) => {
        if (!value) return '';
        const date = new Date(value);
        date.setDate(date.getDate() + days);
        return date.toISOString();
    };
    return {
        ...task,
        id: undefined,
        status: 'todo',
        archived: false,
        skipped: false,
        completedAt: '',
        notifiedAt: '',
        createdAt: new Date().toISOString(),
        nextTaskId: '',
        ...Object.fromEntries(['startAt', 'endAt', 'dueAt', 'remindAt'].map((field) => [field, shift(task[field])]))
    };
}
module.exports = { RULES, nextOccurrence };
