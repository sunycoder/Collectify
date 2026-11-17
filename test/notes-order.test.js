const { test } = require('node:test'),
    assert = require('node:assert/strict'),
    fs = require('node:fs'),
    os = require('node:os'),
    path = require('node:path');
test('便签手动顺序编辑重启不跳位，移动和备份往返保留，旧备份兼容', async (t) => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-order-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    const context = {
        file: path.join(directory, 'data.sqlite'),
        emptyInitialData: true,
        getSettings: () => ({}),
        changed: () => {}
    };
    const backend = await require('../src/plugins/notes/backend').create(context);
    const a = await backend.call('note-save', {
            title: 'A'.repeat(120),
            content: '正文'.repeat(10000),
            color: 'yellow'
        }),
        b = await backend.call('note-save', { title: 'B', content: '', color: 'blue' });
    await backend.call('note-sort', 'manual');
    await backend.call('note-move', { id: a.id, before: b.id });
    await backend.call('note-save', { ...a, title: '修改A' });
    assert.deepEqual(
        (await backend.call('state')).notes.map((n) => n.id),
        [a.id, b.id]
    );
    const reopened = await require('../src/plugins/notes/backend').create(context);
    assert.equal((await reopened.call('state')).noteSort, 'manual');
    assert.deepEqual(
        reopened.exportData().notes.map((n) => n.id),
        [a.id, b.id]
    );
    const exported = reopened.exportData();
    reopened.importData(reopened.planData(exported, 'replace'));
    assert.equal((await reopened.call('state')).noteSort, 'manual');
    assert.throws(() => reopened.planData({ ...exported, noteSort: 'invalid' }), /排序/);
    reopened.importData(reopened.planData({ schemaVersion: 1, notes: exported.notes }, 'replace'));
    assert.equal((await reopened.call('state')).noteSort, 'manual');
    await assert.rejects(reopened.call('note-move', { id: 'missing', before: b.id }), /目标/);
});
