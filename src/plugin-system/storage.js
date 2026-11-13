const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { pluginId } = require('./manifest');
const MAX_VALUE = 256 * 1024,
    MAX_TOTAL = 8 * 1024 * 1024;
function ensureStorageSchema(db) {
    const version = db.prepare('PRAGMA user_version').get().user_version;
    if (version > 1) throw Error('插件数据版本高于当前宿主支持的版本');
    db.exec(
        'CREATE TABLE IF NOT EXISTS plugin_values(key TEXT PRIMARY KEY,value_json TEXT NOT NULL,updated_at TEXT NOT NULL) STRICT;PRAGMA user_version=1'
    );
}

function keyOf(key) {
    if (typeof key !== 'string' || !key.length || key.length > 128 || /[\x00-\x1f]/.test(key))
        throw Error('插件存储键不正确');
    return key;
}
function serialize(value) {
    const text = JSON.stringify(value);
    if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_VALUE) throw Error('插件单项数据不能超过 256 KB');
    return text;
}
function validateValues(values) {
    if (!values || typeof values !== 'object' || Array.isArray(values)) throw Error('插件数据必须为键值对象');
    const rows = Object.entries(values).map(([key, value]) => [keyOf(key), serialize(value)]);
    if (rows.length > 200 || rows.reduce((sum, r) => sum + Buffer.byteLength(r[1]), 0) > MAX_TOTAL)
        throw Error('插件数据超出存储限制');
    return rows;
}

class PluginStorage {
    constructor(dataRoot) {
        this.dataRoot = dataRoot;
    }
    file(id) {
        return path.join(this.dataRoot, pluginId(id), 'data.sqlite');
    }
    withDatabase(id, action) {
        const file = this.file(id);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const db = new DatabaseSync(file);
        try {
            db.exec('PRAGMA busy_timeout=5000');
            ensureStorageSchema(db);
            return action(db);
        } finally {
            db.close();
        }
    }
    get(id, key) {
        return this.withDatabase(id, (db) => {
            const row = db.prepare('SELECT value_json FROM plugin_values WHERE key=?').get(keyOf(key));
            return row ? JSON.parse(row.value_json) : null;
        });
    }
    set(id, key, value) {
        const itemKey = keyOf(key),
            text = serialize(value);
        this.withDatabase(id, (db) => {
            const total = db
                .prepare(
                    'SELECT coalesce(sum(length(CAST(value_json AS BLOB))),0) AS size,count(*) AS count FROM plugin_values WHERE key<>?'
                )
                .get(itemKey);
            if (total.size + Buffer.byteLength(text) > MAX_TOTAL || total.count >= 200) throw Error('插件存储空间已满');
            db.prepare(
                'INSERT INTO plugin_values VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at'
            ).run(itemKey, text, new Date().toISOString());
        });
    }
    delete(id, key) {
        this.withDatabase(id, (db) => db.prepare('DELETE FROM plugin_values WHERE key=?').run(keyOf(key)));
    }
    batch(id, { set = {}, delete: removed = [] } = {}) {
        if (!Array.isArray(removed) || removed.length > 200) throw Error('存储删除批次不正确');
        const rows = validateValues(set);
        removed.forEach(keyOf);
        this.withDatabase(id, (db) => {
            db.exec('BEGIN IMMEDIATE');
            try {
                const values = Object.fromEntries(
                    db
                        .prepare('SELECT key,value_json FROM plugin_values')
                        .all()
                        .map((row) => [row.key, JSON.parse(row.value_json)])
                );
                for (const key of removed) delete values[key];
                for (const [key, text] of rows) values[key] = JSON.parse(text);
                validateValues(values);
                const erase = db.prepare('DELETE FROM plugin_values WHERE key=?');
                for (const key of removed) erase.run(key);
                const save = db.prepare(
                    'INSERT INTO plugin_values VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at'
                );
                for (const [key, text] of rows) save.run(key, text, new Date().toISOString());
                db.exec('COMMIT');
            } catch (error) {
                db.exec('ROLLBACK');
                throw error;
            }
        });
    }
    export(id) {
        return this.withDatabase(id, (db) =>
            Object.fromEntries(
                db
                    .prepare('SELECT key,value_json FROM plugin_values ORDER BY key')
                    .all()
                    .map((r) => [r.key, JSON.parse(r.value_json)])
            )
        );
    }
    replace(id, values) {
        const rows = validateValues(values);
        this.withDatabase(id, (db) => {
            db.exec('BEGIN IMMEDIATE');
            try {
                db.exec('DELETE FROM plugin_values');
                const insert = db.prepare('INSERT INTO plugin_values VALUES(?,?,?)');
                for (const [key, text] of rows) insert.run(key, text, new Date().toISOString());
                db.exec('COMMIT');
            } catch (error) {
                db.exec('ROLLBACK');
                throw error;
            }
        });
    }
}
module.exports = { PluginStorage, validateValues, ensureStorageSchema };
