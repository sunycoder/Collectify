const { test } = require('node:test');
const assert = require('node:assert/strict'),
    fs = require('node:fs'),
    path = require('node:path'),
    os = require('node:os');
const { create } = require('../src/plugin-library/chinese-calendar/backend');
const core = require('../src/plugin-library/chinese-calendar/vendor/calendar-core.cjs');
const { preferences } = require('../src/plugin-library/chinese-calendar/preferences');
const source = path.resolve(__dirname, '../src/plugin-library/chinese-calendar');
const weather = require('./fixtures/calendar-weather.json');
const city = { name: '北京市', locationKey: 'weathercn:101010100', lat: 39.904, lon: 116.408 };
function temp(t) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'collectify-lunar-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    return root;
}
async function fixture(t, adapters = {}) {
    const file = path.join(temp(t), 'data/data.sqlite');
    const provider = await create({ file }, adapters);
    provider.activate();
    t.after(() => provider.dispose());
    return { file, provider };
}
test('日历启用不加载历法、天气、MCP、SQLite 或 Electron，不建库不启动后台任务', (t) => {
    const { spawnSync } = require('node:child_process'),
        file = path.join(temp(t), 'absent/data.sqlite');
    const result = spawnSync(
        process.execPath,
        [
            '-e',
            `const Module=require('module'),fs=require('fs'),load=Module._load;Module._load=function(id,...args){if(/vendor|electron|sqlite|http|tyme|zod/.test(id))throw Error('eager '+id);return load.call(this,id,...args)};const resources=process.getActiveResourcesInfo();require(${JSON.stringify(path.join(source, 'backend.js'))}).create({file:${JSON.stringify(file)}}).then(p=>{p.activate();p.deactivate();p.activate();p.dispose();if(fs.existsSync(${JSON.stringify(file)}))throw Error('eager data');if(JSON.stringify(resources)!==JSON.stringify(process.getActiveResourcesInfo()))throw Error('handles leaked')}).catch(e=>{console.error(e);process.exitCode=1});`
        ],
        { encoding: 'utf8', windowsHide: true }
    );
    assert.equal(result.status, 0, result.stderr);
});
test('离线农历节日、节气、黄历、时辰、严格日期及范围边界', () => {
    const spring = core.getDateInfo({ date: '2026-02-17' });
    assert.equal(spring.lunar_date_full, '正月初一');
    assert.equal(spring.zodiac, '马');
    assert.ok(spring.festivals.some((f) => f.name === '春节'));
    assert.equal(spring.legal_holiday.is_work, false);
    assert.equal(core.getDateInfo({ date: '2026-02-04' }).solar_term, '立春');
    assert.equal(core.parseDate('2024-02-29').day, 29);
    for (const date of ['2026-02-30', '2026-2-04', '1900-01-01', '2100-01-01', 'bad'])
        assert.throws(() => core.getDateInfo({ date }));
    const almanac = core.getAlmanac({ date: '2026-02-17' });
    assert.ok(almanac.yi.length);
    assert.ok(almanac.ji.length);
    assert.ok(almanac.wu_xing);
    assert.ok(almanac.peng_zu);
    assert.ok(almanac.tai_shen);
    const hours = core.getShichen({ date: '2026-02-17' });
    assert.equal(hours.hours.length, 12);
    assert.equal(hours.hours[0].god, '天牢');
    assert.throws(() => core.getFestivals({ start_date: '2026-11-17', end_date: '2026-11-16' }), /结束/);
    assert.throws(() => core.getFestivals({ start_date: '2026-01-01', end_date: '2027-02-05' }), /400/);
    assert.ok(
        core
            .getFestivals({ start_date: '2026-02-16', end_date: '2026-02-18' })
            .results.some((r) => r.date === '2026-02-17')
    );
});
test('偏好与天气城市真实落库、备份导入与重启保持，坏配置不覆盖已有数据', async (t) => {
    const { provider, file } = await fixture(t);
    assert.equal(fs.existsSync(file), false);
    assert.deepEqual((await provider.call('state')).preferences, {});
    const prefs = {
        'calendar-theme': 'ink',
        'calendar-week-start': '1',
        'calendar-weather-location': JSON.stringify(city)
    };
    await provider.call('preferences', prefs);
    await assert.rejects(provider.call('preferences', { 'calendar-theme': 'unknown' }));
    assert.equal(provider.exportData().preferences['calendar-theme'], 'ink');
    assert.throws(() => preferences({ 'calendar-weather-location': '{"name":"url","lat":999,"lon":0}' }));
    assert.throws(() => provider.planData({ schemaVersion: 2, preferences: {} }));
    provider.importData(provider.planData({ schemaVersion: 1, preferences: { 'calendar-theme': 'red' } }));
    const reopened = await create({ file });
    reopened.activate();
    assert.equal((await reopened.call('state')).preferences['calendar-theme'], 'red');
    await reopened.dispose();
});
test('天气城市搜索与当前/逐时/未来四天天气、缓存时间及响应字段正确', async (t) => {
    let time = 1000,
        requests = 0;
    const { provider } = await fixture(t, {
        now: () => time,
        fetch: async (url, options) => {
            requests++;
            assert.ok(url.startsWith('https://weatherapi.market.xiaomi.com/wtr-v3/'));
            assert.equal(options.redirect, 'error');
            assert.equal(options.credentials, 'omit');
            return Response.json(
                url.includes('city/search')
                    ? [
                          {
                              name: city.name,
                              locationKey: city.locationKey,
                              latitude: String(city.lat),
                              longitude: String(city.lon),
                              affiliation: '中国'
                          }
                      ]
                    : weather
            );
        }
    });
    const cities = await provider.call('weather-search', { query: '北京' });
    assert.deepEqual(cities[0], { ...city, affiliation: '中国' });
    const result = await provider.call('weather', { location: city });
    assert.equal(result.current.temp, 18);
    assert.equal(result.current.weather, '多云');
    assert.equal(result.daily.length, 5);
    assert.equal(result.hourly[0].hour, '08:00');
    assert.equal(result.daily[0].date, '2026-11-17');
    time += 1000;
    const cached = await provider.call('weather', { location: city });
    assert.equal(cached.cached, true);
    assert.equal(cached.fetchedAt, 1000);
    assert.equal(requests, 2);
    await assert.rejects(provider.call('weather', { location: { ...city, lat: Infinity } }), /城市/);
    await assert.rejects(provider.call('weather-search', { query: 'a'.repeat(61) }), /60/);
});
test('停用、隐藏、取消与新城市请求撤销旧任务，迟到结果不能进入缓存', async (t) => {
    const jobs = [];
    const { provider } = await fixture(t, {
        fetch: (url, options) => new Promise((resolve) => jobs.push({ url, signal: options.signal, resolve }))
    });
    const first = provider.call('weather', { location: city }),
        checked = assert.rejects(first, /取消/);
    const next = provider.call('weather', { location: { ...city, name: '新城市', lat: 30 } });
    assert.equal(jobs[0].signal.aborted, true);
    jobs[1].resolve(Response.json(weather));
    assert.equal((await next).locationName, '新城市');
    await checked;
    jobs[0].resolve(Response.json(weather));
    for (const action of ['hidden', 'cancel', 'deactivate']) {
        const pending = provider.call('weather', { location: city }),
            rejected = assert.rejects(pending, /取消/);
        if (action === 'hidden') provider.layout({}, false);
        else if (action === 'cancel') await provider.call('weather-cancel');
        else provider.deactivate();
        await rejected;
        jobs.at(-1).resolve(Response.json(weather));
        if (action === 'hidden') {
            await assert.rejects(provider.call('weather-search', { query: '北京' }), /未显示/);
            provider.layout({}, true);
        }
        if (action === 'deactivate') {
            await assert.rejects(provider.call('get_date_info'), /停用/);
            provider.activate();
        }
    }
});
test('天气超时与错误明确返回，离线查询继续工作；外部链接只能打开已知资料站点', async (t) => {
    let response = () => new Response('bad', { status: 503 });
    let opened;
    const { provider } = await fixture(t, {
        fetch: (...args) => response(...args),
        electron: { shell: { openExternal: (url) => (opened = url) } }
    });
    await assert.rejects(provider.call('weather-search', { query: '北京' }), /503/);
    response = () => Response.json({ error: 'bad' });
    await assert.rejects(provider.call('weather', { location: city }), /当前天气/);
    assert.equal((await provider.call('get_date_info', { date: '2026-02-17' })).lunar_day, '初一');
    await assert.rejects(provider.call('open-external', { url: 'file:///C:/Windows/system.ini' }));
    await assert.rejects(provider.call('open-external', { url: 'https://example.org' }));
    await provider.call('open-external', { url: 'https://github.com/scutken/he-calendar' });
    assert.equal(opened, 'https://github.com/scutken/he-calendar');
    t.mock.timers.enable({ apis: ['setTimeout'] });
    response = () => new Promise(() => {});
    const pending = provider.call('weather-search', { query: '上海' }),
        checked = assert.rejects(pending, /超时/);
    t.mock.timers.tick(15001);
    await checked;
});
test('日历五个只读工具通过宿主 MCP 真实客户端查询，停用后撤回工具', async (t) => {
    const { Client } = require('@modelcontextprotocol/sdk/client/index.js'),
        { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
    const { LocalMcpService } = require('../src/mcp-service');
    const { provider } = await fixture(t);
    let enabled = true;
    const repository = { readMcpConfig: () => null, saveMcpConfig: () => {} };
    const service = new LocalMcpService(
        repository,
        () => {},
        () => [
            {
                name: 'host_health',
                description: '模拟宿主常驻公共能力',
                inputSchema: {},
                handler: () => ({ ok: true })
            },
            ...(enabled ? provider.mcpTools() : [])
        ]
    );
    await service.start(0);
    const client = new Client({ name: 'calendar-test', version: '1' });
    t.after(async () => {
        await client.close();
        await service.stop(false);
    });
    await client.connect(
        new StreamableHTTPClientTransport(new URL(service.status().url), {
            requestInit: { headers: { Authorization: 'Bearer ' + service.config.token } }
        })
    );
    const tools = await client.listTools();
    assert.equal(tools.tools.filter((tool) => tool.name.startsWith('calendar_')).length, 5);
    const date = await client.callTool({ name: 'calendar_get_date_info', arguments: { date: '2026-02-17' } });
    assert.ok(JSON.stringify(date).includes('正月初一'));
    assert.ok(!date.isError);
    const bad = await client.callTool({ name: 'calendar_get_almanac', arguments: { date: '2026-02-30' } });
    assert.equal(bad.isError, true);
    enabled = false;
    provider.deactivate();
    const next = new Client({ name: 'after-disable', version: '1' });
    t.after(() => next.close());
    await next.connect(
        new StreamableHTTPClientTransport(new URL(service.status().url), {
            requestInit: { headers: { Authorization: 'Bearer ' + service.config.token } }
        })
    );
    assert.equal(
        (await next.listTools()).tools.some((tool) => tool.name.startsWith('calendar_')),
        false
    );
});
