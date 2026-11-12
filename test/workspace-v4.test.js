const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { Store } = require('../src/store');
const Theme = require('../src/theme');
const { localDay, matchesTaskDate } = require('../src/task-query');
function fixture(t) { const dir=fs.mkdtempSync(path.join(os.tmpdir(),'collectify-v4-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return {dir,file:path.join(dir,'collectify.sqlite')}; }
test('五类资源保存重启，非网页不强制 URL；文本保持原始空白',t=>{
  const {dir,file}=fixture(t),s=new Store(file);
  s.save({type:'file',name:'文件',localPath:path.join(dir,'a.txt')});
  s.save({type:'folder',name:'目录',localPath:dir});
  const content='  code\n\tline\n';s.save({type:'text',name:'命令',content});
  s.save({type:'credential',name:'测试账号',username:'tester',password:'test-only'});
  const reopened=new Store(file);assert.equal(reopened.entries.filter(e=>e.type!=='web').length,4);
  assert.equal(reopened.entries.find(e=>e.type==='text').content,content);
  assert.throws(()=>s.save({type:'file',name:'无路径'}));assert.throws(()=>s.save({type:'text',name:'空白',content:'   '}));
  assert.throws(()=>s.save({type:'credential',name:'账号',url:'javascript:bad'}));
});
test('无网址资源导入不互相覆盖；原网页 ID 保持',t=>{
  const s=new Store(fixture(t).file),raw=s.snapshot();raw.entries=[{type:'text',name:'A',content:'one',categoryId:'gm'},{type:'text',name:'B',content:'two',categoryId:'gm'},{type:'credential',name:'账号',username:'user',categoryId:'gm'}];
  assert.equal(s.import(raw),3);assert.equal(s.import(raw),0);
  const ids=s.entries.filter(e=>e.type!=='web').map(e=>e.id);assert.equal(new Set(ids).size,3);
  const original=s.entries[0];s.import(s.snapshot(),{mode:'replace'});assert.equal(s.entries[0].id,original.id);
});
test('主题与桌面窗口设置持久化；无效主题参数回退且保存其他设置',t=>{
  const {file}=fixture(t),s=new Store(file),data=s.snapshot();data.settings.keepInTray=true;data.settings.theme={preset:'ink',accent:'#abcdef',radius:99,motion:false};data.settings.widget={visible:true,mode:'floating',bounds:{x:10,y:20,width:350,height:500}};s.commit(data);
  const reopened=new Store(file);assert.equal(reopened.data.settings.theme.radius,22);assert.equal(reopened.data.settings.theme.accent,'#abcdef');assert.equal(reopened.data.settings.keepInTray,true);assert.equal(reopened.data.settings.widget.mode,'floating');
  const clean=Theme.validate({accent:'url(javascript:alert(1))',sidebar:'red',radius:-3});assert.match(clean.accent,/^#[a-f0-9]{6}$/);assert.equal(clean.radius,8);
  for(const p of Theme.PRESETS){const tokens=Theme.tokens({...p,preset:p.id});assert.ok(Theme.contrast(tokens['--accent'],tokens['--accent-fg'])>=4.5);assert.ok(Theme.contrast(tokens['--sidebar'],tokens['--sidebar-fg'])>=4.5);}
});
test('某日待办按截止、创建、完成或提醒筛选，使用本地日历日期',()=>{
  const at=new Date(2026,10,11,0,5).toISOString(),t={dueAt:at,createdAt:new Date(2026,10,10,12).toISOString(),completedAt:'',remindAt:at};
  assert.equal(localDay(at),'2026-11-11');assert.ok(matchesTaskDate(t,'2026-11-11'));assert.ok(!matchesTaskDate(t,'2026-11-10'));
  assert.ok(matchesTaskDate(t,'2026-11-10','createdAt'));assert.ok(!matchesTaskDate(t,'2026-11-11','completedAt'));assert.ok(matchesTaskDate(t,'2026-11-11','remindAt'));assert.ok(matchesTaskDate(t,''));
});
