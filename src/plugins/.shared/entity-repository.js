const fs = require('node:fs'),
    path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { ensureStorageSchema } = require('../../plugin-system/storage');

// 只执行插件随包提供的固定表定义；页面无法传表名、字段名或 SQL。
class EntityRepository {
    constructor(file, { id, schema, tables, attachments = false }) {
        Object.assign(this, { file, id, schema, tables, attachments });
        fs.mkdirSync(path.dirname(file), { recursive: true });
        this.database((db) => {
            ensureStorageSchema(db);
            db.exec('CREATE TABLE IF NOT EXISTS domain_schema(id TEXT PRIMARY KEY,version INTEGER NOT NULL) STRICT');
            const row = db.prepare('SELECT * FROM domain_schema').get();
            if (row && (row.id !== id || row.version > 1)) throw Error('插件领域数据库身份或版本不匹配');
            db.exec('BEGIN');
            try {
                db.exec(schema);
                db.exec(
                    'CREATE TABLE IF NOT EXISTS domain_state(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,payload TEXT NOT NULL) STRICT;CREATE TABLE IF NOT EXISTS domain_audit(id INTEGER PRIMARY KEY,tool TEXT NOT NULL,created_at TEXT NOT NULL) STRICT;PRAGMA user_version=1'
                );
                if (!row) db.prepare('INSERT INTO domain_schema VALUES(?,1)').run(id);
                db.exec('COMMIT');
            } catch (error) {
                db.exec('ROLLBACK');
                throw error;
            }
        });
    }
    database(action) {
        const db = new DatabaseSync(this.file);
        try {
            db.exec('PRAGMA foreign_keys=ON;PRAGMA busy_timeout=5000;PRAGMA journal_mode=WAL');
            return action(db);
        } finally {
            db.close();
        }
    }
    read() {
        return this.database((db) => {
            db.exec('BEGIN');
            try {
                const state = db.prepare('SELECT * FROM domain_state WHERE id=1').get();
                this.revision = state?.revision || 0;
                if (!state) {
                    db.exec('COMMIT');
                    return null;
                }
                const data = JSON.parse(state.payload);
                for (const [table, d] of Object.entries(this.tables))
                    data[table] = db
                        .prepare(`SELECT * FROM ${table} ORDER BY sort_order,id`)
                        .all()
                        .map((row) =>
                            Object.fromEntries(
                                Object.entries(d.fields).map(([field, col]) => [
                                    field,
                                    d.booleans?.includes(field) ? !!row[col] : (row[col] ?? '')
                                ])
                            )
                        );
                if (this.attachments) {
                    const rows = db.prepare('SELECT * FROM task_attachments ORDER BY position').all();
                    for (const task of data.tasks)
                        task.attachments = rows.filter((r) => r.task_id === task.id).map((r) => r.path);
                }
                db.exec('COMMIT');
                return data;
            } catch (error) {
                db.exec('ROLLBACK');
                throw error;
            }
        });
    }
    write(data, tool) {
        this.database((db) => {
            db.exec('BEGIN IMMEDIATE');
            try {
                const revision = db.prepare('SELECT revision FROM domain_state WHERE id=1').get()?.revision || 0;
                if (revision !== this.revision) throw Error('插件数据库已被其他实例更新，请重启重试');
                for (const table of Object.keys(this.tables).reverse()) {
                    const keep = new Set(data[table].map((v) => v.id)),
                        remove = db.prepare(`DELETE FROM ${table} WHERE id=?`);
                    for (const row of db.prepare(`SELECT id FROM ${table}`).all())
                        if (!keep.has(row.id)) remove.run(row.id);
                }
                for (const [table, d] of Object.entries(this.tables)) {
                    if (d.nameKey)
                        for (const row of db.prepare(`SELECT id FROM ${table}`).all())
                            db.prepare(`UPDATE ${table} SET name_key=? WHERE id=?`).run(`reserved:${row.id}`, row.id);
                    const columns = [...Object.values(d.fields), ...(d.nameKey ? ['name_key'] : []), 'sort_order'];
                    const update = columns
                        .filter((c) => c !== 'id')
                        .map((c) => `${c}=excluded.${c}`)
                        .join(',');
                    const changed = columns
                        .filter((c) => c !== 'id')
                        .map((c) => `${c} IS NOT excluded.${c}`)
                        .join(' OR ');
                    const statement = db.prepare(
                        `INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')}) ON CONFLICT(id) DO UPDATE SET ${update} WHERE ${changed}`
                    );
                    data[table].forEach((item, index) =>
                        statement.run(
                            ...Object.keys(d.fields).map((field) =>
                                d.booleans?.includes(field)
                                    ? Number(!!item[field])
                                    : d.nullable?.includes(field)
                                      ? item[field] || null
                                      : (item[field] ?? '')
                            ),
                            ...(d.nameKey ? [item.name.toLocaleLowerCase()] : []),
                            index
                        )
                    );
                }
                if (this.attachments) {
                    db.exec('DELETE FROM task_attachments');
                    const add = db.prepare('INSERT INTO task_attachments VALUES(?,?,?)');
                    for (const task of data.tasks)
                        task.attachments.forEach((file, index) => add.run(task.id, index, file));
                }
                const metadata = { ...data };
                for (const table of Object.keys(this.tables)) delete metadata[table];
                db.prepare(
                    'INSERT INTO domain_state VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload'
                ).run(revision + 1, JSON.stringify(metadata));
                if (tool)
                    db.prepare('INSERT INTO domain_audit(tool,created_at) VALUES(?,?)').run(
                        tool,
                        new Date().toISOString()
                    );
                db.exec('COMMIT');
                this.revision = revision + 1;
            } catch (error) {
                db.exec('ROLLBACK');
                throw error;
            }
        });
    }
}
module.exports = { EntityRepository };
