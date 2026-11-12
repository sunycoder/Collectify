const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../src/store');
const {withInitialExamples}=require('../src/initial-examples');
const {event,quadrant}=require('../src/task-schedule');
const {dueReminders}=require('../src/productivity');
const {matchesTaskDate}=require('../src/task-query');
const defaults=path.join(__dirname,'..','config','default-config.json');
test('附件资源作为首次默认数据，凭据与文本完整落库且重启不重建',t=>{
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'collectify-defaults-'));
    t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
    const file=path.join(directory,'collectify.sqlite'),now=new Date(2026,10,12,11,30);
    const store=new Store(file,{defaults,now});
    assert.equal(store.entries.length,11);assert.equal(store.categories.length,6);
    assert.equal(store.entries.filter(entry=>entry.type==='web').length,8);
    assert.equal(store.entries.filter(entry=>entry.type==='text').length,3);
    const raw=JSON.parse(fs.readFileSync(defaults,'utf8'));
    // 比较附件生成配置与数据库，断言不把实际密码带到测试日志。
    assert.ok(raw.entries.every(entry=>{const saved=store.entries.find(item=>item.id===entry.id);return saved&&saved.name===entry.name&&(saved.password||'')===(entry.password||'')&&(saved.username||'')===(entry.username||'')&&(saved.content||'')===(entry.content||'');}));
    assert.equal(store.data.tasks.length,6);assert.equal(store.data.notes.length,3);
    const original=store.snapshot(),reopened=new Store(file,{defaults,now:new Date(2027,0,1)});
    assert.deepEqual(reopened.snapshot(),original);
    for(const task of [...reopened.data.tasks])reopened.removeItem('tasks',task.id);
    for(const note of [...reopened.data.notes])reopened.removeItem('notes',note.id);
    assert.equal(new Store(file,{defaults}).data.tasks.length,0);
    assert.equal(new Store(file,{defaults}).data.notes.length,0);
});
test('默认示例覆盖四种状态、四象限与日期安排，没有自动提醒',()=>{
    const raw=JSON.parse(fs.readFileSync(defaults,'utf8')),now=new Date(2026,10,12,11,30),data=withInitialExamples(raw,now);
    assert.equal(new Set(data.tasks.map(task=>task.status)).size,4);
    assert.equal(new Set(data.tasks.map(quadrant)).size,4);
    assert.equal(dueReminders(data.tasks,Date.now()+365*86400000).length,0);
    const events=data.tasks.map(event).filter(Boolean);assert.equal(events.length,4);assert.ok(events.some(item=>item.allDay));
    const tomorrow=data.tasks.find(task=>task.id==='example-environment-review');
    assert.equal(new Date(tomorrow.startAt).getHours(),9);assert.equal(new Date(tomorrow.startAt).getMinutes(),30);
    assert.ok(matchesTaskDate(tomorrow,'2026-11-13','startAt'));
    assert.equal(tomorrow.bookmarkId,'gm-trunk');
    assert.ok(data.tasks.every(task=>task.title.startsWith('示例 · ')));assert.ok(data.notes.every(note=>note.title.startsWith('示例 · ')));
    assert.equal(raw.tasks,undefined);assert.equal(raw.notes,undefined);
});
test('自定义默认配置未启用示例时不增加内容，JSON 收藏导入不插入示例',t=>{
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'collectify-no-examples-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
    const store=new Store(path.join(directory,'collectify.sqlite'),{defaultData:{version:2,categories:[],entries:[]}});
    assert.equal(store.data.tasks.length,0);assert.equal(store.data.notes.length,0);
    store.import(JSON.parse(fs.readFileSync(defaults,'utf8')));
    assert.equal(store.data.tasks.length,0);assert.equal(store.data.notes.length,0);
});
