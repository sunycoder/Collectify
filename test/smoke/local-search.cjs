const { app, BrowserWindow, protocol, dialog } = require('electron');
const fs = require('node:fs'),
    path = require('node:path'),
    os = require('node:os'),
    assert = require('node:assert/strict');
const { PluginRegistry } = require('../../src/plugin-system/registry');
const { PluginRuntime } = require('../../src/plugin-system/runtime');
const { PluginServices } = require('../../src/plugin-system/services');
const { PluginPackages, encodeZip, collectFiles } = require('../../src/plugin-system/package');
protocol.registerSchemesAsPrivileged([
    {
        scheme: 'collectify-plugin',
        privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
    }
]);
app.disableHardwareAcceleration();
app.setAppPath(path.resolve(__dirname, '../..'));
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'collectify-search-smoke-'));
app.setPath('userData', temporary);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
app.whenReady().then(async () => {
    let runtime, services, win;
    try {
        const root = path.resolve(__dirname, '../..'),
            fixtures = path.join(temporary, 'fixtures');
        // 被搜索的文件在真实磁盘上；ASAR 内只存插件程序，不把打包资源当成本地用户文件。
        fs.mkdirSync(fixtures, { recursive: true });
        const fixtureSource = path.join(root, 'test', 'fixtures', 'local-search');
        for (const file of fs.readdirSync(fixtureSource))
            fs.writeFileSync(path.join(fixtures, file), fs.readFileSync(path.join(fixtureSource, file)));
        const registry = new PluginRegistry({
            builtinRoot: path.join(root, 'src', 'plugins'),
            userRoot: path.join(temporary, 'packages'),
            dataRoot: path.join(temporary, 'data'),
            hostFile: path.join(temporary, 'host.sqlite')
        });
        // 市场插件独立安装到隔离目录，不能依赖宿主默认携带插件。
        const packages = new PluginPackages(registry, path.join(temporary, 'staging'));
        const prepared = packages.prepare(
            encodeZip(collectFiles(path.join(root, 'src/plugin-library/local-search')), { native: true })
        );
        try {
            registry.install(prepared.directory);
        } finally {
            packages.cleanup(prepared);
        }
        win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { offscreen: true } });
        const theme = require('../../src/theme').validate({ preset: 'office' });
        runtime = new PluginRuntime({
            registry,
            getWindow: () => win,
            getTheme: () => theme,
            changed: () => {},
            smoke: true
        });
        services = new PluginServices(registry, {
            dataDirectory: temporary,
            smoke: true,
            getSettings: () => ({ theme }),
            getWindow: () => win,
            openPlugin: () => {}
        });
        runtime.services = services;
        await services.load();
        assert.ok(!services.errors.has('collectify.local-search'), services.errors.get('collectify.local-search'));
        await runtime.open('collectify.local-search', 'open', 'search');
        const wc = runtime.views.get('collectify.local-search').view.webContents,
            js = (code) => wc.executeJavaScript(code);
        const until = async (predicate) => {
            for (let i = 0; i < 120; i++) {
                if (await predicate()) return;
                await delay(60);
            }
            throw Error('Local search UI timeout');
        };
        await until(() => js('!!settings'));
        assert.equal(await js("document.querySelectorAll('#result-columns [role=separator]').length"), 4);
        await js(
            "(()=>{const handle=document.querySelector('#result-columns [role=separator]');handle.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));})()"
        );
        await until(() => js('settings.columns[0]===250'));
        const dividerPoint = await js(
            "(()=>{const r=document.querySelector('#preview-divider').getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+30)}})()"
        );
        wc.sendInputEvent({ type: 'mouseDown', ...dividerPoint, button: 'left' });
        wc.sendInputEvent({ type: 'mouseMove', x: dividerPoint.x + 120, y: dividerPoint.y });
        wc.sendInputEvent({ type: 'mouseUp', x: dividerPoint.x + 120, y: dividerPoint.y, button: 'left' });
        await until(() => js('settings.splitRatio>0.42'));
        await js("document.querySelector('#preview-expand').click()");
        assert.equal(await js("document.querySelector('.search-layout').classList.contains('preview-expanded')"), true);
        await js("document.querySelector('#preview-expand').click()");
        assert.equal(await js("document.querySelector('#filters')"), null);
        const navigation = services.navigation('collectify.local-search');
        assert.equal(navigation.length, 11);
        assert.ok(navigation.every((item) => item.icon));
        const original = dialog.showOpenDialog;
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixtures] });
        try {
            await js("document.querySelector('#choose-folder').click()");
            await until(() => js("document.querySelectorAll('.result-row').length>=10"));
        } finally {
            dialog.showOpenDialog = original;
        }
        const pick = async (name) => {
            await js(
                `(()=>{const e=[...document.querySelectorAll('.result-row')].find(n=>n.title.endsWith(${JSON.stringify(path.sep + name)}));if(!e)throw Error('Fixture missing: '+${JSON.stringify(name)});e.click();})()`
            );
        };
        await pick('sample.xlsx');
        await until(() => js("document.querySelector('#preview table')?.textContent.includes('测试')"));
        await pick('sample.docx');
        await until(() => js("document.querySelector('#preview pre')?.textContent.includes('文档预览测试')"));
        await pick('sample.png');
        await until(() => js("!!document.querySelector('#preview img')?.naturalWidth"));
        await pick('sample.psd');
        await until(() => js("!!document.querySelector('#preview img')?.naturalWidth"));
        await pick('sample.pdf');
        await until(() =>
            js(
                "document.querySelector('.pdf-canvas')?.width>0 && document.querySelector('.pdf-toolbar span')?.textContent==='1 / 1'"
            )
        );
        await pick('sample.wav');
        await until(() => js("document.querySelector('#preview audio')?.readyState>=1"));
        if (process.platform === 'win32') {
            await pick('sample.zip');
            await until(() => js("document.querySelector('#preview table')?.textContent.includes('readme.txt')"));
        }
        await pick('readme.txt');
        await until(() => js("document.querySelector('#preview pre')?.textContent.includes('<script>')"));
        assert.deepEqual(runtime.views.get('collectify.local-search').errors, []);
        await runtime.open('collectify.local-search', 'open', 'image');
        await until(() => js("filter==='image' && document.querySelectorAll('.result-row').length===4"));
        await runtime.open('collectify.local-search', 'open', 'all');
        await until(() => js("filter==='all' && document.querySelectorAll('.result-row').length>=10"));
        await js(
            "document.querySelector('#query').value='sample';document.querySelector('#query').dispatchEvent(new Event('input',{bubbles:true}))"
        );
        await until(() =>
            js(
                "document.querySelectorAll('.result-row').length>0 && [...document.querySelectorAll('.result-row')].every(n=>n.textContent.includes('sample'))"
            )
        );
        await js("document.querySelector('#settings-open').click()");
        await until(() => js("document.querySelector('#settings').open"));
        assert.ok(await js("document.querySelectorAll('#filter-settings>div').length>=10"));
        const originalFilter = await js('settings.filters[1].enabled');
        await js("document.querySelectorAll('#filter-settings input')[1].click()");
        wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
        wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
        await until(() => js("!!document.querySelector('.unsaved-changes-dialog[open]')"));
        await js("document.querySelector('[data-choice=cancel]').click()");
        await until(() => js("!document.querySelector('.unsaved-changes-dialog')"));
        assert.equal(await js("document.querySelector('#settings').open"), true);
        assert.equal(await js('draft.filters[1].enabled'), !originalFilter);
        await js('void closeSearchSettings()');
        await until(() => js("!!document.querySelector('.unsaved-changes-dialog[open]')"));
        await js("document.querySelector('[data-choice=save]').click()");
        await until(() => js("!document.querySelector('#settings').open"));
        assert.equal(await js('settings.filters[1].enabled'), !originalFilter);
        await js(
            "document.querySelector('#settings-open').click();document.querySelectorAll('#filter-settings input')[1].click();void closeSearchSettings()"
        );
        await until(() => js("!!document.querySelector('.unsaved-changes-dialog[open]')"));
        await js("document.querySelector('[data-choice=discard]').click()");
        await until(() => js("!document.querySelector('#settings').open"));
        assert.equal(await js('settings.filters[1].enabled'), !originalFilter);
        await js(
            "document.querySelector('#settings-open').click();document.querySelectorAll('#filter-settings input')[1].click()"
        );
        await js("document.querySelector('#settings-save').click()");
        await js("document.querySelector('#preview-toggle').click()");
        await until(() => js("document.querySelector('.search-layout').classList.contains('preview-off')"));
        await js("document.querySelector('#preview-toggle').click()");
        await until(() => js("!document.querySelector('.search-layout').classList.contains('preview-off')"));
        await js("document.querySelector('#clear-query').click()");
        await until(() => js("document.querySelectorAll('.result-row').length>=10"));
        await js("[...document.querySelectorAll('.result-row input[type=checkbox]')].slice(0,2).forEach(e=>e.click())");
        assert.equal(await js('compareFiles.size'), 2);
        const comparedIds = await js('[...compareFiles]');
        assert.equal((await services.call('collectify.local-search', 'diff-open', { ids: comparedIds })).missing, true);
        registry.install(path.join(root, 'src/plugin-library/diff'));
        await services.load();
        let openedDiff;
        services.environment.openPlugin = async (...args) => {
            openedDiff = args;
        };
        await js("document.querySelector('#compare-selected').click()");
        await until(() => !!openedDiff);
        assert.equal(openedDiff[0], 'collectify.diff');
        assert.equal(openedDiff[2].paths.length, 2);
        assert.ok(openedDiff[2].paths.every((p) => fs.statSync(p).isFile()));
        await pick('sample.xlsx');
        await until(() => js("document.querySelector('#preview table')?.textContent.includes('测试')"));
        await delay(150);
        const screenshot = path.join(temporary, 'local-search.png');
        fs.writeFileSync(screenshot, (await wc.capturePage()).toPNG());
        console.log('Screenshot:', screenshot);
        console.log(
            'LOCAL SEARCH UI PASS: real plugin protocol/SDK, folder search, XLSX, Word, PNG/PSD, PDF canvas, audio range loading, archive, text safety, settings and preview toggle.'
        );
        await services.dispose();
        runtime.close('collectify.local-search');
        win.destroy();
        app.exit(0);
    } catch (error) {
        console.error(error);
        await services?.dispose().catch(() => {});
        win?.destroy();
        app.exit(1);
    }
});
