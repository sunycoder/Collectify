const { randomUUID } = require('node:crypto');
const SECTIONS = ['bookmarks', 'tasks', 'notes', 'settings', 'plugins'];
const BUSINESS_SECTIONS = ['bookmarks', 'tasks', 'notes', 'settings'];
const { validateSnapshot } = require('../../plugin-system/registry');

function selection(value, available = SECTIONS) {
    if (
        !Array.isArray(value) ||
        !value.length ||
        new Set(value).size !== value.length ||
        value.some((key) => !available.includes(key))
    )
        throw Error('请选择文件中包含的数据类型');
    return value;
}

function exportWorkspace(store, sections = BUSINESS_SECTIONS, includeCredentials = true, plugins) {
    selection(sections);
    const snapshot = store.snapshot(),
        data = {};
    if (sections.includes('bookmarks')) {
        data.categories = snapshot.categories;
        data.entries = snapshot.entries.map((entry) => {
            if (includeCredentials) return entry;
            const { username, password, ...resource } = entry;
            return resource;
        });
    }
    for (const key of ['tasks', 'notes']) if (sections.includes(key)) data[key] = snapshot[key];
    if (sections.includes('settings')) {
        // 跨机器只交换偏好，不恢复旧机器的窗口位置、可见状态或 MCP 连接令牌。
        data.settings = { ...snapshot.settings, widget: { ...snapshot.settings.widget, visible: false, bounds: null } };
    }
    if (sections.includes('plugins')) {
        if (!plugins) throw Error('插件宿主尚未就绪');
        data.plugins = plugins.snapshot();
    }
    return { format: 'collectify-workspace', version: 1, exportedAt: new Date().toISOString(), sections, data };
}

function parseWorkspace(raw) {
    if (raw?.format === 'collectify-workspace') {
        if (raw.version !== 1 || !raw.data || typeof raw.data !== 'object') throw Error('不支持的数据文件版本');
        selection(raw.sections);
        for (const key of raw.sections) {
            if (key === 'bookmarks' && (!Array.isArray(raw.data.categories) || !Array.isArray(raw.data.entries)))
                throw Error('收藏数据不完整');
            if (['tasks', 'notes'].includes(key) && !Array.isArray(raw.data[key])) throw Error('数据列表不完整');
            if (
                key === 'settings' &&
                (!raw.data.settings || typeof raw.data.settings !== 'object' || Array.isArray(raw.data.settings))
            )
                throw Error('设置数据不正确');
            if (key === 'plugins') validateSnapshot(raw.data.plugins);
        }
        return structuredClone(raw);
    }
    // 原 version 2 文件仍可作为仅含收藏的全局数据文件导入，预览明确标出可选范围。
    if (raw?.version === 2 && Array.isArray(raw.categories) && Array.isArray(raw.entries))
        return {
            format: 'collectify-workspace',
            version: 1,
            sections: ['bookmarks'],
            data: { categories: raw.categories, entries: raw.entries }
        };
    throw Error('不是有效的 Collectify 数据文件');
}

function describeWorkspace(raw) {
    const parsed = parseWorkspace(raw),
        data = parsed.data;
    return {
        sections: parsed.sections,
        counts: {
            bookmarks: data.entries?.length || 0,
            tasks: data.tasks?.length || 0,
            notes: data.notes?.length || 0,
            plugins: data.plugins?.plugins.length || 0
        },
        exportedAt: parsed.exportedAt || ''
    };
}

