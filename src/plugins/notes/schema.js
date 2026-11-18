module.exports = {
    methods: {
        saveNote(input) {
            if (input.id && !this.data.notes.some((n) => n.id === input.id)) throw Error('便签不存在');
            const note = require('./model').validateNote({ ...input, updatedAt: new Date().toISOString() });
            this.updateEntities('notes', [note]);
            return note;
        }
    },
    validate: (data) =>
        require('../.shared/domain-store').validateCollection(data, 'notes', require('./model').validateNote),
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
