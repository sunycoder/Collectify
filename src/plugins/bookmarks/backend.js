const fs = require('node:fs'),
    path = require('node:path');
const { shell, session } = require('electron');
const { createStore } = require('../.shared/domain-store');
const definition = require('./schema');
const { seed } = require('../.shared/seed');
const credentials = require('./credentials');
const { copyText } = require('../../clipboard-service');
const { validUrl } = require('../../plugin-system/urls');

exports.create = async (context) => {
    const initial = seed(context, definition);
    if (initial.entries) initial.entries = await Promise.all(initial.entries.map((e) => credentials.prepare(e)));
    const store = createStore(
        context.file,
        {
            ...definition,
            project: ({ version, categories, entries, configSource, sourceName }) => ({
                version,
                categories,
                entries,
                configSource,
                sourceName
            })
        },
        initial
    );
    const browser = require('./browser').create(context, store);
    const entry = (id) => {
        const item = store.entries.find((v) => v.id === id);
        if (!item) throw Error('收藏不存在');
        return item;
    };
    const changed = () => context.changed();
    async function call(action, payload) {
        let result,
            write = false;
        switch (action) {
            case 'state':
                return {
                    ...store.snapshot(),
                    entries: store.entries.map(credentials.publicEntry),
                    settings: context.getSettings()
                };
            case 'list':
                return store.entries.map((e) => ({ id: e.id, name: e.name }));
            case 'save': {
                const previous = store.entries.find((v) => v.id === payload.id);
                result = store.save(await credentials.prepare(payload, previous));
                write = true;
                if (previous && previous.url !== result.url) {
                    for (const tab of [...browser.tabs.values()])
                        if (tab.entry.id === result.id) browser.closeTab(tab.id);
                    await session.fromPartition(`persist:entry-${result.id}`).clearStorageData();
                }
                for (const tab of browser.tabs.values()) if (tab.entry.id === result.id) tab.entry = result;
                result = credentials.publicEntry(result);
                break;
            }
            case 'delete':
                store.remove(payload);
                for (const tab of [...browser.tabs.values()]) if (tab.entry.id === payload) browser.closeTab(tab.id);
                await session.fromPartition(`persist:entry-${payload}`).clearStorageData();
                if (context.available('collectify.tasks'))
                    await context.invoke('collectify.tasks', 'unlink-bookmark', payload);
                write = true;
                break;
            case 'category-save':
                result = store.saveCategory(payload);
                write = true;
                break;
            case 'category-delete':
                store.removeCategory(payload.id, payload.targetId);
                write = true;
                break;
            case 'reorder':
                store.reorder(payload.kind, payload.ids);
                write = true;
                break;
            case 'copy': {
                const e = entry(payload);
                await copyText(
                    e.type === 'text' ? e.content : ['file', 'folder'].includes(e.type) ? e.localPath : e.url
                );
                break;
            }
            case 'copy-text':
                if (typeof payload !== 'string' || payload.length > 30000) throw Error('复制内容不正确');
                await copyText(payload);
                break;
            case 'password':
                return credentials.passwordOf(entry(payload));
            case 'copy-credential': {
                const e = entry(payload.id);
                await copyText(payload.field === 'username' ? e.username : await credentials.passwordOf(e));
                break;
            }
            case 'resource-viewed':
                store.markOpened(payload);
                write = true;
                break;
            case 'pick-resource':
                return context.pick(payload === 'folder' ? 'folder' : 'file');
            case 'reveal-resource': {
                const e = entry(payload);
                if (!['file', 'folder'].includes(e.type)) throw Error('不是本地资源');
                shell.showItemInFolder(e.localPath);
                break;
            }
            case 'open': {
                const e = entry(typeof payload === 'string' ? payload : payload.id),
                    mode = ['internal', 'external'].includes(payload?.mode)
                        ? payload.mode
                        : context.getSettings().browserOpenMode || 'internal';
                if (['file', 'folder'].includes(e.type)) {
                    if (!fs.existsSync(e.localPath)) throw Error('本地资源不存在');
                    const error = await shell.openPath(e.localPath);
                    if (error) throw Error(error);
                } else if (e.type !== 'web') throw Error('请从收藏详情查看该资源');
                else if (mode === 'external') {
                    if (!validUrl(e.url)) throw Error('网址不正确');
                    await shell.openExternal(e.url);
                } else {
                    await browser.openEntry(e);
                    if (e.username || e.password) await browser.loginHelper.show(e);
                }
                store.markOpened(e.id);
                write = true;
                break;
            }
            case 'organize': {
                const data = store.snapshot();
                if (payload.bookmarkIds.some((id) => !data.entries.some((e) => e.id === id)))
                    throw Error('部分收藏不存在');
                let category = data.categories.find((c) => c.name.toLowerCase() === payload.categoryName.toLowerCase());
                if (!category) {
                    category = {
                        id: require('node:crypto').randomUUID(),
                        name: payload.categoryName,
                        description: '',
                        color: 'blue',
                        icon: 'link'
                    };
                    data.categories.push(category);
                }
                data.entries = data.entries.map((e) =>
                    payload.bookmarkIds.includes(e.id) ? { ...e, categoryId: category.id } : e
                );
                store.commit(data);
                result = { categoryId: category.id, moved: payload.bookmarkIds.length };
                write = true;
                break;
            }
            default:
                return (await browser.call(action, payload))?.data;
        }
        if (write) changed();
        return result;
    }
    return {
        store,
        browser,
        call,
        layout: browser.layout,
        activate() {},
        deactivate() {
            browser.destroy();
        },
        dispose() {
            browser.dispose();
        },
        summary: () => ({ count: store.entries.length }),
        navigation: () => [
            { id: 'all', label: '全部收藏', count: store.entries.length },
            { id: 'favorite', label: '已置顶', count: store.entries.filter((e) => e.favorite).length },
            { id: 'recent', label: '最近打开' },
            { id: 'new-category', label: '新建分类', group: '分类' },
            ...store.categories.map((c) => ({
                id: `category:${c.id}`,
                label: c.name,
                count: store.entries.filter((e) => e.categoryId === c.id).length,
                group: '分类',
                draggable: c.id !== 'inbox',
                dragData: { kind: 'category', id: c.id }
            }))
        ],
        exportData: (includeCredentials) => ({
            schemaVersion: 1,
            categories: store.categories,
            entries: store.entries.map((e) =>
                includeCredentials === false
                    ? Object.fromEntries(Object.entries(e).filter(([key]) => !['username', 'password'].includes(key)))
                    : e
            ),
            configSource: store.data.configSource,
            sourceName: store.data.sourceName
        }),
        planData(data, mode) {
            if (data?.schemaVersion !== 1) throw Error('收藏数据版本不支持');
            const staged = Object.create(store);
            staged.data = store.snapshot();
            staged.commit = function (value) {
                this.data = this.validate(value);
            };
            staged.import(
                { version: 2, categories: data.categories, entries: data.entries },
                { mode, override: true, sourceName: data.sourceName || '插件数据' }
            );
            const referenceMap = {};
            for (const source of data.entries) {
                const categoryName = data.categories.find((c) => c.id === source.categoryId)?.name;
                const category = staged.categories.find((c) => c.name === categoryName);
                const target = staged.entries.find(
                    (e) =>
                        e.categoryId === category?.id &&
                        e.type === source.type &&
                        (e.type === 'web'
                            ? e.url === source.url
                            : e.name === source.name &&
                              e.localPath === source.localPath &&
                              e.content === source.content)
                );
                if (target) referenceMap[source.id] = target.id;
            }
            return {
                schemaVersion: 1,
                categories: staged.categories,
                entries: staged.entries,
                configSource: 'imported',
                sourceName: data.sourceName || '插件数据',
                referenceMap
            };
        },
        importData(data) {
            store.commit({ ...store.snapshot(), ...data });
            browser.destroy();
        },
        mcpTools() {
            const { z } = require('../../vendor/mcp-service.cjs');
            return [
                {
                    name: 'list_bookmarks',
                    description: '查询收藏，不返回账号密码',
                    inputSchema: { query: z.string().optional(), categoryId: z.string().optional() },
                    handler: (input) =>
                        store.entries
                            .filter(
                                (e) =>
                                    (!input.categoryId || e.categoryId === input.categoryId) &&
                                    (!input.query ||
                                        [e.name, e.note, e.url].some((v) =>
                                            v.toLowerCase().includes(input.query.toLowerCase())
                                        ))
                            )
                            .map((e) =>
                                Object.fromEntries(
                                    Object.entries(e).filter(([key]) => !['username', 'password'].includes(key))
                                )
                            )
                },
                {
                    name: 'organize_bookmarks',
                    description: '将已有收藏批量移动到分类，保留登录资料',
                    write: true,
                    inputSchema: {
                        categoryName: z.string().min(1).max(60),
                        bookmarkIds: z.array(z.string()).min(1).max(200)
                    },
                    handler: (input) => call('organize', input)
                }
            ];
        }
    };
};
