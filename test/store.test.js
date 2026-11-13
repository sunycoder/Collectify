const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../src/store');
const entry = {
    name: '系统',
    environment: 'test',
    url: 'http://localhost:8090/',
    note: '中文备注',
    group: '测试',
    color: 'red',
    mode: 'internal'
};
function fixture(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-store-test-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return path.join(dir, 'collectify.sqlite');
}
test('新增和修改跨重启保存，删除不影响其他入口', (t) => {
    const file = fixture(t),
        store = new Store(file);
    const a = store.save(entry),
        b = store.save({ ...entry, environment: 'prod' });
    store.save({ ...a, note: '修改后的中文' });
    const reopened = new Store(file);
    assert.equal(reopened.entries.find((e) => e.id === a.id).note, '修改后的中文');
    reopened.remove(a.id);
    assert.ok(new Store(file).entries.some((e) => e.id === b.id));
    assert.ok(!new Store(file).entries.some((e) => e.id === a.id));
});
test('危险协议及地址内凭据拒绝，磁盘不改变', (t) => {
    const file = fixture(t),
        store = new Store(file),
        before = fs.readFileSync(file, 'utf8');
    for (const url of ['javascript:alert(1)', 'file:///etc/passwd', 'https://user:secret@example.com/', 'invalid'])
        assert.throws(() => store.save({ ...entry, url }));
    assert.equal(fs.readFileSync(file, 'utf8'), before);
});
test('JSON 导入完整校验后事务写入，重复导入幂等且重新分配会话 ID', (t) => {
    const file = fixture(t),
        store = new Store(file),
        before = store.snapshot();
    const raw = {
        version: 2,
        categories: [{ id: 'external', name: '外部分类' }],
        entries: [{ ...entry, id: 'foreign-session', categoryId: 'external' }]
    };
    assert.throws(() =>
        store.import({
            ...raw,
            entries: [...raw.entries, { ...raw.entries[0], id: 'invalid-url', url: 'javascript:bad' }]
        })
    );
    assert.deepEqual(store.snapshot(), before);
    assert.equal(store.import(raw), 1);
    assert.notEqual(store.entries.at(-1).id, 'foreign-session');
    assert.equal(store.import(raw), 0);
});
test('坏配置启动拒绝且保留原始文件', (t) => {
    const file = fixture(t);
    fs.writeFileSync(file, '{bad config', 'utf8');
    assert.throws(() => new Store(file));
    assert.equal(fs.readFileSync(file, 'utf8'), '{bad config');
});
test('分类可独立保存、重命名、排序，重复名称拒绝且不丢数据', (t) => {
    const file = fixture(t),
        store = new Store(file);
    const category = store.saveCategory({ name: '监控', color: 'blue', icon: 'chart' });
    store.saveCategory({ ...category, name: '线上监控' });
    assert.equal(new Store(file).categories.find((c) => c.id === category.id).name, '线上监控');
    const before = fs.readFileSync(file, 'utf8');
    assert.throws(() => store.saveCategory({ name: 'GM' }));
    assert.equal(fs.readFileSync(file, 'utf8'), before);
    const ids = store.categories.map((c) => c.id).reverse();
    store.reorder('categories', ids);
    assert.deepEqual(
        new Store(file).categories.map((c) => c.id),
        ids
    );
});
test('删除分类原子转移所有收藏，收藏 ID 与最近打开记录保持', (t) => {
    const store = new Store(fixture(t));
    const category = store.saveCategory({ name: '监控' });
    const bookmark = store.save({ ...entry, categoryId: category.id });
    store.markOpened(bookmark.id);
    const opened = store.entries.find((e) => e.id === bookmark.id).lastOpened;
    assert.ok(opened > 0);
    assert.throws(() => store.removeCategory(category.id, 'missing'));
    assert.ok(store.categories.some((c) => c.id === category.id));
    store.removeCategory(category.id, 'inbox');
    const moved = store.entries.find((e) => e.id === bookmark.id);
    assert.equal(moved.categoryId, 'inbox');
    assert.equal(moved.lastOpened, opened);
    assert.throws(() => store.removeCategory('inbox', 'gm'));
});
test('收藏环境可选，跨分类移动和完整排序持久化，失效排序拒绝', (t) => {
    const file = fixture(t),
        store = new Store(file);
    const bookmark = store.save({ name: '构建平台', url: 'http://localhost:8080/', categoryId: 'jenkins' });
    assert.equal(bookmark.environment, '');
    store.save({ ...bookmark, categoryId: 'gm' });
    const ids = store.entries.map((e) => e.id).reverse();
    store.reorder('entries', ids);
    assert.deepEqual(
        new Store(file).entries.map((e) => e.id),
        ids
    );
    assert.equal(new Store(file).entries.find((e) => e.id === bookmark.id).categoryId, 'gm');
    assert.throws(() => store.reorder('entries', [ids[0]]));
    assert.throws(() => store.save({ ...bookmark, categoryId: 'missing' }));
});
test('新版导入保留空分类，按分类和网址去重，重新分配会话 ID', (t) => {
    const store = new Store(fixture(t));
    const incoming = {
        version: 2,
        categories: [{ id: 'foreign', name: '外部收藏', color: 'blue', icon: 'book' }],
        entries: [{ ...entry, id: 'foreign-session', categoryId: 'foreign', lastOpened: 10 }]
    };
    assert.equal(store.import(incoming), 1);
    const imported = store.entries.at(-1);
    assert.notEqual(imported.id, 'foreign-session');
    assert.equal(imported.lastOpened, 0);
    assert.notEqual(imported.categoryId, 'foreign');
    assert.equal(store.import(incoming), 0);
    assert.equal(store.import({ version: 2, categories: [{ id: 'empty', name: '空分类' }], entries: [] }), 0);
    assert.ok(store.categories.some((c) => c.name === '空分类'));
});
