const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'),
    path = require('node:path'),
    os = require('node:os');
const { createHash } = require('node:crypto');
const { captureClipboard, writeSnapshot, filePaths, RAW_DROP } = require('../src/plugin-system/clipboard-formats');
const model = require('../src/plugin-library/clipboard-history/history-model');
const { PluginStorage } = require('../src/plugin-system/storage');
const snapshot = (text) => ({
    kind: 'text',
    text,
    bytes: Buffer.byteLength(text),
    fingerprint: createHash('sha256')
        .update('text\0' + text)
        .digest('hex')
});
function item(type, value) {
    return { types: [type], getType: async () => new Blob([value], { type }) };
}
test('文本、图片、文件捕获使用真实格式，采集中停用时不交付数据', async () => {
    const nativeImage = {
        createFromBuffer: () => ({ getSize: () => ({ width: 20, height: 10 }), isEmpty: () => false })
    };
    const capture = (value) =>
        captureClipboard({ clipboard: { read: async () => [value] }, nativeImage, allowed: () => true });
    assert.equal((await capture(item('text/plain', '中文'))).kind, 'text');
    const image = await capture(item('image/png', Buffer.from('PNGfixture')));
    assert.equal(image.kind, 'image');
    assert.equal(image.width, 20);
    assert.equal(image.bytes, 10);
    const files = await capture(item('text/uri-list', 'file:///D:/docs/test.txt\r\nfile:///D:/docs/second.png'));
    assert.equal(files.kind, 'files');
    assert.equal(files.files.length, 2);
    let allowed = true;
    await assert.rejects(
        () =>
            captureClipboard({
                clipboard: {
                    read: async () => {
                        allowed = false;
                        return [item('text/plain', 'private')];
                    }
                },
                nativeImage,
                allowed: () => allowed
            }),
        /停止/
    );
    await assert.rejects(() => capture(item('text/plain', 'x'.repeat(65537))), /64 KB/);
    await assert.rejects(() => capture(item('image/png', Buffer.alloc(4 * 1024 * 1024 + 1))), /4 MB/);
});
test('Windows 文件列表解析不读取文件原文，写回只允许受支持的剪贴板格式', async () => {
    const names = Buffer.from('D:\\docs\\a.txt\0D:\\docs\\b.txt\0\0', 'utf16le'),
        header = Buffer.alloc(20);
    header.writeUInt32LE(20, 0);
    header.writeUInt32LE(1, 16);
    assert.deepEqual(filePaths(RAW_DROP, Buffer.concat([header, names])), ['D:\\docs\\a.txt', 'D:\\docs\\b.txt']);
    assert.throws(() => filePaths(RAW_DROP, Buffer.alloc(2)), /损坏/);
    let copied;
    class TestItem {
        constructor(data) {
            this.data = data;
        }
    }
    await writeSnapshot(
        {
            clipboard: {
                write: async (data) => {
                    copied = data;
                }
            },
            ClipboardItem: TestItem
        },
        { kind: 'image', format: 'image/png', data: Buffer.from('PNG').toString('base64') }
    );
    assert.ok(copied[0].data['image/png'] instanceof Blob);
    await assert.rejects(
        () =>
            writeSnapshot(
                { clipboard: {}, ClipboardItem: TestItem },
                { kind: 'image', format: 'application/javascript', data: 'AAAA' }
            ),
        /格式/
    );
});
test('历史按内容去重并保留收藏，容量回收不删除收藏，图片按块保存', () => {
    let entries = [];
    const first = model.makeEntry(snapshot('first'));
    entries = model.insert(entries, first).items;
    entries[0].favorite = true;
    entries = model.insert(entries, model.makeEntry(snapshot('second'))).items;
    entries = model.insert(entries, model.makeEntry(snapshot('first'))).items;
    assert.equal(entries.length, 2);
    assert.equal(entries[0].favorite, true);
    assert.equal(model.filter(entries, 'favorites', 'first').length, 1);
    assert.equal(model.filter(entries, 'image', '').length, 0);
    const large = model.makeEntry({
        ...snapshot('large'),
        kind: 'image',
        data: 'x'.repeat(250000),
        width: 10,
        height: 10
    });
    assert.equal(large.chunks.length, 3);
    const many = Array.from({ length: 100 }, (_, index) => ({
        ...model.makeEntry(snapshot('old' + index)).meta,
        favorite: index === 0
    }));
    const plan = model.insert(many, model.makeEntry(snapshot('new')));
    assert.equal(plan.items.length, 100);
    assert.ok(plan.items.some((item) => item.id === many[0].id));
    assert.equal(plan.removed.length, 1);
    assert.throws(
        () =>
            model.insert(
                many.map((item) => ({ ...item, favorite: true })),
                model.makeEntry(snapshot('new'))
            ),
        /空间已满/
    );
});
test('图片分块和历史索引在同一个存储批次提交，超限失败后原数据不变', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'collectify-clip-storage-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const storage = new PluginStorage(root);
    storage.batch('test.clipboard', { set: { index: ['a'], blob: 'image' } });
    assert.deepEqual(storage.get('test.clipboard', 'index'), ['a']);
    storage.withDatabase('test.clipboard', (db) =>
        db.exec(
            "CREATE TRIGGER reject_image BEFORE INSERT ON plugin_values WHEN NEW.key='zblob' BEGIN SELECT RAISE(ABORT,'模拟图片落库失败'); END"
        )
    );
    assert.throws(
        () => storage.batch('test.clipboard', { set: { index: ['partial'], zblob: 'new image' }, delete: ['blob'] }),
        /模拟图片落库失败/
    );
    assert.deepEqual(storage.get('test.clipboard', 'index'), ['a']);
    assert.equal(storage.get('test.clipboard', 'blob'), 'image');
    assert.throws(
        () => storage.batch('test.clipboard', { set: { index: ['b'], blob: 'x'.repeat(300000) }, delete: ['blob'] }),
        /256 KB/
    );
    assert.equal(storage.get('test.clipboard', 'blob'), 'image');
    assert.deepEqual(storage.get('test.clipboard', 'index'), ['a']);
    storage.batch('test.clipboard', { set: { index: [] }, delete: ['blob'] });
    assert.equal(storage.get('test.clipboard', 'blob'), null);
});
test('旧文本历史升级使用相同内容指纹，复制旧内容不会产生两份记录', async () => {
    const old = await model.fromLegacy({ text: '旧文本', at: '2026-11-01T00:00:00.000Z' }),
        fresh = model.makeEntry(snapshot('旧文本'));
    assert.equal(old.meta.id, fresh.meta.id);
    const next = model.insert([old.meta], fresh);
    assert.equal(next.items.length, 1);
    assert.equal(next.items[0].preview, '旧文本');
});
