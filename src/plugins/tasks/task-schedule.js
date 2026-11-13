(function (root) {
    function anchor(task) {
        return task.startAt || task.dueAt || '';
    }

    function quadrant(task) {
        return task.important ? (task.urgent ? 'do' : 'plan') : task.urgent ? 'delegate' : 'later';
    }

    function overdue(task, now = Date.now()) {
        if (!task.dueAt || task.status === 'done' || task.archived) return false;
        const due = new Date(task.dueAt);
        if (task.allDay) due.setHours(24, 0, 0, 0);
        return due.getTime() < now;
    }

    function moveSchedule(task, newStart, newEnd, allDay) {
        const start = new Date(newStart);
        if (!Number.isFinite(start.getTime())) throw Error('无效开始时间');
        const old = anchor(task),
            delta = old ? start.getTime() - Date.parse(old) : 0;
        const patch = { ...task, allDay: !!allDay };
        if (task.startAt) {
            patch.startAt = start.toISOString();
            patch.endAt = newEnd
                ? new Date(newEnd).toISOString()
                : task.endAt
                  ? new Date(Date.parse(task.endAt) + delta).toISOString()
                  : '';
            if (task.dueAt) patch.dueAt = new Date(Date.parse(task.dueAt) + delta).toISOString();
        } else patch.dueAt = start.toISOString();
        return patch;
    }

    function event(task) {
        const at = anchor(task);
        if (!at) return null;
        const start = new Date(at),
            end = task.endAt && task.startAt ? new Date(task.endAt) : new Date(start.getTime() + 30 * 60000);
        return {
            id: task.id,
            title: task.title,
            start: task.allDay
                ? `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`
                : start.toISOString(),
            end: task.allDay ? undefined : end.toISOString(),
            allDay: !!task.allDay,
            editable: !task.archived,
            classNames: [
                task.status === 'done'
                    ? 'event-done'
                    : task.important || task.priority === 'high'
                      ? 'event-important'
                      : 'event-normal'
            ],
            extendedProps: { taskId: task.id, deadline: !task.startAt, status: task.status }
        };
    }

    const api = { anchor, quadrant, overdue, moveSchedule, event };
    if (typeof module !== 'undefined') module.exports = api;
    else root.TaskSchedule = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
