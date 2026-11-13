const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { validateConfig, sourceKey, CALLBACK, sourcePresets } = require('./config');
const { SourceClient } = require('./client');
const { json } = require('./transport');
const { validateProfiles, defaultPlan } = require('./profiles');
const { selectUpdate, downloadUpdate, verifyInstaller } = require('./updates');
const { compareVersion } = require('../plugin-system/catalog');
class Distribution {
    constructor({
        registry,
        credentials,
        directory,
        version,
        openExternal,
        backup,
        getSettings,
        changed = () => {},
        refreshPlugins = async () => ({ updates: 0 }),
        fetcher,
        deployment
    }) {
        Object.assign(this, {
            registry,
            credentials,
            directory,
            version,
            openExternal,
            backup,
            getSettings,
            changed,
            refreshPlugins,
            fetcher
        });
        this.presets = sourcePresets(deployment);
        this.sources = { ...this.presets };
        for (const [provider, value] of Object.entries(registry.getSetting('distributionSources', {}) || {})) {
            if (!['gitlab', 'github'].includes(provider)) continue;
            try {
                this.sources[provider] = validateConfig({ ...value, provider });
            } catch {
                /* 坏的历史配置保留在原存储中，界面使用部署预设恢复。 */
            }
        }
        const previous = registry.getSetting('distributionSource');
        const deployed = deployment ? this.presets[deployment.provider] : null;
        const sameDeployment =
            deployed &&
            previous?.provider === deployed.provider &&
            previous.baseUrl === deployed.baseUrl &&
            previous.project === deployed.project;
        try {
            this.config = validateConfig(
                sameDeployment && !previous.clientId
                    ? { ...previous, clientId: deployed.clientId }
                    : previous || deployment || this.presets.github
            );
        } catch {
            // 恢复已知部署源的应用 ID，同时保留用户选择的分支及目录路径。
            if (sameDeployment) {
                try {
                    this.config = validateConfig({ ...previous, clientId: deployed.clientId });
                } catch {
                    this.config = validateConfig(deployed);
                }
            } else this.config = validateConfig(deployment || this.presets.github);
        }
        this.sources[this.config.provider] = this.config;
        if (deployment && !registry.getSetting('distributionSource'))
            registry.setSetting('distributionSource', this.config);
        this.client = this.newClient();
        this.generation = 0;
        this.busy = '';
        this.error = '';
        this.identity = null;
        this.pending = null;
        this.update = null;
        this.downloaded = null;
        this.profiles = [];
        this.preview = null;
        this.profileError = '';
        this.updateError = '';
    }
    newClient() {
        return new SourceClient(this.config, this.credentials, { fetcher: this.fetcher });
    }
    status() {
        let authenticated = false;
        try {
            authenticated = !!this.credentials.read(this.client.key);
        } catch {
            /* 登录页仍可打开并退出损坏的授权。 */
        }
        return {
            config: this.config,
            sources: this.sources,
            presets: this.presets,
            callback: CALLBACK,
            authenticated,
            secureStorage: this.credentials.supported(),
            identity: this.identity,
            busy: this.busy,
            error: this.error,
            pending: this.pending,
            update: this.update,
            downloaded: !!this.downloaded,
            progress: this.progress || null,
            profiles: this.profiles,
            preview: this.preview?.summary || null,
            profileError: this.profileError,
            updateError: this.updateError,
            pluginError: this.pluginError || '',
            pluginUpdates: this.pluginUpdates || 0
        };
    }
    async run(label, action) {
        if (this.busy) throw Error('正在' + this.busy + '，请稍候或取消');
        const generation = this.generation;
        this.busy = label;
        this.error = '';
        this.changed();
        try {
            return await action();
        } catch (error) {
            if (generation === this.generation) this.error = error.name === 'AbortError' ? '操作已取消' : error.message;
            throw error;
        } finally {
            if (generation === this.generation) {
                this.busy = '';
                this.changed();
            }
        }
    }
    reset() {
        this.generation++;
        this.credentials.invalidateWrites?.();
        this.client.dispose();
        this.client = this.newClient();
        this.busy = '';
        this.pending = null;
        this.identity = null;
        this.update = null;
        this.downloaded = null;
        this.profiles = [];
        this.preview = null;
        this.error = '';
        this.profileError = '';
        this.updateError = '';
        this.progress = null;
        this.pluginError = '';
        this.pluginUpdates = 0;
    }
    save(input) {
        if (this.busy) throw Error('请先完成或取消当前操作，再修改源');
        const config = validateConfig(input);
        this.registry.setSetting('distributionSource', config);
        this.sources[config.provider] = config;
        this.registry.setSetting('distributionSources', this.sources);
        this.config = config;
        this.reset();
        this.changed();
        return this.status();
    }
    login() {
        if (this.busy) throw Error('已有操作正在进行');
        const client = this.client,
            generation = this.generation;
        // 长时间等待系统浏览器授权不占用 IPC 调用，界面能显示进度并允许取消。
        this.loginTask = this.run('登录', async () => {
            const identity = await client.login({
                openExternal: this.openExternal,
                pending: (value) => {
                    if (generation === this.generation) {
                        this.pending = value;
                        this.changed();
                    }
                }
            });
            client.controller.signal.throwIfAborted();
            this.identity = identity;
            this.pending = null;
        })
            .then(() => {
                if (generation === this.generation) void this.check().catch(() => {});
            })
            .catch(() => {});
        return this.status();
    }
    logout() {
        this.credentials.clear();
        this.reset();
        this.changed();
        return this.status();
    }
    cancel() {
        this.reset();
        this.changed();
        return this.status();
    }
    async currentIdentity() {
        const client = this.client;
        if (!this.credentials.read(client.key)) throw Error('请先登录后读取团队配置');
        const identity = await client.identity();
        client.controller.signal.throwIfAborted();
        this.identity = identity;
        return identity;
    }
    ledgerKey(profile) {
        return `team-defaults:${sourceKey({ provider: this.config.provider, baseUrl: this.config.baseUrl, project: this.config.project })}:${this.identity.id}:${profile.id}`;
    }
    async listProfiles() {
        const identity = await this.currentIdentity();
        const items = validateProfiles(
            await this.client.read(
                this.client.file(this.config.project, this.config.ref, this.config.profilesPath),
                512 * 1024
            )
        );
        this.profileItems = items.filter((p) => !p.groups.length || p.groups.some((g) => identity.groups.includes(g)));
        this.profiles = this.profileItems.map((p) => {
            const prior = this.registry.getSetting(this.ledgerKey(p));
            if (prior && compareVersion(p.version, prior.version) < 0)
                throw Error('团队配置版本低于已应用版本，请维护者核对发布源');
            if (prior?.version === p.version && prior.sha256 !== p.sha256)
                throw Error('团队配置同版本内容发生变化，请维护者提高版本号');
            return {
                id: p.id,
                name: p.name,
                version: p.version,
                appliedVersion: prior?.version || null,
                available: prior?.sha256 !== p.sha256
            };
        });
    }
    async check() {
        return this.run('检查更新', async () => {
            const client = this.client;
            const results = await Promise.allSettled([
                (async () => {
                    const url = await client.provider.releaseUrl((u) => client.read(u));
                    const result = selectUpdate(await client.read(url, 512 * 1024), {
                        version: this.version,
                        config: this.config
                    });
                    client.controller.signal.throwIfAborted();
                    if (this.update?.file.sha256 !== result.file.sha256) this.downloaded = null;
                    this.update = result;
                    this.updateError = '';
                })(),
                this.credentials.read(client.key) ? this.listProfiles() : Promise.resolve(),
                this.refreshPlugins()
            ]);
            client.controller.signal.throwIfAborted();
            if (results[0].status === 'rejected') this.updateError = results[0].reason.message;
            if (results[1].status === 'rejected') {
                this.profileError = results[1].reason.message;
                this.profiles = [];
            } else this.profileError = '';
            this.pluginError = results[2].status === 'rejected' ? results[2].reason.message : '';
            this.pluginUpdates = results[2].status === 'fulfilled' ? results[2].value?.updates || 0 : 0;
            this.checkedAt = new Date().toISOString();
            return this.status();
        });
    }
    async previewProfile(id) {
        return this.run('读取团队配置', async () => {
            this.preview = null;
            await this.listProfiles();
            const profile = this.profileItems.find((p) => p.id === id);
            if (!profile) throw Error('当前账号无权应用此团队配置');
            const bytes = await this.client.download(
                this.client.file(profile.project || this.config.project, profile.ref || this.config.ref, profile.path),
                { limit: profile.size }
            );
            if (bytes.length !== profile.size || createHash('sha256').update(bytes).digest('hex') !== profile.sha256)
                throw Error('团队配置校验失败');
            const raw = this.backup.parse(json(bytes));
            const missing = raw.plugins.filter((p) => !this.registry.plugins.has(p.id)).map((p) => p.id);
            const summary = {
                token: randomUUID(),
                id,
                name: profile.name,
                version: profile.version,
                plugins: raw.plugins.map((p) => p.id),
                missing,
                settings: !!raw.settings,
                policy: '仅补充新内容，保留已有值及个人修改；不会自动安装或启用插件。'
            };
            this.preview = { raw, profile, summary, identity: this.identity.id, source: sourceKey(this.config) };
            return this.status();
        });
    }
    async applyProfile(token) {
        return this.run('应用团队配置', async () => {
            const draft = this.preview;
            if (!draft || token !== draft.summary.token || draft.source !== sourceKey(this.config))
                throw Error('团队配置预览已失效');
            await this.listProfiles();
            const current = this.profileItems.find((p) => p.id === draft.profile.id);
            if (
                this.identity.id !== draft.identity ||
                !current ||
                current.sha256 !== draft.profile.sha256 ||
                JSON.stringify(current) !== JSON.stringify(draft.profile)
            )
                throw Error('身份、权限或配置发生变化，请重新预览');
            if (draft.summary.missing.length) throw Error('请先安装配置所需插件：' + draft.summary.missing.join('、'));
            // 再次读取配置文件，GitLab 服务端执行真实访问检查，不能只依赖客户端的组匹配。
            const bytes = await this.client.download(
                this.client.file(current.project || this.config.project, current.ref || this.config.ref, current.path),
                { limit: current.size }
            );
            if (bytes.length !== current.size || createHash('sha256').update(bytes).digest('hex') !== current.sha256)
                throw Error('配置已改变，请重新预览');
            const ids = draft.raw.plugins.map((p) => p.id),
                previous = this.registry.getSetting(this.ledgerKey(current));
            const local = this.registry.snapshot(true, ids),
                plan = defaultPlan(draft.raw, local, previous?.raw);
            if (draft.raw.settings) {
                const personal = this.registry.getSetting('personalSettingKeys', []),
                    defaults = {};
                for (const key of ['theme', 'keepInTray', 'navigationCollapsed', 'browserOpenMode'])
                    if (
                        Object.hasOwn(draft.raw.settings, key) &&
                        !personal.includes(key) &&
                        !Object.hasOwn(previous?.raw.settings || {}, key)
                    )
                        defaults[key] = draft.raw.settings[key];
                plan.settings = { ...this.getSettings(), ...defaults };
            }
            this.backup.import(plan, { ids, settings: !!plan.settings, mode: 'merge' });
            this.registry.setSetting(this.ledgerKey(current), {
                version: current.version,
                sha256: current.sha256,
                raw: draft.raw
            });
            this.preview = null;
            this.profiles = this.profiles.map((item) =>
                item.id === current.id ? { ...item, appliedVersion: current.version, available: false } : item
            );
            return this.status();
        });
    }
    async download() {
        return this.run('下载安装包', async () => {
            if (!this.update?.available) throw Error('请先检查是否有新版本');
            const update = this.update;
            let last = 0;
            this.downloaded = await downloadUpdate(this.client, update, path.join(this.directory, 'updates'), {
                progress: (received, total) => {
                    this.progress = { received, total: total || update.file.size };
                    if (Date.now() - last > 300) {
                        last = Date.now();
                        this.changed();
                    }
                }
            });
            return this.status();
        });
    }
    async installer() {
        if (this.busy || !this.downloaded || !this.update?.available) throw Error('请先下载并校验新版本');
        await verifyInstaller(this.downloaded, this.update);
        return this.downloaded;
    }
    start() {
        const check = () => {
            try {
                if (
                    this.busy ||
                    !this.config.automaticChecks ||
                    (this.config.provider === 'gitlab' && !this.credentials.read(this.client.key))
                )
                    return;
                void this.check().catch(() => {});
            } catch (error) {
                this.error = error.message;
                this.changed();
            }
        };
        this.timer = setInterval(check, 60 * 60 * 1000);
        this.timer.unref();
        check();
    }
    dispose() {
        clearInterval(this.timer);
        this.credentials.invalidateWrites?.();
        this.client.dispose();
    }
}
module.exports = { Distribution };
