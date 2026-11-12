const {
    app,
    BrowserWindow,
    WebContentsView,
    ipcMain,
    dialog,
    shell,
    session,
    clipboard,
    Notification,
    Tray,
    Menu
} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {Store} = require('./store');
const credentials = require('./credentials');
const {copyText} = require('./clipboard-service');
const {deliverReminders} = require('./reminders');
const {DesktopWidget} = require('./desktop-widget');
const {LoginHelper} = require('./login-helper');
const {LocalMcpService} = require('./vendor/mcp-service.cjs');
const {validate: validateTheme} = require('./theme');
const {exportWorkspace,parseWorkspace,describeWorkspace,importWorkspace}=require('./workspace-transfer');
const {randomUUID}=require('node:crypto');
let desktopWidget, createMainWindow, loginHelper, localMcp;
let importDraft;

function dataChanged() {
    desktopWidget?.update();
    if (win && !win.isDestroyed()) win.webContents.send('data-changed');
}

let tray, quitting = false, reminderBusy = false;

function publicState() {
    const data = store.snapshot();
    data.entries = data.entries.map(credentials.publicEntry);
    return data;
}

async function showMain(section) {
    if (!win && createMainWindow) await createMainWindow();
    if (!win) return;
    win.show();
    if (win.isMinimized()) win.restore();
    win.focus();
    if (section) {
        dashboard = true;
        layout();
        publish();
        win.webContents.send('open-section', section);
    }
}

async function checkReminders() {
    if (reminderBusy || !store || smoke) return;
    reminderBusy = true;
    try {
        const count = await deliverReminders(store, async task => {
            if (Notification.isSupported()) {
                const notification = new Notification({
                    title: `待办提醒 · ${task.title}`,
                    body: task.note.slice(0, 120) || '点击查看待办，可完成或稍后提醒。',
                    icon: path.join(__dirname, '..', 'assets', 'icon.png')
                });
                notification.on('click', () => showMain('tasks'));
                notification.show();
            }
            if (win && !win.isDestroyed()) win.webContents.send('reminder', {title: task.title, id: task.id});
        });
        if (count) dataChanged();
    } catch (error) {
        if (win) win.webContents.send('reminder-error', '提醒发送失败，请检查系统通知设置');
    } finally {
        reminderBusy = false;
    }
}

// 业务数据库与网页登录分区统一放在 Collectify 的本机数据目录。
app.setPath('userData', path.join(app.getPath('appData'), 'Collectify'));
app.setPath('sessionData', app.getPath('userData'));
app.setName('Collectify');
const smoke = process.argv.includes('--smoke-test');
if (smoke) {
    app.disableHardwareAcceleration();
    app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
    app.setPath('userData', fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'collectify-smoke-')));
    app.setPath('sessionData', app.getPath('userData'));
}
if (!app.requestSingleInstanceLock()) {
    app.quit();
    process.exit(0);
}
let win, store, active = null, dashboard = true, overlay = false;
app.on('second-instance', () => {
    if (win) {
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
    }
});
const tabs = new Map();
const prepared = new Set();
const rendererUrl = pathToFileURL(path.join(__dirname, 'index.html')).href;
const validUrl = value => {
    try {
        const url = new URL(value);
        return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
    } catch {
        return false;
    }
};

function getEntry(id) {
    const entry = store.entries.find(e => e.id === id);
    if (!entry) throw new Error('入口不存在');
    return entry;
}

function publish() {
    if (!win || win.isDestroyed()) return;
    win.webContents.send('tabs', {
        active, dashboard,
        tabs: [...tabs.values()].map(t => ({
            id: t.id,
            entryId: t.entry.id,
            name: t.entry.name,
            environment: t.entry.environment,
            color: store.categories.find(c => c.id === t.entry.categoryId)?.color || 'sage',
            title: t.title,
            url: t.url,
            loading: t.loading,
            error: t.error,
            hasCredentials: !!(t.entry.username || t.entry.password),
            back: t.view.webContents.navigationHistory.canGoBack(),
            forward: t.view.webContents.navigationHistory.canGoForward()
        }))
    });
}

