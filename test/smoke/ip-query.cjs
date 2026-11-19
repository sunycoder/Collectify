const { app, BrowserWindow, protocol } = require('electron');
const fs = require('node:fs'),
    path = require('node:path'),
    os = require('node:os'),
    assert = require('node:assert/strict');
const { PluginRegistry } = require('../../src/plugin-system/registry');
const { PluginRuntime } = require('../../src/plugin-system/runtime');
const { PluginServices } = require('../../src/plugin-system/services');
const { PluginPackages, encodeZip, collectFiles } = require('../../src/plugin-system/package');
const root = path.resolve(__dirname, '../..'),
    id = 'collectify.ip-query';
protocol.registerSchemesAsPrivileged([
    {
        scheme: 'collectify-plugin',
        privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
    }
]);
app.disableHardwareAcceleration();
app.setAppPath(path.resolve(__dirname, '../..'));
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'collectify-ip-ui-'));
app.setPath('userData', temporary);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
app.whenReady().then(async () => {
    let win, services, runtime;
    try {
        fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
        const registry = new PluginRegistry({
            builtinRoot: path.join(root, 'src/plugins'),
            userRoot: path.join(temporary, 'packages'),
            dataRoot: path.join(temporary, 'data'),
            hostFile: path.join(temporary, 'host.sqlite')
        });
        const packages = new PluginPackages(registry, path.join(temporary, 'staging'));
        const packed = encodeZip(collectFiles(path.join(root, 'src/plugin-library/ip-query')), {
            native: true,
            store: true
        });
        const prepared = packages.prepare(packed);
        registry.install(prepared.directory, prepared.manifest);
        packages.cleanup(prepared);
        let theme = require('../../src/theme').validate({ preset: 'office' });
        win = new BrowserWindow({ show: false, width: 1120, height: 1050, webPreferences: { offscreen: true } });
        services = new PluginServices(registry, {});
        runtime = new PluginRuntime({
            registry,
            getWindow: () => win,
            getTheme: () => theme,
            changed: () => {},
            smoke: true
        });
        runtime.services = services;
        await services.load();
        assert.ok(!services.errors.has(id), services.errors.get(id));
        const file = path.join(registry.dataRoot, id, 'data.sqlite');
        assert.equal(fs.existsSync(file), false, '安装启用不应创建 IP 数据库');
        await services.unload(id);
        let unsafeCity = true,
            requests = 0,
            delayed;
        const provider = await require(path.join(registry.get(id).directory, 'backend.js')).create(
            { file },
            {
                electron: {
                    safeStorage: {
                        isEncryptionAvailable: () => true,
                        getSelectedStorageBackend: () => 'test-only',
                        encryptString: () => Buffer.from('isolated-ui-test-ciphertext')
                    }
                },
                fetch: async (url) => {
                    requests++;
                    const ip = decodeURIComponent(url.slice('https://ipwho.is/'.length)) || '8.8.8.8';
                    if (ip === '9.9.9.9')
                        return new Promise((resolve) => {
                            delayed = resolve;
                        });
                    return Response.json({
                        ip,
                        success: true,
                        country: '美国',
                        region: 'California',
                        city: unsafeCity ? '<img src=x onerror=alert(1)>' : 'San Jose',
                        connection: { isp: 'Google LLC', org: 'Google LLC', asn: 15169 },
                        latitude: 37.339,
                        longitude: -121.894,
                        timezone: { id: 'America/Los_Angeles' }
                    });
                }
            }
        );
        services.providers.set(id, provider);
        await services.enable(id);
        await runtime.open(id, 'open', 'home');
        let wc = runtime.views.get(id).view.webContents;
        let js = (code) => wc.executeJavaScript(code);
        const until = async (predicate) => {
            for (let i = 0; i < 160; i++) {
                if (await predicate()) return;
                await wait(50);
            }
            throw Error('IP 插件界面等待超时');
        };
        const errors = [];
        wc.on('console-message', (event) => {
            if (event.level === 3) errors.push(event.message);
        });
        await until(() => js("document.querySelector('#result-ip').textContent==='8.8.8.8'"));
        assert.equal(requests, 1);
        assert.equal(
            await js('!!document.querySelector(\'script[src$="tom-select.js"]\')'),
            false,
            '设置控件应按需加载'
        );
        assert.equal(await js("document.querySelector('.logo img').naturalWidth>0"), true, '使用指定 SVG 图标');
        assert.equal(await js("document.querySelector('#fields img')!==null"), false, '供应商返回内容只能作为文本展示');
        assert.match(await js("document.querySelector('#fields').textContent"), /<img/);
        await js(
            "document.querySelector('#address').value='2001:4860:4860::8888';document.querySelector('#query-form').requestSubmit()"
        );
        await until(() => js("document.querySelector('#result-type').textContent==='IPv6'"));
        await js(
            "document.querySelector('#address').value='127.0.0.1';document.querySelector('#query-form').requestSubmit()"
        );
        await until(() => js("document.querySelector('#status').textContent.includes('未向外部')"));
        assert.equal(requests, 2);
        await js(
            "document.querySelector('#address').value='https://example.com';document.querySelector('#query-form').requestSubmit()"
        );
        await until(() => js("document.querySelector('#status').classList.contains('error')"));
        assert.equal(requests, 2);
        await js("document.querySelector('#settings-open').click()");
        await until(() => js("document.querySelector('#settings-dialog').open"));
        assert.equal(await js("document.querySelector('#provider').options.length"), 2);
        const click = async (selector) => {
            // 原生弹窗重新打开后，等待控件刷新与居中布局完成；Mac 的布局/输入提交可能跨帧。
            await js('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
            const point = await js(
                `(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}})()`
            );
            assert.equal(
                await js(
                    `(()=>{const target=document.querySelector(${JSON.stringify(selector)});return target.contains(document.elementFromPoint(${point.x},${point.y}))})()`
                ),
                true,
                `点击目标被遮挡：${selector}`
            );
            wc.sendInputEvent({ type: 'mouseMove', ...point });
            wc.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
            wc.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
            await wait(60);
        };
        await click('#settings-dialog .ts-control');
        await until(() => js("!!document.querySelector('.ts-dropdown:popover-open')"));
        fs.writeFileSync(path.join(root, 'dist', 'ip-query-select-preview.png'), (await wc.capturePage()).toPNG());
        await click('.ts-dropdown [data-value="ipinfo"]');
        assert.equal(await js("document.querySelector('#key-field').hidden"), false);
        assert.equal(await js("document.querySelector('#remove-key').hidden"), true, '未保存 Key 不展示移除操作');
        await js(
            "document.querySelector('#api-key').value='isolated-test-key';document.querySelector('#settings-form').requestSubmit()"
        );
        await until(() => js("!document.querySelector('#settings-dialog').open"));
        assert.equal((await services.call(id, 'state')).settings.hasKey, true);
        await js("document.querySelector('#settings-open').click()");
        await until(() => js("document.querySelector('#settings-dialog').open"));
        await click('#remove-key');
        await until(() => js("document.querySelector('#api-key').disabled"));
        assert.equal((await services.call(id, 'state')).settings.hasKey, true, '移除需保存后生效');
        await click('#remove-key');
        await until(() => js("!document.querySelector('#api-key').disabled"));
        await click('#remove-key');
        fs.writeFileSync(path.join(root, 'dist', 'ip-query-settings-preview.png'), (await wc.capturePage()).toPNG());
        wc.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x: 10, y: 10 });
        wc.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: 10, y: 10 });
        await until(() => js("!document.querySelector('#settings-dialog').open"));
        assert.equal((await services.call(id, 'state')).settings.hasKey, true, '点击空白退出不得保存移除');
        await js("document.querySelector('#settings-open').click()");
        await until(() => js("document.querySelector('#settings-dialog').open"));
        assert.equal(await js("document.querySelector('#api-key').disabled"), false);
        await click('#remove-key');
        await js(
            "document.querySelector('#provider').tomselect.setValue('ipwhois');document.querySelector('#settings-form').requestSubmit()"
        );
        await until(() => js("!document.querySelector('#settings-dialog').open"));
        assert.equal((await services.call(id, 'state')).settings.hasKey, false, '保存才真正移除 Key');
        // 取消按钮和宿主停用均不得被迟到响应覆盖。
        await js(
            "document.querySelector('#address').value='9.9.9.9';document.querySelector('#query-form').requestSubmit()"
        );
        await until(() => !!delayed);
        await js("document.querySelector('#cancel').click()");
        await until(() => js("document.querySelector('#status').textContent==='已取消查询'"));
        delayed(Response.json({ ip: '9.9.9.9', success: true }));
        await wait(80);
        assert.equal(
            (await services.call(id, 'state')).history.some((item) => item.ip === '9.9.9.9'),
            false
        );
        delayed = undefined;
        await js("document.querySelector('#query-form').requestSubmit()");
        await until(() => !!delayed);
        await services.disable(id);
        registry.setEnabled(id, false);
        runtime.close(id);
        delayed(Response.json({ ip: '9.9.9.9', success: true }));
        registry.setEnabled(id, true);
        unsafeCity = false;
        await services.enable(id);
        await runtime.open(id, 'open', 'home');
        wc = runtime.views.get(id).view.webContents;
        js = (code) => wc.executeJavaScript(code);
        await until(() => js("document.querySelector('#result-ip').textContent==='8.8.8.8'"));
        assert.equal(
            (await services.call(id, 'state')).history.some((item) => item.ip === '9.9.9.9'),
            false
        );
        await wc.executeJavaScript('document.documentElement.style.zoom="1"');
        runtime.layout(true);
        await wait(150);
        win.setContentSize(390, 900);
        runtime.layout(true);
        await wait(100);
        assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'), true, '窄屏页面不得横向溢出');
        theme = require('../../src/theme').validate({ preset: 'ink' });
        runtime.themeChanged();
        await until(() => js("getComputedStyle(document.documentElement).colorScheme==='dark'"));
        theme = require('../../src/theme').validate({ preset: 'office' });
        runtime.themeChanged();
        win.setContentSize(1120, 1050);
        runtime.layout(true);
        await wait(100);
        const screenshot = path.join(root, 'dist', 'ip-query-preview.png');
        fs.mkdirSync(path.dirname(screenshot), { recursive: true });
        fs.writeFileSync(screenshot, (await wc.capturePage()).toPNG());
        const viewport = await js('({content:document.documentElement.scrollWidth,width:innerWidth})');
        assert.ok(viewport.content <= viewport.width, '页面不得出现横向溢出');
        assert.equal(errors.length, 0, errors.join('\n'));
        await services.unload(id);
        runtime.close(id);
        registry.uninstall(id);
        const reinstall = packages.prepare(packed);
        registry.install(reinstall.directory, reinstall.manifest);
        packages.cleanup(reinstall);
        await services.load();
        assert.equal(
            (await services.call(id, 'state')).history.some((item) => item.ip === '8.8.8.8'),
            true
        );
        if (process.argv.includes('--live-network')) {
            // 显式开启的联网检查仅查公共测试地址；普通 CI 使用上方隔离响应，不依赖供应商可用性。
            for (const ip of ['8.8.8.8', '2001:4860:4860::8888']) {
                const live = await services.call(id, 'query', { ip, refresh: true });
                assert.equal(live.ip, ip);
                console.log('LIVE IP PASS:', live.ip, live.source, live.country, live.isp);
            }
        }
        await services.unload(id);
        registry.uninstall(id, { deleteData: true });
        assert.equal(fs.existsSync(file), false);
        await services.dispose();
        runtime.destroy();
        win.destroy();
        console.log(
            'IP QUERY UI PASS:',
            process.platform,
            '签名包、真实 IPC/沙箱页面、IPv4/IPv6、错误提示、文本防注入、设置、取消、停用重启、卸载重装、记录与删除数据。'
        );
        console.log('Screenshot:', screenshot);
        app.exit(0);
    } catch (error) {
        console.error(error);
        await services?.dispose().catch(() => {});
        runtime?.destroy();
        win?.destroy();
        app.exit(1);
    }
});
