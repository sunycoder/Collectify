const defaults = require('./defaults.json');
const { preferences, location } = require('./preferences');
exports.create = async (context, adapters = {}) => {
    // 启动只创建轻量对象；历法库、天气模型、Electron、SQLite 和 MCP schema 全部按需加载。
    let active = false,
        disposed = false,
        visible = true,
        saved,
        revision = 0,
        taskBridge;
    const jobs = new Map(),
        cache = new Map();
    const clock = adapters.now || Date.now;
    const electron = () => adapters.electron || require('electron');
    const core = () => require('./vendor/calendar-core.cjs');
    const database = (action) => {
        const fs = require('node:fs'),
            path = require('node:path'),
            { DatabaseSync } = require('node:sqlite');
        fs.mkdirSync(path.dirname(context.file), { recursive: true });
        const db = new DatabaseSync(context.file);
        try {
            db.exec(
                'PRAGMA busy_timeout=3000; CREATE TABLE IF NOT EXISTS calendar_preferences(id INTEGER PRIMARY KEY CHECK(id=1),value TEXT NOT NULL CHECK(json_valid(value))) STRICT'
            );
            return action(db);
        } finally {
            db.close();
        }
    };
    const initialize = () => {
        if (saved !== undefined) return;
        const row = database((db) => db.prepare('SELECT value FROM calendar_preferences WHERE id=1').get());
        saved = row ? preferences(JSON.parse(row.value)) : {};
    };
    const persist = (value) => {
        const clean = preferences(value);
        database((db) =>
            db
                .prepare(
                    'INSERT INTO calendar_preferences VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value'
                )
                .run(JSON.stringify(clean))
        );
        saved = clean;
        return { ...saved };
    };
    const cancel = (channel) => {
        if (channel) {
            jobs.get(channel)?.abort(Error('天气查询已取消'));
            jobs.delete(channel);
        } else {
            revision++;
            for (const job of jobs.values()) job.abort(Error('天气查询已取消'));
            jobs.clear();
        }
    };
    async function request(channel, pathname, params) {
        if (!active || disposed) throw Error('插件已停用');
        if (!visible) throw Error('日历页面未显示，已暂停天气查询');
        cancel(channel);
        const key = pathname + '?' + new URLSearchParams(params).toString();
        const cached = cache.get(key),
            ttl = channel === 'search' ? defaults.searchCacheMs : defaults.weatherCacheMs;
        if (cached && clock() - cached.fetchedAt < ttl)
            return { raw: structuredClone(cached.data), fetchedAt: cached.fetchedAt, cached: true };
        const controller = new AbortController(),
            generation = revision;
        jobs.set(channel, controller);
        const timeout = setTimeout(() => controller.abort(Error('天气服务请求超时，请稍后重试')), defaults.timeoutMs);
        let listener;
        const aborted = new Promise((_, reject) => {
            listener = () => reject(controller.signal.reason);
            controller.signal.addEventListener('abort', listener, { once: true });
        });
        const work = async () => {
            let response;
            try {
                response = await (adapters.fetch || ((url, options) => electron().net.fetch(url, options)))(
                    defaults.weatherBaseUrl + key,
                    {
                        signal: controller.signal,
                        redirect: 'error',
                        credentials: 'omit',
                        cache: 'no-store',
                        headers: { Accept: 'application/json' }
                    }
                );
            } catch {
                if (controller.signal.aborted) throw controller.signal.reason;
                throw Error('无法连接小米天气，请检查网络或系统代理');
            }
            if (!response.ok) {
                await response.body?.cancel();
                throw Error(
                    response.status === 429
                        ? '天气服务请求过于频繁，请稍后再试'
                        : `天气服务暂不可用（HTTP ${response.status}）`
                );
            }
            const reader = response.body?.getReader();
            if (!reader) throw Error('天气服务没有返回内容');
            const cancelReader = () => {
                void reader.cancel().catch(() => {});
            };
            controller.signal.addEventListener('abort', cancelReader, { once: true });
            const chunks = [];
            let size = 0;
            try {
                for (;;) {
                    if (controller.signal.aborted) throw controller.signal.reason;
                    const part = await reader.read();
                    if (part.done) break;
                    size += part.value.byteLength;
                    if (size > defaults.responseLimit) throw Error('天气数据超过大小限制');
                    chunks.push(Buffer.from(part.value));
                }
            } finally {
                controller.signal.removeEventListener('abort', cancelReader);
                await reader.cancel().catch(() => {});
            }
            try {
                return JSON.parse(Buffer.concat(chunks).toString('utf8'));
            } catch {
                throw Error('天气服务返回格式不正确');
            }
        };
        try {
            const data = await Promise.race([work(), aborted]);
            if (!active || disposed || generation !== revision || controller.signal.aborted)
                throw Error('天气查询已取消');
            cache.delete(key);
            cache.set(key, { data, fetchedAt: clock() });
            while (cache.size > defaults.cacheLimit) cache.delete(cache.keys().next().value);
            return { raw: structuredClone(data), fetchedAt: clock(), cached: false };
        } finally {
            clearTimeout(timeout);
            controller.signal.removeEventListener('abort', listener);
            if (jobs.get(channel) === controller) jobs.delete(channel);
        }
    }
    const actionNames = {
        get_date_info: 'getDateInfo',
        get_almanac: 'getAlmanac',
        get_festivals: 'getFestivals',
        search_next_festival: 'searchNextFestival',
        get_shichen: 'getShichen'
    };
    const assertActive = () => {
        if (!active || disposed) throw Error('日历插件已停用');
    };
    const query = (action, input = {}) => {
        assertActive();
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('查询参数不正确');
        if (
            action === 'search_next_festival' &&
            (!input.festival_name || typeof input.festival_name !== 'string' || input.festival_name.length > 60)
        )
            throw Error('节日名称长度应为 1～60 个字符');
        return core()[actionNames[action]](input);
    };
    return {
        activate() {
            if (disposed) throw Error('插件已卸载');
            active = true;
        },
        deactivate() {
            taskBridge?.cancel();
            active = false;
            visible = false;
            cancel();
            cache.clear();
        },
        dispose() {
            taskBridge?.cancel();
            disposed = true;
            active = false;
            cancel();
            cache.clear();
        },
        layout(_bounds, shown) {
            if (visible !== shown) {
                visible = shown;
                if (!shown) {
                    taskBridge?.cancel();
                    cancel();
                }
                context.emit?.('visibility', shown);
            }
        },
        async call(action, input = {}) {
            assertActive();
            if (action === 'tasks-read' || action === 'tasks-open') {
                taskBridge ||= require('./tasks-bridge').createTaskBridge(context, () => active && !disposed);
                return action === 'tasks-read' ? taskBridge.read(input) : taskBridge.open();
            }
            if (Object.hasOwn(actionNames, action)) return query(action, input);
            if (action === 'weather-cancel') {
                cancel();
                return;
            }
            if (action === 'state') {
                initialize();
                return { preferences: { ...saved }, visible };
            }
            if (action === 'preferences') {
                initialize();
                return persist(input);
            }
            if (action === 'weather-search') {
                if (typeof input.query !== 'string' || input.query.trim().length > 60)
                    throw Error('城市名最多 60 个字符');
                if (input.query.trim().length < 2) {
                    cancel('search');
                    return [];
                }
                const { raw } = await request('search', 'location/city/search', {
                    name: input.query.trim(),
                    locale: 'zh_cn'
                });
                if (!Array.isArray(raw)) throw Error('天气城市搜索返回格式不正确');
                return raw
                    .filter(
                        (item) =>
                            item &&
                            typeof item.name === 'string' &&
                            item.latitude !== null &&
                            item.longitude !== null &&
                            Number.isFinite(Number(item.latitude)) &&
                            Number.isFinite(Number(item.longitude)) &&
                            Math.abs(Number(item.latitude)) <= 90 &&
                            Math.abs(Number(item.longitude)) <= 180
                    )
                    .slice(0, 30)
                    .map((item) => ({
                        name: item.name.slice(0, 100),
                        locationKey: String(item.locationKey || item.key || '').slice(0, 150),
                        lat: Number(item.latitude),
                        lon: Number(item.longitude),
                        affiliation: typeof item.affiliation === 'string' ? item.affiliation.slice(0, 200) : ''
                    }));
            }
            if (action === 'weather') {
                const selected = location(input.location);
                const response = await request('forecast', 'weather/all', {
                    latitude: String(selected.lat),
                    longitude: String(selected.lon),
                    isLocated: 'true',
                    days: '5',
                    appKey: defaults.weatherAppKey,
                    sign: defaults.weatherSign,
                    isGlobal: 'false',
                    locale: 'zh_cn'
                });
                const raw = response.raw;
                if (
                    !raw?.current ||
                    raw.current.temperature?.value == null ||
                    raw.current.temperature.value === '' ||
                    !Number.isFinite(Number(raw.current.temperature.value))
                )
                    throw Error('天气服务未返回有效的当前天气');
                const models = require('./vendor/weather-models.cjs');
                return {
                    current: models.parseCurrentWeather(raw.current),
                    daily: models.parseDailyForecast(raw.forecastDaily).slice(0, 5),
                    hourly: models.parseHourlyForecast(raw.forecastHourly).slice(0, 24),
                    locationName: selected.name,
                    source: '小米天气',
                    fetchedAt: response.fetchedAt,
                    cached: response.cached,
                    sourceUpdatedAt: raw.forecastDaily?.pubTime || null
                };
            }
            if (action === 'open-external') {
                let url;
                try {
                    url = new URL(input.url);
                } catch {
                    throw Error('链接不正确');
                }
                if (
                    url.protocol !== 'https:' ||
                    url.username ||
                    url.password ||
                    !(
                        (url.hostname === 'github.com' && url.pathname === '/scutken/he-calendar') ||
                        (url.hostname === 'cal.heshe.tech' && url.pathname === '/') ||
                        (url.hostname === 'baike.baidu.com' && url.pathname.startsWith('/item/'))
                    )
                )
                    throw Error('不支持的日历外部链接');
                await electron().shell.openExternal(url.href);
                return;
            }
            throw Error('不支持的日历操作');
        },
        exportData() {
            initialize();
            return { schemaVersion: 1, preferences: { ...saved } };
        },
        planData(input) {
            if (input?.schemaVersion !== 1) throw Error('日历备份版本不受支持');
            return { schemaVersion: 1, preferences: preferences(input.preferences) };
        },
        importData(input) {
            return persist(input.preferences);
        },
        mcpTools() {
            const schemas = require('./vendor/tool-schemas.cjs').schemas();
            const descriptions = {
                get_date_info: '查询公历、农历、生肖、干支、节气、节日及内置调休信息，日期 YYYY-MM-DD，不传为今天',
                get_almanac: '查询传统黄历宜忌、五行纳音、冲煞、胎神和彭祖百忌，仅供民俗参考',
                get_festivals: '查询日期范围的节日、节气及内置假期，含首尾最多400天，不传默认今天起30天',
                search_next_festival: '从今天起最多400天查找下一个指定节日或节气',
                get_shichen: '查询指定日期十二时辰干支与传统宜忌、吉凶，仅供民俗参考'
            };
            return Object.keys(actionNames).map((name) => ({
                name: 'calendar_' + name,
                description: descriptions[name],
                inputSchema: schemas[name],
                handler: (input) => query(name, input)
            }));
        }
    };
};
