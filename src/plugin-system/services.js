const path = require('node:path');
const fs = require('node:fs');
const { EventEmitter } = require('node:events');
const { validateRequest, failure } = require('./request-contract');
const { OperationMetrics } = require('./operation-metrics');

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
        this.activating = new Map();
        this.taskPools = new Map();
        this.metrics = new OperationMetrics();
        this.cleanups = new Map();
    }
    async load({ activate = true } = {}) {
        // 保留数据的默认插件仍需提供领域备份处理器，但不激活页面、提醒或 MCP。
        const retained = this.registry
            .retainedDefaults()
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
            context.startWorker = (file, options) => {
                if (!this.active.has(plugin.id) || this.stopping.has(plugin.id)) throw Error('插件未启用或正在停用');
                let pool = this.taskPools.get(plugin.id);
                if (!pool) {
                    const { PluginTaskPool } = require('./process-task');
                    pool = new PluginTaskPool(plugin.directory);
                    this.taskPools.set(plugin.id, pool);
                }
                pool.activate();
                return pool.start(file, options);
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
            if (this.activating.has(id)) return this.activating.get(id);
            const task = Promise.resolve()
                .then(() => p.activate?.())
                .then(() => this.active.add(id));
            this.activating.set(id, task);
            try {
                await task;
            } finally {
                this.activating.delete(id);
            }
        }
    }
    async disable(id) {
        await this.activating.get(id);
        const p = this.providers.get(id);
        if (p && this.active.has(id)) {
            this.active.delete(id);
            await this.taskPools.get(id)?.stop();
            await p.deactivate?.();
        }
    }
    async unload(id) {
        this.stopping.add(id);
        try {
            await this.waitForCleanup(id, '停用', () => this.disable(id));
            // 已开始的业务写入必须先结束，避免卸载后旧异步任务重新创建已删除的数据库。
            await this.waitForCleanup(id, '在途数据提交', () => Promise.allSettled([...(this.pending.get(id) || [])]));
            await this.waitForCleanup(id, '释放资源', () => this.providers.get(id)?.dispose?.());
            const directory = this.registry.plugins.get(id)?.directory;
            if (directory)
                for (const file of Object.keys(require.cache))
                    if (file.startsWith(directory + path.sep)) delete require.cache[file];
            this.providers.delete(id);
            this.taskPools.delete(id);
            this.errors.delete(id);
            this.stopping.delete(id);
        } catch (error) {
            // 超时不能继续卸载或删除数据库；保留停止状态，可在任务结束后重试卸载。
            this.emit('cleanup-error', { pluginId: id, code: error.code || 'PLUGIN_CLEANUP_FAILED' });
            throw error;
        }
    }
    async waitForCleanup(id, phase, action) {
        const key = id + ':' + phase;
        let work = this.cleanups.get(key);
        if (!work) {
            work = Promise.resolve().then(action);
            this.cleanups.set(key, work);
            void work.finally(() => this.cleanups.delete(key)).catch(() => {});
        }
        let timer;
        try {
            return await Promise.race([
                work,
                new Promise((_, reject) => {
                    timer = setTimeout(
                        () =>
                            reject(
                                Object.assign(Error(`插件${phase}超时，已保留程序和数据；稍后可重试`), {
                                    code: 'PLUGIN_CLEANUP_TIMEOUT'
                                })
                            ),
                        this.environment.cleanupTimeoutMs || 15000
                    );
                })
            ]);
        } finally {
            clearTimeout(timer);
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
        validateRequest(provider.contracts, action, payload);
        const end = this.metrics.start(id, action);
        try {
            const result = await this.perform(id, () => provider.call(action, payload));
            try {
                provider.contracts?.[action]?.validateResult?.(result);
            } catch {
                throw failure('INVALID_RESPONSE', '插件返回的数据不符合接口契约');
            }
            return result;
        } finally {
            end();
        }
    }
    async searchContent(query) {
        query = String(query || '')
            .trim()
            .toLocaleLowerCase()
            .slice(0, 200);
        if (!query) return [];
        const results = [];
        for (const plugin of this.registry.list().filter((p) => p.enabled)) {
            let found = [];
            const provider = this.providers.get(plugin.id);
            try {
                if (provider?.search) found = await this.perform(plugin.id, () => provider.search(query));
                else if (plugin.search) {
                    const { matchRecord } = require('./content-search'),
                        s = plugin.search;
                    for (const [key, value] of Object.entries(this.registry.storage.export(plugin.id))) {
                        if (!key.startsWith(s.keyPrefix)) continue;
                        const row = matchRecord(value, query, s.fields, s.title, s.route, value?.id);
                        if (row) found.push(row);
                        if (found.length >= 30) break;
                    }
                }
            } catch {
                // 单个插件正在停用或数据不可读时，继续展示其他插件的搜索结果。
                continue;
            }
            if (!Array.isArray(found)) continue;
            results.push(
                ...found.slice(0, 30).map((row) => ({ ...row, pluginId: plugin.id, pluginName: plugin.name }))
            );
            if (results.length >= 80) break;
        }
        return results.slice(0, 80);
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
        const ids = [...this.providers.keys()];
        for (const id of ids) this.stopping.add(id);
        const failures = [];
        for (const id of [...this.active])
            try {
                await this.disable(id);
            } catch (error) {
                failures.push(error);
            }
        await Promise.allSettled([...this.pending.values()].flatMap((jobs) => [...jobs]));
        for (const p of this.providers.values())
            try {
                await p.dispose?.();
            } catch (error) {
                failures.push(error);
            }
        this.active.clear();
        this.providers.clear();
        this.taskPools.clear();
        this.cleanups.clear();
        if (failures.length) throw new AggregateError(failures, '部分插件退出失败');
    }
    async beforeClose(ids, reason) {
        const checked = [];
        try {
            for (const id of ids) {
                const provider = this.providers.get(id);
                if (provider?.beforeClose) {
                    checked.push(provider);
                    if ((await provider.beforeClose(reason)) === false) {
                        for (const prior of checked) prior.closeCheckCanceled?.();
                        return false;
                    }
                }
            }
            return true;
        } catch (error) {
            for (const prior of checked) prior.closeCheckCanceled?.();
            throw error;
        }
    }
    tasks() {
        return [...this.providers]
            .filter(([id]) => this.active.has(id))
            .flatMap(([id, provider]) => {
                let tasks;
                try {
                    tasks = provider.tasks?.() || [];
                } catch {
                    return [];
                }
                if (!Array.isArray(tasks)) return [];
                return tasks
                    .slice(0, 30)
                    .filter((t) => t && typeof t.id === 'string' && t.id.length <= 100 && typeof t.title === 'string')
                    .map((t) => ({
                        pluginId: id,
                        pluginName: this.registry.plugins.get(id)?.name || id,
                        id: t.id,
                        title: t.title.slice(0, 100),
                        progress: Number.isFinite(t.progress) ? Math.max(0, Math.min(1, t.progress)) : null,
                        startedAt: Number.isFinite(t.startedAt) ? t.startedAt : null,
                        cancellable: t.cancellable === true && typeof provider.cancelTask === 'function'
                    }));
            });
    }
    async cancelTask(pluginId, id) {
        const task = this.tasks().find((t) => t.pluginId === pluginId && t.id === id);
        if (!task?.cancellable) throw Error('任务已结束或不支持取消');
        await this.providers.get(pluginId).cancelTask(id);
        this.emit('changed', pluginId);
    }
}
module.exports = { PluginServices };
