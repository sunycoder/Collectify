const { app, BrowserWindow, protocol } = require('electron');
const fs = require('node:fs'),
    path = require('node:path'),
    os = require('node:os'),
    assert = require('node:assert/strict');
const { PluginRegistry } = require('../../src/plugin-system/registry');
const { PluginRuntime } = require('../../src/plugin-system/runtime');
const { PluginServices } = require('../../src/plugin-system/services');
const { PluginPackages, collectFiles, encodeZip } = require('../../src/plugin-system/package');
const root = path.resolve(__dirname, '../..'),
    id = 'collectify.chinese-calendar',
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'collectify-calendar-ui-'));
protocol.registerSchemesAsPrivileged([
    {
        scheme: 'collectify-plugin',
        privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
    }
]);
app.disableHardwareAcceleration();
app.setAppPath(path.resolve(__dirname, '../..'));
app.setPath('userData', tmp);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
app.whenReady().then(async () => {
    let runtime, services, win;
    try {
        fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
        const registry = new PluginRegistry({
            builtinRoot: path.join(root, 'src/plugins'),
            userRoot: path.join(tmp, 'packages'),
            dataRoot: path.join(tmp, 'data'),
            hostFile: path.join(tmp, 'host.sqlite')
        });
        assert.equal(registry.plugins.has(id), false);
        assert.equal(registry.defaults().length, 5);
        const packages = new PluginPackages(registry, path.join(tmp, 'staging')),
            packed = encodeZip(collectFiles(path.join(root, 'src/plugin-library/chinese-calendar')), {
                native: true,
                store: true
            }),
            prepared = packages.prepare(packed);
        registry.install(prepared.directory, prepared.manifest);
        packages.cleanup(prepared);
        let theme = require('../../src/theme').validate({ preset: 'office' });
        win = new BrowserWindow({ show: false, width: 1250, height: 880, webPreferences: { offscreen: true } });
        runtime = new PluginRuntime({
            registry,
            getWindow: () => win,
            getTheme: () => theme,
            changed: () => {},
            smoke: true
        });
        services = new PluginServices(registry, {
            dataDirectory: tmp,
            smoke: true,
            getSettings: () => ({ theme }),
            setSettings: () => {},
            getWindow: () => win,
            openPlugin: () => {}
        });
        runtime.services = services;
        services.on('event', (e) => runtime.emit(e.pluginId, e.name, e.data));
        await services.load();
        assert.ok(!services.errors.has(id), services.errors.get(id));
        const file = path.join(registry.dataRoot, id, 'data.sqlite');
        assert.equal(fs.existsSync(file), false, '启用但未打开不建库');
        const tools = services.contributions().filter((t) => t.pluginId === id);
        assert.equal(tools.length, 5);
        assert.equal(fs.existsSync(file), false, '工具注册不读取配置');
        await services.unload(id);
        let network = 0;
        const backend = await require(path.join(registry.get(id).directory, 'backend.js')).create(
            {
                file,
                emit: (name, data) => runtime.emit(id, name, data),
                available: (other) => registry.plugins.get(other)?.enabled === true && services.providers.has(other),
                invoke: (other, action, input) => services.call(other, action, input),
                open: (other, route) => {
                    return Promise.resolve();
                }
            },
            {
                fetch: async (url) => {
                    network++;
                    return Response.json(
                        url.includes('city/search')
                            ? [
                                  {
                                      name: '北京市',
                                      locationKey: 'weathercn:101010100',
                                      latitude: '39.904',
                                      longitude: '116.408',
                                      affiliation: '中国'
                                  }
                              ]
                            : require('../fixtures/calendar-weather.json')
                    );
                }
            }
        );
        services.providers.set(id, backend);
        await services.enable(id);
        let wc, js;
        const until = async (predicate) => {
            for (let i = 0; i < 200; i++) {
                if (await predicate()) return;
                await wait(50);
            }
            throw Error('日历界面等待超时');
        };
        const open = async () => {
            await runtime.open(id, 'open', 'home');
            wc = runtime.views.get(id).view.webContents;
            js = async (code) => {
                try {
                    return await wc.executeJavaScript(code);
                } catch (error) {
                    throw Error(code + '\n' + error.message);
                }
            };
            await until(() => js("document.querySelectorAll('.day-cell').length===42"));
        };
        await open();
        assert.equal(network, 0, '默认城市未选择时不得联网');
        assert.equal(await js("document.querySelector('.calendar-brand').naturalWidth>0"), true);
        const month = await js("document.querySelectorAll('.year-month')[1].textContent.trim()");
        await js("document.querySelectorAll('.actions > button')[2].click()");
        await until(() =>
            js(`document.querySelectorAll('.year-month')[1].textContent.trim()!==${JSON.stringify(month)}`)
        );
        await js("document.querySelector('.actions > .text-btn').click()");
        await wait(250);
        const today = new Date(),
            year = today.getFullYear();
        await js("document.querySelectorAll('.year-month')[1].click()");
        await until(() => js("document.querySelector('.month-picker')!==null"));
        await js("document.querySelectorAll('.month-picker .picker-item')[1].click()");
        await until(() => js('!!document.querySelector(\'.day-cell[data-date="2026-02-17"]\')'));
        await js('document.querySelector(\'.day-cell[data-date="2026-02-17"]\').click()');
        await until(() => js("document.querySelector('.lunar-full').textContent.includes('正月初一')"));
        assert.ok((await js("document.querySelector('.almanac-panel').textContent")).includes('彭祖'));
        assert.ok(await js("document.querySelector('.day-diff').textContent.includes('天')"));
        const scheduled = await services.call('collectify.tasks', 'task-save', {
            title: '日历联动：项目评审',
            startAt: new Date(2026, 1, 17, 9, 30).toISOString(),
            endAt: new Date(2026, 1, 17, 10, 30).toISOString(),
            status: 'doing',
            important: true
        });
        await services.call('collectify.tasks', 'task-save', {
            title: '日历联动：提交材料',
            dueAt: new Date(2026, 1, 17, 18).toISOString(),
            status: 'todo'
        });
        await services.call('collectify.tasks', 'task-save', {
            title: '日历联动：已经完成',
            dueAt: new Date(2026, 1, 17, 12).toISOString(),
            status: 'done'
        });
        await js("document.querySelector('.task-refresh').click()");
        await until(() => js("document.querySelectorAll('.calendar-task').length===3"));
        assert.ok(
            await js(
                "document.querySelector('.day-cell[data-date=\"2026-02-17\"] .task-day-badge').textContent.includes('3')"
            )
        );
        await services.disable('collectify.tasks');
        registry.setEnabled('collectify.tasks', false);
        await js("document.querySelector('.task-refresh').click()");
        await until(() => js("document.querySelector('.calendar-tasks').textContent.includes('未安装或未启用')"));
        assert.equal(await js("document.querySelectorAll('.task-day-badge').length"), 0, '停用必须清除旧计数');
        registry.setEnabled('collectify.tasks', true);
        await services.enable('collectify.tasks');
        await services.call('collectify.tasks', 'task-save', { id: scheduled.id, title: '日历联动：更新后的评审' });
        await js("document.querySelector('.task-refresh').click()");
        await until(() => js("document.querySelector('.calendar-tasks').textContent.includes('更新后的评审')"));
        await js("document.querySelector('.theme-trigger').click()");
        await until(() => js("document.querySelector('.theme-options')!==null"));
        assert.equal(await js("document.querySelectorAll('.theme-option-item').length"), 6);
        await js(
            "[...document.querySelectorAll('.theme-option-item')].find(n=>n.textContent.includes('朱红')).click()"
        );
        await until(() => js("document.querySelector('.calendar-container').classList.contains('theme-red')"));
        await js("document.querySelector('.settings-wrapper > button').click()");
        await until(() => js("document.querySelector('.settings-panel')!==null"));
        assert.equal(await js("document.querySelector('.settings-panel').textContent.includes('关于合社日历')"), false);
        await js("[...document.querySelectorAll('.option-btn')].find(n=>n.textContent.trim()==='周一').click()");
        await until(() => js("document.querySelector('.week-day').textContent.trim()==='一'"));
        await js(
            "const input=document.querySelector('.location-input');input.value='北京';input.dispatchEvent(new Event('input',{bubbles:true}));input.focus()"
        );
        await until(() => js("document.querySelector('.location-result-item')?.textContent.includes('北京市')"));
        await js("document.querySelector('.location-result-item').click()");
        await until(() => js("document.querySelector('.weather-brief-temp')?.textContent.includes('18')"));
        assert.equal(network, 2);
        await js("document.querySelector('.settings-wrapper > button').click()");
        await js("document.querySelector('.weather-brief').dispatchEvent(new MouseEvent('mouseenter'))");
        await until(() => js("document.querySelector('.weather-card')!==null"));
        assert.equal(await js("document.querySelectorAll('.weather-card-forecast-item').length"), 4);
        assert.equal(await js("document.querySelectorAll('.weather-hourly-item').length"), 4);
        runtime.layout(true);
        await wait(200);
        fs.writeFileSync(path.join(root, 'dist/calendar-weather-preview.png'), (await wc.capturePage()).toPNG());
        await js("document.querySelector('.weather-brief').dispatchEvent(new MouseEvent('mouseleave'))");
        await wait(250);
        fs.writeFileSync(path.join(root, 'dist/calendar-preview.png'), (await wc.capturePage()).toPNG());
        await until(async () => {
            const state = await services.call(id, 'state');
            return state.preferences['calendar-theme'] === 'red' && state.preferences['calendar-week-start'] === '1';
        });
        backend.layout({}, false);
        await wait(60);
        backend.layout({}, true);
        await wait(60);
        assert.equal(network, 2, '重新显示优先读取天气缓存');
        await js("document.querySelector('.theme-trigger').click()");
        await until(() => js("document.querySelector('.theme-options')!==null"));
        await js('document.querySelector(\'[title="夜间模式"]\').click()');
        await until(() => js("document.querySelector('.calendar-container').classList.contains('dark-mode')"));
        await js("document.querySelector('.theme-trigger').click()");
        win.setContentSize(390, 850);
        runtime.layout(true);
        await wait(200);
        assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'), true, '窄屏不应出现横向溢出');
        const backup = backend.exportData();
        assert.equal(backup.preferences['calendar-theme'], 'red');
        runtime.close(id);
        await services.disable(id);
        registry.setEnabled(id, false);
        assert.equal(
            services.contributions().some((t) => t.pluginId === id),
            false
        );
        await assert.rejects(runtime.open(id, 'open', 'home'));
        registry.setEnabled(id, true);
        await services.enable(id);
        await open();
        assert.equal(await js("document.querySelector('.calendar-container').classList.contains('theme-red')"), true);
        runtime.close(id);
        await services.unload(id);
        const exported = packages.export(id);
        registry.uninstall(id);
        const reinstall = packages.prepare(exported);
        registry.install(reinstall.directory, reinstall.manifest);
        packages.cleanup(reinstall);
        await services.load();
        assert.equal((await services.call(id, 'state')).preferences['calendar-week-start'], '1');
        if (process.argv.includes('--live-network')) {
            const cities = await services.call(id, 'weather-search', { query: '北京' });
            assert.ok(cities.length);
            const real = await services.call(id, 'weather', { location: cities[0] });
            assert.ok(Number.isFinite(real.current.temp));
            assert.ok(real.daily.length >= 5);
            console.log('LIVE WEATHER PASS:', real.locationName, real.current.temp, '°C', real.daily.length, 'days');
        }
        await services.unload(id);
        registry.uninstall(id, { deleteData: true });
        assert.equal(fs.existsSync(file), false);
        await services.dispose();
        runtime.destroy();
        win.destroy();
        console.log(
            'CHINESE CALENDAR UI PASS:',
            process.platform,
            '上游 Vue 页面、月切换、农历黄历、主题、日期距离、周起始、天气卡片、缓存、MCP撤回、停用卸载重装、窄屏。'
        );
        app.exit(0);
    } catch (error) {
        console.error(error);
        await services?.dispose().catch(() => {});
        runtime?.destroy();
        win?.destroy();
        app.exit(1);
    }
});
