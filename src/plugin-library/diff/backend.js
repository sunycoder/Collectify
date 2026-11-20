const path = require('node:path');
exports.create = async (context, adapters = {}) => {
    // 安装、启用时只创建生命周期状态；文件、解析库、窗口和工作线程均在主动使用时初始化。
    let active = true,
        generation = 0,
        roots = [null, null],
        cache = {},
        settings,
        workspace = { dirty: false, texts: ['', ''], names: ['左侧', '右侧'], hasOtherEdits: false },
        closeApproved = false,
        savedDraftValue = null,
        serial = Promise.resolve();
    const jobs = new Map(),
        resources = new Map();
    const fs = () => require('node:fs'),
        electron = () => adapters.electron || require('electron');
    const alive = () => {
        if (!active) throw Error('Diff 已停用');
    };
    const persistence = () => require('./persistence'),
        directory = path.dirname(context.file);
    const prefs = () => {
        if (settings) return settings;
        try {
            settings = persistence().preferences(
                JSON.parse(fs().readFileSync(path.join(directory, 'preferences.json'), 'utf8'))
            );
        } catch (e) {
            if (e.code !== 'ENOENT') throw e;
            settings = persistence().preferences();
        }
        return settings;
    };
    function cancel(key) {
        const job = jobs.get(key);
        if (job) {
            jobs.delete(key);
            job.reject(Error('对比已取消'));
            void job.worker.terminate();
            context.changed?.();
        }
    }
    function work(key, action, data) {
        alive();
        cancel(key);
        return new Promise((resolve, reject) => {
            const { Worker } = require('node:worker_threads');
            const worker = (context.startWorker || ((file, options) => new Worker(file, options)))(
                path.join(__dirname, action === 'ocr' ? 'vendor/ocr-worker.cjs' : 'vendor/compare-worker.cjs'),
                {
                    workerData: { action, data },
                    resourceLimits: { maxOldGenerationSizeMb: 384 }
                }
            );
            const finish = (error, result) => {
                if (jobs.get(key)?.worker !== worker) return;
                clearTimeout(timer);
                jobs.delete(key);
                context.changed?.();
                void worker.terminate();
                if (error) reject(error);
                else {
                    try {
                        alive();
                        resolve(result);
                    } catch (e) {
                        reject(e);
                    }
                }
            };
            const timer = setTimeout(() => finish(Error('对比超过 60 秒，已停止；请缩小对比范围')), 60000);
            jobs.set(key, {
                worker,
                reject: (e) => {
                    clearTimeout(timer);
                    reject(e);
                }
            });
            const labels = {
                scan: '扫描目录与内容指纹',
                parse: '解析本地文件',
                report: '生成差异报告',
                ocr: '离线文字识别'
            };
            jobs.get(key).title = labels[action] || 'Diff 任务';
            jobs.get(key).startedAt = Date.now();
            context.changed?.();
            worker.on('message', (m) => {
                if (m.progress) {
                    context.emit?.('progress', m.progress);
                } else finish(m.error ? Error(m.error) : null, m.result);
            });
            worker.on('error', (e) => finish(e));
            worker.on('exit', (code) => {
                if (jobs.get(key)?.worker === worker) finish(Error('对比工作线程已停止（' + code + '）'));
            });
        });
    }
    async function descriptor(file, side) {
        if (typeof file !== 'string' || !path.isAbsolute(file) || file.length > 4000) throw Error('请选择本地绝对路径');
        const real = await fs().promises.realpath(file),
            stat = await fs().promises.stat(real);
        alive();
        if (stat.isDirectory()) {
            return { kind: 'folder', name: path.basename(real), path: real };
        }
        if (!stat.isFile() || stat.size > 32 * 1024 * 1024) throw Error('文件不是普通文件或超过 32 MiB');
        const M = require('./model'),
            ext = path.extname(real).toLowerCase();
        const base = { name: path.basename(real), path: real, size: stat.size, modified: stat.mtimeMs };
        if (M.IMAGES[ext] || ext === '.pdf') {
            const id = require('node:crypto').randomUUID();
            while (resources.size >= 64) resources.delete(resources.keys().next().value);
            resources.set(id, {
                file: real,
                mime: M.IMAGES[ext] || 'application/pdf',
                size: stat.size,
                modified: stat.mtimeMs
            });
            return {
                ...base,
                kind: ext === '.pdf' ? 'pdf' : 'image',
                url: 'collectify-plugin://collectify.diff/__resources/' + id
            };
        }
        return { ...base, ...(await work('parse-' + side, 'parse', { file: real })) };
    }
    async function importPaths(input) {
        const paths = input.paths;
        if (!Array.isArray(paths) || !paths.length || paths.length > 2) throw Error('一次请选择一到两个文件或目录');
        const side = input.side === 1 ? 1 : 0,
            result = [];
        const request = ++generation;
        cancel('scan');
        for (let i = 0; i < paths.length; i++) {
            const target = paths.length === 2 ? i : side;
            result.push({ side: target, item: await descriptor(paths[i], target) });
            if (request !== generation) throw Error('已由新的文件选择替代');
        }
        for (const value of result) if (value.item.kind === 'folder') roots[value.side] = value.item.path;
        return result;
    }
    function readDraft(full) {
        const data = persistence().read(directory, 'text-draft.json');
        if (!data) return null;
        if (data.schemaVersion !== 1) throw Error('Diff 草稿版本不受支持');
        const validated = persistence().workspace(data.workspace);
        return full
            ? { ...validated, savedAt: data.savedAt }
            : {
                  savedAt: data.savedAt,
                  names: validated.names,
                  characters: validated.texts.reduce((n, s) => n + s.length, 0)
              };
    }
    function saveDraft() {
        if (!workspace.texts.some(Boolean)) throw Error('当前没有可保存的文本工作副本');
        persistence().write(directory, 'text-draft.json', {
            schemaVersion: 1,
            savedAt: new Date().toISOString(),
            workspace: { ...workspace, hasOtherEdits: false }
        });
        savedDraftValue = JSON.stringify(workspace);
    }
    return {
        backupCoverage: () => ({
            content: '原始对比文件、图片与草稿不包含',
            preferences: '语言、显示与忽略规则',
            externalFiles: false
        }),
        exportData() {
            const { localDrafts, ...preferences } = prefs();
            return {
                schemaVersion: 1,
                preferences,
                pairs: persistence().pairs(persistence().read(directory, 'pairs.json') || [])
            };
        },
        planData(input) {
            if (input?.schemaVersion !== 1) throw Error('Diff 偏好备份版本不正确');
            const clean = persistence().preferences(input.preferences);
            clean.localDrafts = prefs().localDrafts;
            return { schemaVersion: 1, preferences: clean, pairs: persistence().pairs(input.pairs || []) };
        },
        importData(input) {
            const next = this.planData(input);
            persistence().write(directory, 'preferences.json', next.preferences);
            persistence().write(directory, 'pairs.json', next.pairs);
            settings = next.preferences;
            context.emit?.('preferences-changed', settings);
        },
        tasks() {
            return [...jobs].map(([id, job]) => ({
                id,
                title: job.title || 'Diff 任务',
                startedAt: job.startedAt,
                progress: null,
                cancellable: true
            }));
        },
        cancelTask(id) {
            cancel(id);
        },
        async beforeClose(reason) {
            await serial;
            if (!workspace.dirty || closeApproved) return true;
            const canDraft = workspace.texts.some(Boolean),
                answer = await electron().dialog.showMessageBox(context.getWindow?.(), {
                    type: 'warning',
                    message: 'Diff 有尚未另存的工作内容',
                    detail: `即将${{ quit: '退出程序', disable: '停用插件', uninstall: '卸载插件', update: '更新插件', reload: '重新加载插件', import: '导入数据并重建页面' }[reason] || '关闭页面'}。${canDraft ? '可保存当前文本工作副本为本地草稿，之后恢复；草稿不包含图片、表格内存编辑或原始文件。' : ''}${workspace.hasOtherEdits ? ' 图片/表格内存编辑不能通过文本草稿恢复，请取消后先导出。' : ''}`,
                    buttons: canDraft
                        ? ['取消操作', '放弃未另存内容', '保存文本草稿并继续']
                        : ['取消操作', '放弃未另存内容'],
                    defaultId: 0,
                    cancelId: 0
                });
            if (answer.response === 0) return false;
            if (answer.response === 2) saveDraft();
            closeApproved = true;
            return true;
        },
        closeCheckCanceled() {
            closeApproved = false;
        },
        async call(action, input = {}) {
            alive();
            switch (action) {
                case 'workspace-roots': {
                    if (!Array.isArray(input.paths) || input.paths.length !== 2) throw Error('目录组合无效');
                    roots = await Promise.all(
                        input.paths.map(async (p) => {
                            if (!p) return null;
                            if (
                                typeof p !== 'string' ||
                                !path.isAbsolute(p) ||
                                !(await fs().promises.stat(p)).isDirectory()
                            )
                                throw Error('目录已不存在，请重新定位');
                            return fs().promises.realpath(p);
                        })
                    );
                    cancel('scan');
                    return;
                }
                case 'pair-choose': {
                    const result = await electron().dialog.showOpenDialog(context.getWindow?.(), {
                        title: input.side === 1 ? '重新定位右侧内容' : '重新定位左侧内容',
                        properties: [input.directory === true ? 'openDirectory' : 'openFile']
                    });
                    return result.canceled ? null : result.filePaths[0];
                }
                case 'pair-list':
                    return persistence().read(directory, 'pairs.json') || [];
                case 'pair-delete': {
                    const list = (persistence().read(directory, 'pairs.json') || []).filter((p) => p.id !== input.id);
                    persistence().write(directory, 'pairs.json', list);
                    return list;
                }
                case 'pair-save': {
                    if (
                        !Array.isArray(input.paths) ||
                        input.paths.length !== 2 ||
                        input.paths.some((p) => typeof p !== 'string' || !path.isAbsolute(p) || p.length > 4000)
                    )
                        throw Error('请保存两个有效的本地路径');
                    const list = persistence().read(directory, 'pairs.json') || [];
                    if (list.length >= 30 && !list.some((p) => p.id === input.id)) throw Error('最多保存 30 个组合');
                    const stats = await Promise.all(input.paths.map((p) => fs().promises.stat(p)));
                    if (
                        stats.some((s) => !s.isFile() && !s.isDirectory()) ||
                        stats[0].isDirectory() !== stats[1].isDirectory()
                    )
                        throw Error('请选择两个文件或两个目录');
                    const pair = {
                        id: input.id || require('node:crypto').randomUUID(),
                        name: String(input.name || '对比组合').slice(0, 100),
                        paths: input.paths,
                        settings: persistence().preferences(input.settings || {}),
                        directory: stats[0].isDirectory()
                    };
                    const next = [...list.filter((p) => p.id !== pair.id), pair];
                    persistence().write(directory, 'pairs.json', next);
                    return next;
                }
                case 'state': {
                    let draft = null,
                        draftError = '';
                    try {
                        draft = readDraft(false);
                    } catch (error) {
                        draftError = error.message;
                    }
                    return { settings: prefs(), roots, platform: process.platform, draft, draftError };
                }
                case 'workspace-state': {
                    const next = persistence().workspace(input),
                        changed = JSON.stringify(next) !== JSON.stringify(workspace);
                    workspace = next;
                    if (changed) closeApproved = false;
                    if (
                        prefs().localDrafts &&
                        workspace.dirty &&
                        workspace.texts.some(Boolean) &&
                        JSON.stringify(workspace) !== savedDraftValue
                    )
                        saveDraft();
                    return;
                }
                case 'draft-read':
                    return readDraft(true);
                case 'draft-save':
                    saveDraft();
                    return readDraft(false);
                case 'draft-delete':
                    fs().rmSync(path.join(directory, 'text-draft.json'), { force: true });
                    savedDraftValue = JSON.stringify(workspace);
                    return;
                case 'save-text': {
                    const side = input.side === 1 ? 1 : 0;
                    if (typeof input.text !== 'string' || input.text.length > 2000000) throw Error('另存文本超过限制');
                    const result = await electron().dialog.showSaveDialog(context.getWindow?.(), {
                        title: '另存当前文本（不会覆盖原文件）',
                        defaultPath: path.basename(input.name || 'Diff-工作副本.txt')
                    });
                    alive();
                    if (result.canceled) return null;
                    const destination = path.resolve(result.filePath),
                        parents = path.relative(directory, destination);
                    if (
                        parents === '' ||
                        (!parents.startsWith('..' + path.sep) && parents !== '..' && !path.isAbsolute(parents))
                    )
                        throw Error('不能覆盖插件内部数据');
                    if (
                        Array.isArray(input.originals) &&
                        input.originals.some(
                            (p) => typeof p === 'string' && path.resolve(p).toLowerCase() === destination.toLowerCase()
                        )
                    )
                        throw Error('请另选文件名，原文件保持只读');
                    const tmp = destination + '.' + require('node:crypto').randomUUID() + '.tmp';
                    try {
                        await fs().promises.writeFile(tmp, input.text, 'utf8');
                        alive();
                        await fs().promises.rename(tmp, destination);
                    } finally {
                        await fs().promises.rm(tmp, { force: true });
                    }
                    return { file: destination, side };
                }
                case 'probe': {
                    if (!Array.isArray(input.paths) || input.paths.length < 1 || input.paths.length > 2)
                        throw Error('一次请选择一到两个文件或文件夹');
                    return Promise.all(
                        input.paths.map(async (file) => {
                            if (typeof file !== 'string' || !path.isAbsolute(file)) throw Error('请选择本地文件');
                            const stat = await fs().promises.stat(file);
                            alive();
                            if (stat.isDirectory()) return 'folder';
                            const ext = path.extname(file).toLowerCase();
                            return require('./model').IMAGES[ext]
                                ? 'image'
                                : ['.docx', '.xlsx', '.xls', '.pdf', '.pptx', '.csv'].includes(ext)
                                  ? 'document'
                                  : 'text';
                        })
                    );
                }
                case 'settings': {
                    const previouslyAuto = prefs().localDrafts;
                    const next = persistence().preferences(input, prefs());
                    persistence().write(directory, 'preferences.json', next);
                    settings = next;
                    if (previouslyAuto && !next.localDrafts)
                        fs().rmSync(path.join(directory, 'text-draft.json'), { force: true });
                    if (!previouslyAuto && next.localDrafts && workspace.dirty && workspace.texts.some(Boolean))
                        saveDraft();
                    context.changed?.();
                    return next;
                }
                case 'choose': {
                    const result = await electron().dialog.showOpenDialog(context.getWindow?.(), {
                        title: input.directory ? '选择对比目录' : '选择对比文件',
                        properties: input.directory ? ['openDirectory'] : ['openFile', 'multiSelections']
                    });
                    alive();
                    if (result.canceled) return null;
                    return importPaths({ side: input.side, paths: result.filePaths.slice(0, 2) });
                }
                case 'import':
                    return importPaths(input);
                case 'scan': {
                    if (!roots[0] || !roots[1]) throw Error('请先选择两侧目录');
                    const request = ++generation,
                        result = await work('scan', 'scan', {
                            roots: [...roots],
                            cache: input.force ? {} : cache,
                            force: input.force === true
                        });
                    if (request !== generation) throw Error('目录已改变，请重新扫描');
                    cache = result.cache;
                    delete result.cache;
                    return { ...result, roots: [...roots] };
                }
                case 'file': {
                    const side = input.side === 1 ? 1 : 0,
                        root = roots[side];
                    if (
                        !root ||
                        typeof input.relative !== 'string' ||
                        input.relative.split(/[\\/]/).some((p) => !p || p === '..' || p === '.')
                    )
                        throw Error('目录文件路径无效');
                    const file = await fs().promises.realpath(path.resolve(root, input.relative));
                    if (!file.startsWith(root + path.sep)) throw Error('文件超出所选目录');
                    return descriptor(file, side);
                }
                case 'swap-roots':
                    roots.reverse();
                    generation++;
                    cancel('scan');
                    return [...roots];
                case 'compare-folders': {
                    if (!Array.isArray(input.relative) || input.relative.length !== 2) throw Error('请选择两个子目录');
                    const selected = await Promise.all(
                        input.relative.map(async (relative, side) => {
                            if (
                                typeof relative !== 'string' ||
                                relative.split(/[\\/]/).some((p) => !p || p === '..' || p === '.')
                            )
                                throw Error('子目录路径无效');
                            const real = await fs().promises.realpath(path.resolve(roots[side], relative));
                            if (
                                !real.startsWith(roots[side] + path.sep) ||
                                !(await fs().promises.stat(real)).isDirectory()
                            )
                                throw Error('子目录越界或类型无效');
                            return real;
                        })
                    );
                    const result = await work('subfolders', 'scan', { roots: selected, force: true });
                    delete result.cache;
                    return { ...result, roots: selected };
                }
                case 'cancel':
                    generation++;
                    for (const key of [...jobs.keys()]) cancel(key);
                    return;
                case 'clear-roots':
                    roots = [null, null];
                    cache = {};
                    generation++;
                    cancel('scan');
                    return;
                case 'report':
                    return work('report', 'report', input);
                case 'ocr': {
                    if (
                        typeof input.image !== 'string' ||
                        input.image.length > 9 * 1024 * 1024 ||
                        !/^[A-Za-z0-9+/=]+$/.test(input.image)
                    )
                        throw Error('识别图片无效或过大');
                    const image = electron().nativeImage.createFromBuffer(Buffer.from(input.image, 'base64')),
                        size = image.getSize();
                    if (image.isEmpty() || size.width * size.height > 4000000)
                        throw Error('OCR 图片超过 400 万像素，请缩小后识别');
                    return work('ocr-' + (input.side === 1 ? 1 : 0), 'ocr', {
                        image: image.toPNG().toString('base64'),
                        language: input.language === 'eng' ? 'eng' : 'eng+chi_sim'
                    });
                }
                case 'export': {
                    const format = ['html', 'json', 'pdf', 'png', 'csv'].includes(input.format) ? input.format : 'html';
                    if (
                        format === 'csv' &&
                        (typeof input.data !== 'string' || Buffer.byteLength(input.data) > 8 * 1024 * 1024)
                    )
                        throw Error('CSV 内容过大或格式无效');
                    const generated = ['png', 'csv'].includes(format)
                        ? null
                        : await work('report', 'report', input.report);
                    const result = await electron().dialog.showSaveDialog(context.getWindow?.(), {
                        title: '导出差异报告',
                        defaultPath: 'Diff-报告.' + format,
                        filters: [{ name: format.toUpperCase(), extensions: [format] }]
                    });
                    alive();
                    if (result.canceled || !result.filePath) return null;
                    let bytes;
                    if (format === 'pdf') {
                        const { BrowserWindow, session } = electron(),
                            isolated = session.fromPartition('diff-report-' + require('node:crypto').randomUUID());
                        isolated.webRequest.onBeforeRequest((details, callback) =>
                            callback({ cancel: !details.url.startsWith('data:') })
                        );
                        const win = new BrowserWindow({
                            show: false,
                            webPreferences: {
                                sandbox: true,
                                nodeIntegration: false,
                                contextIsolation: true,
                                session: isolated
                            }
                        });
                        try {
                            await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(generated.html));
                            alive();
                            bytes = await win.webContents.printToPDF({
                                printBackground: true,
                                preferCSSPageSize: true
                            });
                        } finally {
                            win.destroy();
                        }
                    } else if (format === 'png') {
                        if (
                            typeof input.data !== 'string' ||
                            !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(input.data) ||
                            input.data.length > 9 * 1024 * 1024
                        )
                            throw Error('PNG 数据无效或过大');
                        bytes = Buffer.from(input.data.split(',')[1], 'base64');
                    } else if (format === 'csv') bytes = Buffer.from(input.data, 'utf8');
                    else
                        bytes = Buffer.from(
                            format === 'html' ? generated.html : JSON.stringify(generated.report, null, 2),
                            'utf8'
                        );
                    alive();
                    const tmp = result.filePath + '.' + require('node:crypto').randomUUID() + '.tmp';
                    try {
                        await fs().promises.writeFile(tmp, bytes);
                        alive();
                        await fs().promises.rename(tmp, result.filePath);
                    } finally {
                        await fs().promises.rm(tmp, { force: true });
                    }
                    return { file: result.filePath, bytes: bytes.length };
                }
                default:
                    throw Error('未知 Diff 操作');
            }
        },
        async resource(relative) {
            if (!active) return new Response('Stopped', { status: 403 });
            const value = resources.get(relative.slice('__resources/'.length));
            if (!value) return new Response('Expired', { status: 404 });
            try {
                const real = await fs().promises.realpath(value.file),
                    stat = await fs().promises.stat(real);
                if (real !== value.file || stat.size !== value.size || stat.mtimeMs !== value.modified)
                    return new Response('Changed', { status: 409 });
                const bytes = await require('./model').readFile(real);
                alive();
                return new Response(bytes, {
                    headers: {
                        'Content-Type': value.mime,
                        'Cache-Control': 'no-store',
                        'X-Content-Type-Options': 'nosniff'
                    }
                });
            } catch {
                return new Response('Unavailable', { status: 404 });
            }
        },
        activate() {
            active = true;
            closeApproved = false;
            workspace = { dirty: false, texts: ['', ''], names: ['左侧', '右侧'], hasOtherEdits: false };
        },
        async deactivate() {
            active = false;
            generation++;
            for (const key of [...jobs.keys()]) cancel(key);
            resources.clear();
            cache = {};
            await serial;
        },
        async dispose() {
            await this.deactivate();
        }
    };
};
