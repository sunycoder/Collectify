const { app, BrowserWindow, protocol, dialog } = require('electron');
const fs = require('node:fs'),
    path = require('node:path'),
    os = require('node:os'),
    assert = require('node:assert/strict');
const { PluginRegistry } = require('../src/plugin-system/registry');
const { PluginRuntime } = require('../src/plugin-system/runtime');
const { PluginServices } = require('../src/plugin-system/services');
protocol.registerSchemesAsPrivileged([
    {
        scheme: 'collectify-plugin',
        privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
    }
]);
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'collectify-search-smoke-'));
app.setPath('userData', temporary);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
app.whenReady().then(async () => {
    let runtime, services, win;
    try {
        const root = path.resolve(__dirname, '..'),
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
        win = new BrowserWindow({ show: false, width: 1280, height: 900, webPreferences: { offscreen: true } });
        const theme = require('../src/theme').validate({ preset: 'office' });
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
        await until(() => js("!!document.querySelector('#filters button')"));
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
        await js("document.querySelector('#settings-save').click()");
        await js("document.querySelector('#preview-toggle').click()");
        await until(() => js("document.querySelector('.search-layout').classList.contains('preview-off')"));
        await js("document.querySelector('#preview-toggle').click()");
        await until(() => js("!document.querySelector('.search-layout').classList.contains('preview-off')"));
        await js("document.querySelector('#clear-query').click()");
        await until(() => js("document.querySelectorAll('.result-row').length>=10"));
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
