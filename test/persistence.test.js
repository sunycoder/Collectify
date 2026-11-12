const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {Store}=require('../src/store');
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'collectify-sqlite-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return path.join(dir,'collectify.sqlite');}

test('SQLite 实体分表、附件子表、索引和格式版本真实落库',t=>{
    const file=fixture(t),store=new Store(file);
    store.saveTask({title:'附件任务',attachments:[path.join(path.dirname(file),'report.txt')]});
    assert.equal(fs.readFileSync(file).subarray(0,15).toString(),'SQLite format 3');
    store.repository.withDatabase(db=>{
        const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name);
        for(const table of ['categories','entries','tasks','task_attachments','notes','settings','schema_migrations','workspace_meta','mcp_connection','mcp_audit'])assert.ok(tables.includes(table));
        assert.equal(db.prepare('SELECT count(*) n FROM task_attachments').get().n,1);
        assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys,1);
        assert.equal(db.prepare('PRAGMA user_version').get().user_version,2);
        assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_tasks_due'").get());
        assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
    });
});

test('实际故障回归：缺少 MCP 表的 v1 库升级后可启动服务，业务数据不变且重复打开幂等',t=>{
    const file=fixture(t),store=new Store(file);
    const task=store.saveTask({title:'升级必须保留的任务'}),before=store.snapshot();
    store.repository.withDatabase(db=>db.exec('DROP TABLE mcp_connection; DROP TABLE mcp_audit; DELETE FROM schema_migrations WHERE version=2; INSERT OR IGNORE INTO schema_migrations VALUES(1, CURRENT_TIMESTAMP); PRAGMA user_version=1'));
    const upgraded=new Store(file);
    assert.deepEqual(upgraded.snapshot(),before);assert.equal(upgraded.data.tasks[0].id,task.id);
    assert.equal(upgraded.repository.readMcpConfig(),null);
    upgraded.repository.saveMcpConfig({enabled:false,port:17863,token:'a'.repeat(64)});
    assert.equal(new Store(file).repository.readMcpConfig().token,'a'.repeat(64));
    assert.equal(upgraded.repository.withDatabase(db=>db.prepare('SELECT count(*) n FROM schema_migrations WHERE version=2').get().n),1);
});

test('带 MCP 表的 v1 库升级不重置令牌和审计',t=>{
    const file=fixture(t),store=new Store(file);
    store.repository.saveMcpConfig({enabled:false,port:17863,token:'b'.repeat(64)});
    store.withAudit('save_note',()=>store.saveNote({title:'保留审计'}));
    store.repository.withDatabase(db=>db.exec('DELETE FROM schema_migrations WHERE version=2; PRAGMA user_version=1'));
    const upgraded=new Store(file);
    assert.equal(upgraded.repository.readMcpConfig().token,'b'.repeat(64));
    assert.equal(upgraded.repository.withDatabase(db=>db.prepare('SELECT count(*) n FROM mcp_audit').get().n),1);
});

test('事务后半段失败回滚全部业务行和审计，内存不发布假成功',t=>{
    const store=new Store(fixture(t)),before=store.snapshot();
    store.repository.withDatabase(db=>db.exec("CREATE TRIGGER reject_note BEFORE INSERT ON notes BEGIN SELECT RAISE(ABORT,'模拟后半段失败'); END"));
    const next=store.snapshot();next.tasks.push({title:'不应留下部分任务'});next.notes.push({title:'触发失败'});
    assert.throws(()=>store.withAudit('save_note',()=>store.commit(next)),/模拟后半段失败/);
    assert.deepEqual(store.snapshot(),before);assert.deepEqual(new Store(store.file).snapshot(),before);
    assert.equal(store.repository.withDatabase(db=>db.prepare('SELECT count(*) n FROM mcp_audit').get().n),0);
});

