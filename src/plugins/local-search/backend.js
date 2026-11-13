const fs = require('node:fs'),
    path = require('node:path'),
    { randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { SearchEngine, folderSearch } = require('./engine');
const { PreviewService } = require('./preview');
const { preferences } = require('./model');
exports.create = async (context, adapters = {}) => {
    const { shell, dialog, nativeImage } = adapters.electron || require('electron');
    const directory = path.dirname(context.file);
    fs.mkdirSync(directory, { recursive: true });
    const database = (action) => {
        const db = new DatabaseSync(context.file);
        try {
            db.exec(
                'PRAGMA busy_timeout=3000; CREATE TABLE IF NOT EXISTS preferences(id INTEGER PRIMARY KEY CHECK(id=1),value_json TEXT NOT NULL CHECK(json_valid(value_json))) STRICT'
            );
            return action(db);
        } finally {
            db.close();
        }
    };
    let settings = preferences(
        database((db) => {
            const row = db.prepare('SELECT value_json FROM preferences WHERE id=1').get();
            return row ? JSON.parse(row.value_json) : {};
        })
    );
    let roots = [],
        results = new Map(),
        controller = null,
        generation = 0,
        active = true,
        source = '未连接';
    const engine = adapters.engine || new SearchEngine(directory),
        preview = new PreviewService(engine, {
            thumbnail: async (file) => {
                const image = await nativeImage.createThumbnailFromPath(file, { width: 1000, height: 800 });
                return image.isEmpty() ? null : image.toDataURL();
            }
        });
    const save = (value) => {
        settings = preferences(value);
        database((db) =>
            db
                .prepare(
                    'INSERT INTO preferences VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value_json=excluded.value_json'
                )
                .run(JSON.stringify(settings))
        );
        return settings;
    };
    const selected = (id) => {
        const file = results.get(id);
        if (!file) throw Error('结果已更新，请重新选择文件');
        return file;
    };
    return {
        async call(action, input = {}) {
            switch (action) {
                case 'state':
                    return { settings, roots, source, platform: process.platform, connected: engine.started };
                case 'settings':
                    return save(input);
                case 'default-settings':
                    return preferences();
                case 'connect': {
                    const status = await engine.connect();
                    if (!active) {
                        await engine.stop();
                        throw Error('插件已停用');
                    }
                    source = status.source;
                    save({ ...settings, engine: 'everything' });
                    return { source, settings };
                }
                case 'engine-window':
                    await engine.window();
                    return;
                case 'choose-folder': {
                    const value = await dialog.showOpenDialog({
                        title: '选择要搜索的文件夹',
                        properties: ['openDirectory', 'multiSelections']
                    });
                    if (!active) throw Error('插件已停用');
                    if (!value.canceled) {
                        roots = value.filePaths.map((file) => fs.realpathSync(file));
                        controller?.abort();
                        save({ ...settings, engine: 'folder' });
                        source = '文件夹搜索';
                    }
                    return { roots, settings, source };
                }
                case 'search': {
                    const query = String(input.query || '').slice(0, 500),
                        filter =
                            settings.filters.find((item) => item.id === input.filter && item.enabled) ||
                            settings.filters[0];
                    const offset = Math.max(0, Math.min(100000, Math.trunc(Number(input.offset) || 0))),
                        sort = input.sort || settings.sort;
                    controller?.abort();
                    controller = new AbortController();
                    const request = ++generation;
                    const options = { query, filter, sort, offset, signal: controller.signal };
                    if (settings.engine === 'folder' && !roots.length) throw Error('请先选择搜索文件夹');
                    const found =
                        settings.engine === 'folder'
                            ? await folderSearch(roots, options)
                            : await engine.search(options);
                    if (!active || request !== generation) throw Error('搜索已取消');
                    if (!offset) results.clear();
                    const items = found.items.map((item) => {
                        const id = randomUUID();
                        results.set(id, item.path);
                        return { ...item, id, name: path.basename(item.path), parent: path.dirname(item.path) };
                    });
                    while (results.size > 3000) results.delete(results.keys().next().value);
                    return { ...found, items, offset };
                }
                case 'preview': {
                    const result = await preview.preview(selected(input.id), { sheetIndex: input.sheetIndex });
                    if (!active) {
                        preview.dispose();
                        throw Error('插件已停用');
                    }
                    return result;
                }
                case 'open': {
                    const error = await shell.openPath(selected(input.id));
                    if (error) throw Error(error);
                    return;
                }
                case 'reveal':
                    shell.showItemInFolder(selected(input.id));
                    return;
                case 'path':
                    return selected(input.id);
                default:
                    throw Error('不支持的本地搜索操作');
            }
        },
        resource: (relative, request) => preview.resource(relative, request),
        activate() {
            active = true;
        },
        async deactivate() {
            active = false;
            controller?.abort();
            generation++;
            results.clear();
            preview.dispose();
            await engine.stop();
        },
        async dispose() {
            controller?.abort();
            preview.dispose();
            await engine.stop();
        },
        exportData: () => ({ schemaVersion: 1, preferences: settings }),
        planData(data) {
            if (data?.schemaVersion !== 1) throw Error('本地搜索设置格式无效');
            return { schemaVersion: 1, preferences: preferences(data.preferences) };
        },
        importData: (data) => save(data.preferences)
    };
};
