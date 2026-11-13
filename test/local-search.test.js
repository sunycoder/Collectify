const { test } = require('node:test'),
    assert = require('node:assert/strict'),
    fs = require('node:fs'),
    os = require('node:os'),
    path = require('node:path');
const { FILTERS, preferences, matches, csv, queryText } = require('../src/plugins/local-search/model');
const { SearchEngine, folderSearch } = require('../src/plugins/local-search/engine');
const { PreviewService } = require('../src/plugins/local-search/preview');
const fixtures = path.join(__dirname, 'fixtures', 'local-search');
function temporary(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'collectify-search-test-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return dir;
}
test('分类明确区分 TypeScript 与视频，关键词不作为搜索表达式或命令执行', () => {
    const video = FILTERS.find((entry) => entry.id === 'video');
    assert.equal(matches({ path: 'D:\\code\\index.ts', directory: false }, '', video), false);
    assert.equal(matches({ path: 'D:\\video.mp4', directory: false }, '', video), true);
    const regex = new RegExp(queryText('hello (test)', video), 'i');
    assert.ok(regex.test('C:\\hello (test).mp4'));
    assert.ok(!regex.test('C:\\hello test.mp4'));
    assert.deepEqual(csv('Filename,Size\r\n"C:\\hello,世界.txt",12\r\n')[1], ['C:\\hello,世界.txt', '12']);
    const settings = preferences({
        filters: [
            { id: 'custom-design', label: '设计', extensions: ['psd'], enabled: true },
            ...FILTERS.map((entry) => ({ ...entry, enabled: false }))
        ]
    });
    assert.equal(settings.filters.find((entry) => entry.id === 'all').enabled, true);
    assert.ok(settings.filters.some((entry) => entry.id === 'custom-design'));
});
test('文件夹搜索按范围过滤、排序和分页，取消后不返回结果', async (t) => {
    const root = temporary(t);
    fs.mkdirSync(path.join(root, 'nested'));
    for (let i = 0; i < 160; i++) fs.writeFileSync(path.join(root, `file-${i}.txt`), 'data');
    fs.writeFileSync(path.join(root, 'nested', '图片.png'), 'image');
    const all = await folderSearch([root], { query: 'file-', filter: FILTERS[0], sort: 'name' });
    assert.equal(all.total, 160);
    assert.equal(all.items.length, 150);
    const page = await folderSearch([root], { query: 'file-', filter: FILTERS[0], offset: 150 });
    assert.equal(page.items.length, 10);
    const images = await folderSearch([root], { filter: FILTERS.find((entry) => entry.id === 'image') });
    assert.equal(images.items.length, 1);
    const abort = new AbortController();
    abort.abort();
    await assert.rejects(folderSearch([root], { signal: abort.signal }), /取消/);
});
test('真实文档解析：XLSX/CSV/DOCX/PSD、纯文本、PDF兼容 AI 与媒体票据', async (t) => {
    const service = new PreviewService(new SearchEngine(temporary(t)));
    t.after(() => service.dispose());
    const sheet = await service.preview(path.join(fixtures, 'sample.xlsx'));
    assert.equal(sheet.kind, 'table');
    assert.equal(sheet.rows[1][0], '测试');
    assert.equal(sheet.rows[1][1], '3');
    assert.equal((await service.preview(path.join(fixtures, 'table.csv'))).kind, 'table');
    const legacySheet = await service.preview(path.join(fixtures, 'sample.xls'));
    assert.equal(legacySheet.kind, 'table');
    assert.equal(legacySheet.rows[1][0], '测试');
    const word = await service.preview(path.join(fixtures, 'sample.docx'));
    assert.equal(word.kind, 'text');
    assert.match(word.text, /文档预览测试/);
    const psd = await service.preview(path.join(fixtures, 'sample.psd'));
    assert.equal(psd.kind, 'image');
    assert.match(psd.url, /^data:image\/png;base64/);
    const text = await service.preview(path.join(fixtures, 'readme.txt'));
    assert.equal(text.kind, 'text');
    assert.match(text.text, /<script>/);
    assert.equal((await service.preview(path.join(fixtures, 'sample.ai'))).kind, 'pdf');
    assert.equal((await service.preview(path.join(fixtures, 'sample.wav'))).kind, 'audio');
});
test('资源票据只读与范围请求，过期或未签发的票据拒绝读取', async (t) => {
    const service = new PreviewService(new SearchEngine(temporary(t)));
    t.after(() => service.dispose());
    const preview = await service.preview(path.join(fixtures, 'readme.txt'));
    assert.equal(preview.kind, 'text');
    const url = service.link(path.join(fixtures, 'sample.wav'), 'audio/wav'),
        relative = new URL(url).pathname.slice(1);
    const response = await service.resource(relative, new Request(url, { headers: { Range: 'bytes=0-3' } }));
    assert.equal(response.status, 206);
    assert.equal(Buffer.from(await response.arrayBuffer()).toString(), 'RIFF');
    assert.equal(
        (await service.resource(relative, new Request(url, { headers: { Range: 'bytes=999999-' } }))).status,
        416
    );
    assert.equal((await service.resource('__resources/../../secret', new Request(url))).status, 404);
    service.dispose();
    assert.equal((await service.resource(relative, new Request(url))).status, 404);
});
test('压缩包只列目录，不解压到本机；无效文档返回可理解结果', async (t) => {
    const root = temporary(t),
        service = new PreviewService(new SearchEngine(root));
    t.after(() => service.dispose());
    if (process.platform === 'win32')
        for (const name of ['sample.zip', 'sample.gz', 'sample.7z']) {
            const result = await service.preview(path.join(fixtures, name));
            assert.equal(result.kind, 'archive', result.message);
            assert.ok(result.rows.length);
        }
    const bad = path.join(root, 'bad.docx');
    fs.writeFileSync(bad, 'broken');
    const result = await service.preview(bad);
    assert.equal(result.kind, 'metadata');
    assert.ok(result.message);
});
test('后台只允许访问已展示的搜索结果，偏好重启保持，停用后撤销资源', async (t) => {
    const root = temporary(t),
        opened = [];
    const electron = {
        dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [fixtures] }) },
        shell: {
            openPath: async (file) => {
                opened.push(file);
                return '';
            },
            showItemInFolder: (file) => opened.push(file)
        },
        nativeImage: {}
    };
    const backend = await require('../src/plugins/local-search/backend').create(
        { file: path.join(root, 'data.sqlite') },
        { electron }
    );
    const state = await backend.call('state');
    assert.equal(backend.navigation().length, 11);
    assert.ok(backend.navigation().every((item) => item.icon));
    await backend.call('settings', { ...state.settings, preview: false });
    await backend.call('choose-folder');
    const result = await backend.call('search', { query: 'readme', filter: 'all' });
    assert.ok(result.items.length);
    await assert.rejects(backend.call('preview', { id: 'C:\\private.txt' }), /结果已更新/);
    await backend.call('open', { id: result.items[0].id });
    assert.ok(opened[0].startsWith(fixtures));
    const reopened = await require('../src/plugins/local-search/backend').create(
        { file: path.join(root, 'data.sqlite') },
        { electron }
    );
    assert.equal((await reopened.call('state')).settings.preview, false);
    await backend.deactivate();
    await assert.rejects(backend.call('preview', { id: result.items[0].id }), /结果已更新/);
    await reopened.dispose();
});
test('源码目录安装识别真实默认目录，拒绝冒充 ID 的外部原生目录并给出清晰原因', (t) => {
    const { builtinSource, assertPageSource } = require('../src/plugin-system/source-install');
    const directory = path.resolve(__dirname, '../src/plugins/local-search');
    const registry = { defaults: () => [{ id: 'collectify.local-search', directory }] };
    assert.equal(builtinSource(directory, registry).id, 'collectify.local-search');
    const copy = temporary(t);
    fs.writeFileSync(
        path.join(copy, 'manifest.json'),
        JSON.stringify({ id: 'collectify.local-search', name: '本地搜索', backend: 'backend.js' })
    );
    assert.equal(builtinSource(copy, registry), null);
    assert.throws(() => assertPageSource(copy), /原生后台.*不能通过页面插件入口安装/);
    assert.throws(() => require('../src/plugin-system/package').collectFiles(directory), /原生后台/);
});
