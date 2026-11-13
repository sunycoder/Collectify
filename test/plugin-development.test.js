const { test } = require('node:test'),
    assert = require('node:assert/strict');
const fs = require('node:fs'),
    path = require('node:path'),
    os = require('node:os');
const { PluginRegistry } = require('../src/plugin-system/registry');
const { PluginDevelopment, filesIn, digest } = require('../src/plugin-system/development');
const { readPluginClipboard } = require('../src/plugin-system/clipboard-access');
const { pluginUrl } = require('../src/plugin-system/manifest');
function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'collectify-development-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const registry = new PluginRegistry({
        builtinRoot: path.resolve(__dirname, '../src/plugins'),
        userRoot: path.join(root, 'packages'),
        dataRoot: path.join(root, 'data'),
        hostFile: path.join(root, 'host.sqlite')
    });
    const installed = [];
    const service = new PluginDevelopment({
        registry,
        root: path.join(root, 'drafts'),
        templatesRoot: path.resolve(__dirname, '../src/plugin-templates'),
        installed: async (id) => {
            installed.push(id);
            return { opened: false };
        },
        setEnabled: async (id, value) => registry.setEnabled(id, value),
        runtimeStatus: (id) => ({ id, state: 'not-open' })
    });
    return { root, registry, service, installed };
}
const create = (service, pluginId = 'example.demo', template = 'basic') =>
    service.create({ pluginId, name: '自有插件', description: '开发验证', template });
