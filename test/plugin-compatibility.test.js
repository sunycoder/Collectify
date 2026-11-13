const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'),
    path = require('node:path'),
    os = require('node:os');
const { compatibility, validateCompatibility } = require('../src/plugin-system/compatibility');
const { readManifest } = require('../src/plugin-system/manifest');
const { PluginCatalog } = require('../src/plugin-system/catalog');
test('插件版本和平台不兼容时给出明确原因，兼容时不增加额外要求', () => {
    assert.match(
        compatibility({ minHostVersion: '5.6.0' }, { hostVersion: '5.5.3', platform: 'win32' }).compatibilityReason,
        /5.6.0/
    );
    assert.equal(
        compatibility({ minHostVersion: '5.6.0' }, { hostVersion: '5.6.0', platform: 'win32' }).compatible,
        true
    );
    assert.equal(
        compatibility({ platforms: ['win32'] }, { hostVersion: '5.6.0', platform: 'darwin' }).compatible,
        false
    );
    assert.equal(compatibility({}, { hostVersion: '5.6.0', platform: 'linux' }).compatible, true);
    assert.throws(() => validateCompatibility({ minHostVersion: 'latest' }), /格式/);
    assert.throws(() => validateCompatibility({ platforms: ['unknown'] }), /平台/);
});
test('离线安装前拒绝过高主程序版本，在线目录可列出但下载前拦截', async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'collectify-support-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.writeFileSync(path.join(root, 'index.html'), '<h1>hello</h1>');
    fs.writeFileSync(
        path.join(root, 'manifest.json'),
        JSON.stringify({
            id: 'test.future',
            name: '未来插件',
            description: '兼容性测试',
            version: '1.0.0',
            apiVersion: 1,
            entry: 'index.html',
            minHostVersion: '99.0.0',
            permissions: [],
            commands: [{ id: 'open', title: '打开' }]
        })
    );
    assert.throws(() => readManifest(root), /请先升级.*99.0.0/);
    let downloads = 0;
    const catalog = new PluginCatalog(
        { getSetting: () => '', plugins: new Map() },
        {
            fetcher: async () => {
                downloads++;
                throw Error('不应联网');
            }
        }
    );
    catalog.items = [{ id: 'test.future', version: '1.0.0', minHostVersion: '99.0.0' }];
    catalog.loaded = true;
    assert.equal(catalog.status().plugins[0].compatible, false);
    await assert.rejects(() => catalog.package('test.future'), /99.0.0/);
    assert.equal(downloads, 0);
});
