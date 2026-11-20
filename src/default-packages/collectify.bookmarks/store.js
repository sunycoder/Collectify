const path = require('node:path');
const { randomUUID } = require('node:crypto');
const COLORS = ['sage', 'blue', 'orange', 'purple', 'rose', 'slate'];
const ICONS = ['game', 'build', 'link', 'chart', 'server', 'book'];
const INBOX = {
    id: 'inbox',
    name: '未分类',
    description: '还没决定归属的地址，先放在这里。',
    color: 'slate',
    icon: 'link'
};

function text(input, key, max, required = false) {
    const value = typeof input?.[key] === 'string' ? input[key].trim() : '';
    if (required && !value) throw new Error(`请填写${{ name: '名称', url: '网址' }[key] || key}`);
    if (value.length > max) throw new Error('内容超过长度限制');
    return value;
}

function validateEntry(input) {
    const type = ['web', 'file', 'folder', 'text', 'credential'].includes(input?.type) ? input.type : 'web';
    let parsed;
    if (type === 'web') {
        try {
            parsed = new URL(text(input, 'url', 2048, type === 'web'));
        } catch {
            throw new Error('请输入完整的 http:// 或 https:// 网址');
        }
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password)
            throw new Error('网址仅支持 HTTP / HTTPS，且不能包含账号密码');
    }
    const localPath = text(input, 'localPath', 2048);
    if (['file', 'folder'].includes(type) && !path.posix.isAbsolute(localPath) && !path.win32.isAbsolute(localPath))
        throw new Error('请选择本地文件或文件夹的绝对路径');
    const content = typeof input.content === 'string' ? input.content : '';
    if (content.length > 30000 || (type === 'text' && !content.trim()))
        throw new Error('请填写文本片段，最多 30000 字');
    return {
        type,
        localPath: ['file', 'folder'].includes(type) ? localPath : '',
        content: type === 'text' ? content : '',
        name: text(input, 'name', 80, true),
        // 账号资料的地址只作参考和复制，不交给网页加载器或系统执行。
        url: parsed?.href || (type === 'credential' ? text(input, 'url', 2048) : ''),
        categoryId: text(input, 'categoryId', 80) || 'inbox',
        environment: text(input, 'environment', 60),
        resourceGroup: text(input, 'resourceGroup', 80),
        note: text(input, 'note', 5000),
        username: text(input, 'username', 200),
        password: typeof input.password === 'string' ? input.password : undefined,
        authMode: input?.authMode === 'basic' ? 'basic' : 'manual',
        mode: input?.mode === 'external' ? 'external' : 'internal',
        favorite: input?.favorite === true,
        lastOpened: Number.isFinite(input?.lastOpened) && input.lastOpened >= 0 ? input.lastOpened : 0
    };
}

function validateCategory(input) {
    return {
        name: text(input, 'name', 60, true),
        description: text(input, 'description', 160),
        color: COLORS.includes(input?.color) ? input.color : 'sage',
        icon: ICONS.includes(input?.icon) ? input.icon : 'link'
    };
}

function validateId(id) {
    return typeof id === 'string' && /^[a-zA-Z0-9-]{1,80}$/.test(id);
}

class BookmarkStore {
    get entries() {
        return this.data.entries;
    }

    get categories() {
        return this.data.categories;
    }

    snapshot() {
        return structuredClone(this.data);
    }

    validate(data) {
        // 应用版本与数据结构版本独立；禁止旧版加载未来结构后保存并静默丢字段。
        if (Number.isInteger(data?.version) && data.version > 2)
            throw new Error('该数据由更高版本的软件创建，请升级 Collectify 后再打开。原文件未改动。');
        if (
            !data ||
            data.version !== 2 ||
            !Array.isArray(data.categories) ||
            !Array.isArray(data.entries) ||
            data.categories.length > 200 ||
            data.entries.length > 5000
        )
            throw new Error('收藏配置格式或数量不正确');
        const categoryIds = new Set(),
            entryIds = new Set(),
            names = new Set();
        const categories = data.categories.map((c) => {
            if (!validateId(c?.id) || categoryIds.has(c.id)) throw new Error('分类 ID 不正确或重复');
            const category = { id: c.id, ...validateCategory(c) };
            if (names.has(category.name.toLocaleLowerCase())) throw new Error('分类名称重复');
            categoryIds.add(c.id);
            names.add(category.name.toLocaleLowerCase());
            return category;
        });
        if (!categoryIds.has('inbox')) {
            if (names.has(INBOX.name)) throw new Error('未分类为系统保留名称');
            categories.push({ ...INBOX });
            categoryIds.add('inbox');
        }
        const entries = data.entries.map((e) => {
            if (!validateId(e?.id) || entryIds.has(e.id)) throw new Error('收藏 ID 不正确或重复');
            entryIds.add(e.id);
            const entry = { id: e.id, ...validateEntry(e) };
            if (!categoryIds.has(entry.categoryId)) throw new Error('收藏所属分类不存在');
            return entry;
        });
        return {
            version: 2,
            categories,
            entries,
            configSource: ['default', 'imported'].includes(data.configSource) ? data.configSource : 'local',
            sourceName: text(data, 'sourceName', 200)
        };
    }

    save(input) {
        const value = validateEntry(input),
            previous = this.entries.find((e) => e.id === input.id);
        if (input.id && !previous) throw new Error('收藏已被删除，请刷新后重试');
        const entry = { id: previous?.id || randomUUID(), ...value, lastOpened: previous?.lastOpened || 0 };
        if (!this.categories.some((c) => c.id === entry.categoryId)) throw Error('收藏所属分类不存在');
        entry.password ??= '';
        this.updateEntities('entries', [entry]);
        return entry;
    }

