const {
    app,
    BrowserWindow,
    ipcMain,
    dialog,
    shell,
    Tray,
    Menu,
    protocol,
    safeStorage,
    nativeImage
} = require('electron');
const fs = require('node:fs'),
    path = require('node:path'),
    os = require('node:os');
const { DatabaseSync } = require('node:sqlite');
const { pathToFileURL } = require('node:url');
const { PluginRegistry } = require('./plugin-system/registry');
const { PluginRuntime } = require('./plugin-system/runtime');
const { PluginServices } = require('./plugin-system/services');
const { WorkspaceBackup } = require('./plugin-system/backup');
const { PluginDevelopment } = require('./plugin-system/development');
const { PluginPackages } = require('./plugin-system/package');
const { PluginCatalog } = require('./plugin-system/catalog');
const { Distribution } = require('./distribution/manager');
const { AutomaticUpdate } = require('./distribution/automatic');
const { installation, prepareInstallation, previousInstallation } = require('./distribution/install');
const { CredentialStore } = require('./distribution/credentials');
const { webUrl } = require('./distribution/config');
const Theme = require('./theme');
const { LazyMcpService } = require('./lazy-mcp-service');
const { copyText } = require('./clipboard-service');
const { revealWindow, stayResident, bindTray, bindStableLayout } = require('./window-lifecycle');
const defaults = require('./app-defaults');
const loginItem = require('./login-item').createLoginItem(app);
let updatePrompt,
    pendingInstallation,
    updateCloseApproved = false;

async function installAppUpdate({ startup = false } = {}) {
    const plan = installation({ packaged: app.isPackaged && !smoke, fileName: distribution.update?.file.name });
    if (!plan.supported) throw Error(plan.reason);
    const file = await distribution.installer();
    if (!(await confirmPluginClose([...(services?.providers.keys() || [])], 'quit'))) return false;
    // 下载校验之后及交接前再次检查，拒绝在用户退出确认期间被替换的安装包。
    if ((await distribution.installer()) !== file) throw Error('安装包状态已改变，请重试更新');
    pendingInstallation = await prepareInstallation({
        directory: app.getPath('userData'),
        file,
        update: distribution.update,
        plan
    });
    try {
        // 助手启动时用户仍可操作；退出前再刷新一次最新数据，不能依赖几秒前的保存结果。
        if (
            (startup && distribution.automation.active) ||
            distribution.automation.deferred ||
            !(await confirmPluginClose([...(services?.providers.keys() || [])], 'quit'))
        ) {
            pendingInstallation.cancel();
            pendingInstallation = null;
            return false;
        }
        updateCloseApproved = true;
        app.quit();
        return true;
    } catch (error) {
        pendingInstallation?.cancel();
        pendingInstallation = null;
        throw error;
    }
}

function updateAction(action) {
    if (action === 'update') return distribution.automation.begin();
    if (action === 'later') return distribution.automation.later();
    if (action === 'cancel') {
        distribution.automation.later();
        return distribution.cancel();
    }
}
ipcMain.on('app-update-activity', () => distribution?.automation?.touch());
let bootReady = false,
    revealAfterBoot = false;
const revealMain = async () => {
    if (!bootReady) {
        revealAfterBoot = true;
        return;
    }
    return revealWindow(() => win, createWindow).catch((error) =>
        dialog.showErrorBox('无法打开 Collectify', error.message)
    );
};
protocol.registerSchemesAsPrivileged([
    {
        scheme: 'collectify-plugin',
        privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
    }
]);
app.setPath('userData', path.join(app.getPath('appData'), 'Collectify'));
app.setPath('sessionData', app.getPath('userData'));
app.setName('Collectify');
const smoke = process.argv.includes('--smoke-test');
const startupMarks = {};
function startupMark(name) {
    if (startupMarks[name] !== undefined) return;
    startupMarks[name] = Math.round(process.uptime() * 1000);
    if (process.argv.includes('--startup-metrics')) console.log('STARTUP', name, startupMarks[name] + 'ms');
}
startupMark('main-imports-ready');
if (smoke) {
    app.disableHardwareAcceleration();
    app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
    app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'collectify-shell-')));
    app.setPath('sessionData', app.getPath('userData'));
}
if (!app.requestSingleInstanceLock()) {
    app.quit();
    process.exit(0);
}
let win,
    tray,
    registry,
    runtime,
    services,
    backup,
    mcp,
    development,
    packages,
    pluginCatalog,
    distribution,
    overlay = false,
    fullscreenTransition = false,
    quitting = false,
    importDraft;
