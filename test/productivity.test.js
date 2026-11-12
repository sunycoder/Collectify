const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { Store } = require('../src/store');
const { dueReminders } = require('../src/productivity');
const { deliverReminders } = require('../src/reminders');
function fixture(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'collectify-v3-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return { dir, file: path.join(dir, 'collectify.sqlite') }; }
test('默认 JSON 只首次初始化；替换导入优先并持久化，默认改变不覆盖', t => {
  const { dir, file } = fixture(t), defaults = path.join(dir, 'default-config.json');
  fs.writeFileSync(defaults, JSON.stringify({ version: 2, categories: [{ id: 'a', name: '默认' }], entries: [{ id: 'default-site', categoryId: 'a', name: '原配置', url: 'http://localhost:8000/' }] }));
  const store = new Store(file, { defaults });
  assert.equal(store.data.configSource, 'default');
  const task = store.saveTask({ title: '导入后也要保留' }); store.saveNote({ title: '草稿', content: '内容' });
  store.import({ version: 2, categories: [{ id: 'b', name: '新配置' }], entries: [{ name: '导入站点', categoryId: 'b', url: 'http://localhost:9000/' }] }, { mode: 'replace', sourceName: 'team.json' });
  fs.writeFileSync(defaults, '{broken default');
  const reopened = new Store(file, { defaults });
  assert.equal(reopened.data.configSource, 'imported'); assert.equal(reopened.data.sourceName, 'team.json');
  assert.deepEqual(reopened.entries.map(e => e.name), ['导入站点']); assert.equal(reopened.data.tasks[0].id, task.id); assert.equal(reopened.data.notes[0].content, '内容');
});
test('合并导入同网址时导入字段优先，保留本机会话和密码', t => {
  const store = new Store(fixture(t).file), entry = store.entries[0];
  store.save({ ...entry, password: 'test-password', username: 'old' });
  const raw = store.snapshot(); raw.entries = [{ ...entry, name: '导入名称', username: 'new' }]; raw.categories[0].description = '导入描述';
  delete raw.entries[0].password;
  assert.equal(store.import(raw, { override: true }), 0);
  assert.equal(store.entries[0].id, entry.id); assert.equal(store.entries[0].name, '导入名称'); assert.equal(store.entries[0].password, 'test-password'); assert.equal(store.categories[0].description, '导入描述');
  raw.entries[0].password='';store.import(raw,{override:true});assert.equal(store.entries[0].password,'');
});
test('任务状态、日期、优先级、附件和备注重启保留；归档需先完成', t => {
  const { file, dir } = fixture(t), store = new Store(file);
  let task = store.saveTask({ title: '发布检查', dueAt: '2026-11-12T10:00:00+08:00', priority: 'high', attachments: [path.join(dir, 'report.txt')], note: '检查版本', status: 'todo' });
  assert.throws(() => store.saveTask({ ...task, archived: true }));
  task = store.saveTask({ ...task, status: 'doing' }); task = store.saveTask({ ...task, status: 'done' }); assert.ok(task.completedAt);
  task = store.saveTask({ ...task, archived: true });
  const reopened = new Store(file); assert.equal(reopened.data.tasks[0].archived, true); assert.equal(reopened.data.tasks[0].priority, 'high'); assert.equal(reopened.data.tasks[0].note, '检查版本');
  assert.equal(reopened.data.tasks[0].attachments[0], path.join(dir, 'report.txt'));
  task = reopened.saveTask({ ...task, archived: false, status: 'todo' }); assert.equal(task.completedAt, '');
  assert.throws(() => store.saveTask({ title: '坏日期', dueAt: 'bad date' }));
  assert.throws(() => store.saveTask({ title: '相对路径', attachments: ['relative.txt'] }));
});
test('提醒补发、重启去重、改时间重启提醒；失败不确认、完成和归档不提醒', async t => {
  const { file } = fixture(t), store = new Store(file), now = Date.now();
  const active = store.saveTask({ title: '已错过', remindAt: new Date(now - 10000).toISOString() });
  store.saveTask({ title: '已完成', status: 'done', remindAt: new Date(now - 10000).toISOString() });
  store.saveTask({ title: '已归档', status: 'done', archived: true, remindAt: new Date(now - 10000).toISOString() });
  assert.equal(dueReminders(store.data.tasks, now).length, 1);
  await assert.rejects(deliverReminders(store, async () => { throw Error('delivery failure'); }, now));
  assert.equal(store.data.tasks.find(t => t.id === active.id).notifiedAt, '');
  let delivered = 0; await deliverReminders(store, async () => { delivered++; }, now);
  const reopened = new Store(file); await deliverReminders(reopened, async () => { delivered++; }, now); assert.equal(delivered, 1);
  reopened.saveTask({ ...reopened.data.tasks.find(t => t.id === active.id), remindAt: new Date(now + 10000).toISOString() });
  assert.equal(dueReminders(reopened.data.tasks, now).length, 0);
  assert.equal(dueReminders(reopened.data.tasks, now + 11000).length, 1);
});
test('便签持久化且无关写入不改变更新时间；删除任务不删除本地文件', t => {
  const { file, dir } = fixture(t), store = new Store(file), attachment = path.join(dir, 'keep.txt'); fs.writeFileSync(attachment, 'keep');
  const note = store.saveNote({ title: '便签', content: '独立内容', color: 'pink' });
  const task = store.saveTask({ title: '带附件', attachments: [attachment] }); store.removeItem('tasks', task.id);
  assert.ok(fs.existsSync(attachment)); assert.equal(new Store(file).data.notes[0].updatedAt, note.updatedAt);
});
