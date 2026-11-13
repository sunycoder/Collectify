const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'),
    path = require('node:path'),
    os = require('node:os');
const { PluginRegistry } = require('../src/plugin-system/registry');
const { PluginPackages, encodeZip, decodeZip, sha256, collectFiles } = require('../src/plugin-system/package');
const { PluginCatalog, download, validateCatalog, compareVersion } = require('../src/plugin-system/catalog');
const { PluginServices } = require('../src/plugin-system/services');
function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'collectify-package-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const options = {
        builtinRoot: path.resolve(__dirname, '../src/plugins'),
        userRoot: path.join(root, 'packages'),
        dataRoot: path.join(root, 'data'),
        hostFile: path.join(root, 'host.sqlite')
    };
    const registry = new PluginRegistry(options),
        packages = new PluginPackages(registry, path.join(root, 'staging'));
    return { root, options, registry, packages };
}
function archive({ id = 'example.package', version = '1.0.0', extra = [] } = {}) {
    const manifest = {
        id,
        name: '示例插件',
        description: '独立分发测试',
        version,
        apiVersion: 1,
        entry: 'index.html',
        permissions: ['storage'],
        commands: [{ id: 'open', title: '打开' }]
    };
    return encodeZip([
        { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest)) },
        { name: 'index.html', data: Buffer.from('<h1>你好</h1>') },
        ...extra
    ]);
}
function record(data, changes = {}) {
    return {
        id: 'example.package',
        name: '示例插件',
        description: '目录测试',
        version: '1.0.0',
        apiVersion: 1,
        size: data.length,
        sha256: sha256(data),
        url: 'https://plugins.example/package.collectify-plugin',
        ...changes
    };
}

