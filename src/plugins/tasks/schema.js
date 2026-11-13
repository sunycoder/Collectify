module.exports = {
    id: 'collectify.tasks',
    schema: "CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, title TEXT NOT NULL CHECK(length(trim(title))>0), note TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('inbox','todo','doing','done')), priority TEXT NOT NULL CHECK(priority IN ('high','medium','low')), important INTEGER NOT NULL CHECK(important IN (0,1)), urgent INTEGER NOT NULL CHECK(urgent IN (0,1)), all_day INTEGER NOT NULL CHECK(all_day IN (0,1)), start_at TEXT, end_at TEXT, due_at TEXT, remind_at TEXT, notified_at TEXT, bookmark_id TEXT, archived INTEGER NOT NULL CHECK(archived IN (0,1)), created_at TEXT NOT NULL, completed_at TEXT, sort_order INTEGER NOT NULL, CHECK(archived=0 OR status='done'), CHECK(end_at IS NULL OR (start_at IS NOT NULL AND end_at>start_at))) STRICT;\r\nCREATE TABLE IF NOT EXISTS task_attachments(task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, position INTEGER NOT NULL CHECK(position>=0), path TEXT NOT NULL, PRIMARY KEY(task_id,position)) STRICT;\r",
    tables: {
        tasks: {
            fields: {
                id: 'id',
                title: 'title',
                note: 'note',
                status: 'status',
                priority: 'priority',
                important: 'important',
                urgent: 'urgent',
                allDay: 'all_day',
                startAt: 'start_at',
                endAt: 'end_at',
                dueAt: 'due_at',
                remindAt: 'remind_at',
                notifiedAt: 'notified_at',
                bookmarkId: 'bookmark_id',
                archived: 'archived',
                createdAt: 'created_at',
                completedAt: 'completed_at'
            },
            booleans: ['important', 'urgent', 'allDay', 'archived'],
            nullable: ['startAt', 'endAt', 'dueAt', 'remindAt', 'notifiedAt', 'bookmarkId', 'completedAt']
        }
    },
    attachments: true
};
