const { test } = require('node:test'),
    assert = require('node:assert/strict'),
    fs = require('node:fs'),
    os = require('node:os'),
    path = require('node:path');
const cleanup = require('../scripts/release-cleanup.cjs');
const { loadAuxiliary } = require('../src/auxiliary-window');
test('Collectify 应用身份、SQLite 数据目录与 Windows 图标资源一致', () => {
    const source = fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8');
    assert.match(source, /app\.setPath\('userData', path\.join\(app\.getPath\('appData'\), 'Collectify'\)\)/);
    const pkg = require('../package.json');
    assert.equal(pkg.name, 'collectify');
    assert.equal(pkg.build.productName, 'Collectify');
    assert.equal(pkg.build.nsis.shortcutName, 'Collectify');
    const p = require('../package.json');
    assert.equal(p.build.appId, 'com.collectify.desktop');
    assert.equal(p.build.nsis.deleteAppDataOnUninstall, false);
    assert.equal(p.build.win.signExecutable, false);
    assert.notEqual(p.build.win.signAndEditExecutable, false);
    assert.equal(p.build.win.icon, 'assets/icon.ico');
    assert.equal(p.build.nsis.artifactName, 'Collectify-Setup.exe');
    assert.deepEqual(p.build.win.target, ['nsis']);
});
test('新包未完成不清理，完成后仅清理 dist 顶层旧包', async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'collectify-release-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.writeFileSync(path.join(dir, 'Collectify-Setup-5.1.0-x64.exe'), 'old');
    fs.mkdirSync(path.join(dir, 'win-unpacked'));
    fs.writeFileSync(path.join(dir, 'win-unpacked', 'keep'), 'keep');
    fs.writeFileSync(path.join(dir, 'Shiye-Setup.exe'), 'legacy');
    await assert.rejects(cleanup({ outDir: dir, artifactPaths: [path.join(dir, 'Collectify-Setup.exe')] }));
    assert.ok(fs.existsSync(path.join(dir, 'Collectify-Setup-5.1.0-x64.exe')));
    fs.writeFileSync(path.join(dir, 'Collectify-Setup.exe'), Buffer.alloc(1000001));
    await cleanup({ outDir: dir, artifactPaths: [path.join(dir, 'Collectify-Setup.exe')] });
    assert.deepEqual(fs.readdirSync(dir).sort(), ['Collectify-Setup.exe', 'win-unpacked']);
    assert.equal(fs.readFileSync(path.join(dir, 'win-unpacked', 'keep'), 'utf8'), 'keep');
});
test('辅助页加载失败保持隐藏，准备完成才恢复显示资格', async () => {
    const calls = [],
        fake = {
            setOpacity: (v) => calls.push(['opacity', v]),
            hide: () => calls.push(['hide']),
            loadFile: async () => {
                throw Error('load failed');
            }
        };
    await assert.rejects(loadAuxiliary(fake, 'bad'));
    assert.deepEqual(calls, [['opacity', 0], ['hide']]);
    calls.length = 0;
    fake.loadFile = async () => {};
    fake.webContents = { executeJavaScript: async () => true };
    await loadAuxiliary(fake, 'good');
    assert.deepEqual(calls, [
        ['opacity', 0],
        ['opacity', 1]
    ]);
});
