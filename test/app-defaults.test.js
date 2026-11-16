const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'),
    os = require('node:os'),
    path = require('node:path');
const { spawnSync } = require('node:child_process');
test('集中配置可改变公开源与端口，坏端口启动时明确拒绝', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'collectify-defaults-'));
    try {
        fs.mkdirSync(path.join(root, 'src'));
        fs.mkdirSync(path.join(root, 'config'));
        fs.copyFileSync(path.resolve(__dirname, '../src/app-defaults.js'), path.join(root, 'src/app-defaults.js'));
        const config = structuredClone(require('../config/app-defaults.json'));
        config.network.mcpPort = 19001;
        config.network.oauthCallbackPort = 19002;
        config.distribution.project = 'team/new-repository';
        const file = path.join(root, 'config/app-defaults.json');
        fs.writeFileSync(file, JSON.stringify(config));
        const execute = () =>
            spawnSync(process.execPath, ['-e', "console.log(JSON.stringify(require('./src/app-defaults')))"], {
                cwd: root,
                encoding: 'utf8'
            });
        let result = execute();
        assert.equal(result.status, 0);
        const actual = JSON.parse(result.stdout);
        assert.equal(actual.network.mcpPort, 19001);
        assert.equal(actual.distribution.project, 'team/new-repository');
        fs.writeFileSync(
            path.join(root, 'config/local.json'),
            JSON.stringify({ network: { mcpPort: 19003 }, initialData: { version: 2, categories: [], entries: [] } })
        );
        const overridden = JSON.parse(execute().stdout);
        assert.equal(overridden.network.mcpPort, 19003);
        assert.equal(overridden.network.oauthCallbackPort, 19002, '覆盖单个端口时保留其他默认字段');
        assert.deepEqual(overridden.initialData, { version: 2, categories: [], entries: [] });
        config.network.oauthCallbackPort = 70000;
        fs.writeFileSync(file, JSON.stringify(config));
        result = execute();
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /默认端口/);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