test('插件包导入、更新、停用保持、导出与重装保留数据，包中不夹带用户数据', (t) => {
    const { registry, packages } = fixture(t),
        install = (data) => {
            const prepared = packages.prepare(data);
            try {
                return registry.install(prepared.directory, prepared.manifest);
            } finally {
                packages.cleanup(prepared);
            }
        };
    install(archive());
    registry.storage.set('example.package', 'private', '用户隐私');
    registry.setEnabled('example.package', false);
    install(archive({ version: '1.1.0' }));
    assert.equal(registry.get('example.package').version, '1.1.0');
    assert.equal(registry.get('example.package').enabled, false);
    const exported = packages.export('example.package');
    assert.equal(decodeZip(exported).length, 2);
    assert.ok(!exported.includes(Buffer.from('用户隐私')));
    registry.uninstall('example.package');
    install(exported);
    assert.equal(registry.storage.get('example.package', 'private'), '用户隐私');
    assert.deepEqual(fs.readdirSync(packages.root), []);
});
test('默认插件卸载跨重启保留、恢复数据；彻底删除只影响自己的数据库', (t) => {
    const { registry, options } = fixture(t);
    registry.storage.set('collectify.json', 'keep', 123);
    registry.storage.set('collectify.timestamp', 'keep', 456);
    registry.uninstall('collectify.json');
    const reopened = new PluginRegistry(options);
    assert.ok(!reopened.plugins.has('collectify.json'));
    assert.ok(reopened.availableDefaults().some((p) => p.id === 'collectify.json'));
    reopened.restore('collectify.json');
    assert.equal(reopened.get('collectify.json').enabled, true);
    assert.equal(reopened.storage.get('collectify.json', 'keep'), 123);
    reopened.uninstall('collectify.json', { deleteData: true });
    assert.ok(!fs.existsSync(path.dirname(reopened.storage.file('collectify.json'))));
    assert.equal(reopened.storage.get('collectify.timestamp', 'keep'), 456);
    reopened.restore('collectify.json');
    assert.equal(reopened.storage.get('collectify.json', 'keep'), null);
});
test('保留卸载记录的原生默认插件仍不能被外部页面包冒充', (t) => {
    const { registry, packages } = fixture(t);
    registry.uninstall('collectify.tasks');
    const prepared = packages.prepare(archive({ id: 'collectify.tasks' }));
    try {
        assert.throws(() => registry.install(prepared.directory), /内置/);
    } finally {
        packages.cleanup(prepared);
    }
    assert.ok(!registry.plugins.has('collectify.tasks'));
});
test('包拒绝篡改、穿透、大小写重复、符号链接、未来 API 和下载身份不符，不改变已有程序', (t) => {
    const { registry, packages } = fixture(t),
        good = archive(),
        prepared = packages.prepare(good);
    registry.install(prepared.directory);
    packages.cleanup(prepared);
    const corrupt = Buffer.from(good);
    corrupt[40] ^= 1;
    assert.throws(() => packages.prepare(corrupt));
    assert.throws(() => encodeZip([{ name: '../outside.html', data: Buffer.from('x') }]), /路径/);
    assert.throws(() => encodeZip([{ name: 'CON.html', data: Buffer.from('x') }]), /路径/);
    assert.throws(() => packages.prepare(archive({ extra: [{ name: 'INDEX.html', data: Buffer.from('x') }] })), /重复/);
    const link = Buffer.from(good),
        central = link.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    link.writeUInt32LE(0xa1ff0000, central + 38);
    assert.throws(() => packages.prepare(link), /链接/);
    const future = decodeZip(good),
        manifest = JSON.parse(future[0].data);
    manifest.apiVersion = 99;
    future[0].data = Buffer.from(JSON.stringify(manifest));
    assert.throws(() => packages.prepare(encodeZip(future)), /API/);
    assert.throws(() => packages.prepare(good, record(good, { id: 'wrong.identity' })), /ID/);
    assert.throws(() => packages.prepare(good, record(good, { sha256: '0'.repeat(64) })), /SHA-256/);
    assert.equal(registry.get('example.package').version, '1.0.0');
    assert.deepEqual(fs.readdirSync(packages.root), []);
});
test('解压前后限制阻止压缩炸弹、文件区域重叠和文件目录冲突', () => {
    assert.throws(
        () => decodeZip(archive({ extra: [{ name: 'large.txt', data: Buffer.alloc(11 * 1024 * 1024) }] })),
        /超过/
    );
    assert.throws(
        () =>
            decodeZip(
                archive({
                    extra: [
                        { name: 'folder.js', data: Buffer.from('x') },
                        { name: 'folder.js/child.js', data: Buffer.from('y') }
                    ]
                })
            ),
        /冲突/
    );
    const data = archive(),
        first = data.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])),
        second = data.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), first + 4);
    data.writeUInt32LE(0, second + 42);
    assert.throws(() => decodeZip(data));
});
test('源码打包拒绝数据文件与链接，不允许打包宿主数据库', (t) => {
    const { root } = fixture(t),
        folder = path.join(root, 'source');
    fs.mkdirSync(folder);
    fs.writeFileSync(path.join(folder, 'data.sqlite'), 'secret');
    assert.throws(() => collectFiles(folder), /类型/);
});
test('卸载等待进行中的异步业务写入，等待期间拒绝新请求并回收处理器', async (t) => {
    const { registry, packages } = fixture(t),
        prepared = packages.prepare(archive());
    registry.install(prepared.directory);
    packages.cleanup(prepared);
    const services = new PluginServices(registry, {});
    let complete,
        disposed = false,
        started;
    const signal = new Promise((resolve) => (started = resolve));
    services.providers.set('example.package', {
        call: () => {
            started();
            return new Promise((resolve) => (complete = resolve));
        },
        dispose: () => {
            disposed = true;
        }
    });
    services.active.add('example.package');
    const write = services.call('example.package', 'write');
    await signal;
    const removing = services.unload('example.package');
    await Promise.resolve();
    assert.equal(disposed, false);
    await assert.rejects(() => services.call('example.package', 'write'), /卸载/);
    complete('写入结束');
    assert.equal(await write, '写入结束');
    await removing;
    assert.equal(disposed, true);
    assert.equal(services.providers.has('example.package'), false);
    assert.equal(services.pending.size, 0);
});
test('更新拒绝降级与同版本改程序，替换失败恢复原程序和启停状态', (t) => {
    const { registry, packages } = fixture(t),
        install = (data) => {
            const p = packages.prepare(data);
            try {
                return registry.install(p.directory);
            } finally {
                packages.cleanup(p);
            }
        };
    install(archive({ version: '2.0.0' }));
    registry.setEnabled('example.package', false);
    assert.throws(() => install(archive()), /低于/);
    assert.throws(
        () => install(archive({ version: '2.0.0', extra: [{ name: 'new.js', data: Buffer.from('1') }] })),
        /版本号/
    );
    const rename = fs.renameSync;
    try {
        fs.renameSync = (from, to) => {
            if (path.basename(from).startsWith('.install-')) throw Error('模拟替换失败');
            return rename(from, to);
        };
        assert.throws(() => install(archive({ version: '2.1.0' })), /模拟替换失败/);
    } finally {
        fs.renameSync = rename;
    }
    assert.equal(registry.get('example.package').version, '2.0.0');
    assert.equal(registry.get('example.package').enabled, false);
    assert.equal(fs.existsSync(path.join(registry.get('example.package').directory, 'index.html')), true);
});
test('发布脚本生成可导入程序包与目录，目录校验值匹配真实文件', (t) => {
    const { root, packages } = fixture(t),
        prepared = packages.prepare(archive()),
        output = path.join(root, 'release');
    const { spawnSync } = require('node:child_process'),
        result = spawnSync(
            process.execPath,
            [
                path.resolve(__dirname, '../scripts/package-plugin.cjs'),
                prepared.directory,
                output,
                'https://plugins.example/releases/'
            ],
            { encoding: 'utf8' }
        );
    assert.equal(result.status, 0, result.stderr);
    const catalog = validateCatalog(JSON.parse(fs.readFileSync(path.join(output, 'catalog.json'), 'utf8'))),
        file = fs.readFileSync(path.join(output, 'example.package-1.0.0.collectify-plugin'));
    assert.equal(catalog[0].size, file.length);
    assert.equal(catalog[0].sha256, sha256(file));
    const installed = packages.prepare(file, catalog[0]);
    assert.equal(installed.manifest.id, 'example.package');
    packages.cleanup(installed);
    packages.cleanup(prepared);
});
test('目录加载按需联网、版本比较、大小校验，失败刷新保留上次结果', async (t) => {
    const { registry } = fixture(t),
        data = archive();
    let calls = 0,
        fail = false;
    const catalog = new PluginCatalog(registry, {
        fetcher: async (url) => {
            calls++;
            return url.endsWith('catalog.json')
                ? new Response(
                      fail
                          ? 'bad'
                          : JSON.stringify({ format: 'collectify-plugin-catalog', version: 1, plugins: [record(data)] })
                  )
                : new Response(data);
        }
    });
    assert.equal(calls, 0);
    catalog.configure('https://plugins.example/catalog.json');
    assert.equal(calls, 0);
    assert.equal((await catalog.refresh()).plugins.length, 1);
    assert.equal(calls, 1);
    assert.deepEqual((await catalog.package('example.package')).data, data);
    fail = true;
    await assert.rejects(() => catalog.refresh());
    assert.equal(catalog.status().plugins.length, 1);
    assert.equal(compareVersion('1.10.0', '1.9.99'), 1);
    assert.equal(compareVersion('2.0.0', '10.0.0'), -1);
    assert.throws(() => catalog.configure('http://plugins.example/catalog.json'), /HTTPS/);
    assert.throws(() => catalog.configure('https://user:secret@plugins.example/catalog.json'), /HTTPS/);
    assert.throws(
        () =>
            validateCatalog({ format: 'collectify-plugin-catalog', version: 1, plugins: [record(data), record(data)] }),
        /重复/
    );
});
test('下载拒绝 HTTPS 降级、过多重定向、超过声明大小和 HTTP 错误', async () => {
    await assert.rejects(
        () =>
            download('https://example.com', 100, {
                fetcher: async () =>
                    new Response(null, { status: 302, headers: { location: 'http://example.com/file' } })
            }),
        /HTTPS/
    );
    await assert.rejects(
        () =>
            download('https://example.com', 100, {
                fetcher: async () =>
                    new Response(null, { status: 302, headers: { location: 'https://example.com/file' } })
            }),
        /重定向/
    );
    await assert.rejects(
        () => download('https://example.com', 2, { fetcher: async () => new Response('abcd') }),
        /大小/
    );
    await assert.rejects(
        () => download('https://example.com', 100, { fetcher: async () => new Response(null, { status: 404 }) }),
        /404/
    );
});