    remove(id) {
        if (!this.entries.some((e) => e.id === id)) throw new Error('收藏不存在');
        this.commit({ ...this.snapshot(), entries: this.entries.filter((e) => e.id !== id) });
    }

    saveCategory(input) {
        const value = validateCategory(input),
            previous = this.categories.find((c) => c.id === input.id);
        if (input.id && !previous) throw new Error('分类不存在');
        if (input.id === 'inbox' || value.name === '未分类') throw new Error('未分类为系统保留分类');
        const category = { id: previous?.id || randomUUID(), ...value };
        if (
            this.categories.some(
                (c) => c.id !== category.id && c.name.toLocaleLowerCase() === category.name.toLocaleLowerCase()
            )
        )
            throw Error('分类名称重复');
        this.updateEntities('categories', [category]);
        return category;
    }

    removeCategory(id, targetId) {
        if (
            id === 'inbox' ||
            id === targetId ||
            !this.categories.some((c) => c.id === id) ||
            !this.categories.some((c) => c.id === targetId)
        )
            throw new Error('请选择有效的接收分类');
        const data = this.snapshot();
        data.categories = data.categories.filter((c) => c.id !== id);
        data.entries = data.entries.map((e) => (e.categoryId === id ? { ...e, categoryId: targetId } : e));
        this.commit(data);
    }

    reorder(kind, ids) {
        if (!['entries', 'categories'].includes(kind) || !Array.isArray(ids)) throw new Error('排序参数不正确');
        const data = this.snapshot(),
            lookup = new Map(data[kind].map((item) => [item.id, item]));
        if (ids.length !== lookup.size || new Set(ids).size !== ids.length || ids.some((id) => !lookup.has(id)))
            throw new Error('排序对象已变化，请重试');
        data[kind] = ids.map((id) => lookup.get(id));
        this.commit(data);
    }

    markOpened(id) {
        const entry = this.entries.find((e) => e.id === id);
        if (!entry) throw new Error('收藏不存在');
        this.updateEntities('entries', [{ ...entry, lastOpened: Date.now() }]);
    }

    import(raw, options = {}) {
        // 先验证完整文件再合并；导入重新分配 ID，不接入他人的网页登录分区。
        const incoming = this.validate({
            ...raw,
            entries: Array.isArray(raw?.entries)
                ? raw.entries.map((entry) => ({ ...entry, id: entry.id || randomUUID() }))
                : raw?.entries
        });
        if (incoming.entries.length > 1000) throw new Error('一次最多导入 1000 条收藏');
        const data = this.snapshot(),
            categoryMap = new Map();
        if (options.mode === 'replace') {
            // 替换只作用于收藏配置，不删除独立的待办与便签；保留相同网址的本机 ID。
            const oldEntries = data.entries;
            data.categories = incoming.categories;
            data.entries = incoming.entries.map((entry) => {
                const old = oldEntries.find(
                    (e) =>
                        e.type === entry.type &&
                        (entry.type === 'web'
                            ? e.url === entry.url
                            : entry.type === 'credential'
                              ? e.name === entry.name && e.url === entry.url && e.username === entry.username
                              : e.name === entry.name && e.localPath === entry.localPath && e.content === entry.content)
                );
                return {
                    ...entry,
                    id: old?.id || randomUUID(),
                    password: entry.password === undefined ? old?.password : entry.password,

                    lastOpened: old?.lastOpened || 0
                };
            });
            // 同网址不同分类仍为不同收藏，确保 ID 唯一。
            const used = new Set();
            for (const entry of data.entries) {
                if (used.has(entry.id)) entry.id = randomUUID();
                used.add(entry.id);
            }
            data.configSource = 'imported';
            data.sourceName = options.sourceName || 'JSON 文件';
            this.commit(data);
            return data.entries.length;
        }
        for (const category of incoming.categories) {
            let local = data.categories.find((c) => c.name.toLocaleLowerCase() === category.name.toLocaleLowerCase());
            if (!local) {
                local = { ...category, id: randomUUID() };
                data.categories.push(local);
            } else if (options.override && local.id !== 'inbox') {
                local = { ...category, id: local.id };
                data.categories = data.categories.map((c) => (c.id === local.id ? local : c));
            }
            categoryMap.set(category.id, local.id);
        }
        let added = 0;
        for (const entry of incoming.entries) {
            const categoryId = categoryMap.get(entry.categoryId);
            const oldIndex = data.entries.findIndex(
                (e) =>
                    e.categoryId === categoryId &&
                    e.type === entry.type &&
                    (entry.type === 'web'
                        ? e.url === entry.url
                        : entry.type === 'credential'
                          ? e.name === entry.name && e.url === entry.url && e.username === entry.username
                          : e.name === entry.name && e.localPath === entry.localPath && e.content === entry.content)
            );
            if (oldIndex >= 0) {
                if (options.override)
                    data.entries[oldIndex] = {
                        ...entry,
                        id: data.entries[oldIndex].id,
                        categoryId,
                        password: entry.password === undefined ? data.entries[oldIndex].password : entry.password,

                        lastOpened: data.entries[oldIndex].lastOpened
                    };
                continue;
            }
            data.entries.push({ ...entry, id: randomUUID(), categoryId, lastOpened: 0 });
            added++;
        }
        data.configSource = 'imported';
        data.sourceName = options.sourceName || 'JSON 文件';
        this.commit(data);
        return added;
    }
}

module.exports = { BookmarkStore, validateEntry };
