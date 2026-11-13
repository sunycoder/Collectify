const path = require('node:path');
const fs = require('node:fs');
const { EventEmitter } = require('node:events');

// 宿主只认识清单和生命周期，不包含任何具体业务插件的名称或数据表。
class PluginServices extends EventEmitter {
    constructor(registry, environment) {
        super();
        this.registry = registry;
        this.environment = environment;
        this.providers = new Map();
        this.active = new Set();
        this.errors = new Map();
        this.stopping = new Set();
        this.pending = new Map();
    }
    async load({ activate = true } = {}) {
        // 保留数据的默认插件仍需提供领域备份处理器，但不激活页面、提醒或 MCP。
        const retained = this.registry
            .defaults()
            .filter(
                (p) =>
                    p.backend &&
                    !this.registry.plugins.has(p.id) &&
                    fs.existsSync(path.join(this.registry.dataRoot, p.id, 'data.sqlite'))
            );
        for (const plugin of [...this.registry.plugins.values(), ...retained]) {
            if (!plugin.backend) continue;
            if (this.providers.has(plugin.id)) continue;
            const context = {
                ...this.environment,
                id: plugin.id,
                file: path.join(this.registry.dataRoot, plugin.id, 'data.sqlite'),
                emptyInitialData: this.registry.getSetting('emptyPluginData', []).includes(plugin.id),
                emit: (name, data) => this.emit('event', { pluginId: plugin.id, name, data }),
                changed: () => this.emit('changed', plugin.id),
                invoke: (id, action, payload) => this.call(id, action, payload),
                available: (id) =>
                    this.registry.plugins.get(id)?.enabled === true && this.providers.has(id) && !this.errors.has(id),
                open: (id, route, payload) => this.environment.openPlugin(id, route, payload)
            };
            try {
                const provider = await require(path.join(plugin.directory, plugin.backend)).create(context);
                this.providers.set(plugin.id, provider);
            } catch (error) {
                this.errors.set(plugin.id, error.message);
                this.registry.diagnostics.push({ folder: plugin.name, error: error.message });
            }
        }
        this.registry.providers = this.providers;
        if (activate) await this.activateEnabled();
    }
    async activateEnabled() {
        for (const plugin of this.registry.plugins.values()) if (plugin.enabled) await this.enable(plugin.id);
    }
    async enable(id) {
        if (this.stopping.has(id)) throw Error('插件正在卸载，请稍候');
        if (this.errors.has(id)) return;
        const p = this.providers.get(id);
        if (p && !this.active.has(id)) {
            await p.activate?.();
            this.active.add(id);
        }
    }
    async disable(id) {
        const p = this.providers.get(id);
        if (p && this.active.has(id)) {
            this.active.delete(id);
            await p.deactivate?.();
        }
    }
    async unload(id) {
        this.stopping.add(id);
        try {
            await this.disable(id);
            // 已开始的业务写入必须先结束，避免卸载后旧异步任务重新创建已删除的数据库。
            await Promise.allSettled([...(this.pending.get(id) || [])]);
            await this.providers.get(id)?.dispose?.();
            this.providers.delete(id);
            this.errors.delete(id);
        } finally {
            this.stopping.delete(id);
        }
    }
    async perform(id, action) {
        this.registry.get(id, true);
        if (this.stopping.has(id)) throw Error('插件正在卸载，请稍候');
        const pending = Promise.resolve().then(action),
            jobs = this.pending.get(id) || new Set();
        this.pending.set(id, jobs);
        jobs.add(pending);
        try {
            return await pending;
        } finally {
            jobs.delete(pending);
            if (!jobs.size) this.pending.delete(id);
        }
    }
    async call(id, action, payload) {
        this.registry.get(id, true);
        const provider = this.providers.get(id);
        if (!provider?.call)
            throw Error(this.errors.has(id) ? `插件后台加载失败：${this.errors.get(id)}` : '插件没有声明后台能力');
        return this.perform(id, () => provider.call(action, payload));
    }
    navigation(id) {
        return this.providers.get(id)?.navigation?.() || this.registry.get(id).navigation;
    }
    layout(bounds, activeId, overlay) {
        for (const [id, p] of this.providers) p.layout?.(bounds, id === activeId && !overlay);
    }
    contributions() {
        return [...this.providers]
            .filter(([id]) => this.active.has(id))
            .flatMap(([id, p]) =>
                (p.mcpTools?.() || []).map((tool) => ({
                    ...tool,
                    pluginId: id,
                    handler: (input) =>
                        this.perform(id, () => {
                            return tool.write && p.store
                                ? p.store.withAudit(tool.name, () => tool.handler(input))
                                : tool.handler(input);
                        })
                }))
            );
    }
    async dispose() {
        for (const id of [...this.active]) await this.disable(id);
        for (const p of this.providers.values()) await p.dispose?.();
    }
}
module.exports = { PluginServices };