test('SDK 合同、模板、UTF-8 批次写入、分页读取与 revision 冲突', (t) => {
    const { service } = fixture(t),
        draft = create(service);
    assert.ok(service.sdk().permissions.includes('clipboard.read'));
    assert.ok(service.sdk().templates.some((p) => p.id === 'clipboard-history'));
    const text = '// 中文注释\nconst value="你好";';
    const updated = service.write({
        draftId: draft.draftId,
        expectedRevision: 1,
        files: [{ path: 'app.js', content: text }]
    });
    assert.equal(updated.revision, 2);
    assert.equal(service.readFile(draft.draftId, 'app.js').content, text);
    assert.equal(service.readFile(draft.draftId, 'app.js', 0, 5).nextOffset, 5);
    assert.throws(
        () =>
            service.write({
                draftId: draft.draftId,
                expectedRevision: 1,
                files: [{ path: 'app.js', content: 'lost' }]
            }),
        /已被修改/
    );
    assert.equal(service.readFile(draft.draftId, 'app.js').content, text);
});
test('草稿拒绝越界、保留文件、符号链接和大批次，拒绝后原文件与 revision 不变', (t) => {
    const { root, service } = fixture(t),
        draft = create(service),
        outside = path.join(root, 'outside');
    fs.mkdirSync(outside);
    for (const file of ['../outside.txt', 'C:/escape.js', 'folder\\escape.js', 'con.txt', '.hidden.js'])
        assert.throws(() =>
            service.write({ draftId: draft.draftId, expectedRevision: 1, files: [{ path: file, content: 'no' }] })
        );
    assert.throws(
        () =>
            service.write({
                draftId: draft.draftId,
                expectedRevision: 1,
                files: [{ path: 'large.js', content: 'x'.repeat(65537) }]
            }),
        /64 KB/
    );
    const pkg = service.read(draft.draftId).pkg;
    fs.symlinkSync(outside, path.join(pkg, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(
        () =>
            service.write({
                draftId: draft.draftId,
                expectedRevision: 1,
                files: [{ path: 'link/escape.js', content: 'blocked' }]
            }),
        /链接/
    );
    assert.equal(fs.existsSync(path.join(outside, 'escape.js')), false);
    fs.unlinkSync(path.join(pkg, 'link'));
    assert.equal(service.get(draft.draftId).revision, 1);
    assert.throws(() => service.readFile(draft.draftId, '../draft.json'), /路径/);
    assert.throws(() => service.get('../outside'), /ID/);
});
test('校验不执行 JS，能报告语法、CSP、资源引用和草稿身份问题', async (t) => {
    const { root, service } = fixture(t),
        draft = create(service),
        effect = path.join(root, 'should-not-exist');
    service.write({
        draftId: draft.draftId,
        expectedRevision: 1,
        files: [{ path: 'app.js', content: `require('node:fs').writeFileSync(${JSON.stringify(effect)},'bad');` }]
    });
    const compiled = await service.validate(draft.draftId, 2);
    assert.equal(compiled.valid, true);
    assert.equal(fs.existsSync(effect), false);
    service.write({
        draftId: draft.draftId,
        expectedRevision: 2,
        files: [
            { path: 'app.js', content: 'const x = ;' },
            { path: 'index.html', content: '<script src="missing.js"></script><button onclick="alert(1)">x</button>' }
        ]
    });
    const invalid = await service.validate(draft.draftId, 3);
    assert.equal(invalid.valid, false);
    assert.equal(invalid.validationToken, null);
    assert.ok(invalid.issues.some((i) => i.file === 'app.js'));
    assert.ok(invalid.issues.some((i) => /资源/.test(i.message)));
    assert.ok(invalid.issues.some((i) => /内联/.test(i.message)));
});
test('安装必须使用同一份校验结果；后续写入、直接改文件或默认插件覆盖均被拒绝', async (t) => {
    const { service, registry } = fixture(t),
        draft = create(service);
    const checked = await service.validate(draft.draftId, 1);
    assert.equal(checked.valid, true, JSON.stringify(checked.issues));
    service.write({ draftId: draft.draftId, expectedRevision: 1, files: [{ path: 'app.js', content: '// updated' }] });
    await assert.rejects(
        service.install({ draftId: draft.draftId, expectedRevision: 1, validationToken: checked.validationToken }),
        /校验/
    );
    const next = await service.validate(draft.draftId, 2);
    fs.writeFileSync(path.join(service.read(draft.draftId).pkg, 'app.js'), '// changed outside');
    await assert.rejects(
        service.install({ draftId: draft.draftId, expectedRevision: 2, validationToken: next.validationToken }),
        /校验/
    );
    assert.equal(registry.plugins.has('example.demo'), false);
    assert.throws(() => create(service, 'collectify.tasks'), /默认/);
});
test('创建、校验、安装与更新保留数据；并发草稿不覆盖新安装的程序', async (t) => {
    const { service, registry, installed } = fixture(t),
        first = create(service);
    const check = await service.validate(first.draftId, 1);
    await service.install({
        draftId: first.draftId,
        expectedRevision: 1,
        validationToken: check.validationToken,
        open: false
    });
    assert.equal(registry.get('example.demo').enabled, true);
    assert.equal(installed.length, 1);
    registry.storage.set('example.demo', 'keep', 'data');
    const a = create(service),
        b = create(service);
    assert.equal(a.manifest.version, '1.0.1');
    service.write({ draftId: a.draftId, expectedRevision: 1, files: [{ path: 'app.js', content: '// draft A' }] });
    const va = await service.validate(a.draftId, 2),
        vb = await service.validate(b.draftId, 1);
    await service.install({
        draftId: a.draftId,
        expectedRevision: 2,
        validationToken: va.validationToken,
        open: false
    });
    await assert.rejects(
        service.install({ draftId: b.draftId, expectedRevision: 1, validationToken: vb.validationToken, open: false }),
        /最新插件/
    );
    assert.equal(registry.storage.get('example.demo', 'keep'), 'data');
    assert.equal(registry.get('example.demo').version, '1.0.1');
});
test('写入中断恢复旧包，提交完成后恢复保留新包，删除草稿不卸载程序', async (t) => {
    const { service, registry } = fixture(t),
        draft = create(service),
        before = service.readFile(draft.draftId, 'app.js').content,
        p = service.read(draft.draftId);
    fs.renameSync(p.pkg, p.previous);
    fs.cpSync(p.previous, p.pkg, { recursive: true });
    fs.writeFileSync(path.join(p.pkg, 'app.js'), '// partial');
    assert.equal(service.readFile(draft.draftId, 'app.js').content, before);
    service.write({
        draftId: draft.draftId,
        expectedRevision: 1,
        files: [{ path: 'app.js', content: '// committed' }]
    });
    const next = service.read(draft.draftId);
    fs.cpSync(next.pkg, next.previous, { recursive: true });
    assert.equal(digest(filesIn(next.pkg)), next.meta.contentDigest);
    assert.equal(service.get(draft.draftId).revision, 2);
    const checked = await service.validate(draft.draftId, 2);
    await service.install({
        draftId: draft.draftId,
        expectedRevision: 2,
        validationToken: checked.validationToken,
        open: false
    });
    assert.equal(service.discard(draft.draftId, 2).discarded, true);
    assert.equal(registry.get('example.demo').enabled, true);
});
test('前台剪贴板读取在隐藏或异步期间离开时拒绝，空文本和容量边界明确', async () => {
    let allowed = false,
        reads = 0;
    const readText = async () => {
        reads++;
        return 'sample';
    };
    await assert.rejects(readPluginClipboard({ allowed: () => allowed, readText }), /未显示/);
    assert.equal(reads, 0);
    allowed = true;
    assert.equal(await readPluginClipboard({ allowed: () => allowed, readText }), 'sample');
    assert.equal(await readPluginClipboard({ allowed: () => true, readText: async () => '' }), '');
    await assert.rejects(
        readPluginClipboard({ allowed: () => true, readText: async () => 'x'.repeat(65537) }),
        /64 KB/
    );
    await assert.rejects(
        readPluginClipboard({
            allowed: () => allowed,
            readText: async () => {
                allowed = false;
                return 'hidden';
            }
        }),
        /未显示/
    );
});
test('UTF-8 页面入口编码与资源解码一致，空格、中文和百分号不会导致 SDK 来源误判', () => {
    const entry = '目录/主页 %.html',
        url = pluginUrl({ id: 'example.unicode', entry });
    assert.equal(decodeURIComponent(new URL(url).pathname.slice(1)), entry);
    assert.match(url, /%20/);
    assert.match(url, /%25/);
    assert.equal(
        pluginUrl({ id: 'example.ascii', entry: 'index.html' }),
        'collectify-plugin://example.ascii/index.html'
    );
});
