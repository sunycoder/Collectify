const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'),
    path = require('node:path'),
    os = require('node:os');
const { buildCatalog } = require('../scripts/build-plugin-catalog.cjs');
const { publish } = require('../scripts/publish-plugins.cjs');
const { PluginPackages, sha256 } = require('../src/plugin-system/package');
const { PluginCatalog, DEFAULT_CATALOG_URL } = require('../src/plugin-system/catalog');
function fixture(t, all = false) {
    const output = fs.mkdtempSync(path.join(os.tmpdir(), 'collectify-release-test-'));
    t.after(() => fs.rmSync(output, { recursive: true, force: true }));
    const result = buildCatalog({ output, check: true });
    return all
        ? result
        : { ...result, plugins: result.plugins.slice(0, 1), tag: 'plugin-collectify.clipboard-history-v2.1.1' };
}
test('官方目录可重现构建，程序包身份、大小和校验值完全匹配', (t) => {
    const built = fixture(t, true),
        checker = new PluginPackages(null, path.join(built.output, 'check'));
    assert.equal(built.plugins.length, 2);
    assert.equal(built.plugins[0].id, 'collectify.clipboard-history');
    for (const item of built.plugins) {
        const filename = path.basename(new URL(item.url).pathname),
            data = fs.readFileSync(path.join(built.output, filename));
        assert.equal(data.length, item.size);
        assert.equal(sha256(data), item.sha256);
        const prepared = checker.prepare(data, item);
        assert.ok(prepared.manifest.iconAsset.endsWith('.svg'));
        checker.cleanup(prepared);
    }
    const before = fs.readFileSync(path.join(built.output, 'catalog.json'), 'utf8');
    buildCatalog({ output: built.output, check: true });
    assert.equal(fs.readFileSync(path.join(built.output, 'catalog.json'), 'utf8'), before);
});
test('发布先上传附件再公开草稿，重复执行不覆盖已发布程序', async (t) => {
    const built = fixture(t),
        commands = [];
    await publish({
        build: () => built,
        run: (args) => {
            commands.push(args);
            return { status: 0, stdout: args[0] === 'api' ? '[]' : '' };
        }
    });
    assert.deepEqual(
        commands.map((c) => c.slice(0, 2)),
        [
            ['api', `repos/${built.repository}/releases?per_page=100`],
            ['release', 'create'],
            ['release', 'upload'],
            ['release', 'edit']
        ]
    );
    assert.ok(commands[1].includes('--draft'));
    assert.ok(!commands.flat().includes('--clobber'));
    const item = built.plugins[0],
        assets = [
            { id: 1, name: path.basename(new URL(item.url).pathname), size: item.size, digest: `sha256:${item.sha256}` }
        ],
        second = [];
    await publish({
        build: () => built,
        run: (args) => {
            second.push(args);
            return { status: 0, stdout: JSON.stringify([{ tag_name: built.tag, draft: false, assets }]) };
        }
    });
    assert.equal(second.length, 1);
});
test('发布失败不公开草稿，已有同版本不同内容时拒绝覆盖', async (t) => {
    const built = fixture(t),
        commands = [];
    await assert.rejects(
        () =>
            publish({
                build: () => built,
                run: (args) => {
                    commands.push(args);
                    return args[1] === 'upload'
                        ? { status: 1, stderr: '模拟上传失败' }
                        : { status: 0, stdout: args[0] === 'api' ? '[]' : '' };
                }
            }),
        /上传失败/
    );
    assert.ok(!commands.some((args) => args[1] === 'edit'));
    const item = built.plugins[0];
    await assert.rejects(
        () =>
            publish({
                build: () => built,
                run: () => ({
                    status: 0,
                    stdout: JSON.stringify([
                        {
                            tag_name: built.tag,
                            draft: false,
                            assets: [{ id: 1, name: path.basename(new URL(item.url).pathname), size: item.size }]
                        }
                    ])
                }),
                fetcher: async () => new Response('wrong')
            }),
        /不一致/
    );
});
test('新用户和原空地址用户使用官方目录，第三方源保留并可恢复官方源', () => {
    let stored = '';
    const registry = {
        getSetting: () => stored,
        setSetting: (_key, value) => {
            stored = value;
        },
        plugins: new Map()
    };
    const catalog = new PluginCatalog(registry);
    assert.equal(catalog.source, DEFAULT_CATALOG_URL);
    catalog.configure('https://example.com/catalog.json');
    assert.equal(new PluginCatalog(registry).source, 'https://example.com/catalog.json');
    catalog.configure('');
    assert.equal(catalog.source, DEFAULT_CATALOG_URL);
    assert.equal(stored, DEFAULT_CATALOG_URL);
});
