const { pluginId } = require('./manifest');
const { ARCHIVE_LIMIT } = require('./package');
const { compatibility, validateCompatibility } = require('./compatibility');
const DEFAULT_CATALOG_URL = 'https://raw.githubusercontent.com/sunycoder/Collectify/main/plugins/catalog.json';

function compareVersion(a, b) {
    const left = a.split('.').map(BigInt),
        right = b.split('.').map(BigInt);
    for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] > right[i] ? 1 : -1;
    return 0;
}
function httpsUrl(value) {
    if (typeof value !== 'string' || value.length > 2000) throw Error('请填写 HTTPS 地址');
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash)
        throw Error('插件目录与下载必须使用无凭据的 HTTPS 地址');
    return url.href;
}
function validateCatalog(input, { validateUrl = httpsUrl } = {}) {
    if (
        input?.format !== 'collectify-plugin-catalog' ||
        input.version !== 1 ||
        !Array.isArray(input.plugins) ||
        input.plugins.length > 200
    )
        throw Error('插件目录格式不正确');
    const ids = new Set();
    return input.plugins.map((item) => {
        pluginId(item.id);
        if (
            ids.has(item.id) ||
            !/^\d+\.\d+\.\d+$/.test(item.version) ||
            item.version.length > 60 ||
            typeof item.name !== 'string' ||
            !item.name.trim() ||
            item.name.length > 100 ||
            typeof item.description !== 'string' ||
            item.description.length > 1000 ||
            !/^[a-f0-9]{64}$/.test(item.sha256) ||
            item.apiVersion !== 1 ||
            !Number.isSafeInteger(item.size) ||
            item.size <= 0 ||
            item.size > ARCHIVE_LIMIT
        )
            throw Error('插件目录信息无效、重复或不兼容');
        ids.add(item.id);
        return {
            ...validateCompatibility(item),
            id: item.id,
            name: item.name,
            description: item.description,
            version: item.version,
            apiVersion: item.apiVersion,
            sha256: item.sha256,
            size: item.size,
            url: validateUrl(item.url),
            ...(item.homepage ? { homepage: validateUrl(item.homepage) } : {})
        };
    });
}

// 网络只在主进程的显式操作中使用；渲染页面和插件自身仍无网络权限。
async function download(url, limit, { fetcher = fetch, signal } = {}) {
    let current = httpsUrl(url);
    const timeout = AbortSignal.timeout(30000),
        combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    for (let hop = 0; hop <= 5; hop++) {
        const response = await fetcher(current, {
            redirect: 'manual',
            signal: combined,
            credentials: 'omit',
            headers: { Accept: 'application/json, application/octet-stream' }
        });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get('location');
            await response.body?.cancel();
            if (!location || hop === 5) throw Error('插件下载重定向次数过多');
            current = httpsUrl(new URL(location, current).href);
            continue;
        }
        if (!response.ok) {
            await response.body?.cancel();
            throw Error(`插件下载失败（HTTP ${response.status}）`);
        }
        if (Number(response.headers.get('content-length')) > limit) {
            await response.body?.cancel();
            throw Error('下载内容超过大小限制');
        }
        const reader = response.body?.getReader();
        if (!reader) throw Error('下载内容为空');
        const chunks = [];
        let total = 0;
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                total += value.length;
                if (total > limit) throw Error('下载内容超过大小限制');
                chunks.push(Buffer.from(value));
            }
        } catch (error) {
            await reader.cancel().catch(() => {});
            throw error;
        }
        return Buffer.concat(chunks);
    }
}
class PluginCatalog {
    constructor(registry, options = {}) {
        this.registry = registry;
        this.options = options;
        this.items = [];
        this.loaded = false;
        this.source = registry.getSetting('pluginCatalogUrl', '') || DEFAULT_CATALOG_URL;
        this.updatedAt = null;
    }
    status() {
        return {
            source: this.source,
            officialSource: DEFAULT_CATALOG_URL,
            loaded: this.loaded,
            updatedAt: this.updatedAt,
            plugins: this.items.map((item) => {
                const installed = this.registry.plugins.get(item.id);
                return {
                    ...compatibility(item),
                    ...item,
                    installedVersion: installed?.version || null,
                    updateAvailable: !!installed && compareVersion(item.version, installed.version) > 0,
                    native: !!installed?.backend
                };
            })
        };
    }
    configure(value) {
        const source = value.trim() ? (this.options.validateUrl || httpsUrl)(value.trim()) : DEFAULT_CATALOG_URL;
        this.registry.setSetting('pluginCatalogUrl', source);
        this.source = source;
        this.items = [];
        this.loaded = false;
        this.updatedAt = null;
        return this.status();
    }
    async refresh(signal) {
        if (!this.source) throw Error('请先配置插件目录地址');
        const source = this.source,
            data = await (this.options.download || download)(source, 512 * 1024, { ...this.options, signal });
        const items = validateCatalog(
            JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data).replace(/^\uFEFF/, '')),
            this.options
        );
        if (source !== this.source) throw Error('插件目录地址已更改，请重新刷新');
        this.items = items;
        this.loaded = true;
        this.updatedAt = new Date().toISOString();
        return this.status();
    }
    async package(id, signal) {
        const item = this.items.find((p) => p.id === id);
        if (!item || !this.loaded) throw Error('请刷新插件目录后再安装');
        const support = compatibility(item);
        if (!support.compatible) throw Error(support.compatibilityReason);
        const data = await (this.options.download || download)(item.url, Math.min(ARCHIVE_LIMIT, item.size), {
            ...this.options,
            signal
        });
        if (data.length !== item.size) throw Error('下载的插件包大小与目录不一致');
        return { data, item };
    }
}
module.exports = { PluginCatalog, validateCatalog, httpsUrl, download, compareVersion, DEFAULT_CATALOG_URL };
