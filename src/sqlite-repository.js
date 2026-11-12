const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const SCHEMA_VERSION = 2;

// SQLite 列与领域字段的映射集中于仓储；页面与 MCP 不接触表名或 SQL。
const definitions = {
    categories: { fields: { id:'id', name:'name', description:'description', color:'color', icon:'icon' } },
    entries: { fields: { id:'id', categoryId:'category_id', type:'type', name:'name', url:'url', localPath:'local_path', content:'content', environment:'environment', note:'note', username:'username', password:'password', authMode:'auth_mode', mode:'open_mode', favorite:'favorite', lastOpened:'last_opened' }, booleans:['favorite'] },
    tasks: { fields: { id:'id', title:'title', note:'note', status:'status', priority:'priority', important:'important', urgent:'urgent', allDay:'all_day', startAt:'start_at', endAt:'end_at', dueAt:'due_at', remindAt:'remind_at', notifiedAt:'notified_at', bookmarkId:'bookmark_id', archived:'archived', createdAt:'created_at', completedAt:'completed_at' }, booleans:['important','urgent','allDay','archived'], nullable:['startAt','endAt','dueAt','remindAt','notifiedAt','bookmarkId','completedAt'] },
    notes: { fields: { id:'id', title:'title', content:'content', color:'color', updatedAt:'updated_at' } }
};
const schema = `
CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL) STRICT;
CREATE TABLE workspace_meta(id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL DEFAULT 0, initialized INTEGER NOT NULL DEFAULT 0 CHECK(initialized IN (0,1)), config_source TEXT NOT NULL DEFAULT 'local', source_name TEXT NOT NULL DEFAULT '') STRICT;
INSERT INTO workspace_meta(id) VALUES(1);
CREATE TABLE categories(id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE, description TEXT NOT NULL, color TEXT NOT NULL, icon TEXT NOT NULL, sort_order INTEGER NOT NULL) STRICT;
CREATE TABLE entries(id TEXT PRIMARY KEY, category_id TEXT NOT NULL REFERENCES categories(id) DEFERRABLE INITIALLY DEFERRED, type TEXT NOT NULL CHECK(type IN ('web','file','folder','text','credential')), name TEXT NOT NULL, url TEXT NOT NULL, local_path TEXT NOT NULL, content TEXT NOT NULL, environment TEXT NOT NULL, note TEXT NOT NULL, username TEXT NOT NULL, password TEXT NOT NULL, auth_mode TEXT NOT NULL CHECK(auth_mode IN ('manual','basic')), open_mode TEXT NOT NULL CHECK(open_mode IN ('internal','external')), favorite INTEGER NOT NULL CHECK(favorite IN (0,1)), last_opened INTEGER NOT NULL CHECK(last_opened>=0), sort_order INTEGER NOT NULL) STRICT;
CREATE TABLE tasks(id TEXT PRIMARY KEY, title TEXT NOT NULL CHECK(length(trim(title))>0), note TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('inbox','todo','doing','done')), priority TEXT NOT NULL CHECK(priority IN ('high','medium','low')), important INTEGER NOT NULL CHECK(important IN (0,1)), urgent INTEGER NOT NULL CHECK(urgent IN (0,1)), all_day INTEGER NOT NULL CHECK(all_day IN (0,1)), start_at TEXT, end_at TEXT, due_at TEXT, remind_at TEXT, notified_at TEXT, bookmark_id TEXT REFERENCES entries(id) ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED, archived INTEGER NOT NULL CHECK(archived IN (0,1)), created_at TEXT NOT NULL, completed_at TEXT, sort_order INTEGER NOT NULL, CHECK(archived=0 OR status='done'), CHECK(end_at IS NULL OR (start_at IS NOT NULL AND end_at>start_at))) STRICT;
CREATE TABLE task_attachments(task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, position INTEGER NOT NULL CHECK(position>=0), path TEXT NOT NULL, PRIMARY KEY(task_id,position)) STRICT;
CREATE TABLE notes(id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL, color TEXT NOT NULL CHECK(color IN ('yellow','blue','pink','green')), updated_at TEXT NOT NULL, sort_order INTEGER NOT NULL) STRICT;
CREATE TABLE settings(key TEXT PRIMARY KEY, value_json TEXT NOT NULL CHECK(json_valid(value_json))) STRICT;
CREATE TABLE mcp_connection(id INTEGER PRIMARY KEY CHECK(id=1), enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), port INTEGER NOT NULL CHECK(port BETWEEN 0 AND 65535), token TEXT NOT NULL CHECK(length(token)=64)) STRICT;
CREATE TABLE mcp_audit(id INTEGER PRIMARY KEY, at TEXT NOT NULL, tool TEXT NOT NULL, result TEXT NOT NULL CHECK(result='ok')) STRICT;
CREATE INDEX idx_entries_category_order ON entries(category_id,sort_order);
CREATE INDEX idx_entries_favorite ON entries(favorite,last_opened);
CREATE INDEX idx_tasks_status ON tasks(archived,status);
CREATE INDEX idx_tasks_due ON tasks(due_at) WHERE archived=0;
CREATE INDEX idx_tasks_start ON tasks(start_at) WHERE archived=0;
CREATE INDEX idx_tasks_reminder ON tasks(remind_at) WHERE archived=0 AND notified_at IS NULL;
CREATE INDEX idx_tasks_bookmark ON tasks(bookmark_id);
CREATE INDEX idx_notes_updated ON notes(updated_at);
`;

