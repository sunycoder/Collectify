const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { pluginId, readManifest, assetPath } = require('./manifest');
const { PluginStorage, validateValues } = require('./storage');

class PluginRegistry {
    constructor({ builtinRoot, userRoot, dataRoot, hostFile }) {
        Object.assign(this, { builtinRoot, userRoot, dataRoot, hostFile });
        const packaged = path.join(path.dirname(builtinRoot), 'default-packages');
        this.seedRoot = fs.existsSync(packaged) ? packaged : builtinRoot;
        fs.mkdirSync(path.dirname(hostFile), { recursive: true });
        fs.mkdirSync(userRoot, { recursive: true });
        this.storage = new PluginStorage(dataRoot);
        this.settingCache = new Map();
        this.database((db) => {
            const version = db.prepare('PRAGMA user_version').get().user_version;
            if (version > 2) throw Error('插件宿主数据版本不受支持');
            db.exec(
                'CREATE TABLE IF NOT EXISTS installed_plugins(id TEXT PRIMARY KEY,enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),version TEXT NOT NULL,installed_at TEXT NOT NULL) STRICT; CREATE TABLE IF NOT EXISTS host_settings(key TEXT PRIMARY KEY,value_json TEXT NOT NULL CHECK(json_valid(value_json))) STRICT;'
            );
            if (version < 2) db.exec('PRAGMA user_version=2');
        });
        const order = this.getSetting('pluginOrder', []);
        this.pluginOrder = Array.isArray(order) ? [...new Set(order.filter((id) => typeof id === 'string'))] : [];
        this.seedDefaults();
        this.discover();
    }
    database(action) {
        const db = new DatabaseSync(this.hostFile);
        try {
            db.exec('PRAGMA busy_timeout=5000');
            return action(db);
        } finally {
            db.close();
        }
    }
    getSetting(key, fallback = null) {
        if (!this.settingCache.has(key))
            this.database((db) => {
                const row = db.prepare('SELECT value_json FROM host_settings WHERE key=?').get(key);
                this.settingCache.set(key, row ? row.value_json : null);
            });
        const text = this.settingCache.get(key);
        return text === null ? structuredClone(fallback) : JSON.parse(text);
    }
    setSetting(key, value) {
        if (key === 'pluginOrder') value = require('./navigation-order').validateOrder(value);
        const text = JSON.stringify(value);
        if (typeof text !== 'string') throw Error('宿主设置必须为可序列化的数据');
        if (this.settingCache.has(key) && this.settingCache.get(key) === text) return;
        this.database((db) =>
            db
                .prepare(
                    'INSERT INTO host_settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json'
                )
                .run(key, text)
        );
        this.settingCache.set(key, text);
        if (key === 'pluginOrder') this.pluginOrder = [...value];
    }
    readMcpConfig() {
        return this.getSetting('mcp');
    }
    readSettings(fallbacks) {
        const missing = Object.keys(fallbacks).filter((key) => !this.settingCache.has(key));
        if (missing.length)
            this.database((db) => {
                const rows = new Map(
                    db
                        .prepare(
                            `SELECT key,value_json FROM host_settings WHERE key IN (${missing.map(() => '?').join(',')})`
                        )
                        .all(...missing)
                        .map((r) => [r.key, r.value_json])
                );
                for (const key of missing) this.settingCache.set(key, rows.get(key) ?? null);
            });
        return Object.fromEntries(
            Object.entries(fallbacks).map(([key, fallback]) => [key, this.getSetting(key, fallback)])
        );
    }
    saveMcpConfig(value) {
        this.setSetting('mcp', value);
    }
    defaults() {
        if (this.defaultManifests) return this.defaultManifests;
        if (!fs.existsSync(this.seedRoot)) return [];
        return (this.defaultManifests = fs
            .readdirSync(this.seedRoot, { withFileTypes: true })
            .filter((d) => d.isDirectory() && !d.isSymbolicLink() && !d.name.startsWith('.'))
            .map((d) => ({
                ...readManifest(path.join(this.seedRoot, d.name)),
                directory: path.join(this.seedRoot, d.name)
            })));
    }
    seedDefaults() {
        const decided = new Set(this.getSetting('seededDefaultPlugins', []));
        const removed = this.getSetting('removedDefaultPlugins', []);
        for (const plugin of this.defaults()) {
            if (decided.has(plugin.id)) continue;
            const target = path.join(this.userRoot, plugin.id);
            if (!removed.includes(plugin.id) && !fs.existsSync(target)) this.copyDefault(plugin.directory, plugin.id);
            decided.add(plugin.id);
            this.setSetting('seededDefaultPlugins', [...decided]);
        }
    }
    copyDefault(source, id) {
        const stage = path.join(this.userRoot, '.seed-' + randomUUID()),
            target = path.join(this.userRoot, pluginId(id));
        try {
            fs.cpSync(source, stage, { recursive: true, dereference: false });
            if (readManifest(stage).id !== id) throw Error('初始插件身份不一致');
            fs.renameSync(stage, target);
        } finally {
            if (fs.existsSync(stage)) fs.rmSync(stage, { recursive: true, force: true });
        }
    }
    retainedDefaults() {
        return this.defaults()
            .filter((p) => !this.plugins.has(p.id))
            .map((p) => {
                const saved = path.join(this.userRoot, '.retained', p.id);
                return fs.existsSync(saved) ? { ...readManifest(saved), directory: saved } : p;
            });
    }
    availableDefaults() {
        return this.defaults()
            .filter((p) => !this.plugins.has(p.id))
            .map(({ directory, backend, entry, ...p }) => p);
    }
    discover() {
        this.iconCache = new Map();
        const records = this.database(
            (db) =>
                new Map(
                    db
                        .prepare('SELECT id,version,enabled FROM installed_plugins')
                        .all()
                        .map((r) => [r.id, r])
                )
        );
        const changed = [];
        const next = new Map(),
            diagnostics = [];
        for (const [root, builtin] of [[this.userRoot, false]]) {
            if (!fs.existsSync(root)) continue;
            for (const folder of fs.readdirSync(root, { withFileTypes: true })) {
                if (folder.name.startsWith('.')) continue;
                try {
                    if (!folder.isDirectory() || folder.isSymbolicLink()) throw Error('插件包必须为普通目录');
                    const directory = path.join(root, folder.name),
                        manifest = readManifest(directory, { builtin });
                    const initial = this.defaults().find((p) => p.id === manifest.id);
                    if (
                        initial?.backend &&
                        (!manifest.backend || manifest.runtime !== 'native' || manifest.publisher !== initial.publisher)
                    )
                        throw Error('默认原生插件必须使用可信发布者的签名包');
                    if (!builtin && folder.name !== manifest.id)
                        throw Error('已安装插件的目录名必须与插件 ID 一致，请通过插件管理安装');
                    if (next.has(manifest.id)) throw Error('插件 ID 与已安装插件冲突');
                    const record = records.get(manifest.id) || { enabled: 1 };
                    if (records.get(manifest.id)?.version !== manifest.version) changed.push(manifest);
                    next.set(manifest.id, {
                        ...manifest,
                        directory,
                        builtin,
                        defaultInstalled: !!initial,
                        enabled: !!record.enabled
                    });
                } catch (error) {
                    diagnostics.push({ folder: folder.name, error: error.message });
                }
            }
        }
        if (changed.length)
            this.database((db) => {
                db.exec('BEGIN');
                try {
                    const save = db.prepare(
                        'INSERT INTO installed_plugins VALUES(?,1,?,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version'
                    );
                    const now = new Date().toISOString();
                    for (const manifest of changed) save.run(manifest.id, manifest.version, now);
                    db.exec('COMMIT');
                } catch (error) {
                    db.exec('ROLLBACK');
                    throw error;
                }
            });
        this.plugins = next;
        this.diagnostics = diagnostics;
    }
    get(id, enabled = false) {
        const plugin = this.plugins.get(pluginId(id));
        if (!plugin || (enabled && !plugin.enabled)) throw Error('插件未安装或已停用');
        return plugin;
    }
    async icon(id, includeDisabled = false) {
        const plugin = this.get(id, !includeDisabled);
        if (!plugin.icon) return null;
        if (this.iconCache.has(id)) return this.iconCache.get(id);
        const cache = this.iconCache;
        const pending = (async () => {
            const file = assetPath(plugin.directory, plugin.icon);
            // 文件可能在清单读取后改变，读取时再次限制大小；不向渲染端暴露本机路径。
            const handle = await fs.promises.open(file, 'r');
            try {
                if ((await handle.stat()).size > 65536) throw Error('插件图标不能超过 64 KiB');
                const bytes = Buffer.alloc(65537);
                const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
                if (bytesRead > 65536) throw Error('插件图标不能超过 64 KiB');
                if (this.plugins.get(id) !== plugin || (!includeDisabled && !plugin.enabled))
                    throw Error('插件已更新或停用');
                return 'data:image/svg+xml;base64,' + bytes.subarray(0, bytesRead).toString('base64');
            } finally {
                await handle.close();
            }
        })();
        cache.set(id, pending);
        try {
            return await pending;
        } catch (error) {
            if (cache.get(id) === pending) cache.delete(id);
            throw error;
        }
    }
    list() {
        const positions = new Map(this.pluginOrder.map((id, index) => [id, index]));
        return [...this.plugins.values()]
            .sort(
                (a, b) =>
                    (positions.get(a.id) ?? Infinity) - (positions.get(b.id) ?? Infinity) ||
                    a.order - b.order ||
                    a.name.localeCompare(b.name)
            )
            .map(({ directory, entry, backend, ...publicInfo }) => ({
                ...publicInfo,
                distributable: !publicInfo.builtin
            }));
    }
    move(id, targetId, placement = 'before') {
        this.get(id);
        this.get(targetId);
        if (!['before', 'after'].includes(placement)) throw Error('插件排序位置无效');
        const ids = this.list().map((p) => p.id);
        if (id === targetId) return ids;
        ids.splice(ids.indexOf(id), 1);
        ids.splice(ids.indexOf(targetId) + (placement === 'after' ? 1 : 0), 0, id);
        this.setSetting('pluginOrder', ids);
        this.pluginOrder = ids;
        return [...ids];
    }
    resetOrder() {
        this.setSetting('pluginOrder', []);
        this.pluginOrder = [];
    }
    setEnabled(id, enabled) {
        const plugin = this.get(id);
        if (typeof enabled !== 'boolean') throw Error('插件启停参数不正确');
        this.database((db) => db.prepare('UPDATE installed_plugins SET enabled=? WHERE id=?').run(Number(enabled), id));
        plugin.enabled = enabled;
    }
    commands() {
        return this.list()
            .filter((p) => p.enabled)
            .flatMap((p) => p.commands.map((c) => ({ ...c, pluginId: p.id, pluginName: p.name })));
    }
    // 自有插件使用本地目录安装；先校验并暂存全部文件，再替换目录，失败时恢复旧包。
    install(source, approvedManifest, { development = false } = {}) {
        const manifest = readManifest(source),
            previous = this.plugins.get(manifest.id);
        if (approvedManifest && JSON.stringify(manifest) !== JSON.stringify(approvedManifest))
            throw Error('确认后插件清单发生变化，请重新选择并确认');
        const initial = this.defaults().find((p) => p.id === manifest.id);
        if (
            initial?.backend &&
            (!manifest.backend || manifest.runtime !== 'native' || manifest.publisher !== initial.publisher)
        )
            throw Error('默认原生插件必须使用可信发布者的签名包');
        if (previous) {
            const { compareVersion } = require('./catalog'),
                { collectFiles, encodeZip, sha256 } = require('./package'),
                comparison = compareVersion(manifest.version, previous.version);
            if (comparison < 0) throw Error('不能安装低于当前版本的插件');
            if (
                comparison === 0 &&
                !development &&
                sha256(encodeZip(collectFiles(source), { native: manifest.runtime === 'native' })) !==
                    sha256(encodeZip(collectFiles(previous.directory), { native: previous.runtime === 'native' }))
            )
                throw Error('程序内容改变时必须提高插件版本号');
        }
        const root = path.resolve(this.userRoot),
            origin = fs.realpathSync(source);
        if (origin === root || origin.startsWith(root + path.sep)) throw Error('请选择插件安装目录之外的源码目录');
        let total = 0,
            files = 0,
            entries = 0;
        const inspect = (directory, depth = 0) => {
            if (depth > 20) throw Error('插件目录嵌套过深');
            for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
                if (++entries > 500) throw Error('插件包目录项过多');
                if (item.isSymbolicLink()) throw Error('插件包不允许符号链接');
                const file = path.join(directory, item.name);
                if (item.isDirectory()) {
                    if (item.name === 'node_modules' || item.name.startsWith('.'))
                        throw Error('插件包不应包含依赖目录或隐藏目录');
                    inspect(file, depth + 1);
                } else if (item.isFile()) {
                    require('./package').safeName(path.relative(origin, file).split(path.sep).join('/'), {
                        native: manifest.runtime === 'native'
                    });
                    total += fs.statSync(file).size;
                    files++;
                    if (total > (manifest.runtime === 'native' ? 96 : 10) * 1024 * 1024 || files > 300)
                        throw Error('插件包超过大小或文件数量限制');
                } else throw Error('插件包包含特殊文件');
            }
        };
        inspect(origin);
        const staging = path.join(root, `.install-${randomUUID()}`),
            target = path.join(root, manifest.id),
            backup = path.join(root, `.previous-${randomUUID()}`);
        try {
            fs.cpSync(origin, staging, { recursive: true, dereference: false });
            if (JSON.stringify(readManifest(staging)) !== JSON.stringify(manifest))
                throw Error('复制期间插件清单发生变化，请重新安装');
            if (fs.existsSync(target)) fs.renameSync(target, backup);
            try {
                fs.renameSync(staging, target);
                this.discover();
                if (!this.plugins.has(manifest.id)) throw Error('插件安装后校验失败');
            } catch (error) {
                if (fs.existsSync(target)) fs.rmSync(target, { recursive: true });
                if (fs.existsSync(backup)) fs.renameSync(backup, target);
                this.discover();
                throw error;
            }
            if (fs.existsSync(backup)) fs.rmSync(backup, { recursive: true });
        } finally {
            if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true });
        }
        if (!previous) this.setEnabled(manifest.id, true);
        if (initial)
            this.setSetting(
                'removedDefaultPlugins',
                this.getSetting('removedDefaultPlugins', []).filter((id) => id !== manifest.id)
            );
        return manifest.id;
    }
    uninstall(id, { deleteData = false } = {}) {
        const plugin = this.get(id);
        // 默认安装身份仅决定首次安装与离线恢复，不限制后续插件更新。
        if (plugin.defaultInstalled)
            this.setSetting('removedDefaultPlugins', [
                ...new Set([...this.getSetting('removedDefaultPlugins', []), id])
            ]);
        {
            const target = path.resolve(plugin.directory),
                root = path.resolve(this.userRoot);
            if (path.dirname(target) !== root) throw Error('插件卸载路径越界');
            if (plugin.defaultInstalled && !deleteData) {
                const retained = path.join(root, '.retained', id);
                fs.mkdirSync(path.dirname(retained), { recursive: true });
                if (fs.existsSync(retained)) fs.rmSync(retained, { recursive: true, force: true });
                fs.renameSync(target, retained);
            } else fs.rmSync(target, { recursive: true, maxRetries: 5, retryDelay: 80 });
        }
        this.plugins.delete(id);
        this.database((db) => db.prepare('UPDATE installed_plugins SET enabled=0 WHERE id=?').run(id));
        if (deleteData) {
            const retained = path.join(this.userRoot, '.retained', id);
            if (fs.existsSync(retained)) fs.rmSync(retained, { recursive: true, force: true });
            const target = path.resolve(this.dataRoot, pluginId(id));
            if (path.dirname(target) !== path.resolve(this.dataRoot)) throw Error('插件数据路径越界');
            fs.rmSync(target, { recursive: true, force: true });
            this.setSetting('emptyPluginData', [...new Set([...this.getSetting('emptyPluginData', []), id])]);
            this.database((db) => db.prepare('DELETE FROM installed_plugins WHERE id=?').run(id));
        }
    }
    restore(id) {
        pluginId(id);
        if (!this.defaults().some((p) => p.id === id)) throw Error('没有可恢复的默认插件');
        if (this.plugins.has(id)) throw Error('默认插件已经安装');
        const saved = path.join(this.userRoot, '.retained', id);
        const fallback = this.defaults().find((p) => p.id === id);
        if (fs.existsSync(saved)) readManifest(saved);
        this.copyDefault(fs.existsSync(saved) ? saved : fallback.directory, id);
        this.setSetting(
            'removedDefaultPlugins',
            this.getSetting('removedDefaultPlugins', []).filter((value) => value !== id)
        );
        this.discover();
        this.setEnabled(id, true);
        return id;
    }
    snapshot(includeCredentials = true, ids) {
        // 同步调用期间主线程不会交错处理插件写入，提供同一批次的完整插件数据。
        const rows = this.database((db) =>
            db.prepare('SELECT id,version,enabled FROM installed_plugins ORDER BY id').all()
        ).filter((p) => !ids || ids.includes(p.id));
        return {
            version: 1,
            plugins: rows.map((p) => {
                if (
                    this.providers &&
                    (this.plugins.get(p.id)?.backend || this.defaults().find((d) => d.id === p.id)?.backend) &&
                    !this.providers.has(p.id)
                )
                    throw Error(`请先恢复插件再导出完整数据：${p.id}`);
                return {
                    id: p.id,
                    version: p.version,
                    enabled: this.plugins.has(p.id) && !!p.enabled,
                    values: this.storage.export(p.id),
                    ...(this.providers?.get(p.id)?.exportData
                        ? { data: this.providers.get(p.id).exportData(includeCredentials) }
                        : {})
                };
            })
        };
    }
    planImport(input, mode, { onlySelected = false } = {}) {
        validateSnapshot(input);
        if (!['merge', 'replace'].includes(mode)) throw Error('插件数据导入方式不正确');
        const previous = this.snapshot(true, onlySelected ? input.plugins.map((p) => p.id) : undefined),
            merged = new Map(previous.plugins.map((p) => [p.id, p]));
        for (const item of input.plugins) {
            const prior = merged.get(item.id);
            // 导入数据不自动启用已停用插件，也不安装任何可执行包。
            let data;
            if (item.data) {
                const provider = this.providers?.get(item.id);
                if (!provider?.planData) throw Error('请安装支持该领域数据的插件后再导入');
                data = provider.planData(item.data, mode);
            }
            merged.set(item.id, {
                ...prior,
                ...item,
                enabled: prior?.enabled ?? false,
                values: mode === 'merge' ? { ...prior?.values, ...item.values } : item.values,
                ...(data ? { data } : {})
            });
        }
        const next = { version: 1, plugins: [...merged.values()] };
        const selected = new Set(input.plugins.map((p) => p.id));
        for (const item of next.plugins)
            if (selected.has(item.id) && item.data)
                this.providers?.get(item.id)?.reconcileImport?.(
                    item.data,
                    next.plugins.filter((p) => selected.has(p.id))
                );
        validateSnapshot(next);
        return next;
    }
    applySnapshot(input, { partial = false } = {}) {
        validateSnapshot(input);
        for (const plugin of input.plugins) {
            this.storage.replace(plugin.id, plugin.values);
            if (plugin.data) {
                const provider = this.providers?.get(plugin.id);
                if (!provider?.importData) throw Error('插件领域数据处理器缺失');
                provider.importData(plugin.data);
            }
        }
        this.database((db) => {
            db.exec('BEGIN IMMEDIATE');
            try {
                if (!partial) db.exec('DELETE FROM installed_plugins');
                const insert = db.prepare(
                    'INSERT INTO installed_plugins VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled,version=excluded.version'
                );
                for (const plugin of input.plugins)
                    insert.run(plugin.id, Number(plugin.enabled), plugin.version, new Date().toISOString());
                db.exec('COMMIT');
            } catch (error) {
                db.exec('ROLLBACK');
                throw error;
            }
        });
        for (const plugin of this.plugins.values()) {
            const item = input.plugins.find((p) => p.id === plugin.id);
            if (item) plugin.enabled = item.enabled;
        }
    }
}
function validateSnapshot(input) {
    if (input?.version !== 1 || !Array.isArray(input.plugins) || input.plugins.length > 100)
        throw Error('插件备份格式不正确');
    const ids = new Set();
    for (const plugin of input.plugins) {
        pluginId(plugin.id);
        if (
            ids.has(plugin.id) ||
            typeof plugin.enabled !== 'boolean' ||
            typeof plugin.version !== 'string' ||
            !/^\d+\.\d+\.\d+$/.test(plugin.version)
        )
            throw Error('插件备份信息不正确或重复');
        ids.add(plugin.id);
        validateValues(plugin.values);
        if (
            plugin.data &&
            (!Number.isInteger(plugin.data.schemaVersion) ||
                Buffer.byteLength(JSON.stringify(plugin.data)) > 20 * 1024 * 1024)
        )
            throw Error('插件领域数据版本或大小不正确');
    }
}
module.exports = { PluginRegistry, validateSnapshot };
