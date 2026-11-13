const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'),
    os = require('node:os'),
    path = require('node:path'),
    crypto = require('node:crypto');
const { validateConfig, webUrl, authKey, CALLBACK } = require('../src/distribution/config');
const { request } = require('../src/distribution/transport');
const { CredentialStore } = require('../src/distribution/credentials');
const { SourceClient } = require('../src/distribution/client');
const { createProvider } = require('../src/distribution/providers');
const { gitlabLogin, githubLogin } = require('../src/distribution/oauth');
const { supplement } = require('../src/distribution/profiles');
const { selectUpdate, downloadUpdate, verifyInstaller } = require('../src/distribution/updates');
const { Distribution } = require('../src/distribution/manager');
const { PluginRegistry } = require('../src/plugin-system/registry');
const { WorkspaceBackup } = require('../src/plugin-system/backup');
const config = validateConfig({
    provider: 'gitlab',
    baseUrl: 'https://gitlab.example.com',
    project: 'group/project',
    clientId: 'public-client'
});
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
function temporary(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'collectify-distribution-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return dir;
}
function memoryCredentials() {
    let record = null;
    return {
        supported: () => true,
        read: (key) => (record?.key === key ? record.value : null),
        write: (key, value) => {
            record = { key, value };
        },
        clear: () => {
            record = null;
        }
    };
}
function response(value, init) {
    return new Response(JSON.stringify(value), init);
}
test('源配置可切换项目及地址，HTTP 仅显式放行内网 IP，不接受凭据 URL 与路径越界', () => {
    assert.throws(() => validateConfig({ ...config, baseUrl: 'http://192.168.1.2' }), /HTTPS/);
    const internal = validateConfig({ ...config, baseUrl: 'http://192.168.1.2:80', allowInsecureHttp: true });
    assert.equal(new URL(internal.baseUrl).hostname, '192.168.1.2');
    assert.throws(() => webUrl('http://example.com', internal), /HTTPS/);
    assert.throws(() => webUrl('https://user:secret@example.com', config), /凭据/);
    assert.throws(() => validateConfig({ ...config, catalogPath: '../private' }), /路径/);
    assert.equal(authKey(config), authKey({ ...config, project: 'other/project' }));
    assert.notEqual(authKey(config), authKey({ ...config, baseUrl: 'https://other.example.com' }));
});
test('系统安全存储加密落盘，拒绝明文密钥环，换源不能复用登录，清理同时删除暂存文件', async (t) => {
    const file = path.join(temporary(t), 'credentials.enc'),
        key = crypto.randomBytes(32);
    const encryption = {
        isEncryptionAvailable: () => true,
        encryptString: (value) => {
            const iv = crypto.randomBytes(12),
                cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
            return Buffer.concat([iv, cipher.update(value), cipher.final(), cipher.getAuthTag()]);
        },
        decryptString: (bytes) => {
            const decipher = crypto.createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
            decipher.setAuthTag(bytes.subarray(-16));
            return Buffer.concat([decipher.update(bytes.subarray(12, -16)), decipher.final()]).toString();
        }
    };
    const store = new CredentialStore(file, encryption);
    await store.initialize();
    await store.write('one', { accessToken: 'test-private-token' });
    assert.equal(fs.readFileSync(file).includes(Buffer.from('test-private-token')), false);
    assert.equal(store.read('one').accessToken, 'test-private-token');
    assert.equal(store.read('two'), null);
    const insecure = new CredentialStore(file, { ...encryption, getSelectedStorageBackend: () => 'basic_text' });
    await insecure.initialize();
    await assert.rejects(insecure.write('one', {}), /安全存储/);
    store.clear();
    assert.equal(fs.existsSync(file), false);
});
test('私有 API 重定向到 CDN 时不携带授权，越限流取消且 HTTPS 不降级', async () => {
    const headers = [],
        provider = createProvider(config);
    const bytes = await request('https://gitlab.example.com/api/v4/file', {
        config,
        headers: (url) => provider.headers(url, 'dummy-token'),
        fetcher: async (url, options) => {
            headers.push(options.headers);
            return headers.length === 1
                ? new Response(null, { status: 302, headers: { location: 'https://cdn.example.com/file' } })
                : new Response('package');
        }
    });
    assert.equal(bytes.toString(), 'package');
    assert.equal(headers[0].Authorization, 'Bearer dummy-token');
    assert.equal(headers[1].Authorization, undefined);
    await assert.rejects(
        request('https://gitlab.example.com/api/v4/file', {
            config,
            fetcher: async () => new Response('large'),
            limit: 2
        }),
        /大小/
    );
    await assert.rejects(
        request('https://gitlab.example.com/api/v4/file', {
            config: { ...config, allowInsecureHttp: true },
            fetcher: async () => new Response(null, { status: 302, headers: { location: 'http://192.168.1.2/file' } })
        }),
        /降级/
    );
});
test('GitLab PKCE 真实本机回调验证 state，仅用一次 code 和 verifier 换取授权', async () => {
    const controller = new AbortController();
    let authorize, posted;
    const result = await gitlabLogin(config, createProvider(config), {
        signal: controller.signal,
        openExternal: async (value) => {
            authorize = new URL(value);
            const bad = await fetch(CALLBACK + '?state=wrong&code=code');
            assert.equal(bad.status, 400);
            const good = await fetch(CALLBACK + '?state=' + authorize.searchParams.get('state') + '&code=one-time');
            assert.equal(good.status, 200);
        },
        fetcher: async (url, options) => {
            posted = new URLSearchParams(options.body);
            return response({ access_token: 'test-token', refresh_token: 'test-refresh', expires_in: 3600 });
        }
    });
    assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(
        authorize.searchParams.get('code_challenge'),
        crypto.createHash('sha256').update(posted.get('code_verifier')).digest('base64url')
    );
    assert.equal(posted.get('code'), 'one-time');
    assert.equal(posted.get('client_secret'), null);
    assert.equal(result.accessToken, 'test-token');
});
test('GitLab 登录取消后释放回调端口，可再次开始登录', async () => {
    const controller = new AbortController();
    await assert.rejects(
        gitlabLogin(config, createProvider(config), {
            signal: controller.signal,
            openExternal: async () => controller.abort()
        }),
        /取消/
    );
    const second = new AbortController();
    await assert.rejects(
        gitlabLogin(config, createProvider(config), {
            signal: second.signal,
            openExternal: async () => second.abort()
        }),
        /取消/
    );
});
test('GitHub 设备授权支持等待和降速，不需要在客户端保存 Client Secret', async () => {
    const source = validateConfig({ provider: 'github', project: 'owner/repo', clientId: 'id' });
    const waits = [];
    let count = 0,
        pending,
        opened;
    const token = await githubLogin(source, createProvider(source), {
        signal: new AbortController().signal,
        openExternal: async (url) => {
            opened = url;
        },
        pending: (p) => {
            pending = p;
        },
        wait: async (ms) => {
            waits.push(ms);
        },
        fetcher: async (url, options) => {
            assert.equal(new URLSearchParams(options.body).has('client_secret'), false);
            return response(
                [
                    { device_code: 'device', user_code: 'ABCD-EFGH', expires_in: 100, interval: 5 },
                    { error: 'authorization_pending' },
                    { error: 'slow_down' },
                    { access_token: 'test-github-token' }
                ][count++]
            );
        }
    });
    assert.equal(opened, 'https://github.com/login/device');
    assert.equal(pending.userCode, 'ABCD-EFGH');
    assert.deepEqual(waits, [5000, 5000, 10000]);
    assert.equal(token.accessToken, 'test-github-token');
});
test('并发请求仅刷新一次授权，轮转 Refresh Token；403 保持真实权限错误', async () => {
    const store = memoryCredentials();
    store.write(authKey(config), { accessToken: 'expired', refreshToken: 'old', expiresAt: 1 });
    let refreshes = 0;
    const client = new SourceClient(config, store, {
        fetcher: async (url, options) => {
            if (url.endsWith('/oauth/token')) {
                refreshes++;
                await new Promise((resolve) => setTimeout(resolve, 5));
                return response({ access_token: 'new', refresh_token: 'rotated', expires_in: 3600 });
            }
            assert.equal(options.headers.Authorization, 'Bearer new');
            return response({ ok: true });
        }
    });
    await Promise.all([
        client.read('https://gitlab.example.com/api/v4/one'),
        client.read('https://gitlab.example.com/api/v4/two')
    ]);
    assert.equal(refreshes, 1);
    assert.equal(store.read(authKey(config)).refreshToken, 'rotated');
    client.fetcher = async () => new Response('', { status: 403 });
    await assert.rejects(client.read('https://gitlab.example.com/api/v4/denied'), /没有访问权限/);
    assert.equal(refreshes, 1);
});
test('GitLab Raw 转 API，GitHub 私有 Release 转附件 API，两者共用下载流程', async () => {
    const provider = createProvider(config);
    assert.match(
        await provider.resolve('https://gitlab.example.com/group/project/-/raw/main/plugins/catalog.json'),
        /projects\/group%2Fproject\/repository\/files\/plugins%2Fcatalog.json\/raw\?ref=main/
    );
    const github = createProvider(validateConfig({ provider: 'github', project: 'a/b' }));
    const url = await github.resolve('https://github.com/a/b/releases/download/v1.0.0/package.zip', async () => ({
        assets: [{ id: 42, name: 'package.zip' }]
    }));
    assert.equal(url, 'https://api.github.com/repos/a/b/releases/assets/42');
    assert.equal(github.headers(new URL(url), 'token').Accept, 'application/octet-stream');
});
test('更新按系统架构选择，完整流式下载后校验，损坏或中断不留下安装包', async (t) => {
    const dir = temporary(t),
        data = Buffer.from('installer'),
        base = {
            format: 'collectify-app-update',
            schemaVersion: 1,
            version: '5.7.0',
            notes: '更新内容',
            files: [
                {
                    name: 'Collectify-5.7.0-windows-x64-setup.exe',
                    platform: 'win32',
                    arch: 'x64',
                    url: 'https://cdn.example.com/app.exe',
                    size: data.length,
                    sha256: digest(data)
                }
            ]
        };
    const update = selectUpdate(base, { version: '5.6.0', platform: 'win32', arch: 'x64', config });
    assert.equal(update.available, true);
    assert.throws(() => selectUpdate(base, { version: '5.6.0', platform: 'darwin', arch: 'arm64', config }), /架构/);
    const client = new SourceClient(config, memoryCredentials(), { fetcher: async () => new Response(data) });
    const file = await downloadUpdate(client, update, dir);
    await verifyInstaller(file, update);
    fs.writeFileSync(file, 'changed');
    await assert.rejects(verifyInstaller(file, update), /发生变化/);
    fs.unlinkSync(file);
    client.fetcher = async () => new Response('corrupted');
    await assert.rejects(downloadUpdate(client, update, dir), /校验|大小/);
    assert.deepEqual(fs.readdirSync(dir), []);
});
test('默认配置补充保留已有值、相同网址及用户删除记录；新条目可以加入', () => {
    const prior = { entries: [{ id: 'removed', url: 'https://old.example.com' }], value: 'old' };
    const local = {
        entries: [{ id: 'one', url: 'https://personal.example.com', title: '个人修改' }],
        value: 'personal'
    };
    const incoming = {
        entries: [
            { id: 'other-id', url: 'https://personal.example.com', title: '默认标题' },
            { id: 'removed', url: 'https://old.example.com' },
            { id: 'new', url: 'https://new.example.com' }
        ],
        value: 'new'
    };
    const result = supplement(local, incoming, prior);
    assert.deepEqual(
        result.entries.map((v) => v.id),
        ['one', 'new']
    );
    assert.equal(result.value, 'personal');
});
test('团队配置经真实工作台事务应用，预览绑定账号并重新校验组权限，个人数据与 Token 不进入状态或备份', async (t) => {
    const dir = temporary(t),
        registry = new PluginRegistry({
            builtinRoot: path.resolve(__dirname, '../src/plugins'),
            userRoot: path.join(dir, 'packages'),
            dataRoot: path.join(dir, 'data'),
            hostFile: path.join(dir, 'host.sqlite')
        });
    registry.storage.set('collectify.json', 'indent', 'personal');
    const raw = {
        format: 'collectify-workspace',
        version: 2,
        plugins: [
            { id: 'collectify.json', version: '1.0.0', enabled: true, values: { indent: 'team', newKey: 'default' } }
        ]
    };
    const bytes = Buffer.from(JSON.stringify(raw));
    let groups = ['engineering'],
        reads = 0;
    const index = {
        format: 'collectify-team-profiles',
        version: 1,
        profiles: [
            {
                id: 'eng',
                name: '研发',
                version: '1.0.0',
                groups: ['engineering'],
                path: 'profiles/eng.json',
                size: bytes.length,
                sha256: digest(bytes)
            },
            {
                id: 'other',
                name: '其他团队',
                version: '1.0.0',
                groups: ['other'],
                path: 'profiles/other.json',
                size: bytes.length,
                sha256: digest(bytes)
            }
        ]
    };
    const credentials = memoryCredentials();
    credentials.write(authKey(config), { accessToken: 'not-exported', expiresAt: 0 });
    const backup = new WorkspaceBackup(
        registry,
        () => ({}),
        () => ({})
    );
    const manager = new Distribution({
        registry,
        credentials,
        directory: dir,
        version: '5.6.0',
        deployment: config,
        backup,
        getSettings: () => ({}),
        fetcher: async (url) => {
            if (url.endsWith('/user')) return response({ id: 7, username: 'demo' });
            if (url.includes('/groups?')) return response(groups.map((full_path) => ({ full_path })));
            if (url.includes('profiles%2Findex.json')) return response(index);
            if (url.includes('profiles%2Feng.json')) {
                reads++;
                return new Response(bytes);
            }
            return new Response('', { status: 404 });
        }
    });
    t.after(() => manager.dispose());
    await manager.previewProfile('eng');
    assert.equal(manager.status().profiles.length, 1);
    const preview = manager.status().preview;
    groups = [];
    await assert.rejects(manager.applyProfile(preview.token), /权限|身份/);
    assert.equal(registry.storage.get('collectify.json', 'newKey'), null);
    groups = ['engineering'];
    await manager.previewProfile('eng');
    await manager.applyProfile(manager.status().preview.token);
    assert.equal(reads, 3);
    assert.equal(registry.storage.get('collectify.json', 'indent'), 'personal');
    assert.equal(registry.storage.get('collectify.json', 'newKey'), 'default');
    assert.equal(JSON.stringify(manager.status()).includes('not-exported'), false);
    assert.equal(JSON.stringify(backup.export(['collectify.json'], true, true)).includes('not-exported'), false);
    manager.logout();
    assert.equal(manager.status().preview, null);
    assert.equal(manager.status().authenticated, false);
});