function layout() {
    if (!win) return;
    if (dashboard) loginHelper?.hide(true); else if (overlay) loginHelper?.hide();
    const [width, height] = win.getContentSize();
    for (const tab of tabs.values()) {
        const visible = !dashboard && !overlay && active === tab.id && !tab.error;
        tab.view.setVisible(visible);
        if (visible) tab.view.setBounds({
            x: 248,
            y: 168,
            width: Math.max(0, width - 248),
            height: Math.max(0, height - 168)
        });
    }
}

function closeTab(id) {
    const tab = tabs.get(id);
    if (!tab) return;
    win.contentView.removeChildView(tab.view);
    tab.view.webContents.close();
    tabs.delete(id);
    if (active === id) active = [...tabs.keys()].at(-1) || null;
    if (!active) dashboard = true;
    if (!tabs.size) loginHelper?.hide(true);
    layout();
    publish();
}

async function openEntry(entry, url = entry.url, extra = false) {
    if (!validUrl(url)) throw new Error('仅支持 HTTP / HTTPS 网页');
    if (!extra) {
        const existing = [...tabs.values()].find(t => t.entry.id === entry.id);
        if (existing) {
            active = existing.id;
            dashboard = false;
            layout();
            publish();
            return;
        }
    }
    const partition = `persist:entry-${entry.id}`;
    const isolatedSession = session.fromPartition(partition);
    if (!prepared.has(partition)) {
        isolatedSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
        isolatedSession.setPermissionCheckHandler(() => false);
        isolatedSession.on('will-download', (_event, item) => item.setSaveDialogOptions({title: '保存下载文件'}));
        prepared.add(partition);
    }
    // 远程网页不加载 preload，也没有任何工作台 IPC 或本机 Node 能力。
    const view = new WebContentsView({
        webPreferences: {
            partition, nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true,
            allowRunningInsecureContent: false
        }
    });
    const id = require('node:crypto').randomUUID();
    const tab = {id, entry, view, title: entry.name, url, loading: true, error: ''};
    tabs.set(id, tab);
    win.contentView.addChildView(view);
    const wc = view.webContents;
    let authAttempted = false;
    wc.on('login', (event, request, authInfo, callback) => {
        event.preventDefault();
        const current = store.entries.find(e => e.id === entry.id) || entry;
        const ownOrigin = new URL(current.url).origin;
        if (authAttempted || authInfo.isProxy || authInfo.scheme.toLowerCase() !== 'basic' || current.authMode !== 'basic' || new URL(request.url).origin !== ownOrigin) {
            callback();
            return;
        }
        authAttempted = true;
        credentials.passwordOf(current).then(password => callback(current.username, password)).catch(() => callback());
    });
    // 焦点在远程网页内时也能返回全局收藏搜索，不向网页暴露工作台 API。
    wc.on('before-input-event', (event, input) => {
        if (input.type === 'keyDown' && (input.control || input.meta) && input.key.toLowerCase() === 'k' && !overlay) {
            event.preventDefault();
            dashboard = true;
            layout();
            publish();
            win.webContents.focus();
            win.webContents.send('focus-search');
        }
    });
    wc.setWindowOpenHandler(details => {
        if (validUrl(details.url)) openEntry(entry, details.url, true).catch(() => {
        });
        return {action: 'deny'};
    });
    for (const eventName of ['will-navigate', 'will-redirect', 'will-frame-navigate']) {
        wc.on(eventName, (event, destination) => {
            const target = typeof destination === 'string' ? destination : event.url;
            if (!validUrl(target)) event.preventDefault();
        });
    }
    wc.on('page-title-updated', (_event, title) => {
        tab.title = title;
        publish();
    });
    wc.on('did-start-loading', () => {
        tab.loading = true;
        tab.error = '';
        layout();
        publish();
    });
    wc.on('did-stop-loading', () => {
        tab.loading = false;
        publish();
    });
    wc.on('did-navigate', (_event, next) => {
        tab.url = next;
        publish();
    });
    wc.on('did-navigate-in-page', (_event, next, mainFrame) => {
        if (mainFrame) {
            tab.url = next;
            publish();
        }
    });
    wc.on('did-fail-load', (_event, code, description, _url, mainFrame) => {
        if (!mainFrame || code === -3) return;
        tab.error = `网页加载失败：${description} (${code})`;
        tab.loading = false;
        layout();
        publish();
    });
    wc.on('render-process-gone', () => {
        tab.error = '网页进程已退出，请点击刷新重试';
        layout();
        publish();
    });
    active = id;
    dashboard = false;
    layout();
    publish();
    await wc.loadURL(url).catch(() => {
    });
}

