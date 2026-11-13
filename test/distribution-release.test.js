const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'),
    path = require('node:path'),
    os = require('node:os'),
    crypto = require('node:crypto');
const { generate } = require('../scripts/distribution-manifest.cjs');
const { publish } = require('../scripts/publish-gitlab.cjs');
const { build } = require('../scripts/build-team-profiles.cjs');
const { createProvider } = require('../src/distribution/providers');
const { validateConfig } = require('../src/distribution/config');
function fixture(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'collectify-ci-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    for (const directory of ['plugins', 'dist', 'docs/releases'])
        fs.mkdirSync(path.join(root, directory), { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '5.7.0' }));
    fs.writeFileSync(
        path.join(root, 'plugins/definitions.json'),
        JSON.stringify({
            publisher: { provider: 'gitlab', baseUrl: 'https://gitlab.example.com', project: 'company/app' }
        })
    );
    fs.writeFileSync(path.join(root, 'docs/releases/5.7.0.md'), '发布说明');
    fs.writeFileSync(path.join(root, 'dist/Collectify-5.7.0-windows-x64-setup.exe'), 'test-installer');
    const env = {
        CI_API_V4_URL: 'https://gitlab.example.com/api/v4',
        CI_PROJECT_ID: '7',
        CI_PROJECT_PATH: 'company/app',
        CI_JOB_TOKEN: 'fixture-ci-token',
        CI_COMMIT_TAG: 'v5.7.0'
    };
    return { root, env };
}
test('发布清单准确映射 Linux 架构与文件哈希，拒绝旧版本残留包', (t) => {
    const { root } = fixture(t),
        directory = path.join(root, 'dist');
    fs.writeFileSync(path.join(directory, 'Collectify-5.7.0-linux-amd64.deb'), 'deb');
    fs.writeFileSync(path.join(directory, 'Collectify-5.7.0-linux-x86_64.AppImage'), 'image');
    const manifest = generate({
        directory,
        version: '5.7.0',
        notes: '版本内容',
        assetUrl: (name) => 'https://example.com/' + name
    });
    assert.equal(manifest.files.length, 3);
    assert.equal(manifest.files.find((f) => f.name.endsWith('.deb')).arch, 'x64');
    assert.equal(
        manifest.files.find((f) => f.name.endsWith('.AppImage')).sha256,
        crypto.createHash('sha256').update('image').digest('hex')
    );
    fs.writeFileSync(path.join(directory, 'Collectify-5.6.0-macos-arm64.dmg'), 'old');
    assert.throws(() => generate({ directory, version: '5.7.0', notes: '', assetUrl: (v) => v }), /版本不一致/);
});
test('GitLab 发布先上传所有文件再创建 Release，失败不公开且令牌只发给指定 API', async (t) => {
    const { root, env } = fixture(t),
        actions = [];
    await publish({
        root,
        env,
        fetcher: async (url, options) => {
            assert.ok(url.startsWith('https://gitlab.example.com/api/v4/projects/7/'));
            assert.equal(options.headers['JOB-TOKEN'], 'fixture-ci-token');
            actions.push([options.method || 'GET', url]);
            if (options.method === 'PUT') {
                const reader = options.body.getReader();
                while (!(await reader.read()).done) {}
                return new Response('');
            }
            if (options.method === 'POST') {
                const release = JSON.parse(options.body);
                assert.equal(release.assets.links.length, 3);
                return new Response('');
            }
            return new Response('', { status: 404 });
        }
    });
    assert.equal(actions.filter((a) => a[0] === 'PUT').length, 3);
    assert.equal(actions.at(-1)[0], 'POST');
    let published = false;
    await assert.rejects(
        publish({
            root,
            env,
            fetcher: async (url, options) => {
                if (options.method === 'POST') published = true;
                if (options.method === 'PUT') {
                    await options.body.cancel();
                    return new Response('', { status: 500 });
                }
                return new Response('', { status: 404 });
            }
        }),
        /发布失败/
    );
    assert.equal(published, false);
});
test('GitLab 发布拒绝错误项目和已发布版本，不覆盖同名不同内容的未完成上传', async (t) => {
    const { root, env } = fixture(t);
    await assert.rejects(
        publish({
            root,
            env: { ...env, CI_PROJECT_PATH: 'other/project' },
            fetcher: async () => {
                throw Error('不应联网');
            }
        }),
        /目标/
    );
    await assert.rejects(publish({ root, env, fetcher: async () => new Response('') }), /Release 已存在/);
    let uploads = 0;
    await assert.rejects(
        publish({
            root,
            env,
            fetcher: async (url, options) => {
                if (options.method === 'PUT') uploads++;
                return url.includes('/releases/')
                    ? new Response('', { status: 404 })
                    : new Response('different-content');
            }
        }),
        /同名不同内容/
    );
    assert.equal(uploads, 0);
});
test('GitLab 插件 Release 不遮住主程序更新，GitHub 仍读取主程序 latest', async () => {
    const source = validateConfig({
        provider: 'gitlab',
        baseUrl: 'https://gitlab.example.com',
        project: 'company/app'
    });
    const provider = createProvider(source);
    const url = await provider.releaseUrl(async (value) => {
        assert.match(value, /\/releases\?/);
        return [
            { tag_name: 'plugin-clipboard-v2.1.1', assets: { links: [] } },
            {
                tag_name: 'v5.7.0',
                assets: { links: [{ name: 'collectify-update.json', url: 'https://example.com/update.json' }] }
            }
        ];
    });
    assert.equal(url, 'https://example.com/update.json');
    const github = createProvider(validateConfig({ provider: 'github', project: 'owner/repo' }));
    assert.equal(
        await github.releaseUrl(async (value) => {
            assert.ok(value.endsWith('/releases/latest'));
            return { assets: [{ id: 99, name: 'collectify-update.json' }] };
        }),
        'https://api.github.com/repos/owner/repo/releases/assets/99'
    );
});
test('团队索引从导出文件计算校验值，不向索引写入配置正文或本机路径', (t) => {
    const { root } = fixture(t),
        directory = path.join(root, 'profiles');
    fs.mkdirSync(directory);
    const raw = { format: 'collectify-workspace', version: 2, plugins: [] };
    fs.writeFileSync(path.join(directory, 'team.json'), JSON.stringify(raw));
    fs.writeFileSync(
        path.join(directory, 'definitions.json'),
        JSON.stringify({
            profiles: [
                {
                    id: 'team',
                    name: '团队',
                    version: '1.0.0',
                    groups: ['company/team'],
                    file: 'team.json',
                    path: 'profiles/team.json'
                }
            ]
        })
    );
    const result = build(directory);
    assert.equal(result.profiles[0].file, undefined);
    assert.equal(result.profiles[0].size, Buffer.byteLength(JSON.stringify(raw)));
    assert.equal(result.profiles[0].sha256.length, 64);
    fs.writeFileSync(
        path.join(directory, 'definitions.json'),
        JSON.stringify({ profiles: [{ file: '../package.json' }] })
    );
    assert.throws(() => build(directory), /目录内/);
});
