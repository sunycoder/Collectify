const { createProvider } = require('./providers');
const { authKey } = require('./config');
const { request, json } = require('./transport');
const oauth = require('./oauth');
class SourceClient {
    constructor(config, store, { fetcher = fetch } = {}) {
        Object.assign(this, { config, store, fetcher });
        this.provider = createProvider(config);
        this.key = authKey(config);
        this.controller = new AbortController();
        this.refreshing = null;
    }
    dispose() {
        this.controller.abort();
    }
    async token(force = false) {
        const prior = this.store.read(this.key);
        if (!prior) return null;
        if (!force && (!prior.expiresAt || prior.expiresAt > Date.now() + 30000)) return prior.accessToken;
        if (!this.refreshing)
            this.refreshing = (async () => {
                const next = await oauth.refresh(this.config, this.provider, prior, {
                    fetcher: this.fetcher,
                    signal: this.controller.signal
                });
                this.controller.signal.throwIfAborted();
                await this.store.write(this.key, next);
                this.controller.signal.throwIfAborted();
                return next.accessToken;
            })().finally(() => {
                this.refreshing = null;
            });
        return this.refreshing;
    }
    async download(value, options = {}) {
        const url = await this.provider.resolve(value, (u) => this.read(u));
        const signal = options.signal
            ? AbortSignal.any([options.signal, this.controller.signal])
            : this.controller.signal;
        for (let attempt = 0; attempt < 2; attempt++) {
            const token = await this.token(attempt === 1);
            try {
                return await request(url, {
                    ...options,
                    signal,
                    config: this.config,
                    fetcher: this.fetcher,
                    headers: (target) => this.provider.headers(target, token)
                });
            } catch (error) {
                if (error.status !== 401 || attempt || !this.store.read(this.key)?.refreshToken) throw error;
            }
        }
    }
    async read(url, limit = 1024 * 1024) {
        return json(await this.download(url, { limit }));
    }
    file(project, ref, file) {
        return this.provider.fileUrl(project, ref, file);
    }
    async login(options) {
        if (!this.config.clientId) throw Error('请维护者先填写 OAuth Application ID');
        if (!this.store.supported()) throw Error('系统安全存储不可用，请先配置系统密钥环');
        const token = await (this.config.provider === 'gitlab' ? oauth.gitlabLogin : oauth.githubLogin)(
            this.config,
            this.provider,
            { ...options, fetcher: this.fetcher, signal: this.controller.signal }
        );
        this.controller.signal.throwIfAborted();
        await this.store.write(this.key, token);
        this.controller.signal.throwIfAborted();
        return this.identity();
    }
    identity() {
        return this.provider.identity((url) => this.read(url));
    }
}
module.exports = { SourceClient };
