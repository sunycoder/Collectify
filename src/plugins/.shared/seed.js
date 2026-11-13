const fs = require('node:fs'),
    path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { withInitialExamples } = require('./initial-examples');
function seed(context, definition) {
    if (fs.existsSync(context.file)) {
        const db = new DatabaseSync(context.file, { readOnly: true });
        try {
            if (
                db.prepare("SELECT name FROM sqlite_master WHERE name='domain_state'").get() &&
                db.prepare('SELECT id FROM domain_state LIMIT 1').get()
            )
                return {};
        } finally {
            db.close();
        }
    }
    // 用户明确删除的数据在恢复插件时保持为空，不重新灌入旧库或默认示例。
    if (context.emptyInitialData) return { settings: {} };
    const legacy = path.join(context.dataDirectory, 'collectify.sqlite');
    if (fs.existsSync(legacy)) {
        const db = new DatabaseSync(legacy, { readOnly: true });
        try {
            const data = { settings: {} };
            for (const [table, d] of Object.entries(definition.tables))
                data[table] = db
                    .prepare(`SELECT * FROM ${table} ORDER BY sort_order,id`)
                    .all()
                    .map((row) =>
                        Object.fromEntries(
                            Object.entries(d.fields).map(([f, c]) => [
                                f,
                                d.booleans?.includes(f) ? !!row[c] : (row[c] ?? '')
                            ])
                        )
                    );
            if (definition.attachments) {
                const rows = db.prepare('SELECT * FROM task_attachments ORDER BY position').all();
                for (const task of data.tasks)
                    task.attachments = rows.filter((r) => r.task_id === task.id).map((r) => r.path);
            }
            for (const row of db.prepare('SELECT * FROM settings').all())
                data.settings[row.key] = JSON.parse(row.value_json);
            const meta = db.prepare('SELECT config_source,source_name FROM workspace_meta WHERE id=1').get();
            data.configSource = meta.config_source;
            data.sourceName = meta.source_name;
            return data;
        } finally {
            db.close();
        }
    }
    const raw = context.smoke
        ? { version: 2, categories: [], entries: [] }
        : JSON.parse(fs.readFileSync(context.defaultsFile, 'utf8').replace(/^\uFEFF/, ''));
    const defaults = withInitialExamples(raw);
    return {
        ...Object.fromEntries(Object.keys(definition.tables).map((key) => [key, defaults[key] || []])),
        settings: defaults.settings || {},
        configSource: 'default',
        sourceName: path.basename(context.defaultsFile)
    };
}
module.exports = { seed };