test('两个仓储实例写入冲突拒绝过期快照，不覆盖已提交内容',t=>{
    const file=fixture(t),first=new Store(file),second=new Store(file);
    first.saveTask({title:'第一实例'});
    assert.throws(()=>second.saveTask({title:'过期写入'}),/其他实例修改/);
    assert.equal(second.data.tasks.length,0);
    assert.equal(new Store(file).data.tasks[0].title,'第一实例');
});

test('SQL 约束拒绝悬空分类、非法状态、错误归档和时间范围',t=>{
    const store=new Store(fixture(t));store.saveTask({title:'约束验证'});
    store.repository.withDatabase(db=>{
        for(const sql of ["UPDATE entries SET category_id='missing'","UPDATE tasks SET status='invalid'","UPDATE tasks SET archived=1","UPDATE tasks SET start_at='2026-11-12T12:00:00.000Z',end_at='2026-11-12T10:00:00.000Z'"])assert.throws(()=>db.exec(sql));
        assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
    });
});

test('删除收藏解除任务关联，删除任务级联附件行但保留本地文件',t=>{
    const file=fixture(t),store=new Store(file),attachment=path.join(path.dirname(file),'keep.txt');fs.writeFileSync(attachment,'keep');
    const entry=store.entries[0],task=store.saveTask({title:'关联任务',bookmarkId:entry.id,attachments:[attachment]});
    store.remove(entry.id);assert.equal(store.data.tasks[0].bookmarkId,'');assert.equal(new Store(file).data.tasks[0].bookmarkId,'');
    store.removeItem('tasks',task.id);assert.equal(store.repository.withDatabase(db=>db.prepare('SELECT count(*) n FROM task_attachments').get().n),0);assert.ok(fs.existsSync(attachment));
});

test('WAL 模式一致备份包含最新提交，不依赖裸复制主文件',t=>{
    const file=fixture(t),store=new Store(file),keeper=new DatabaseSync(file);keeper.exec('PRAGMA journal_mode=WAL');
    try {
        store.saveTask({title:'WAL中的最新任务'});assert.ok(fs.existsSync(`${file}-wal`));
        const backup=path.join(path.dirname(file),'backup.sqlite');store.backup(backup);
        assert.equal(new Store(backup).data.tasks[0].title,'WAL中的最新任务');
        store.saveTask({title:'备份后新增'});assert.equal(new Store(backup).data.tasks.length,1);
    }finally{keeper.close();}
});

test('新数据库不读取旁边旧 JSON，拒绝损坏和未来版本数据库',t=>{
    const file=fixture(t);fs.writeFileSync(path.join(path.dirname(file),'entries.json'),'{old irrelevant');
    new Store(file);const db=new DatabaseSync(file);db.exec('PRAGMA user_version=99');db.close();
    assert.throws(()=>new Store(file),/结构版本较新/);
    const broken=path.join(path.dirname(file),'broken.sqlite');fs.writeFileSync(broken,'not sqlite');assert.throws(()=>new Store(broken));assert.equal(fs.readFileSync(broken,'utf8'),'not sqlite');
});

test('修改任务不会重写无关收藏行，密码与 UTC 时间重启保持',t=>{
    const file=fixture(t),store=new Store(file),entry=store.save({name:'资料',type:'credential',username:'demo',password:'test-only'});
    store.repository.withDatabase(db=>db.exec('CREATE TABLE update_observer(n INTEGER); INSERT INTO update_observer VALUES(0); CREATE TRIGGER watch_entries AFTER UPDATE ON entries BEGIN UPDATE update_observer SET n=n+1; END'));
    store.saveTask({title:'UTC时间',bookmarkId:entry.id,startAt:'2026-11-12T10:00:00+08:00',endAt:'2026-11-12T11:00:00+08:00'});
    assert.equal(store.repository.withDatabase(db=>db.prepare('SELECT n FROM update_observer').get().n),0);
    const reopened=new Store(file);assert.equal(reopened.entries.find(item=>item.id===entry.id).password,'test-only');assert.equal(reopened.data.tasks[0].startAt,'2026-11-12T02:00:00.000Z');
});