function registerApi() {
    ipcMain.handle('workbench', async (event, action, payload) => {
        try {
            if (event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || event.senderFrame.url !== rendererUrl) throw new Error('无权调用工作台接口');
            switch (action) {
                case 'list':
                    return {ok: true, data: store.entries.map(credentials.publicEntry)};
                case 'state':
                    return {ok: true, data: publicState()};
                case 'workspace-info':
                    return {
                        ok: true,
                        data: {
                            directory: app.getPath('userData'),
                            file: store.file,
                            version: app.getVersion(),
                            mcp: localMcp.status()
                        }
                    };
                case 'backup-database': {
                    const result = await dialog.showSaveDialog(win,{title:'备份 Collectify 数据库',defaultPath:'Collectify-backup.sqlite',filters:[{name:'SQLite 数据库',extensions:['sqlite']}]});
                    if (result.canceled) return {ok:true,data:null};
                    if (path.resolve(result.filePath)===path.resolve(store.file)) throw Error('备份位置不能是正在使用的数据库');
                    store.backup(result.filePath);
                    return {ok:true,data:result.filePath};
                }
                case 'open-data-directory': {
                    const error = await shell.openPath(app.getPath('userData'));
                    if (error) throw Error(error);
                    return {ok: true};
                }
                case 'mcp-start':
                    return {ok: true, data: await localMcp.start(payload.port)};
                case 'mcp-stop':
                    return {ok: true, data: await localMcp.stop()};
                case 'mcp-copy':
                    await copyText(JSON.stringify(localMcp.connection(), null, 2));
                    return {ok: true};
                case 'widget-auto-restore': {
                    const data = store.snapshot();
                    data.settings.widget.autoRestore = payload === true;
                    store.commit(data);
                    return {ok: true};
                }
                case 'task-save':
                    return {ok: true, data: store.saveTask(payload)};
                case 'task-delete':
                    store.removeItem('tasks', payload);
                    return {ok: true};
                case 'note-save':
                    return {ok: true, data: store.saveNote(payload)};
                case 'note-delete':
                    store.removeItem('notes', payload);
                    return {ok: true};
                case 'settings': {
                    const data = store.snapshot();
                    data.settings.keepInTray = payload.keepInTray === true;
                    store.commit(data);
                    return {ok: true};
                }
                case 'theme-save': {
                    const data = store.snapshot();
                    data.settings.theme = validateTheme(payload);
                    store.commit(data);
                    return {ok: true, data: data.settings.theme};
                }
                case 'theme-export': {
                    const result = await dialog.showSaveDialog(win, {
                        title: '导出配色方案',
                        defaultPath: 'collectify-theme.json',
                        filters: [{name: '主题 JSON', extensions: ['json']}]
                    });
                    if (result.canceled) return {ok: true, data: null};
                    fs.writeFileSync(result.filePath, JSON.stringify({
                        version: 1,
                        theme: store.data.settings.theme
                    }, null, 2), 'utf8');
                    return {ok: true, data: true};
                }
                case 'theme-import': {
                    const result = await dialog.showOpenDialog(win, {
                        title: '导入配色方案',
                        properties: ['openFile'],
                        filters: [{name: '主题 JSON', extensions: ['json']}]
                    });
                    if (result.canceled) return {ok: true, data: null};
                    if (fs.statSync(result.filePaths[0]).size > 16000) throw Error('主题文件过大');
                    const raw = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8'));
                    if (raw.version !== 1 || !raw.theme) throw Error('主题格式不正确');
                    return {ok: true, data: validateTheme(raw.theme)};
                }
                case 'widget-open':
                    await desktopWidget.open(payload === 'desktop' ? 'desktop' : 'floating');
                    return {ok: true};
                case 'pick-resource': {
                    const result = await dialog.showOpenDialog(win, {
                        title: payload === 'folder' ? '选择文件夹' : '选择文件',
                        properties: [payload === 'folder' ? 'openDirectory' : 'openFile']
                    });
                    return {ok: true, data: result.canceled ? '' : result.filePaths[0]};
                }
                case 'reveal-resource': {
                    const entry = getEntry(payload);
                    if (!['file', 'folder'].includes(entry.type)) throw Error('不是本地资源');
                    shell.showItemInFolder(entry.localPath);
                    return {ok: true};
                }
                case 'resource-viewed':
                    store.markOpened(payload);
                    return {ok: true};
                case 'pick-files': {
                    const result = await dialog.showOpenDialog(win, {
                        title: '关联本地文件',
                        properties: ['openFile', 'multiSelections']
                    });
                    return {ok: true, data: result.canceled ? [] : result.filePaths};
                }
                case 'pick-folder': {
                    const result = await dialog.showOpenDialog(win, {
                        title: '关联本地文件夹',
                        properties: ['openDirectory']
                    });
                    return {ok: true, data: result.canceled ? [] : result.filePaths};
                }
                case 'open-file': {
                    const task = store.data.tasks.find(t => t.id === payload.id),
                        file = task?.attachments[payload.index];
                    if (!file || !path.isAbsolute(file)) throw new Error('附件不存在');
                    if (payload.reveal) shell.showItemInFolder(file);
                    else {
                        const error = await shell.openPath(file);
                        if (error) throw new Error(error);
                    }
                    return {ok: true};
                }
                case 'password':
                    return {ok: true, data: await credentials.passwordOf(getEntry(payload))};
                case 'copy-credential': {
                    const entry = getEntry(payload.id),
                        value = payload.field === 'username' ? entry.username : await credentials.passwordOf(entry);
                    await copyText(value);
                    return {ok: true};
                }
                case 'category-save':
                    return {ok: true, data: store.saveCategory(payload)};
                case 'category-delete':
                    store.removeCategory(payload.id, payload.targetId);
                    return {ok: true};
                case 'reorder':
                    store.reorder(payload.kind, payload.ids);
                    return {ok: true};
                case 'copy': {
                    const entry = getEntry(payload);
                    await copyText(entry.type === 'text' ? entry.content : ['file', 'folder'].includes(entry.type) ? entry.localPath : entry.url);
                    return {ok: true};
                }
                case 'copy-text':
                    if (typeof payload !== 'string' || payload.length > 30000) throw Error('复制内容不正确');
                    await copyText(payload);
                    return {ok: true};
                case 'save': {
                    const previous = store.entries.find(e => e.id === payload.id);
                    const saved = store.save(await credentials.prepare(payload, previous));
                    // 修改地址会创建新会话，避免相同主机不同端口共享 Cookie 导致串号。
                    if (previous && previous.url !== saved.url) {
                        for (const tab of [...tabs.values()]) if (tab.entry.id === saved.id) closeTab(tab.id);
                        await session.fromPartition(`persist:entry-${saved.id}`).clearStorageData();
                        await session.fromPartition(`persist:entry-${saved.id}`).clearCache();
                    }
                    for (const tab of tabs.values()) if (tab.entry.id === saved.id) tab.entry = saved;
                    publish();
                    return {ok: true, data: credentials.publicEntry(saved)};
                }
                case 'delete': {
                    store.remove(payload);
                    for (const tab of [...tabs.values()]) if (tab.entry.id === payload) closeTab(tab.id);
                    await session.fromPartition(`persist:entry-${payload}`).clearStorageData();
                    await session.fromPartition(`persist:entry-${payload}`).clearCache();
                    return {ok: true};
                }
                case 'open': {
                    const entry = getEntry(typeof payload === 'string' ? payload : payload.id);
                    const mode = typeof payload === 'object' && ['external', 'internal'].includes(payload.mode) ? payload.mode : entry.mode;
                    if (['file', 'folder'].includes(entry.type)) {
                        if (!fs.existsSync(entry.localPath)) throw Error('本地资源已移动或不存在，请编辑路径');
                        const error = await shell.openPath(entry.localPath);
                        if (error) throw Error(error);
                    } else if (entry.type !== 'web') throw Error('此资源请在收藏详情中查看');
                    else if (mode === 'external') await shell.openExternal(entry.url);
                    else {
                        void openEntry(entry).catch(() => {
                        });
                        if (entry.username || entry.password) {
                            await loginHelper.show(entry);
                            if (dashboard || overlay || tabs.get(active)?.entry.id !== entry.id) loginHelper.hide(true);
                        }
                    }
                    store.markOpened(entry.id);
                    return {ok: true};
                }
                case 'external': {
                    const tab = tabs.get(payload);
                    const url = tab ? tab.url : getEntry(payload).url;
                    if (!validUrl(url)) throw new Error('地址不正确');
                    await shell.openExternal(url);
                    return {ok: true};
                }
                case 'login-card': {
                    const tab = tabs.get(active);
                    if (!tab) throw Error('请先打开网页');
                    await loginHelper.show(getEntry(tab.entry.id));
                    return {ok: true};
                }
                case 'home':
                    dashboard = true;
                    layout();
                    publish();
                    win.webContents.focus();
                    return {ok: true};
                case 'activate':
                    if (tabs.has(payload)) {
                        active = payload;
                        dashboard = false;
                        layout();
                        publish();
                        loginHelper?.hide();
                        loginHelper?.resume(tabs.get(payload).entry);
                    }
                    return {ok: true};
                case 'close':
                    closeTab(payload);
                    return {ok: true};
                case 'overlay':
                    overlay = payload === true;
                    layout();
                    if (!overlay && !dashboard) loginHelper?.resume(tabs.get(active)?.entry);
                    return {ok: true};
                case 'navigation': {
                    const tab = tabs.get(active);
                    if (tab) {
                        const history = tab.view.webContents.navigationHistory;
                        if (payload === 'back' && history.canGoBack()) history.goBack();
                        if (payload === 'forward' && history.canGoForward()) history.goForward();
                        if (payload === 'reload') {
                            tab.error = '';
                            layout();
                            void tab.view.webContents.loadURL(tab.url).catch(() => {
                            });
                        }
                    }
                    return {ok: true};
                }
                case 'export': {
                    const exported=exportWorkspace(store,payload?.sections,payload?.includeCredentials!==false);
                    const result = await dialog.showSaveDialog(win, {
                        title: '导出工作空间数据',
                        defaultPath: 'Collectify-workspace.json',
                        filters: [{name: 'JSON', extensions: ['json']}]
                    });
                    if (result.canceled) return {ok: true, data: null};
                    if([store.file,`${store.file}-wal`,`${store.file}-shm`].some(file=>path.resolve(file)===path.resolve(result.filePath)))throw Error('不能用导出文件覆盖正在使用的数据库');
                    const serialized=JSON.stringify(exported,null,2);
                    if(Buffer.byteLength(serialized,'utf8')>20*1024*1024)throw Error('所选数据超过 20 MB，请分类型导出或使用数据库备份');
                    fs.writeFileSync(result.filePath, serialized, 'utf8');
                    return {ok: true, data: result.filePath};
                }
                case 'import-cancel':
                    if(importDraft?.token===payload)importDraft=null;
                    return {ok:true};
                case 'import-preview':
                case 'import': {
                    let draft=payload?.token&&importDraft?.token===payload.token?importDraft:null;
                    if(payload?.token&&!draft)throw Error('导入预览已失效，请重新选择文件');
                    if(!draft){
                        const result = await dialog.showOpenDialog(win, {
                        title: '导入工作空间数据',
                        properties: ['openFile'],
                        filters: [{name: 'JSON', extensions: ['json']}]
                    });
                    if (result.canceled) return {ok: true, data: null};
                    if (fs.statSync(result.filePaths[0]).size > 20 * 1024 * 1024) throw new Error('数据文件不能超过 20 MB');
                    const raw = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8').replace(/^\uFEFF/, ''));
                    const parsed=parseWorkspace(raw);
                    if(parsed.sections.includes('bookmarks'))parsed.data.entries=await Promise.all(parsed.data.entries.map(entry=>credentials.prepare(entry)));
                    draft={token:randomUUID(),raw:parsed,name:path.basename(result.filePaths[0])};
                    }
                    if(action==='import-preview'){
                        importDraft=draft;
                        return {ok:true,data:{...describeWorkspace(draft.raw),token:draft.token,name:draft.name}};
                    }
                    const result=importWorkspace(store,draft.raw,{
                        mode: payload?.mode === 'replace' ? 'replace' : 'merge',
                        sections:payload?.sections||draft.raw.sections,
                        sourceName:draft.name
                    });
                    if(result.sections.includes('bookmarks'))for (const tab of [...tabs.values()]) closeTab(tab.id);
                    importDraft=null;dataChanged();
                    return {ok: true, data: result};
                }
                default:
                    throw new Error('未知操作');
            }
        } catch (error) {
            return {ok: false, error: error.message};
        } finally {
            if (['task-save', 'task-delete', 'note-save', 'note-delete', 'theme-save', 'settings', 'import', 'save', 'delete'].includes(action)) desktopWidget?.update();
        }
    });
}

