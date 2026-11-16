const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'),
    os = require('node:os'),
    path = require('node:path');
const { create } = require('../src/plugin-library/ip-query/backend');
const { address, localReason } = require('../src/plugin-library/ip-query/model');
const source = path.resolve(__dirname, '../src/plugin-library/ip-query');
const reply = (ip = '8.8.8.8') => ({
    ip,
    success: true,
    country: '美国',
    country_code: 'US',
    region: 'California',
    city: '<img src=x onerror=alert(1)>',
    connection: { asn: 15169, isp: 'Google', org: 'Google LLC' },
    timezone: { id: 'America/Los_Angeles' },
    latitude: 37.3,
    longitude: -121.8
});
function temporary(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'collectify-ip-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    return root;
}
async function fixture(t, adapters = {}) {
    const file = path.join(temporary(t), 'data', 'data.sqlite');
    const provider = await create({ file }, adapters);
    provider.activate();
    t.after(() => provider.dispose());
    return { provider, file };
}
test('IP 插件在创建、启停时不联网、不建库、不加载 Electron，独立进程冷启动没有额外活动句柄', async (t) => {
    const { spawnSync } = require('node:child_process');
    const file = path.join(temporary(t), 'not-created', 'data.sqlite');
    const result = spawnSync(
        process.execPath,
        [
            '-e',
            `
        const fs=require('fs'),Module=require('module'),original=Module._load;
        Module._load=function(id,...args){if(['electron','node:sqlite','node:net','node:http','node:https'].includes(id))throw Error('eager dependency '+id);return original.call(this,id,...args)};
        const before=process.getActiveResourcesInfo();
        require(${JSON.stringify(path.join(source, 'backend.js'))}).create({file:${JSON.stringify(file)}}).then(async p=>{
          p.activate();p.deactivate();p.activate();await p.dispose();
          if(fs.existsSync(${JSON.stringify(file)}))throw Error('eager database');
          if(JSON.stringify(before)!==JSON.stringify(process.getActiveResourcesInfo()))throw Error('leaked handles');
        }).catch(e=>{console.error(e);process.exitCode=1});
    `
        ],
        { encoding: 'utf8', windowsHide: true }
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.existsSync(path.dirname(file)), false);
});
test('IPv4/IPv6 严格校验与规范化，内网和特殊地址本地解释，不发送到公网', async (t) => {
    assert.equal(address(' 2001:4860:4860:0:0:0:0:8888 '), '2001:4860:4860::8888');
    for (const value of ['https://8.8.8.8', '8.8.8.8:80', 'localhost', '1.2.3.999', '::1%lo', '8.8.8.8/../', '[::1]'])
        assert.throws(() => address(value), /地址/);
    const { provider } = await fixture(t, {
        fetch: () => {
            throw Error('不得联网');
        }
    });
    for (const ip of [
        '10.0.0.1',
        '127.0.0.1',
        '192.168.2.1',
        '169.254.1.2',
        '100.64.2.1',
        '::1',
        '::',
        'fc00::1',
        'fe80::1',
        '2001:db8::1',
        '::ffff:192.168.1.1'
    ]) {
        assert.ok(localReason(address(ip)), ip);
        assert.equal((await provider.call('query', { ip })).local, true);
    }
    assert.equal((await provider.call('state')).history.length, 0);
});
test('真实 SQLite 历史重启保持，缓存与强制刷新、IPv6 结果及数据源字段准确，历史有界', async (t) => {
    let calls = [],
        time = 1000;
    const { provider, file } = await fixture(t, {
        now: () => time,
        fetch: async (url, options) => {
            calls.push({ url, options });
            return Response.json(reply(decodeURIComponent(url.slice('https://ipwho.is/'.length)) || '8.8.8.8'));
        }
    });
    const first = await provider.call('query', { ip: '8.8.8.8' });
    assert.equal(first.asn, 'AS15169');
    assert.equal(first.isp, 'Google');
    assert.equal(first.source, 'IPWhois');
    assert.equal(first.latitude, 37.3);
    assert.equal(first.cached, false);
    assert.equal((await provider.call('query', { ip: '8.8.8.8' })).cached, true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].options.redirect, 'error');
    assert.equal(calls[0].options.credentials, 'omit');
    await provider.call('query', { ip: '8.8.8.8', refresh: true });
    assert.equal(calls.length, 2);
    time += 300001;
    await provider.call('query', { ip: '8.8.8.8' });
    assert.equal(calls.length, 3);
    const ipv6 = await provider.call('query', { ip: '2001:4860:4860::8888' });
    assert.equal(ipv6.type, 'IPv6');
    for (let i = 1; i <= 35; i++) await provider.call('query', { ip: `9.9.9.${i}` });
    assert.equal((await provider.call('state')).history.length, 30);
    await provider.dispose();
    const reopened = await create(
        { file },
        {
            fetch: () => {
                throw Error('打开记录不得自动联网');
            }
        }
    );
    reopened.activate();
    assert.equal((await reopened.call('state')).history[0].ip, '9.9.9.35');
    await reopened.call('clear-history');
    assert.equal((await reopened.call('state')).history.length, 0);
    await reopened.dispose();
});
test('停用、取消、并发新查询和卸载拒绝迟到响应，缓存和历史不能被旧请求回写', async (t) => {
    const jobs = [];
    const { provider } = await fixture(t, {
        fetch: (url, options) => new Promise((resolve) => jobs.push({ url, signal: options.signal, resolve }))
    });
    const first = provider.call('query', { ip: '8.8.8.8' });
    const rejected = assert.rejects(first, /取消/);
    const second = provider.call('query', { ip: '1.1.1.1' });
    assert.equal(jobs[0].signal.aborted, true);
    jobs[1].resolve(Response.json(reply('1.1.1.1')));
    await second;
    await rejected;
    jobs[0].resolve(Response.json(reply()));
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(
        (await provider.call('state')).history.map((item) => item.ip),
        ['1.1.1.1']
    );
    for (const action of ['cancel', 'deactivate', 'dispose']) {
        const pending = provider.call('query', { ip: '9.9.9.9' });
        const checked = assert.rejects(pending, /取消/);
        if (action === 'cancel') await provider.call('cancel');
        else await provider[action]();
        await checked;
        assert.equal(jobs.at(-1).signal.aborted, true);
        jobs.at(-1).resolve(Response.json(reply('9.9.9.9')));
        await new Promise((resolve) => setImmediate(resolve));
        if (action === 'deactivate') {
            await assert.rejects(provider.call('state'), /停用/);
            provider.activate();
        }
        if (action !== 'dispose')
            assert.deepEqual(
                (await provider.call('state')).history.map((item) => item.ip),
                ['1.1.1.1']
            );
    }
    await assert.rejects(provider.call('state'), /停用/);
    assert.throws(() => provider.activate(), /卸载/);
});
test('网络失败、额度、坏响应、地址错配和超限响应不写入成功记录', async (t) => {
    let fetch;
    const { provider } = await fixture(t, { fetch: (...args) => fetch(...args) });
    for (const [response, error] of [
        [() => new Response('', { status: 429 }), /频繁/],
        [() => new Response('', { status: 401 }), /拒绝/],
        [() => new Response('', { status: 503 }), /503/],
        [() => Response.json({ success: false }), /未找到/],
        [() => Response.json(reply('1.1.1.1')), /不一致/],
        [() => new Response('<html>bad</html>'), /无法解析/],
        [() => new Response('a'.repeat(65537)), /过大/],
        [
            () => {
                throw new TypeError('secret-url');
            },
            /无法连接/
        ]
    ]) {
        fetch = response;
        await assert.rejects(provider.call('query', { ip: '8.8.8.8' }), error);
        assert.equal((await provider.call('state')).history.length, 0);
    }
});
test('响应体读取也受超时控制，取消会关闭流；清空记录和无效新查询会撤销旧请求', async (t) => {
    let cancelled = false,
        resolveFetch;
    const { provider } = await fixture(t, {
        fetch: () =>
            new Promise((resolve) => {
                resolveFetch = resolve;
            })
    });
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const first = provider.call('query', { ip: '8.8.8.8' });
    const timedOut = assert.rejects(first, /超时/);
    resolveFetch(
        new Response(
            new ReadableStream({
                cancel() {
                    cancelled = true;
                }
            })
        )
    );
    await new Promise((resolve) => setImmediate(resolve));
    t.mock.timers.tick(10001);
    await timedOut;
    assert.equal(cancelled, true);
    const next = provider.call('query', { ip: '1.1.1.1' });
    const cleared = assert.rejects(next, /取消/);
    await provider.call('clear-history');
    await cleared;
    resolveFetch(Response.json(reply('1.1.1.1')));
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal((await provider.call('state')).history.length, 0);
    const last = provider.call('query', { ip: '8.8.8.8' });
    const superseded = assert.rejects(last, /取消/);
    await assert.rejects(provider.call('query', { ip: 'not-an-ip' }), /地址/);
    await superseded;
    resolveFetch(Response.json(reply()));
});
test('IPinfo Key 只经系统加密存储，状态和历史不含 Key；缺少密钥环拒绝保存并保留旧设置', async (t) => {
    const { createCipheriv, createDecipheriv, randomBytes } = require('node:crypto');
    const key = randomBytes(32),
        iv = randomBytes(16);
    const storage = {
        isEncryptionAvailable: () => true,
        getSelectedStorageBackend: () => 'test',
        encryptString: (value) => {
            const c = createCipheriv('aes-256-cbc', key, iv);
            return Buffer.concat([c.update(value), c.final()]);
        },
        decryptString: (value) => {
            const c = createDecipheriv('aes-256-cbc', key, iv);
            return Buffer.concat([c.update(value), c.final()]).toString();
        }
    };
    let observed;
    const { provider, file } = await fixture(t, {
        electron: { safeStorage: storage },
        fetch: async (url, options) => {
            observed = { url, options };
            return Response.json({
                ip: '8.8.8.8',
                country: 'US',
                country_name: 'United States',
                asn: 'AS15169',
                as_name: 'Google'
            });
        }
    });
    await provider.call('settings', { provider: 'ipinfo' });
    await assert.rejects(provider.call('settings', { provider: 'constructor' }), /不支持/);
    await assert.rejects(provider.call('query'), /Key/);
    const token = 'test-personal-token';
    await provider.call('settings', { provider: 'ipinfo', key: token });
    const result = await provider.call('query');
    assert.equal(observed.url, 'https://api.ipinfo.io/lite/me');
    assert.equal(observed.options.headers.Authorization, 'Bearer ' + token);
    assert.equal(result.city, '');
    assert.equal(result.latitude, null);
    assert.ok(!JSON.stringify(await provider.call('state')).includes(token));
    assert.equal(fs.readFileSync(file).includes(Buffer.from(token)), false);
    storage.getSelectedStorageBackend = () => 'basic_text';
    await assert.rejects(provider.call('settings', { provider: 'ipwhois', key: 'new-key' }), /安全存储/);
    assert.equal((await provider.call('state')).settings.provider, 'ipinfo');
    await provider.call('settings', { provider: 'ipwhois', clearKey: true });
    assert.equal((await provider.call('state')).settings.hasKey, false);
});
test('签名 IP 插件通过真实包安装、运行、停用、卸载、重装，宿主默认插件不增加', async (t) => {
    const { PluginRegistry } = require('../src/plugin-system/registry');
    const { PluginPackages, collectFiles, encodeZip } = require('../src/plugin-system/package');
    const { PluginServices } = require('../src/plugin-system/services');
    const root = temporary(t),
        id = 'collectify.ip-query';
    const registry = new PluginRegistry({
        builtinRoot: path.resolve(__dirname, '../src/plugins'),
        userRoot: path.join(root, 'packages'),
        dataRoot: path.join(root, 'data'),
        hostFile: path.join(root, 'host.sqlite')
    });
    assert.equal(registry.plugins.has(id), false);
    assert.equal(registry.defaults().length, 5);
    const packages = new PluginPackages(registry, path.join(root, 'staging'));
    const prepared = packages.prepare(encodeZip(collectFiles(source), { native: true, store: true }));
    registry.install(prepared.directory, prepared.manifest);
    packages.cleanup(prepared);
    const services = new PluginServices(registry, {});
    await services.load();
    assert.equal(services.errors.has(id), false);
    const file = path.join(registry.dataRoot, id, 'data.sqlite');
    assert.equal(fs.existsSync(file), false, '启用插件但未打开页面时不能初始化数据库');
    await services.call(id, 'settings', { provider: 'ipinfo' });
    await services.disable(id);
    registry.setEnabled(id, false);
    await assert.rejects(services.call(id, 'query', { ip: '8.8.8.8' }));
    registry.setEnabled(id, true);
    await services.enable(id);
    assert.equal((await services.call(id, 'state')).settings.provider, 'ipinfo');
    const exported = packages.export(id);
    await services.unload(id);
    registry.uninstall(id);
    const installed = packages.prepare(exported);
    registry.install(installed.directory, installed.manifest);
    packages.cleanup(installed);
    await services.load();
    assert.equal((await services.call(id, 'state')).settings.provider, 'ipinfo');
    await services.unload(id);
    registry.uninstall(id, { deleteData: true });
    await services.dispose();
    assert.equal(fs.existsSync(file), false);
});