let pluginTransfer = null;
let sourceCredentialsReady;
function sendPluginTransfer(value) {
    if (win && !win.isDestroyed()) win.webContents.send('plugin-transfer', value);
}
const rendererUrl = pathToFileURL(path.join(__dirname, 'index.html')).href;
function settings() {
    const saved = registry.readSettings(defaults.settings);
    return {
        theme: Theme.validate(saved.theme || defaults.settings.theme),
        keepInTray: saved.keepInTray === true,
        navigationCollapsed: saved.navigationCollapsed === true,
        browserOpenMode: saved.browserOpenMode === 'external' ? 'external' : 'internal',
        pluginOrder: [...registry.pluginOrder]
    };
}
function setSettings(input, validateOnly = false) {
    if (!input || typeof input !== 'object') throw Error('工作台设置不正确');
    const previous = settings();
    const clean = {
        theme: Theme.validate(input.theme || previous.theme),
        keepInTray: input.keepInTray === undefined ? previous.keepInTray : input.keepInTray === true,
        navigationCollapsed:
            input.navigationCollapsed === undefined ? previous.navigationCollapsed : input.navigationCollapsed === true,
        pluginOrder:
            input.pluginOrder === undefined
                ? previous.pluginOrder
                : require('./plugin-system/navigation-order').validateOrder(input.pluginOrder),
        browserOpenMode:
            input.browserOpenMode === undefined
                ? previous.browserOpenMode
                : input.browserOpenMode === 'external'
                  ? 'external'
                  : 'internal'
    };
    if (!validateOnly) {
        registry.setSetting('personalSettingKeys', [
            ...new Set([
                ...registry.getSetting('personalSettingKeys', []),
                ...Object.keys(input).filter((key) => Object.hasOwn(clean, key))
            ])
        ]);
        registry.setSetting('theme', clean.theme);
        registry.setSetting('keepInTray', clean.keepInTray);
        registry.setSetting('navigationCollapsed', clean.navigationCollapsed);
        registry.setSetting('browserOpenMode', clean.browserOpenMode);
        registry.setSetting('pluginOrder', clean.pluginOrder);
        for (const id of services?.providers.keys() || []) runtime?.emit(id, 'data-changed');
        runtime?.themeChanged();
        publish();
    }
    return clean;
}
function catalog() {
    return {
        plugins: registry.list().map((p) => ({
            ...p,
            navigation: services.navigation(p.id),
            summary: services.providers.get(p.id)?.summary?.() || {},
            backupCoverage: services.providers.get(p.id)?.backupCoverage?.() || {
                content: services.providers.get(p.id)?.exportData
                    ? '插件领域数据与 SDK 数据'
                    : 'SDK 数据；其他本地文件未声明',
                preferences: services.providers.get(p.id)?.exportData ? '由插件导出合同覆盖' : '仅 SDK 键值偏好',
                externalFiles: false
            }
        })),
        dataPlugins: registry
            .database((db) => db.prepare('SELECT id FROM installed_plugins ORDER BY id').all())
            .map((row) => ({ id: row.id, name: registry.plugins.get(row.id)?.name || row.id })),
        restorableDefaults: registry.availableDefaults(),
        diagnostics: registry.diagnostics,
        active: runtime.active(),
        lastPlugin: registry.getSetting('lastPlugin'),
        settings: settings(),
        tasks: services.tasks()
    };
}
let publishPending = false;
function publish() {
    if (publishPending || !win || win.isDestroyed()) return;
    publishPending = true;
    setImmediate(() => {
        publishPending = false;
        if (win && !win.isDestroyed()) win.webContents.send('shell-state', catalog());
    });
}
let pluginManager;
function management() {
    return (pluginManager ||= require('./host/plugin-management').createPluginManagement({
        registry,
        runtime,
        services,
        pluginCatalog,
        packages,
        getWindow: () => win,
        pick,
        pluginEnabled,
        revealInstalledPlugin,
        confirmPluginClose,
        updateTray,
        publish,
        layout,
        protectedTarget,
        sendPluginTransfer,
        setTransfer: (value) => {
            pluginTransfer = value;
        }
    }));
}
function pluginManagement(...args) {
    return management().manage(...args);
}
function layout() {
    updatePrompt?.sync();
    if (!win || win.isDestroyed()) return;
    runtime.layout(!overlay && !fullscreenTransition && win.isVisible() && !win.isMinimized());
    services.layout(
        runtime.bounds,
        runtime.activeId,
        overlay || fullscreenTransition || !win.isVisible() || win.isMinimized()
    );
}
function pluginRuntimeStatus(id) {
    const plugin = registry.get(id),
        record = runtime.views.get(id);
    return {
        pluginId: id,
        enabled: plugin.enabled,
        state: !plugin.enabled
            ? 'disabled'
            : !record
              ? 'not-open'
              : record.error
                ? 'failed'
                : record.loading
                  ? 'loading'
                  : 'ready',
        scriptErrors: record?.diagnostics || [],
        notice: '仅报告加载和脚本类别/位置，不返回页面内容或用户数据；ready 不等于业务行为已完整测试'
    };
}
async function openPlugin(id, route, payload) {
    if (!win || win.isDestroyed()) await createWindow();
    win.show();
    if (win.isMinimized()) win.restore();
    registry.get(id, true);
    registry.setSetting('lastPlugin', id);
    await runtime.open(id, undefined, route, payload);
    startupMark('first-plugin-ready');
    layout();
    publish();
}
async function revealInstalledPlugin(id) {
    if (win && !win.isDestroyed()) await win.webContents.executeJavaScript('closeDialogsForPlugin()');
    overlay = false;
    await openPlugin(id);
}
function updateTray() {
    if (!tray) return;
    tray.setContextMenu(
        Menu.buildFromTemplate([
            {
                label: '打开 Collectify',
                click: () => {
                    void revealMain();
                }
            },
            ...registry
                .list()
                .filter((p) => p.enabled)
                .map((p) => ({ label: p.name, click: () => void openPlugin(p.id) })),
            { type: 'separator' },
            {
                label: '退出',
                click: () => {
                    quitting = true;
                    app.quit();
                }
            }
        ])
    );
}
function protectedTarget(file) {
    const normalize = (s) => (process.platform === 'win32' ? path.resolve(s).toLowerCase() : path.resolve(s)),
        target = normalize(file),
        root = normalize(app.getPath('userData'));
    return target === root || target.startsWith(root + path.sep);
}
async function pick(kind) {
    const result = await dialog.showOpenDialog(win, {
        title: kind === 'folder' ? '选择文件夹' : '选择文件',
        properties:
            kind === 'folder' ? ['openDirectory'] : kind === 'files' ? ['openFile', 'multiSelections'] : ['openFile']
    });
    return kind === 'files' ? (result.canceled ? [] : result.filePaths) : result.canceled ? '' : result.filePaths[0];
}
async function pluginEnabled(id, enabled) {
    if (!enabled && !(await confirmPluginClose([id], 'disable'))) return false;
    registry.setEnabled(id, enabled);
    try {
        if (enabled) {
            await services.enable(id);
            await runtime.startBackground(id);
        } else {
            await runtime.close(id);
            await services.disable(id);
        }
    } catch (error) {
        registry.setEnabled(id, !enabled);
        throw error;
    }
    updateTray();
    layout();
    publish();
}
async function confirmPluginClose(ids, reason) {
    await runtime?.prepareClose(ids);
    return (await services?.beforeClose(ids, reason)) !== false;
}
async function hostAction(action, payload) {
    if (action === 'plugin-task-cancel') {
        await services.cancelTask(payload.pluginId, payload.id);
        publish();
        return;
    }
    if (action === 'plugin-move') {
        registry.move(payload?.id, payload?.targetId, payload?.placement);
        registry.setSetting('personalSettingKeys', [
            ...new Set([...registry.getSetting('personalSettingKeys', []), 'pluginOrder'])
        ]);
        updateTray();
        publish();
        return registry.list().map((p) => p.id);
    }
    if (action === 'plugin-order-reset') {
        registry.resetOrder();
        registry.setSetting('personalSettingKeys', [
            ...new Set([...registry.getSetting('personalSettingKeys', []), 'pluginOrder'])
        ]);
        updateTray();
        publish();
        return;
    }
    if (action === 'plugin-icon') return registry.icon(payload.id, payload.includeDisabled === true);
    if (action === 'login-item-set') return loginItem.set(payload);
    if (action === 'plugin-download-status') return pluginTransfer?.status || null;
    if (action === 'plugin-download-cancel') {
        pluginTransfer?.controller.abort(Error('已取消下载'));
        return;
    }
    if (action.startsWith('distribution-')) {
        await sourceCredentialsReady;
        switch (action) {
            case 'distribution-status':
                return distribution.status();
            case 'distribution-save': {
                if (pluginManager?.busy) throw Error('插件操作正在进行，请稍后修改源');
                distribution.save(payload);
                pluginCatalog.configure(
                    distribution.client.file(
                        distribution.config.project,
                        distribution.config.ref,
                        distribution.config.catalogPath
                    )
                );
                return distribution.status();
            }
            case 'distribution-login':
                return distribution.login();
            case 'distribution-logout':
                return distribution.logout();
            case 'distribution-cancel':
                return distribution.cancel();
            case 'distribution-check': {
                await distribution.check();
                return distribution.status();
            }
            case 'distribution-download':
                await distribution.download();
                return distribution.status();
            case 'distribution-update':
                void updateAction('update').catch((error) => distribution.automation.set('error', error.message));
                return distribution.status();
            case 'distribution-later':
                updateAction('later');
                return distribution.status();
            case 'distribution-preview':
                await services.load({ activate: false });
                await distribution.previewProfile(payload);
                return distribution.status();
            case 'distribution-apply':
                await services.load({ activate: false });
                if (!(await confirmPluginClose([...services.providers.keys()], 'import'))) return distribution.status();
                await distribution.applyProfile(payload);
                runtime.destroy();
                layout();
                await runtime.startBackgrounds();
                runtime.themeChanged();
                publish();
                return distribution.status();
            case 'distribution-install':
            case 'distribution-manual-install': {
                if (action !== 'distribution-manual-install' && distribution.automation?.status().supported) {
                    void updateAction('update').catch((error) => distribution.automation.set('error', error.message));
                    return distribution.status();
                }
                const file = await distribution.installer();
                const answer = await dialog.showMessageBox(win, {
                    type: 'question',
                    message: '安装 Collectify ' + distribution.update.version + '？',
                    detail:
                        process.platform === 'win32'
                            ? '将退出当前程序并启动安装器，用户数据保留。'
                            : '将打开已校验的安装包，请按系统提示安装。',
                    buttons: ['取消', '安装'],
                    defaultId: 0,
                    cancelId: 0
                });
                if (answer.response !== 1) return distribution.status();
                if ((await distribution.installer()) !== file) throw Error('安装包状态已改变，请重新确认');
                if (process.platform === 'win32') {
                    if (!(await confirmPluginClose([...(services?.providers.keys() || [])], 'quit')))
                        return distribution.status();
                    const child = require('node:child_process').spawn(file, [], { detached: true, stdio: 'ignore' });
                    await new Promise((resolve, reject) => {
                        child.once('spawn', resolve);
                        child.once('error', reject);
                    });
                    child.unref();
                    app.quit();
                } else {
                    const error = await shell.openPath(file);
                    if (error) throw Error(error);
                }
                return distribution.status();
            }
            default:
                throw Error('未知分发源操作');
        }
    }
    if (
        [
            'plugin-install',
            'plugin-local-discover',
            'plugin-local-load',
            'plugin-package-install',
            'plugin-package-export',
            'plugin-uninstall',
            'plugin-restore',
            'plugin-catalog-status',
            'plugin-catalog-configure',
            'plugin-catalog-refresh',
            'plugin-catalog-install'
        ].includes(action)
    )
        return pluginManagement(action, payload);
    switch (action) {
        case 'state':
            return catalog();
        case 'plugin-list':
            return catalog();
        case 'plugin-open':
            await openPlugin(payload.id, payload.route, payload.data);
            return runtime.active();
        case 'plugin-bounds':
            runtime.setBounds(payload);
            layout();
            return;
        case 'content-search':
            return services.searchContent(payload);
        case 'plugin-reload': {
            const active = runtime.active();
            if (active) {
                if (!(await confirmPluginClose([active.id], 'reload'))) return false;
                await runtime.close(active.id);
                await openPlugin(active.id, active.route);
            }
            return;
        }
        case 'plugin-enable':
            return pluginEnabled(payload.id, payload.enabled);
        case 'overlay':
            overlay = payload === true;
            layout();
            return;
        case 'workspace-info':
            return {
                directory: app.getPath('userData'),
                file: registry.hostFile,
                version: app.getVersion(),
                mcp: mcp.status(),
                loginItem: loginItem.status(),
                performance: {
                    startup: startupMarks,
                    operations: services.metrics.snapshot(),
                    pluginLoads: [...runtime.views].map(([id, record]) => ({ id, ...record.loadMetrics })),
                    pages: runtime.views.size,
                    backgroundPages: runtime.backgrounds.size,
                    processes: app
                        .getAppMetrics()
                        .map((p) => ({ type: p.type, cpu: p.cpu.percentCPUUsage, memoryKb: p.memory.workingSetSize }))
                }
            };
        case 'open-data-directory': {
            const error = await shell.openPath(app.getPath('userData'));
            if (error) throw Error(error);
            return;
        }
        case 'app-download': {
            const source = distribution.config;
            await shell.openExternal(
                `${source.baseUrl}/${source.project}/${source.provider === 'github' ? 'releases/latest' : '-/releases'}`
            );
            return;
        }
        case 'settings':
            return setSettings(payload);
        case 'theme-save':
            setSettings({ ...settings(), theme: payload });
            return settings().theme;
        case 'theme-export': {
            const result = await dialog.showSaveDialog(win, {
                title: '导出主题',
                defaultPath: 'Collectify-theme.json',
                filters: [{ name: 'JSON', extensions: ['json'] }]
            });
            if (result.canceled) return null;
            if (protectedTarget(result.filePath)) throw Error('不能覆盖工作台内部数据');
            fs.writeFileSync(result.filePath, JSON.stringify({ version: 1, theme: settings().theme }, null, 2), 'utf8');
            return result.filePath;
        }
        case 'theme-import': {
            const file = await pick('file');
            if (!file) return null;
            if (fs.statSync(file).size > 16000) throw Error('主题文件过大');
            const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (raw.version !== 1 || !raw.theme) throw Error('主题格式不正确');
            return Theme.validate(raw.theme);
        }
        case 'mcp-start':
            await services.load();
            return mcp.start(payload.port);
        case 'mcp-stop':
            return mcp.stop();
        case 'mcp-copy':
            await copyText(JSON.stringify(mcp.connection(), null, 2));
            return;
        case 'export': {
            await services.load({ activate: false });
            const value = backup.export(payload.ids, payload.settings, payload.includeCredentials !== false),
                text = JSON.stringify(value, null, 2);
            if (Buffer.byteLength(text) > 20 * 1024 * 1024) throw Error('所选数据超过 20 MB，请分插件导出');
            const result = await dialog.showSaveDialog(win, {
                title: '导出工作台数据',
                defaultPath: 'Collectify-workspace.json',
                filters: [{ name: 'JSON', extensions: ['json'] }]
            });
            if (result.canceled) return null;
            if (protectedTarget(result.filePath)) throw Error('不能覆盖工作台内部数据');
            fs.writeFileSync(result.filePath, text, 'utf8');
            return result.filePath;
        }
        case 'import-preview': {
            const file = await pick('file');
            if (!file) return null;
            if (fs.statSync(file).size > 20 * 1024 * 1024) throw Error('数据文件不能超过 20 MB');
            const raw = backup.parse(JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')));
            importDraft = { token: require('node:crypto').randomUUID(), raw };
            return {
                token: importDraft.token,
                ids: raw.plugins.map((p) => p.id),
                settings: !!raw.settings,
                name: path.basename(file)
            };
        }
        case 'import-cancel':
            importDraft = null;
            return;
        case 'import': {
            if (!importDraft || payload.token !== importDraft.token) throw Error('导入预览失效');
            await services.load({ activate: false });
            if (!(await confirmPluginClose([...services.providers.keys()], 'import'))) return false;
            runtime.destroy();
            layout();
            backup.import(importDraft.raw, payload);
            await runtime.startBackgrounds();
            importDraft = null;
            runtime.themeChanged();
            publish();
            return true;
        }
        default:
            throw Error('宿主不提供该业务操作，请通过所属插件调用');
    }
}
ipcMain.handle('workbench', async (event, action, payload) => {
    try {
        if (
            event.sender !== win?.webContents ||
            event.senderFrame !== win.webContents.mainFrame ||
            event.senderFrame.url !== rendererUrl
        )
            throw Error('无权调用宿主接口');
        return { ok: true, data: await hostAction(action, payload) };
    } catch (error) {
        return { ok: false, error: error.message };
    }
});
async function createWindow() {
    win = new BrowserWindow({
        ...defaults.window,
        title: 'Collectify · 插件工作台',
        backgroundColor: settings().theme.background,
        icon: path.join(__dirname, '..', 'assets', 'icon.png'),
        show: !smoke,
        autoHideMenuBar: true,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            offscreen: smoke && !process.argv.includes('--smoke-visible')
        }
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    if (smoke)
        win.webContents.on('console-message', (event) => {
            if (event.level === 3) console.error('Shell renderer:', event.message);
        });
    fullscreenTransition = false;
    bindStableLayout(win, layout, (value) => {
        fullscreenTransition = value;
    });
    win.on('hide', layout);
    win.on('minimize', layout);
    win.on('show', layout);
    win.on('restore', layout);
    let windowCloseApproved = false,
        checkingWindowClose = false;
    win.on('close', (event) => {
        if (
            stayResident({
                quitting,
                platform: process.platform,
                trayAvailable: !!tray,
                keepInTray: settings().keepInTray,
                background:
                    runtime.popouts.size > 0 ||
                    runtime.backgroundActivity.size > 0 ||
                    [...services.providers.values()].some((p) => p.keepAlive?.())
            })
        ) {
            event.preventDefault();
            win.hide();
            return;
        }
        if (!quitting && !windowCloseApproved) {
            event.preventDefault();
            if (checkingWindowClose) return;
            checkingWindowClose = true;
            void confirmPluginClose([...services.providers.keys()], 'quit')
                .then((allowed) => {
                    if (allowed && win && !win.isDestroyed()) {
                        windowCloseApproved = true;
                        win.close();
                    }
                })
                .catch((error) => dialog.showErrorBox('无法关闭工作台', error.message))
                .finally(() => (checkingWindowClose = false));
        }
    });
    win.on('closed', () => {
        runtime.destroy();
        win = null;
    });
    // 首个插件与宿主 HTML 并行加载，避免宿主完成后再串行创建插件进程。
    if (!runtime.activeId) {
        const enabled = registry.list().filter((plugin) => plugin.enabled);
        const initial = enabled.find((plugin) => plugin.id === registry.getSetting('lastPlugin')) || enabled[0];
        if (initial) {
            void runtime
                .open(initial.id)
                .then(() => startupMark('first-plugin-ready'))
                .catch((error) => {
                    console.error('首个插件预加载失败：', error.message);
                });
        }
    }
    await win.loadFile(path.join(__dirname, 'index.html'));
    if (!smoke) {
        const { UpdatePrompt } = require('./distribution/update-prompt');
        updatePrompt = new UpdatePrompt({
            parent: win,
            status: () => ({ ...distribution.status(), theme: settings().theme }),
            action: updateAction,
            blocked: () => overlay
        });
    }
    publish();
}
app.on('second-instance', () => {
    void revealMain();
});
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
    void revealMain();
});
let cleanupFinished = false,
    cleanupTask;
