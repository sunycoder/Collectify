const { test } = require('node:test'),
    assert = require('node:assert/strict'),
    fs = require('node:fs'),
    os = require('node:os'),
    path = require('node:path');
const { Store } = require('../src/store');
const credentials = require('../src/credentials');
test('按用户要求明文保存，空密码可明确清除，保留开头结尾空白', async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'collectify-password-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'collectify.sqlite'),
        store = new Store(file);
    const input = await credentials.prepare({
        name: '账号',
        type: 'credential',
        username: 'u',
        password: '  sample  '
    });
    const entry = store.save(input);
    assert.equal(new Store(file).entries.find((e) => e.id === entry.id).password, '  sample  ');
    assert.equal(await credentials.passwordOf(entry), '  sample  ');
    assert.equal((await credentials.prepare({ name: '账号', type: 'credential', password: '' }, entry)).password, '');
    assert.equal((await credentials.prepare({ name: '账号', type: 'credential' }, entry)).password, '  sample  ');
});
test('含凭据 URL 拆分后保留可复制密码；各类资源均可附带账号密码', async () => {
    const entry = await credentials.prepare({ type: 'web', url: 'http://test:abc%20123@localhost:8080/' });
    assert.equal(entry.url, 'http://localhost:8080/');
    assert.equal(entry.username, 'test');
    assert.equal(entry.password, 'abc 123');
    const file = await credentials.prepare({
        type: 'file',
        username: 'old',
        password: 'secret',
        localPath: 'C:\\test.txt'
    });
    assert.equal(file.password, 'secret');
    assert.equal(file.username, 'old');
});
test('账号资料接受非网页参考地址，不要求可执行或可访问，保存重启及导入导出保持', async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'collectify-account-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'data.sqlite');
    const store = new Store(file, { defaultData: { version: 2, categories: [], entries: [] } });
    for (const url of ['svn://svn.example.com/project-svn', 'ssh://git@example.com/repo', '服务器 A 的数据库', '']) {
        const input = await credentials.prepare({
            type: 'credential',
            name: '资料' + store.entries.length,
            url,
            username: 'user',
            password: ' pass '
        });
        const saved = store.save(input);
        const reopened = new Store(file).entries.find((e) => e.id === saved.id);
        assert.equal(reopened.password, ' pass ');
        assert.equal(reopened.url, input.url);
    }
    const raw = store.snapshot();
    const other = new Store(path.join(dir, 'other.sqlite'), {
        defaultData: { version: 2, categories: [], entries: [] }
    });
    other.import(raw);
    assert.equal(other.entries.length, 4);
    assert.ok(other.entries.every((e) => e.password === ' pass '));
    store.save(
        await credentials.prepare({
            type: 'credential',
            name: '同名账号',
            url: 'svn://example.com/a',
            username: 'u',
            password: 'a'
        })
    );
    store.save(
        await credentials.prepare({
            type: 'credential',
            name: '同名账号',
            url: 'svn://example.com/b',
            username: 'u',
            password: 'b'
        })
    );
    other.import(store.snapshot());
    assert.equal(other.entries.filter((e) => e.name === '同名账号').length, 2, '导入不能把不同仓库的同名账号合并');
});