function planImport(store, raw, options) {
    const parsed = parseWorkspace(raw),
        sections = selection(options.sections, parsed.sections),
        replace = options.mode === 'replace';
    if (!['merge', 'replace'].includes(options.mode)) throw Error('请选择合并或替换');
    const incoming = parsed.data;
    // 沿用资源校验、去重与本机会话 ID 规则，所有操作先在隔离快照执行，不产生部分落盘。
    const staged = Object.create(store);
    staged.data = store.snapshot();
    staged.commit = function (data) {
        this.data = this.validate(data);
    };
    const bookmarkMap = new Map();
    if (sections.includes('bookmarks')) {
        const source = store.validate({
            version: 2,
            categories: incoming.categories,
            entries: incoming.entries.map((entry) => ({ ...entry, id: entry.id || randomUUID() }))
        });
        staged.import(source, { mode: options.mode, override: true, sourceName: options.sourceName || '工作空间数据' });
        for (const entry of source.entries) {
            const categoryName = source.categories.find((c) => c.id === entry.categoryId).name.toLocaleLowerCase();
            const target = staged.entries.find(
                (item) =>
                    staged.categories.find((c) => c.id === item.categoryId)?.name.toLocaleLowerCase() ===
                        categoryName &&
                    item.type === entry.type &&
                    (item.type === 'web'
                        ? item.url === entry.url
                        : item.name === entry.name &&
                          item.localPath === entry.localPath &&
                          item.content === entry.content)
            );
            if (target) bookmarkMap.set(entry.id, target.id);
        }
    }
    for (const key of ['tasks', 'notes'])
        if (sections.includes(key)) {
            if (incoming[key].length > 5000) throw Error('一次最多导入 5000 项');
            const sourceIds = new Set();
            const items = incoming[key].map((item) => {
                if (!item || typeof item !== 'object') throw Error('数据项不正确');
                const next = { ...item, id: item.id || randomUUID() };
                if (sourceIds.has(next.id)) throw Error('导入文件存在重复 ID');
                sourceIds.add(next.id);
                if (key === 'tasks' && next.bookmarkId) {
                    next.bookmarkId = sections.includes('bookmarks')
                        ? bookmarkMap.get(next.bookmarkId) || ''
                        : staged.entries.some((e) => e.id === next.bookmarkId)
                          ? next.bookmarkId
                          : '';
                }
                return next;
            });
            if (replace) staged.data[key] = items;
            else {
                const merged = new Map(staged.data[key].map((item) => [item.id, item]));
                for (const item of items) merged.set(item.id, item);
                staged.data[key] = [...merged.values()];
            }
        }
    if (sections.includes('settings'))
        staged.data.settings = {
            ...incoming.settings,
            widget: {
                ...incoming.settings.widget,
                visible: store.data.settings.widget.visible,
                bounds: store.data.settings.widget.bounds
            }
        };
    return store.validate(staged.data);
}

function importWorkspace(store, raw, options, plugins) {
    const next = planImport(store, raw, options);
    const includePlugins = options.sections.includes('plugins');
    if (includePlugins && !plugins) throw Error('插件宿主尚未就绪');
    const pluginBefore = includePlugins ? plugins.snapshot() : null;
    const pluginNext = includePlugins ? plugins.planImport(raw.data.plugins, options.mode) : null;
    if (options.backup !== false) store.backup(`${store.file}.before-import.bak`);
    if (includePlugins && options.backup !== false)
        require('node:fs').writeFileSync(
            `${store.file}.plugins-before-import.json`,
            JSON.stringify({
                format: 'collectify-workspace',
                version: 1,
                exportedAt: new Date().toISOString(),
                sections: ['plugins'],
                data: { plugins: pluginBefore }
            }),
            'utf8'
        );
    // 多个 SQLite 文件无法借单库事务提供跨库原子性；写前保留恢复快照，失败补偿。
    const journal = includePlugins ? `${store.file}.plugin-import-recovery.json` : null;
    if (journal)
        require('node:fs').writeFileSync(
            journal,
            JSON.stringify({
                workspace: store.snapshot(),
                plugins: pluginBefore,
                pluginIds: pluginNext.plugins.map((p) => p.id)
            }),
            'utf8'
        );
    try {
        if (includePlugins) plugins.applySnapshot(pluginNext);
        store.commit(next);
        if (journal) require('node:fs').unlinkSync(journal);
    } catch (error) {
        if (includePlugins) {
            try {
                recoverWorkspaceImport(store, plugins);
            } catch (rollbackError) {
                throw Error(`导入失败，恢复快照已保留：${error.message}；恢复失败：${rollbackError.message}`);
            }
        }
        throw error;
    }
    return {
        sections: options.sections,
        counts: { bookmarks: next.entries.length, tasks: next.tasks.length, notes: next.notes.length }
    };
}
function recoverWorkspaceImport(store, plugins) {
    const fs = require('node:fs'),
        file = `${store.file}.plugin-import-recovery.json`;
    if (!fs.existsSync(file)) return false;
    const recovery = JSON.parse(fs.readFileSync(file, 'utf8'));
    validateSnapshot(recovery.plugins);
    const workspace = store.validate(recovery.workspace);
    if (!Array.isArray(recovery.pluginIds)) throw Error('插件恢复快照格式不正确');
    const { pluginId } = require('../../plugin-system/manifest');
    recovery.pluginIds.forEach(pluginId);
    for (const id of recovery.pluginIds)
        if (!recovery.plugins.plugins.some((p) => p.id === id)) plugins.storage.replace(id, {});
    plugins.applySnapshot(recovery.plugins);
    store.commit(workspace);
    fs.unlinkSync(file);
    return true;
}
module.exports = {
    SECTIONS,
    exportWorkspace,
    parseWorkspace,
    describeWorkspace,
    planImport,
    importWorkspace,
    recoverWorkspaceImport
};
