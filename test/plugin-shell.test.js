const { test } = require('node:test'),
    assert = require('node:assert/strict');
const fs = require('node:fs'),
    path = require('node:path'),
    os = require('node:os'),
    crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { Store } = require('../src/store');
const { seed } = require('../src/plugins/.shared/seed');
const { createStore, validateCollection, validateTask, validateNote } = require('../src/plugins/.shared/domain-store');
const { PluginRegistry } = require('../src/plugin-system/registry');
const { WorkspaceBackup } = require('../src/plugin-system/backup');
function fixture(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'collectify-shell-test-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return dir;
}
test('宿主不包含默认业务操作和固定业务导航；默认业务均为可停用的真实插件', (t) => {
    const dir = fixture(t),
        source = fs.readFileSync(path.resolve(__dirname, '../src/main.js'), 'utf8'),
        html = fs.readFileSync(path.resolve(__dirname, '../src/index.html'), 'utf8');
    assert.doesNotMatch(source, /case\s*['"](?:task-save|note-save|category-save|open-file|widget-open)['"]/);
    assert.doesNotMatch(html, /id="(?:tasks-page|notes-page|categories|all-nav|tasks-nav)"|工具插件/);
    const registry = new PluginRegistry({
        builtinRoot: path.resolve(__dirname, '../src/plugins'),
        userRoot: path.join(dir, 'packages'),
        dataRoot: path.join(dir, 'data'),
        hostFile: path.join(dir, 'host.sqlite')
    });
    assert.equal(registry.list().length, 6);
    assert.deepEqual(registry.diagnostics, []);
    for (const id of ['collectify.bookmarks', 'collectify.tasks', 'collectify.notes'])
        assert.ok(registry.get(id).backend);
    assert.deepEqual(
        registry.get('collectify.tasks').navigation.map((n) => n.id),
        ['list', 'matrix', 'board', 'calendar', 'archive']
    );
    for (const plugin of registry.list()) registry.setEnabled(plugin.id, false);
    assert.equal(registry.commands().length, 0);
});
test('旧库只读迁移到各插件关系表，保留 ID、凭据、任务关联和便签；重启不重复初始化', (t) => {
    const dir = fixture(t),
        legacy = new Store(path.join(dir, 'collectify.sqlite'));
    const item = legacy.save({
        name: '旧资源',
        url: 'https://example.com/private',
        username: 'demo',
        password: 'keep-secret'
    });
    const task = legacy.saveTask({
        title: '旧待办',
        bookmarkId: item.id,
        status: 'doing',
        attachments: [path.join(dir, 'keep.txt')]
    });
    const note = legacy.saveNote({ title: '旧便签', content: '保留正文' });
    const before = crypto.createHash('sha256').update(fs.readFileSync(legacy.file)).digest('hex');
    const models = {};
    for (const name of ['bookmarks', 'tasks', 'notes']) {
        const definition = require('../src/plugins/' + name + '/schema'),
            file = path.join(dir, 'plugins', name, 'data.sqlite'),
            context = { file, dataDirectory: dir, smoke: true, defaultsFile: 'unused' };
        const validation =
            name === 'tasks'
                ? { validate: (d) => validateCollection(d, 'tasks', validateTask) }
                : name === 'notes'
                  ? { validate: (d) => validateCollection(d, 'notes', validateNote) }
                  : {};
        const data = seed(context, definition),
            store = createStore(file, { ...definition, ...validation }, data);
        models[name] = store;
        assert.deepEqual(seed(context, definition), {});
        const reopened = createStore(file, { ...definition, ...validation }, {});
        assert.deepEqual(reopened.data, store.data);
        const db = new DatabaseSync(file, { readOnly: true }),
            tables = db
                .prepare("SELECT name FROM sqlite_master WHERE type='table'")
                .all()
                .map((r) => r.name);
        db.close();
        if (name === 'tasks') {
            assert.ok(tables.includes('task_attachments'));
            assert.equal(tables.includes('entries'), false);
            assert.equal(tables.includes('notes'), false);
        }
    }
    assert.equal(models.bookmarks.entries.find((e) => e.id === item.id).password, 'keep-secret');
    assert.equal(models.tasks.data.tasks.find((v) => v.id === task.id).bookmarkId, item.id);
    assert.deepEqual(models.tasks.data.tasks[0].attachments, [path.join(dir, 'keep.txt')]);
    assert.equal(models.notes.data.notes[0].id, note.id);
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(legacy.file)).digest('hex'), before);
});
test('插件关系仓储拒绝过期写入，任务写入不修改便签库，审计与业务写入同事务', (t) => {
    const dir = fixture(t),
        definition = require('../src/plugins/tasks/schema'),
        file = path.join(dir, 'task.sqlite'),
        options = { ...definition, validate: (d) => validateCollection(d, 'tasks', validateTask) };
    const first = createStore(file, options, { tasks: [] }),
        second = createStore(file, options, {});
    first.withAudit('save_tasks', () => first.saveTask({ title: '有效任务' }));
    assert.throws(() => second.saveTask({ title: '过期覆盖' }), /其他实例/);
    const db = new DatabaseSync(file, { readOnly: true });
    assert.equal(db.prepare('SELECT count(*) AS n FROM tasks').get().n, 1);
    assert.equal(db.prepare('SELECT tool FROM domain_audit').get().tool, 'save_tasks');
    db.close();
});
test('宿主按插件导入，排除的插件保持原值；失败和中断可恢复领域数据与宿主设置', (t) => {
    const dir = fixture(t),
        registry = new PluginRegistry({
            builtinRoot: path.resolve(__dirname, '../src/plugins'),
            userRoot: path.join(dir, 'packages'),
            dataRoot: path.join(dir, 'data'),
            hostFile: path.join(dir, 'host.sqlite')
        });
    let value = { schemaVersion: 1, items: ['before'] },
        settings = { keepInTray: false };
    registry.providers = new Map([
        [
            'collectify.notes',
            {
                exportData: () => structuredClone(value),
                planData: (data) => structuredClone(data),
                importData: (data) => {
                    value = structuredClone(data);
                }
            }
        ]
    ]);
    const backup = new WorkspaceBackup(
        registry,
        () => settings,
        (data, validate) => {
            if (!data || typeof data.keepInTray !== 'boolean') throw Error('设置无效');
            if (!validate) settings = data;
            return data;
        }
    );
    const exported = backup.export(['collectify.notes'], true, true);
    value = { schemaVersion: 1, items: ['changed'] };
    backup.import(exported, { ids: ['collectify.notes'], settings: true, mode: 'replace' });
    assert.deepEqual(value.items, ['before']);
    assert.equal(fs.existsSync(registry.storage.file('collectify.bookmarks')), false);
    const previous = registry.snapshot(true, ['collectify.notes']);
    fs.writeFileSync(
        backup.journal,
        JSON.stringify({ plugins: previous, settings: { keepInTray: false }, ids: ['collectify.notes'] })
    );
    value = { schemaVersion: 1, items: ['partial'] };
    settings = { keepInTray: true };
    assert.equal(backup.recover(), true);
    assert.deepEqual(value.items, ['before']);
    assert.equal(settings.keepInTray, false);
    assert.equal(backup.recover(), false);
});
