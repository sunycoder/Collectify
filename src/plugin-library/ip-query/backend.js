const defaults = require('./defaults.json');

exports.create = async (context, adapters = {}) => {
    // 宿主会在启动阶段创建后台对象。这里不打开数据库、不加载 Electron、不联网、不注册定时任务。
    let active = false,
        disposed = false,
        initialized = false,
        settings,
        history,
        secret = '',
        generation = 0,
        request;
    const cache = new Map();
    const now = adapters.now || Date.now;
    const electron = () => adapters.electron || require('electron');
    const database = (action) => {
        const fs = require('node:fs'),
            path = require('node:path');
        fs.mkdirSync(path.dirname(context.file), { recursive: true });
        const { DatabaseSync } = require('node:sqlite');
        const db = new DatabaseSync(context.file);
        try {
            db.exec(
                'PRAGMA busy_timeout=3000; CREATE TABLE IF NOT EXISTS ip_state(id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL CHECK(json_valid(value))) STRICT'
            );
            return action(db);
        } finally {
            db.close();
        }
    };
    const initialize = () => {
        if (initialized) return;
        const saved = database((db) => db.prepare('SELECT value FROM ip_state WHERE id=1').get());
        const data = saved ? JSON.parse(saved.value) : {};
        settings = { provider: Object.hasOwn(defaults.providers, data.provider) ? data.provider : defaults.provider };
        history = Array.isArray(data.history) ? data.history.slice(0, defaults.historyLimit) : [];
        secret = typeof data.secret === 'string' ? data.secret : '';
        initialized = true;
    };
    const save = (next = { ...settings, history, secret }) =>
        database((db) =>
            db
                .prepare('INSERT INTO ip_state VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value')
                .run(JSON.stringify(next))
        );
    const state = () => ({
        settings: { ...settings, hasKey: !!secret },
        history: history.map((item) => ({ ...item })),
        providers: Object.entries(defaults.providers).map(([id, item]) => ({
            id,
            label: item.label,
            requiresKey: item.requiresKey
        }))
    });
    const secureStorage = () => {
        const storage = electron().safeStorage;
        if (!storage.isEncryptionAvailable() || storage.getSelectedStorageBackend?.() === 'basic_text')
            throw Error('系统安全存储不可用，不能保存 API Key；请使用免 Key 数据源或先配置系统密钥环。');
        return storage;
    };
    const stop = () => {
        generation++;
        request?.abort(Error('查询已取消'));
        request = undefined;
    };
    async function query(input) {
        stop();
        // 地址校验和保留网段表也延迟到实际查询，启动和查看设置不加载网络模块。
        const { address, localReason, normalize } = require('./model');
        const ip = address(input.ip ?? '');
        const reason = localReason(ip);
        if (reason) return { local: true, ip, message: reason };
        const provider = settings.provider,
            definition = defaults.providers[provider];
        const key = `${provider}:${ip}`;
        const found = cache.get(key);
        if (!input.refresh && found && now() - found.queriedAt < (ip ? defaults.cacheMs : defaults.selfCacheMs))
            return { ...found, cached: true, history: history.map((item) => ({ ...item })) };
        const headers = { Accept: 'application/json' };
        if (definition.requiresKey) {
            if (!secret) throw Error('请先在数据源设置中保存 IPinfo API Key，或切换到免 Key 数据源');
            try {
                headers.Authorization = 'Bearer ' + secureStorage().decryptString(Buffer.from(secret, 'base64'));
            } catch {
                throw Error('无法解密 API Key，请检查系统密钥环或重新保存 Key');
            }
        }
        const controller = new AbortController(),
            revision = generation;
        request = controller;
        const timer = setTimeout(() => controller.abort(Error('查询超时，请检查网络或切换数据源')), defaults.timeoutMs);
        // 同时覆盖连接、响应体读取及不响应取消信号的适配器，卸载不会等待一个失控的请求。
        let onAbort;
        const aborted = new Promise((_, reject) => {
            onAbort = () => reject(controller.signal.reason);
            controller.signal.addEventListener('abort', onAbort, { once: true });
        });
        const work = async () => {
            const fetch = adapters.fetch || ((url, options) => electron().net.fetch(url, options));
            const url = definition.url + (ip ? encodeURIComponent(ip) : provider === 'ipinfo' ? 'me' : '');
            let response;
            try {
                response = await fetch(url, {
                    headers,
                    signal: controller.signal,
                    redirect: 'error',
                    credentials: 'omit',
                    cache: 'no-store'
                });
            } catch {
                if (controller.signal.aborted) throw controller.signal.reason;
                throw Error('无法连接数据源，请检查网络、代理或切换数据源');
            }
            if (!response.ok) {
                await response.body?.cancel();
                if (response.status === 429) throw Error('数据源请求过于频繁，请稍后重试或切换数据源');
                if ([401, 403].includes(response.status)) throw Error('数据源拒绝访问，请检查 API Key 或账户额度');
                throw Error(`数据源暂不可用（HTTP ${response.status}）`);
            }
            const reader = response.body?.getReader();
            if (!reader) throw Error('数据源未返回内容');
            const cancelReader = () => {
                void reader.cancel().catch(() => {});
            };
            controller.signal.addEventListener('abort', cancelReader, { once: true });
            const chunks = [];
            let size = 0;
            try {
                if (controller.signal.aborted) throw controller.signal.reason;
                for (;;) {
                    const part = await reader.read();
                    if (controller.signal.aborted) throw controller.signal.reason;
                    if (part.done) break;
                    size += part.value.byteLength;
                    if (size > defaults.responseLimit) throw Error('数据源响应过大，已停止读取');
                    chunks.push(Buffer.from(part.value));
                }
            } finally {
                controller.signal.removeEventListener('abort', cancelReader);
                await reader.cancel().catch(() => {});
            }
            let data;
            try {
                data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            } catch {
                throw Error('数据源返回了无法解析的内容');
            }
            return normalize(provider, data, ip);
        };
        try {
            const result = await Promise.race([work(), aborted]);
            if (!active || disposed || revision !== generation) throw Error('查询已取消');
            const completed = { ...result, queriedAt: now(), cached: false };
            const nextHistory = [
                {
                    ip: result.ip,
                    source: result.source,
                    provider,
                    queriedAt: completed.queriedAt,
                    location: [result.country, result.region, result.city].filter(Boolean).join(' · '),
                    isp: result.isp || result.organization || ''
                },
                ...history.filter((item) => item.ip !== result.ip)
            ].slice(0, defaults.historyLimit);
            save({ ...settings, history: nextHistory, secret });
            history = nextHistory;
            cache.delete(key);
            cache.set(key, completed);
            while (cache.size > defaults.cacheLimit) cache.delete(cache.keys().next().value);
            return { ...completed, history: history.map((item) => ({ ...item })) };
        } catch (error) {
            if (controller.signal.aborted) throw controller.signal.reason;
            // 原始网络错误可能带请求头或供应商 URL，不回传给页面或日志。
            if (error instanceof TypeError) throw Error('无法连接数据源，请检查网络、代理或切换数据源');
            throw error;
        } finally {
            clearTimeout(timer);
            controller.signal.removeEventListener('abort', onAbort);
            if (request === controller) request = undefined;
        }
    }
    return {
        activate() {
            if (disposed) throw Error('插件已卸载');
            active = true;
        },
        deactivate() {
            active = false;
            stop();
            cache.clear();
        },
        dispose() {
            active = false;
            disposed = true;
            stop();
            cache.clear();
        },
        async call(action, input = {}) {
            if (!active || disposed) throw Error('插件已停用');
            if (action === 'cancel') {
                stop();
                return;
            }
            initialize();
            if (action === 'state') return state();
            if (action === 'query') return query(input);
            if (action === 'clear-history') {
                stop();
                save({ ...settings, history: [], secret });
                history = [];
                cache.clear();
                return state();
            }
            if (action === 'settings') {
                if (!Object.hasOwn(defaults.providers, input.provider)) throw Error('不支持的数据源');
                let nextSecret = secret;
                if (input.clearKey === true) nextSecret = '';
                if (input.key) {
                    if (typeof input.key !== 'string' || !/^[\x21-\x7e]{1,500}$/.test(input.key))
                        throw Error('API Key 格式不正确');
                    nextSecret = secureStorage().encryptString(input.key).toString('base64');
                }
                stop();
                save({ provider: input.provider, history, secret: nextSecret });
                cache.clear();
                settings = { provider: input.provider };
                secret = nextSecret;
                return state();
            }
            throw Error('不支持的 IP 查询操作');
        }
    };
};
