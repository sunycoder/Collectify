const { test } = require('node:test'),
    assert = require('node:assert/strict'),
    fs = require('node:fs'),
    os = require('node:os'),
    path = require('node:path');
const { Store } = require('../src/store');
const { exportWorkspace, describeWorkspace, importWorkspace } = require('../src/workspace-transfer');
function fixture(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'collectify-transfer-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return (name) =>
        new Store(path.join(dir, name + '.sqlite'), { defaultData: { version: 2, categories: [], entries: [] } });
}
function seed(store) {
    const category = store.saveCategory({ name: '构建平台', icon: 'build', color: 'blue' });
    const entry = store.save({
        name: '演示站点',
        categoryId: category.id,
        url: 'https://example.com/',
        username: 'demo-user',
        password: 'demo-password'
    });
    const task = store.saveTask({
        title: '演示日程',
        bookmarkId: entry.id,
        status: 'doing',
        startAt: '2026-11-13T10:00:00+08:00',
        endAt: '2026-11-13T11:00:00+08:00',
        note: '保留详情',
        attachments: [path.join(path.dirname(store.file), 'example.txt')]
    });
    const note = store.saveNote({ title: '演示便签', content: '正文' });
    const data = store.snapshot();
    data.settings.theme = { ...data.settings.theme, widgetMaterial: 'glass', glassOpacity: 70 };
    data.settings.keepInTray = true;
    store.commit(data);
    return { entry, task, note };
}
test('全局数据往返：四种内容、日历排期、附件路径、凭据与偏好保持，关联重映射', (t) => {
    const create = fixture(t),
        source = create('source'),
        target = create('target'),
        { entry, task, note } = seed(source);
    const exported = exportWorkspace(source);
    assert.equal(exported.format, 'collectify-workspace');
    assert.equal(exported.sections.length, 4);
    assert.equal(describeWorkspace(exported).counts.tasks, 1);
    importWorkspace(target, exported, { sections: exported.sections, mode: 'replace' });
    const restored = target.entries.find((item) => item.name === entry.name);
    assert.equal(restored.password, 'demo-password');
    assert.notEqual(restored.id, entry.id);
    assert.equal(target.data.tasks[0].id, task.id);
    assert.equal(target.data.tasks[0].bookmarkId, restored.id);
    assert.equal(target.data.tasks[0].startAt, task.startAt);
    assert.deepEqual(target.data.tasks[0].attachments, task.attachments);
    assert.equal(target.data.notes[0].id, note.id);
    assert.equal(target.data.settings.theme.widgetMaterial, 'glass');
    assert.equal(target.data.settings.theme.glassOpacity, 70);
    assert.equal(target.data.settings.keepInTray, true);
    assert.ok(fs.existsSync(target.file + '.before-import.bak'));
});
test('选择性导出不夹带其他类型，关闭凭据后无用户名密码，空选择被拒绝', (t) => {
    const store = fixture(t)('source');
    seed(store);
    const exported = exportWorkspace(store, ['bookmarks'], false);
    assert.equal(exported.data.tasks, undefined);
    assert.equal(exported.data.notes, undefined);
    assert.equal(exported.data.settings, undefined);
    assert.equal(exported.data.entries[0].username, undefined);
    assert.equal(exported.data.entries[0].password, undefined);
    assert.throws(() => exportWorkspace(store, []));
    assert.throws(() => exportWorkspace(store, ['invalid']));
});
test('只替换便签不删除收藏任务设置，重复合并同 ID 更新且不产生副本', (t) => {
    const create = fixture(t),
        source = create('source'),
        target = create('target');
    seed(source);
    seed(target);
    target.saveNote({ title: '应移除的便签' });
    const before = target.snapshot();
    const file = exportWorkspace(source, ['notes']);
    importWorkspace(target, file, { sections: ['notes'], mode: 'replace' });
    assert.equal(target.data.notes.length, 1);
    assert.deepEqual(target.entries, before.entries);
    assert.deepEqual(target.data.tasks, before.tasks);
    assert.deepEqual(target.data.settings, before.settings);
    source.saveNote({ ...source.data.notes[0], content: '已更新' });
    importWorkspace(target, exportWorkspace(source, ['notes']), { sections: ['notes'], mode: 'merge' });
    assert.equal(target.data.notes.length, 1);
    assert.equal(target.data.notes[0].content, '已更新');
});
test('批次中无效任务不部分保存收藏；非法范围与重复 ID 拒绝', (t) => {
    const create = fixture(t),
        source = create('source'),
        target = create('target');
    seed(source);
    const before = target.snapshot();
    const file = exportWorkspace(source);
    file.data.tasks.push({ ...file.data.tasks[0], id: 'bad-time', endAt: '2026-11-12T00:00:00Z' });
    assert.throws(() => importWorkspace(target, file, { sections: ['bookmarks', 'tasks'], mode: 'replace' }));
    assert.deepEqual(target.snapshot(), before);
    const duplicate = exportWorkspace(source, ['tasks']);
    duplicate.data.tasks.push({ ...duplicate.data.tasks[0] });
    assert.throws(() => importWorkspace(target, duplicate, { sections: ['tasks'], mode: 'merge' }), /重复 ID/);
    assert.throws(() =>
        importWorkspace(target, exportWorkspace(source, ['notes']), { sections: ['tasks'], mode: 'replace' })
    );
});
test('任务单独导入解除无法定位的收藏关联；未导出的凭据不会清除本机已有密码', (t) => {
    const create = fixture(t),
        source = create('source'),
        target = create('target');
    seed(source);
    importWorkspace(target, exportWorkspace(source, ['tasks']), { sections: ['tasks'], mode: 'merge' });
    assert.equal(target.data.tasks[0].bookmarkId, '');
    const category = target.saveCategory({ name: '构建平台' });
    target.save({ name: '演示站点', categoryId: category.id, url: 'https://example.com/', password: 'local-password' });
    importWorkspace(target, exportWorkspace(source, ['bookmarks'], false), { sections: ['bookmarks'], mode: 'merge' });
    assert.equal(target.entries[0].password, 'local-password');
});
test('设置导入不移动窗口、不自动显示、不改变本机 MCP 身份；支持原收藏格式预览', (t) => {
    const create = fixture(t),
        source = create('source'),
        target = create('target');
    seed(source);
    const data = target.snapshot();
    data.settings.widget.bounds = { x: 10, y: 20, width: 350, height: 520 };
    data.settings.widget.visible = true;
    target.commit(data);
    target.repository.saveMcpConfig({ enabled: false, port: 17863, token: 'a'.repeat(64) });
    importWorkspace(target, exportWorkspace(source, ['settings']), { sections: ['settings'], mode: 'replace' });
    assert.equal(target.data.settings.widget.visible, true);
    assert.equal(target.data.settings.widget.bounds.x, 10);
    assert.equal(target.repository.readMcpConfig().token, 'a'.repeat(64));
    const snapshot = source.snapshot();
    assert.deepEqual(
        describeWorkspace({ version: 2, categories: snapshot.categories, entries: snapshot.entries }).sections,
        ['bookmarks']
    );
});
test('跨平台绝对路径保留原文，不把附件文件本身写入导出文件', (t) => {
    const create = fixture(t),
        source = create('source'),
        target = create('target');
    source.save({ name: 'Windows 文件', type: 'file', localPath: 'C:\\Work\\report.txt' });
    source.save({ name: 'macOS 文件夹', type: 'folder', localPath: '/Users/demo/Documents' });
    source.saveTask({ title: '跨平台附件', attachments: ['C:\\Work\\report.txt', '/Users/demo/report.txt'] });
    const file = exportWorkspace(source, ['bookmarks', 'tasks']);
    importWorkspace(target, file, { sections: file.sections, mode: 'replace' });
    assert.deepEqual(target.data.tasks[0].attachments, source.data.tasks[0].attachments);
    assert.equal(target.entries.find((item) => item.name === 'Windows 文件').localPath, 'C:\\Work\\report.txt');
});
