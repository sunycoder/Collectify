const { test } = require('node:test'),
    assert = require('node:assert/strict'),
    fs = require('node:fs'),
    path = require('node:path'),
    os = require('node:os');
const M = require('../src/plugin-library/diff/model'),
    W = require('../src/plugin-library/diff/vendor/compare-worker.cjs'),
    { create } = require('./support/diff-fixtures');
function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'collectify-diff-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    return { root, ...create(root) };
}
test('Diff 递归指纹区分同大小同时间内容、独有与类型冲突，目录累计子级差异', async (t) => {
    const f = fixture(t),
        value = await M.scan({ roots: f.roots }),
        rows = new Map(value.rows.map((r) => [r.relative, r]));
    assert.equal(rows.get('same.txt').state, 'same');
    assert.equal(rows.get('nested/changed.txt').state, 'changed');
    assert.equal(rows.get('nested').differences, 1);
    assert.equal(rows.get('removed.txt').state, 'left');
    assert.equal(rows.get('added.txt').state, 'right');
    assert.equal(rows.get('type').state, 'type');
    assert.equal(value.differences, 4);
    const before = value.cache;
    fs.writeFileSync(path.join(f.roots[1], 'nested/changed.txt'), 'CCCC');
    const next = await M.scan({ roots: f.roots, cache: before, force: true });
    assert.notEqual(
        next.rows.find((r) => r.relative === 'nested/changed.txt').right.hash,
        rows.get('nested/changed.txt').right.hash
    );
});
test('Diff 实际 Office 解析保留 Word 正文、Excel 值与公式和幻灯片文本位置', async (t) => {
    const f = fixture(t),
        doc = await W.parse(f.docxLeft);
    assert.match(doc.text, /合同：100/);
    assert.match(doc.text, /第二段/);
    assert.match(doc.text, /第二段 & 安全/);
    const book = await W.parse(f.xlsxLeft);
    assert.equal(book.sheets[0].name, 'Budget');
    assert.equal(book.sheets[0].rows[0][1].v, '100');
    assert.equal(book.sheets[0].rows[1][0].f, 'B1*2');
    const legacy = await W.parse(path.join(__dirname, 'fixtures/diff-sample.xls'));
    assert.equal(legacy.sheets[0].rows[1][1].v, '100');
    const slides = await W.parse(f.pptxRight);
    assert.match(slides.slides[0].text, /季度计划 120/);
    assert.equal(slides.slides[0].shapes[0].x, 600000);
    assert.equal(slides.width, 9144000);
});
test('Diff 报告转义不可信文本并保留差异，千行内容在有界时间内完成', async () => {
    const before = Array.from({ length: 1000 }, (_, i) => 'const line' + i + ' = ' + i + ';').join('\n'),
        after = before.replace('line500 = 500', 'line500 = 510');
    const start = performance.now();
    const result = await W.run({ action: 'report', data: { before, after, title: '<script>alert(1)</script>' } });
    assert.ok(result.report.parts.some((p) => p.added && p.value.includes('510')));
    assert.match(result.html, /&lt;script&gt;/);
    assert.ok(!result.html.includes('<script>'));
    assert.ok(performance.now() - start < 5000);
});
test('Diff 文件编码、大小和二进制边界明确，不截断成相同内容', async (t) => {
    const f = fixture(t);
    assert.equal(M.language('example.ts'), 'typescript');
    assert.equal(M.decode(Buffer.from([255, 254, 65, 0])), 'A');
    assert.throws(() => M.decode(Buffer.from([1, 0, 3])), /二进制/);
    const large = path.join(f.root, 'large.txt');
    const fd = fs.openSync(large, 'w');
    fs.ftruncateSync(fd, M.MAX_FILE + 1);
    fs.closeSync(fd);
    await assert.rejects(M.readFile(large), /32 MiB/);
});
test('Diff 延迟初始化、设置持久化、目录越界拒绝及取消停用不交付迟到结果', async (t) => {
    const f = fixture(t),
        file = path.join(f.root, 'data/data.sqlite');
    const backend = await require('../src/plugin-library/diff/backend').create({ file });
    t.after(() => backend.dispose());
    assert.equal(fs.existsSync(path.dirname(file)), false);
    assert.equal((await backend.call('state')).settings.language, 'auto');
    assert.equal(fs.existsSync(path.dirname(file)), false);
    await backend.call('settings', { language: 'java' });
    assert.equal((await backend.call('state')).settings.language, 'java');
    const reloaded = await require('../src/plugin-library/diff/backend').create({ file });
    assert.equal((await reloaded.call('state')).settings.language, 'java');
    await reloaded.dispose();
    await backend.call('import', { paths: f.roots });
    await assert.rejects(backend.call('file', { relative: '../before.js' }), /路径无效/);
    const pending = backend.call('scan');
    await backend.call('cancel');
    await assert.rejects(pending, /取消/);
    await backend.deactivate();
    await assert.rejects(backend.call('state'), /停用/);
    backend.activate();
    assert.equal((await backend.call('state')).settings.language, 'java');
});
test('Diff 错误文件不当作相同，二进制解析失败和资源失效均可识别', async (t) => {
    const f = fixture(t),
        backend = await require('../src/plugin-library/diff/backend').create({
            file: path.join(f.root, 'settings/data.sqlite')
        });
    t.after(() => backend.dispose());
    const unknown = path.join(f.root, 'bad.docx');
    fs.writeFileSync(unknown, Buffer.from([0, 1, 2]));
    await assert.rejects(backend.call('import', { paths: [unknown] }));
    assert.equal((await backend.resource('__resources/unknown')).status, 404);
    await backend.deactivate();
    assert.equal((await backend.resource('__resources/unknown')).status, 403);
});