app.whenReady().then(async () => {
    try {
        const externalDefault = path.join(app.isPackaged ? path.dirname(app.getPath('exe')) : path.join(__dirname, '..'), 'default-config.json');
        const portableDefault = process.env.PORTABLE_EXECUTABLE_DIR && path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'default-config.json');
        const bundledDefault = path.join(__dirname, '..', 'config', 'default-config.json');
        const defaults = portableDefault && fs.existsSync(portableDefault) ? portableDefault : fs.existsSync(externalDefault) ? externalDefault : bundledDefault;
        const file = path.join(app.getPath('userData'), 'collectify.sqlite');
        let defaultData;
        if (!smoke && !fs.existsSync(file)) {
            defaultData = JSON.parse(fs.readFileSync(defaults, 'utf8').replace(/^\uFEFF/, ''));
            if (Array.isArray(defaultData.entries)) defaultData.entries = await Promise.all(defaultData.entries.map(entry => credentials.prepare(entry)));
        }
        store = new Store(file, smoke ? {} : {defaults, defaultData});
    } catch (error) {
        dialog.showErrorBox('无法读取配置', `配置未被覆盖，请检查 ${app.getPath('userData')} 中的 collectify.sqlite。\n${error.message}`);
        app.quit();
        return;
    }
    registerApi();
    desktopWidget = new DesktopWidget(store, dataChanged, () => showMain('tasks'), smoke);
    loginHelper = new LoginHelper(() => win, smoke);
    localMcp = new LocalMcpService(store, dataChanged);
    const createWindow = async () => {
        win = new BrowserWindow({
            width: 1440,
            height: 940,
            minWidth: 1050,
            minHeight: 720,
            backgroundColor: store.data.settings.theme.background,
            title: 'Collectify · 工作收藏夹',
            autoHideMenuBar: true,
            icon: path.join(__dirname, '..', 'assets', 'icon.png'),
            webPreferences: {
                preload: path.join(__dirname, 'preload.js'),
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: true,
                backgroundThrottling: false,
                offscreen: smoke
            }
        });
        win.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
        if(smoke)win.webContents.on('console-message',event=>{if(event.level===3)console.error('Renderer:',event.message);});
        win.webContents.on('will-navigate', event => event.preventDefault());
        win.on('resize', layout);
        win.on('close', event => {
            if (!smoke && !quitting && tray && (store.data.settings.keepInTray || store.data.settings.widget.visible)) {
                event.preventDefault();
                win.hide();
            } else if (!quitting && !store.data.settings.widget.visible) desktopWidget?.destroy();
        });
        win.on('hide', () => loginHelper?.hide());
        win.on('minimize', () => loginHelper?.hide());
        win.on('closed', () => {
            loginHelper?.destroy();
            for (const tab of tabs.values()) if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
            tabs.clear();
            active = null;
            dashboard = true;
            overlay = false;
            win = null;
        });
        await win.loadFile(path.join(__dirname, 'index.html'));
    };
    createMainWindow = createWindow;
    await createWindow();
    app.setAppUserModelId('com.collectify.desktop');
    if (!smoke) {
        tray = new Tray(path.join(__dirname, '..', 'assets', 'icon.png'));
        tray.setToolTip('Collectify · 收藏与待办');
        tray.setContextMenu(Menu.buildFromTemplate([{
            label: '打开Collectify',
            click: () => showMain()
        }, {label: '查看待办', click: () => showMain('tasks')}, {type: 'separator'}, {
            label: '退出（停止提醒）',
            click: () => {
                quitting = true;
                app.quit();
            }
        }]));
        tray.on('double-click', () => showMain());
        void checkReminders();
        setInterval(checkReminders, 15000).unref();
        if (store.data.settings.widget.autoRestore) await desktopWidget.open(store.data.settings.widget.mode);
        else if (store.data.settings.widget.visible) {
            const data = store.snapshot();
            data.settings.widget.visible = false;
            store.commit(data);
        }
        if (localMcp.config.enabled) {
            try {
                await localMcp.start();
            } catch (error) {
                dialog.showErrorBox('MCP 未启动', error.message);
            }
        }
    }
    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) void createWindow();
    });
    if (smoke) {
        try {
            if(!process.argv.includes('--smoke-ui-only')) {
            if (!process.argv.includes('--smoke-v6-only')) {
                await require('./smoke').run({
                    win, store, tabs, openEntry, closeTab, layout, publish, home: () => {
                        dashboard = true;
                        layout();
                        publish();
                    }
                });
                await require('./smoke-v3').run({win, store, tabs, openEntry, closeTab});
                await require('./smoke-v4').run({win, store, tabs, openEntry, closeTab, desktopWidget});
                await require('./smoke-v5').run({win, store, desktopWidget});
            }
            await require('./smoke-v6').run({win, store, tabs, openEntry, closeTab, loginHelper});
            await require('./smoke-v7').run({win, store, tabs, loginHelper, desktopWidget, localMcp});
            await require('./smoke-v8').run({win, store});
            await require('./smoke-v9').run({win, store});
            }
            await require('./smoke-v10').run({win, store});
            await require('./smoke-v11').run({win,store,desktopWidget});
        } catch (error) {
            console.error(error);
            app.exit(1);
            return;
        }
        app.exit(0);
    }
}).catch(error => {
    // 捕获窗口、辅助服务等后续初始化异常，避免 whenReady 链产生未处理的 Promise 拒绝。
    console.error('Collectify 启动失败:', error);
    if (smoke) { app.exit(1); return; }
    dialog.showErrorBox('Collectify 启动失败', `程序未能完成初始化。\n${error.message}\n数据目录：${app.getPath('userData')}`);
    app.exit(1);
});
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
app.on('before-quit', () => {
    quitting = true;
    if (localMcp?.http) void localMcp.stop(false);
});
