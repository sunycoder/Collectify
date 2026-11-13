module.exports = {
    id: 'collectify.notes',
    schema: "CREATE TABLE IF NOT EXISTS notes(id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL, color TEXT NOT NULL CHECK(color IN ('yellow','blue','pink','green')), updated_at TEXT NOT NULL, sort_order INTEGER NOT NULL) STRICT;\r",
    tables: {
        notes: {
            fields: {
                id: 'id',
                title: 'title',
                content: 'content',
                color: 'color',
                updatedAt: 'updated_at'
            }
        }
    },
    attachments: false
};
