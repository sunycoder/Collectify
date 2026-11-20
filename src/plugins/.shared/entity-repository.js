const fs = require('node:fs'),
    path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { ensureStorageSchema } = require('../../plugin-system/storage');

// 只执行插件随包提供的固定表定义；页面无法传表名、字段名或 SQL。
class EntityRepository {
    constructor(file, { id, schema, tables, attachments = false, migrate }) {
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
                migrate?.(db);
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
                    const relation = this.attachments;
                    const rows = db.prepare(`SELECT * FROM ${relation.table} ORDER BY ${relation.position}`).all();
                    const byOwner = new Map();
                    for (const row of rows) {
                        const items = byOwner.get(row[relation.foreignKey]) || [];
                        items.push(row[relation.value]);
                        byOwner.set(row[relation.foreignKey], items);
                    }
                    for (const item of data[relation.owner]) item[relation.field] = byOwner.get(item.id) || [];
                }
                db.exec('COMMIT');
                return data;
            } catch (error) {
                db.exec('ROLLBACK');
                throw error;
            }
        });
    }
    upsert(db, table, writes) {
        const d = this.tables[table];
        if (!d) throw Error('插件实体表不存在');
        if (!writes.length) return;
        // 只为本次改动的名称释放唯一键，支持导入交换名称；未改动记录不产生写入。
        if (d.nameKey) {
            const reserve = db.prepare(`UPDATE ${table} SET name_key=? WHERE id=?`);
            for (const { item } of writes) reserve.run(`reserved:${item.id}`, item.id);
        }
        const columns = [...Object.values(d.fields), ...(d.nameKey ? ['name_key'] : []), 'sort_order'];
        const update = columns
            .filter((c) => c !== 'id')
            .map((c) => `${c}=excluded.${c}`)
            .join(',');
        const statement = db.prepare(
            `INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')}) ON CONFLICT(id) DO UPDATE SET ${update}`
        );
        for (const { item, position } of writes) {
            statement.run(
                ...Object.keys(d.fields).map((field) =>
                    d.booleans?.includes(field)
                        ? Number(!!item[field])
                        : d.nullable?.includes(field)
                          ? item[field] || null
                          : (item[field] ?? '')
                ),
                ...(d.nameKey ? [item.name.toLocaleLowerCase()] : []),
                position
            );
            if (this.attachments && table === this.attachments.owner) {
                const relation = this.attachments;
                db.prepare(`DELETE FROM ${relation.table} WHERE ${relation.foreignKey}=?`).run(item.id);
                const attach = db.prepare(
                    `INSERT INTO ${relation.table}(${relation.foreignKey},${relation.position},${relation.value}) VALUES(?,?,?)`
                );
                (item[relation.field] || []).forEach((value, i) => attach.run(item.id, i, value));
            }
        }
    }
    transaction(tool, action) {
        this.database((db) => {
            db.exec('BEGIN IMMEDIATE');
            try {
                const revision = db.prepare('SELECT revision FROM domain_state WHERE id=1').get()?.revision || 0;
                if (revision !== this.revision) throw Error('插件数据库已被其他实例更新，请重启重试');
                const entities = action(db);
                db.prepare('UPDATE domain_state SET revision=? WHERE id=1').run(revision + 1);
                if (tool)
                    db.prepare('INSERT INTO domain_audit(tool,created_at) VALUES(?,?)').run(
                        tool,
                        new Date().toISOString()
                    );
                db.exec('COMMIT');
                this.revision = revision + 1;
                this.lastWrite = { entities };
            } catch (error) {
                db.exec('ROLLBACK');
                throw error;
            }
        });
    }
    patch(table, writes, tool) {
        this.transaction(tool, (db) => {
            this.upsert(db, table, writes);
            return writes.length;
        });
    }
    write(data, tool, previous) {
        this.transaction(tool, (db) => {
            let entities = 0;
            for (const table of Object.keys(this.tables).reverse()) {
                const keep = new Set(data[table].map((v) => v.id)),
                    remove = db.prepare(`DELETE FROM ${table} WHERE id=?`);
                for (const row of previous?.[table] || db.prepare(`SELECT id FROM ${table}`).all())
                    if (!keep.has(row.id)) remove.run(row.id);
            }
            for (const table of Object.keys(this.tables)) {
                const old = new Map((previous?.[table] || []).map((item, position) => [item.id, { item, position }]));
                const writes = data[table].flatMap((item, position) => {
                    const prior = old.get(item.id);
                    return prior && prior.position === position && JSON.stringify(prior.item) === JSON.stringify(item)
                        ? []
                        : [{ item, position }];
                });
                this.upsert(db, table, writes);
                entities += writes.length;
            }
            const metadata = { ...data };
            for (const table of Object.keys(this.tables)) delete metadata[table];
            db.prepare(
                'INSERT INTO domain_state VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload'
            ).run(this.revision + 1, JSON.stringify(metadata));
            return entities;
        });
    }
}
module.exports = { EntityRepository };
