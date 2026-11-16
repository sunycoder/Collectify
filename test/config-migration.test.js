const { test } = require('node:test'),
    assert = require('node:assert/strict');
const fs = require('node:fs'),
    path = require('node:path'),
    os = require('node:os');
const { migrate } = require('../scripts/migrate-config.cjs');
const { configureCI } = require('../scripts/configure-source.cjs');
test('旧配置备份后合并，私人数据保留，本机文件明确排除打包', (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'collectify-config-migration-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.mkdirSync(path.join(root, 'config'));
    fs.mkdirSync(path.join(root, 'plugins'));
    const write = (p, v) => fs.writeFileSync(path.join(root, p), JSON.stringify(v));
    const base = structuredClone(require('../config/app-defaults.json'));
    write('config/app-defaults.json', base);
    const privateData = { version: 2, entries: [{ id: 'private', password: 'test-private' }], categories: [] };
    write('default-config.json', privateData);
    write('distribution.json', {
        provider: 'gitlab',
        baseUrl: 'https://gitlab.example.com',
        project: 'company/app',
        clientId: 'company-id'
    });
    migrate(root);
    const local = JSON.parse(fs.readFileSync(path.join(root, 'config/local.json'), 'utf8'));
    assert.deepEqual(local.initialData, privateData);
    assert.equal(local.sources.gitlab.clientId, 'company-id');
    assert.equal(fs.existsSync(path.join(root, 'default-config.json')), false);
    assert.ok(fs.readdirSync(path.join(root, 'dist')).some((n) => n.startsWith('config-migration-')));
    assert.ok(require('../package.json').build.files.includes('!config/local.json'));
    write('plugins/definitions.json', { repository: 'sunycoder/Collectify' });
    configureCI({ root, env: { GITHUB_REPOSITORY: base.distribution.project } });
    const built = JSON.parse(fs.readFileSync(path.join(root, 'config/app-defaults.json'), 'utf8'));
    assert.equal(built.distribution.clientId, base.distribution.clientId, '空 CI 变量不能清掉配置 ID');
    assert.equal(JSON.stringify(built).includes('test-private'), false);
    assert.equal(fs.existsSync(path.join(root, 'config/distribution.json')), false);
});
