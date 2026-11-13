const assert = require('node:assert/strict');
const { dialog } = require('electron');
const { createHash } = require('node:crypto');
const { encodeZip } = require('./plugin-system/package');
const { validateNote } = require('./plugins/tasks/model');
const { CALLBACK } = require('./distribution/config');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const respond = (value) => new Response(JSON.stringify(value));
async function wait(condition) {
    for (let i = 0; i < 300; i++) {
        if (await condition()) return;
        await new Promise((resolve) => setTimeout(resolve, 30));
    }
    throw Error('分发流程等待超时');
}
exports.run = async ({ win, distribution, registry, services, hostAction, pluginCatalog }) => {
    const previousDialog = dialog.showMessageBox,
        previousStore = distribution.credentials;
    let record = null,
        groups = ['company/dev'],
        pluginVersion = '1.0.0',
        profileVersion = '1.0.0';
    let notes = [validateNote({ id: 'team-note', title: '团队初始便签', content: '默认内容' })];
    const installer = Buffer.from('verified-test-installer-no-execution');
    const extension = process.platform === 'win32' ? 'exe' : process.platform === 'darwin' ? 'dmg' : 'deb';
    const osName = { win32: 'windows', darwin: 'macos', linux: 'linux' }[process.platform];
    const manifest = () => ({
        id: 'company.distribution-smoke',
        name: '企业插件',
        description: '下载测试',
        apiVersion: 1,
        version: pluginVersion,
        entry: 'index.html',
        permissions: ['storage'],
        commands: [{ id: 'open', title: '打开' }]
    });
    const archive = () =>
        encodeZip(
            [
                { name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest())) },
                { name: 'index.html', data: Buffer.from('<!doctype html><h1>企业插件</h1>') }
            ],
            { store: true }
        );
    const profile = () =>
        Buffer.from(
            JSON.stringify({
                format: 'collectify-workspace',
                version: 2,
                settings: { browserOpenMode: 'internal' },
                plugins: [
                    {
                        id: 'collectify.notes',
                        version: '1.0.0',
                        enabled: true,
                        values: {},
                        data: { schemaVersion: 1, notes }
                    }
                ]
            })
        );
    const source = 'https://source.example.com/api/v4/';
    distribution.credentials = {
        supported: () => true,
        read: (key) => (record?.key === key ? record.value : null),
        write: (key, value) => {
            record = { key, value };
        },
        clear: () => {
            record = null;
        }
    };
    distribution.openExternal = async (value) => {
        const auth = new URL(value);
        assert.equal(auth.searchParams.get('scope'), 'read_api');
        await fetch(CALLBACK + '?state=' + auth.searchParams.get('state') + '&code=fixture-code');
    };
    distribution.fetcher = async (value, options) => {
        const url = String(value);
        if (url.endsWith('/oauth/token'))
            return respond({ access_token: 'fixture-access', refresh_token: 'fixture-refresh', expires_in: 3600 });
        assert.equal(options.headers.Authorization, 'Bearer fixture-access');
        if (url.endsWith('/user')) return respond({ id: 42, username: 'fixture', name: '测试账号' });
        if (url.includes('/groups?')) return respond(groups.map((full_path) => ({ full_path })));
        if (url.includes('/releases?'))
            return respond([
                { tag_name: 'plugin-sample-v2.0.0', assets: { links: [] } },
                {
                    tag_name: 'v99.0.0',
                    assets: { links: [{ name: 'collectify-update.json', url: source + 'update.json' }] }
                }
            ]);
        if (url.endsWith('/update.json'))
            return respond({
                format: 'collectify-app-update',
                schemaVersion: 1,
                version: '99.0.0',
                notes: '测试新版本',
                files: [
                    {
                        name: `Collectify-99.0.0-${osName}-${process.arch}${process.platform === 'win32' ? '-setup' : ''}.${extension}`,
                        platform: process.platform,
                        arch: process.arch,
                        url: source + 'installer',
                        size: installer.length,
                        sha256: sha(installer)
                    }
                ]
            });
        if (url.endsWith('/installer')) return new Response(installer);
        if (url.includes('plugins%2Fcatalog.json')) {
            const data = archive();
            return respond({
                format: 'collectify-plugin-catalog',
                version: 1,
                plugins: [
                    {
                        id: manifest().id,
                        name: manifest().name,
                        description: '测试插件',
                        version: pluginVersion,
                        apiVersion: 1,
                        size: data.length,
                        sha256: sha(data),
                        url: source + 'plugin'
                    }
                ]
            });
        }
        if (url.endsWith('/plugin')) return new Response(archive());
        if (url.includes('profiles%2Findex.json')) {
            const bytes = profile();
            return respond({
                format: 'collectify-team-profiles',
                version: 1,
                profiles: ['dev', 'other'].map((id) => ({
                    id,
                    name: id,
                    version: profileVersion,
                    groups: ['company/' + id],
                    path: 'profiles/' + id + '.json',
                    size: bytes.length,
                    sha256: sha(bytes)
                }))
            });
        }
        if (url.includes('profiles%2Fdev.json')) return new Response(profile());
        throw Error('未预期的测试请求');
    };
    try {
        dialog.showMessageBox = async () => ({ response: 1 });
        await hostAction('distribution-save', {
            provider: 'gitlab',
            baseUrl: 'https://source.example.com',
            project: 'company/app',
            clientId: 'fixture-client'
        });
        await win.webContents.executeJavaScript("openSettings('distribution')");
        assert.equal(
            await win.webContents.executeJavaScript("document.querySelector('[data-panel=distribution]').hidden"),
            false
        );
        assert.equal(
            await win.webContents.executeJavaScript("document.querySelector('#source-provider').tomselect.getValue()"),
            'gitlab'
        );
        await hostAction('distribution-login');
        await wait(() => !distribution.busy && distribution.update?.available);
        assert.equal(distribution.status().identity.username, 'fixture');
        assert.deepEqual(
            distribution.profiles.map((p) => p.id),
            ['dev']
        );
        await wait(() =>
            win.webContents.executeJavaScript(
                "document.querySelector('#source-groups').textContent.includes('company/dev')"
            )
        );
        await hostAction('plugin-catalog-install', manifest().id);
        registry.storage.set(manifest().id, 'keep', 'personal');
        pluginVersion = '1.1.0';
        await hostAction('distribution-check');
        assert.equal(pluginCatalog.status().plugins[0].updateAvailable, true);
        await hostAction('plugin-catalog-install', manifest().id);
        assert.equal(registry.get(manifest().id).version, '1.1.0');
        assert.equal(registry.storage.get(manifest().id, 'keep'), 'personal');
        await hostAction('distribution-download');
        assert.equal(distribution.status().downloaded, true);
        await distribution.installer(); // 仅验证测试文件，绝不执行系统安装器。
        await hostAction('settings', { browserOpenMode: 'external' });
        await hostAction('distribution-preview', 'dev');
        groups = [];
        await assert.rejects(hostAction('distribution-apply', distribution.status().preview.token), /身份|权限/);
        groups = ['company/dev'];
        await hostAction('distribution-preview', 'dev');
        await hostAction('distribution-apply', distribution.status().preview.token);
        const provider = services.providers.get('collectify.notes');
        assert.ok(provider.exportData().notes.some((n) => n.id === 'team-note'));
        assert.equal((await hostAction('state')).settings.browserOpenMode, 'external');
        await provider.call('note-delete', 'team-note');
        notes = [...notes, validateNote({ id: 'team-new', title: '团队新增内容' })];
        profileVersion = '1.1.0';
        await hostAction('distribution-preview', 'dev');
        await hostAction('distribution-apply', distribution.status().preview.token);
        assert.equal(
            provider.exportData().notes.some((n) => n.id === 'team-note'),
            false
        );
        assert.ok(provider.exportData().notes.some((n) => n.id === 'team-new'));
        const state = await hostAction('distribution-status');
        assert.equal(JSON.stringify(state).includes('fixture-access'), false);
        await hostAction('distribution-logout');
        assert.equal(distribution.status().authenticated, false);
        await win.webContents.executeJavaScript("document.querySelector('#settings-dialog').close()");
        console.log(
            'DISTRIBUTION PASS：真实设置页、PKCE 本机回调、账号组读取、私有目录、插件安装更新保留数据、主程序校验下载、团队配置权限复查与个人删除保留、退出登录通过；服务和令牌为隔离测试替身，未执行安装器。'
        );
    } finally {
        dialog.showMessageBox = previousDialog;
        distribution.dispose();
        distribution.credentials = previousStore;
    }
};
