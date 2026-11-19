(function (root) {
    function localDay(value) {
        const d = new Date(value);
        if (!Number.isFinite(d.getTime())) return '';
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    function matchesTaskDate(task, selected, field = 'dueAt') {
        if (!selected) return true;
        if (
            !/^\d{4}-\d{2}-\d{2}$/.test(selected) ||
            !['dueAt', 'createdAt', 'completedAt', 'remindAt', 'startAt'].includes(field)
        )
            return false;
        return !!task[field] && localDay(task[field]) === selected;
    }

    function matchesFilters(task, filters = {}, now = new Date()) {
        const filter = filters.filter || 'active',
            query = (filters.query || '').trim().toLocaleLowerCase();
        return (
            (filter === 'archive' ? task.archived : !task.archived) &&
            matchesTaskDate(task, filters.date, filters.dateField || 'dueAt') &&
            (filter !== 'today' || (task.dueAt && localDay(task.dueAt) === localDay(now))) &&
            (filter !== 'overdue' ||
                (task.status !== 'done' &&
                    task.dueAt &&
                    (task.allDay ? new Date(new Date(task.dueAt).setHours(24, 0, 0, 0)) : new Date(task.dueAt)) <
                        now)) &&
            (filter !== 'high' || task.priority === 'high') &&
            [task.title, task.note].some((value) => (value || '').toLocaleLowerCase().includes(query))
        );
    }
    const api = { localDay, matchesTaskDate, matchesFilters };
    if (typeof module !== 'undefined') module.exports = api;
    else root.TaskQuery = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