app.on('before-quit', (event) => {
    if (cleanupFinished) return;
    event.preventDefault();
    if (cleanupTask) return;
    cleanupTask = (async () => {
        if (!updateCloseApproved && !(await confirmPluginClose([...(services?.providers.keys() || [])], 'quit')))
            return;
        quitting = true;
        distribution?.dispose();
        runtime?.destroy();
        const results = await Promise.allSettled([services?.dispose(), mcp?.stop(false)]);
        for (const result of results) if (result.status === 'rejected') console.error('退出清理失败：', result.reason);
        pendingInstallation?.commit();
        cleanupFinished = true;
        app.quit();
    })()
        .catch((error) => {
            pendingInstallation?.cancel();
            pendingInstallation = null;
            updateCloseApproved = false;
            dialog.showErrorBox('无法退出工作台', error.message);
        })
        .finally(() => {
            if (!cleanupFinished) {
                cleanupTask = null;
                quitting = false;
            }
        });
});
app.whenReady()
    .then(async () => {
        const dataDirectory = app.getPath('userData');
        registry = new PluginRegistry({
            builtinRoot: path.join(__dirname, 'plugins'),
            userRoot: path.join(dataDirectory, 'plugin-packages'),
            dataRoot: path.join(dataDirectory, 'plugins'),
            hostFile: path.join(dataDirectory, 'host.sqlite')
        });
        packages = new PluginPackages(registry, path.join(dataDirectory, 'plugin-staging'));
        startupMark('registry-ready');
        if (registry.getSetting('personalSettingKeys') === null) {
            const existing =
                registry.getSetting('theme') !== null || fs.existsSync(path.join(dataDirectory, 'collectify.sqlite'));
            registry.setSetting(
                'personalSettingKeys',
                existing ? ['theme', 'keepInTray', 'navigationCollapsed', 'browserOpenMode'] : []
            );
        }
        pluginCatalog = new PluginCatalog(registry, {
            validateUrl: (value) => webUrl(value, distribution?.config).href,
            download: (url, limit, options) =>
                distribution.client.download(url, { limit, signal: options.signal, progress: options.progress })
        });
        // 只迁移宿主自己的全局偏好，不在宿主加载任何业务实体。
        const legacy = path.join(dataDirectory, 'collectify.sqlite');
        if (registry.getSetting('theme') === null && fs.existsSync(legacy)) {
            const db = new DatabaseSync(legacy, { readOnly: true });
            try {
                for (const row of db.prepare("SELECT * FROM settings WHERE key IN ('theme','keepInTray')").all())
                    registry.setSetting(row.key, JSON.parse(row.value_json));
                if (db.prepare("SELECT name FROM sqlite_master WHERE name='mcp_connection'").get()) {
                    const row = db.prepare('SELECT * FROM mcp_connection WHERE id=1').get();
                    if (row) registry.saveMcpConfig({ enabled: !!row.enabled, port: row.port, token: row.token });
                }
            } finally {
                db.close();
            }
        }
        if (registry.getSetting('theme') === null) {
            registry.setSetting('theme', Theme.validate(defaults.settings.theme));
            registry.setSetting('keepInTray', defaults.settings.keepInTray === true);
        }
        runtime = new PluginRuntime({
            registry,
            openPlugin,
            getWindow: () => win,
            getTheme: () => settings().theme,
            changed: () => {
                layout();
                publish();
            },
            smoke
        });
        services = new PluginServices(registry, {
            getWindow: () => win,
            getSettings: settings,
            setSettings,
            dataDirectory,
            initialData: defaults.initialData,
            smoke,
            pick,
            openPlugin,
            openMarket: (id) => {
                win?.show();
                win?.webContents.send('plugin-market-request', { id });
            }
        });
        runtime.services = services;
        services.on('event', ({ pluginId, name, data }) => runtime.emit(pluginId, name, data));
        services.on('changed', (id) => {
            runtime.emit(id, 'data-changed');
            publish();
        });
        // 暂保留稳定的后台准备顺序，不将全量初始化推迟到用户已经开始点击的阶段。
        await services.load({ activate: false });
        startupMark('services-ready');
        backup = new WorkspaceBackup(registry, settings, setSettings);
        backup.recover();
        const sourceCredentials = new CredentialStore(path.join(dataDirectory, 'source-credentials.enc'), safeStorage);
        // macOS 钥匙串可能等待系统响应，不让账号凭据阻塞本地工作台首屏。
        startupMark('credentials-started');
        sourceCredentialsReady = sourceCredentials.initialize().then(() => startupMark('credentials-ready'));
        void sourceCredentialsReady.catch(() => {});
        distribution = new Distribution({
            registry,
            fetcher: require('./distribution/electron-fetch').electronFetch,
            backup,
            getSettings: settings,
            version: app.getVersion(),
            directory: dataDirectory,
            credentials: sourceCredentials,
            openExternal: (url) => shell.openExternal(url),
            refreshPlugins: async () => {
                const result = await pluginManagement('plugin-catalog-refresh');
                return { updates: result.plugins.filter((plugin) => plugin.updateAvailable).length };
            },
            deployment: !smoke || process.argv.includes('--smoke-deployment') ? defaults.distribution : undefined,
            changed: () => {
                if (win && !win.isDestroyed()) win.webContents.send('distribution-state', distribution.status());
                updatePrompt?.sync();
            }
        });
        const failedUpdate = previousInstallation(dataDirectory, app.getVersion());
        distribution.automation = new AutomaticUpdate({
            distribution,
            supported: () =>
                installation({ packaged: app.isPackaged && !smoke, fileName: distribution.update?.file.name }),
            install: installAppUpdate,
            changed: () => distribution.changed(),
            failedVersion: failedUpdate?.version || ''
        });
        if (registry.getSetting('distributionSource'))
            pluginCatalog.configure(
                distribution.client.file(
                    distribution.config.project,
                    distribution.config.ref,
                    distribution.config.catalogPath
                )
            );
        development = new PluginDevelopment({
            registry,
            root: path.join(dataDirectory, 'plugin-drafts'),
            templatesRoot: path.join(__dirname, 'plugin-templates'),
            setEnabled: pluginEnabled,
            runtimeStatus: pluginRuntimeStatus,
            installed: async (id, { open }) => {
                runtime.close(id);
                if (registry.get(id).enabled) await runtime.startBackground(id);
                updateTray();
                publish();
                if (open) await revealInstalledPlugin(id);
                return { opened: open, runtime: pluginRuntimeStatus(id) };
            }
        });
        mcp = new LazyMcpService(registry, publish, (z) => [
            {
                name: 'workspace_summary',
                description: '查询已启用插件的概况',
                inputSchema: {},
                handler: () => ({
                    plugins: registry
                        .list()
                        .filter((p) => p.enabled)
                        .map((p) => ({ id: p.id, name: p.name, ...services.providers.get(p.id)?.summary?.() })),
                    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                    now: new Date().toISOString()
                })
            },
            ...services.contributions(),
            ...development.tools(z)
        ]);
        await createWindow();
        if (quitting) return;
        bootReady = true;
        if (revealAfterBoot) {
            revealAfterBoot = false;
            void revealMain();
        }
        startupMark('shell-ready');
        await services.activateEnabled();
        if (quitting) return;
        await runtime.startBackgrounds();
        if (!smoke) {
            void sourceCredentialsReady
                .then(() => {
                    if (!quitting) distribution.start();
                })
                .catch((error) => console.error('账号服务初始化失败：', error.message));
            const trayIcon = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'icon.png'));
            tray = new Tray(process.platform === 'darwin' ? trayIcon.resize({ width: 18, height: 18 }) : trayIcon);
            tray.setToolTip('Collectify');
            bindTray(tray, () => void revealMain());
            updateTray();
            if (mcp.config.enabled)
                try {
                    await mcp.start();
                } catch (error) {
                    dialog.showErrorBox('MCP 未启动', error.message);
                }
        }
        if (smoke) {
            try {
                const runnerArgument = process.argv.find((value) => value.startsWith('--smoke-runner='));
                // 验证代码由源码检出目录提供，不随正式安装包分发。
                if (app.isPackaged && !runnerArgument) throw Error('打包版验证需要指定 --smoke-runner 的绝对路径');
                const runnerFile = runnerArgument
                    ? path.resolve(runnerArgument.slice('--smoke-runner='.length))
                    : path.join(__dirname, '../test/smoke/runner.js');
                const completed = await require(runnerFile).run({
                    win,
                    registry,
                    runtime,
                    services,
                    backup,
                    mcp,
                    development,
                    packages,
                    pluginCatalog,
                    distribution,
                    hostAction,
                    trayAccess: {
                        get: () => tray,
                        set: (value) => {
                            tray = value;
                        },
                        update: updateTray
                    }
                });
                if (completed === false) return;
                await services.dispose();
                app.exit(0);
            } catch (error) {
                console.error(error);
                app.exit(1);
            }
        }
    })
    .catch((error) => {
        console.error(error);
        if (!smoke) dialog.showErrorBox('Collectify 启动失败', error.message);
        app.exit(1);
    });