class SqliteRepository {
    constructor(file) {
        this.file = file;
        this.revision = 0;
        fs.mkdirSync(path.dirname(file), { recursive:true });
        this.withDatabase(db => {
            const version = db.prepare('PRAGMA user_version').get().user_version;
            if (version > SCHEMA_VERSION) throw new Error('数据库结构版本较新，请使用匹配的 Collectify 版本。');
            if (version === 0) {
                // 非空的未知数据库不能作为新库重置。此项目不读取或迁移旧 JSON。
                if (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").get()) throw new Error('无法识别数据库结构');
                db.exec('BEGIN IMMEDIATE');
                try {
                    db.exec(schema);
                    db.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(SCHEMA_VERSION,new Date().toISOString());
                    db.exec(`PRAGMA user_version=${SCHEMA_VERSION}; COMMIT`);
                } catch (error) { db.exec('ROLLBACK'); throw error; }
            } else if (version === 1) {
                // 开发期 v1 有“仅业务表”和“已带 MCP 表”两种现场，统一事务升级，保留已有配置。
                db.exec('BEGIN IMMEDIATE');
                try {
                    db.exec(`
                        CREATE TABLE IF NOT EXISTS mcp_connection(id INTEGER PRIMARY KEY CHECK(id=1), enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), port INTEGER NOT NULL CHECK(port BETWEEN 0 AND 65535), token TEXT NOT NULL CHECK(length(token)=64)) STRICT;
                        CREATE TABLE IF NOT EXISTS mcp_audit(id INTEGER PRIMARY KEY, at TEXT NOT NULL, tool TEXT NOT NULL, result TEXT NOT NULL CHECK(result='ok')) STRICT;
                    `);
                    db.prepare('INSERT INTO schema_migrations VALUES(?,?)').run(SCHEMA_VERSION,new Date().toISOString());
                    db.exec(`PRAGMA user_version=${SCHEMA_VERSION}; COMMIT`);
                } catch (error) { db.exec('ROLLBACK'); throw error; }
            }
        });
    }

    withDatabase(action) {
        const db = new DatabaseSync(this.file);
        try {
            db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL');
            return action(db);
        } finally { db.close(); }
    }

    read() {
        return this.withDatabase(db => {
            db.exec('BEGIN');
            try {
                const meta = db.prepare('SELECT * FROM workspace_meta WHERE id=1').get();
                this.revision = meta.revision;
                if (!meta.initialized) { db.exec('COMMIT'); return null; }
                const data = { version:2, settings:{}, configSource:meta.config_source, sourceName:meta.source_name };
                for (const [table,definition] of Object.entries(definitions)) {
                    data[table] = db.prepare(`SELECT * FROM ${table} ORDER BY sort_order,id`).all().map(row => {
                        const item = {};
                        for (const [field,column] of Object.entries(definition.fields)) item[field] = definition.booleans?.includes(field) ? !!row[column] : row[column] ?? '';
                        return item;
                    });
                }
                const attachments = new Map();
                for (const row of db.prepare('SELECT * FROM task_attachments ORDER BY task_id,position').all()) {
                    if (!attachments.has(row.task_id)) attachments.set(row.task_id,[]);
                    attachments.get(row.task_id).push(row.path);
                }
                for (const task of data.tasks) task.attachments = attachments.get(task.id) || [];
                for (const row of db.prepare('SELECT * FROM settings').all()) data.settings[row.key] = JSON.parse(row.value_json);
                db.exec('COMMIT'); return data;
            } catch (error) { db.exec('ROLLBACK'); throw error; }
        });
    }

    write(data, auditTool) {
        this.withDatabase(db => {
            db.exec('BEGIN IMMEDIATE');
            try {
                const current = db.prepare('SELECT revision FROM workspace_meta WHERE id=1').get().revision;
                if (current !== this.revision) throw new Error('数据库已被其他实例修改，请重启 Collectify 后重试。');
                // 仅删除本次确实移除的实体；新增/修改使用 UPSERT，未变化的行不重写。
                for (const table of ['tasks','entries','categories','notes']) {
                    const retained = new Set(data[table].map(item=>item.id));
                    const remove = db.prepare(`DELETE FROM ${table} WHERE id=?`);
                    for (const row of db.prepare(`SELECT id FROM ${table}`).all()) if (!retained.has(row.id)) remove.run(row.id);
                }
                // 分类换名可能互换名称，事务内暂时释放唯一键，避免过渡态冲突。
                const desiredNames = new Map(data.categories.map(item=>[item.id,item.name.toLocaleLowerCase()]));
                const releaseName = db.prepare('UPDATE categories SET name_key=? WHERE id=?');
                for (const row of db.prepare('SELECT id,name_key FROM categories').all()) if (desiredNames.get(row.id)!==row.name_key) releaseName.run(`temporary:${randomUUID()}`,row.id);
                for (const [table,definition] of Object.entries(definitions)) {
                    const fields = Object.keys(definition.fields), columns = Object.values(definition.fields).concat('sort_order');
                    if (table==='categories') columns.push('name_key');
                    const updates = columns.filter(column=>column!=='id');
                    const statement = db.prepare(`INSERT INTO ${table}(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')}) ON CONFLICT(id) DO UPDATE SET ${updates.map(column=>`${column}=excluded.${column}`).join(',')} WHERE ${updates.map(column=>`${table}.${column} IS NOT excluded.${column}`).join(' OR ')}`);
                    data[table].forEach((item,index)=>{
                        const values = fields.map(field=>definition.booleans?.includes(field)?Number(!!item[field]):definition.nullable?.includes(field)?item[field]||null:item[field]??'');
                        values.push(index); if (table==='categories') values.push(item.name.toLocaleLowerCase());
                        statement.run(...values);
                    });
                }
                const readFiles = db.prepare('SELECT path FROM task_attachments WHERE task_id=? ORDER BY position');
                const deleteFiles = db.prepare('DELETE FROM task_attachments WHERE task_id=?');
                const insertFile = db.prepare('INSERT INTO task_attachments VALUES(?,?,?)');
                for (const task of data.tasks) {
                    if (JSON.stringify(readFiles.all(task.id).map(row=>row.path))===JSON.stringify(task.attachments)) continue;
                    deleteFiles.run(task.id); task.attachments.forEach((file,index)=>insertFile.run(task.id,index,file));
                }
                const setting = db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json WHERE settings.value_json IS NOT excluded.value_json');
                for (const [key,value] of Object.entries(data.settings)) setting.run(key,JSON.stringify(value));
                db.prepare('UPDATE workspace_meta SET revision=revision+1,initialized=1,config_source=?,source_name=? WHERE id=1').run(data.configSource,data.sourceName);
                if (auditTool) db.prepare("INSERT INTO mcp_audit(at,tool,result) VALUES(?,?,'ok')").run(new Date().toISOString(),auditTool);
                db.exec('COMMIT'); this.revision = current+1;
            } catch (error) { db.exec('ROLLBACK'); throw error; }
        });
    }

    backup(target) {
        if (path.resolve(target)===path.resolve(this.file)) throw new Error('备份位置不能是当前数据库');
        const temporary = `${target}.${randomUUID()}.tmp`;
        try {
            // VACUUM INTO 生成一致快照，不直接复制可能仍有 WAL 的数据库文件。
            this.withDatabase(db=>db.prepare('VACUUM INTO ?').run(temporary));
            fs.renameSync(temporary,target);
        } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    }

    readMcpConfig() {
        return this.withDatabase(db=>{
            const row=db.prepare('SELECT * FROM mcp_connection WHERE id=1').get();
            return row ? {enabled:!!row.enabled,port:row.port,token:row.token} : null;
        });
    }

    saveMcpConfig(config) {
        this.withDatabase(db=>db.prepare('INSERT INTO mcp_connection VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled,port=excluded.port,token=excluded.token').run(Number(config.enabled),config.port,config.token));
    }
}
module.exports = { SqliteRepository, SCHEMA_VERSION };
