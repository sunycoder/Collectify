const { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, protocol, safeStorage } = require('electron');
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
const { PluginPackages, ARCHIVE_LIMIT } = require('./plugin-system/package');
const { PluginCatalog, compareVersion } = require('./plugin-system/catalog');
const { readManifest } = require('./plugin-system/manifest');
const { Distribution } = require('./distribution/manager');
const { CredentialStore } = require('./distribution/credentials');
const { webUrl } = require('./distribution/config');
const Theme = require('./theme');
const { LocalMcpService, z } = require('./vendor/mcp-service.cjs');
const { copyText } = require('./clipboard-service');
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
    pluginOperation = false,
    overlay = false,
    quitting = false,
    importDraft;
const rendererUrl = pathToFileURL(path.join(__dirname, 'index.html')).href;
function settings() {
    return {
        theme: Theme.validate(registry.getSetting('theme') || {}),
        keepInTray: registry.getSetting('keepInTray', false) === true,
        navigationCollapsed: registry.getSetting('navigationCollapsed', false) === true,
        browserOpenMode: registry.getSetting('browserOpenMode', 'internal') === 'external' ? 'external' : 'internal'
    };
}
function setSettings(input, validateOnly = false) {
    if (!input || typeof input !== 'object') throw Error('工作台设置不正确');
    const clean = {
        theme: Theme.validate(input.theme || settings().theme),
        keepInTray: input.keepInTray === undefined ? settings().keepInTray : input.keepInTray === true,
        navigationCollapsed:
            input.navigationCollapsed === undefined
                ? settings().navigationCollapsed
                : input.navigationCollapsed === true,
        browserOpenMode:
            input.browserOpenMode === undefined
                ? settings().browserOpenMode
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
            summary: services.providers.get(p.id)?.summary?.() || {}
        })),
        dataPlugins: registry
            .database((db) => db.prepare('SELECT id FROM installed_plugins ORDER BY id').all())
            .map((row) => ({ id: row.id, name: registry.plugins.get(row.id)?.name || row.id })),
        restorableDefaults: registry.availableDefaults(),
        diagnostics: registry.diagnostics,
        active: runtime.active(),
        lastPlugin: registry.getSetting('lastPlugin'),
        settings: settings()
    };
}
function publish() {
    if (win && !win.isDestroyed()) win.webContents.send('shell-state', catalog());
}
async function installPrepared(prepared, sourceLabel) {
    const { manifest } = prepared,
        previous = registry.plugins.get(manifest.id),
        previousVersion = previous?.version;
    const { sha256, encodeZip, collectFiles } = require('./plugin-system/package'),
        previousDigest = previous ? sha256(encodeZip(collectFiles(previous.directory))) : null;
    if (previous?.builtin || registry.defaults().some((p) => p.id === manifest.id))
        throw Error('默认插件请通过恢复或更新 Collectify 安装');
    if (previous && compareVersion(manifest.version, previous.version) < 0) throw Error('不能安装低于当前版本的插件');
    const added = manifest.permissions.filter((p) => !previous?.permissions.includes(p));
    const answer = await dialog.showMessageBox(win, {
        type: 'question',
        message: `${previous ? '更新' : '安装'} ${manifest.name} ${manifest.version}？`,
        detail: `来源：${sourceLabel}\n插件 ID：${manifest.id}${previous ? '\n当前版本：' + previous.version : ''}\n权限：${manifest.permissions.join('、') || '无'}${previous && added.length ? '\n新增权限：' + added.join('、') : ''}\n插件数据保存在独立目录中，更新会保留数据。`,
        buttons: ['取消', previous ? '更新' : '安装'],
        defaultId: 0,
        cancelId: 0
    });
    if (answer.response !== 1) return null;
    if (registry.plugins.get(manifest.id)?.version !== previousVersion)
        throw Error('确认期间插件状态已改变，请重新安装');
    if (previous && sha256(encodeZip(collectFiles(registry.get(manifest.id).directory))) !== previousDigest)
        throw Error('确认期间插件程序已改变，请重新安装');
    runtime.close(manifest.id);
    const id = registry.install(prepared.directory, manifest);
    if (registry.get(id).enabled) await runtime.startBackground(id);
    updateTray();
    publish();
    return id;
}
async function pluginManagement(action, payload) {
    if (action === 'plugin-catalog-status') return pluginCatalog.status();
    if (pluginOperation) throw Error('插件操作正在进行，请稍候');
    pluginOperation = true;
    try {
        switch (action) {
            case 'plugin-catalog-configure':
                return pluginCatalog.configure(payload);
            case 'plugin-catalog-refresh':
                return await pluginCatalog.refresh();
            case 'plugin-catalog-install': {
                const { data, item } = await pluginCatalog.package(payload),
                    prepared = packages.prepare(data, item);
                try {
                    return await installPrepared(prepared, new URL(pluginCatalog.source).host);
                } finally {
                    packages.cleanup(prepared);
                }
            }
            case 'plugin-package-install': {
                const result = await dialog.showOpenDialog(win, {
                    title: '安装插件包',
                    properties: ['openFile'],
                    filters: [{ name: 'Collectify 插件', extensions: ['collectify-plugin'] }]
                });
                if (result.canceled) return null;
                const file = result.filePaths[0];
                if (fs.statSync(file).size > ARCHIVE_LIMIT) throw Error('插件安装包不能超过 12 MB');
                const prepared = packages.prepare(fs.readFileSync(file));
                try {
                    return await installPrepared(prepared, path.basename(file));
                } finally {
                    packages.cleanup(prepared);
                }
            }
            case 'plugin-install': {
                const source = await pick('folder');
                if (!source) return null;
                const { collectFiles, encodeZip } = require('./plugin-system/package'),
                    prepared = packages.prepare(encodeZip(collectFiles(source)));
                try {
                    return await installPrepared(prepared, '本地目录');
                } finally {
                    packages.cleanup(prepared);
                }
            }
            case 'plugin-package-export': {
                const p = registry.get(payload),
                    data = packages.export(payload),
                    result = await dialog.showSaveDialog(win, {
                        title: '导出插件程序',
                        defaultPath: `${p.id}-${p.version}.collectify-plugin`,
                        filters: [{ name: 'Collectify 插件', extensions: ['collectify-plugin'] }]
                    });
                if (result.canceled) return null;
                if (protectedTarget(result.filePath)) throw Error('不能覆盖工作台内部数据');
                fs.writeFileSync(result.filePath, data);
                return result.filePath;
            }
            case 'plugin-uninstall': {
                const p = registry.get(payload),
                    answer = await dialog.showMessageBox(win, {
                        type: 'question',
                        message: `卸载 ${p.name}？`,
                        detail: p.builtin
                            ? '默认插件可随时恢复。卸载后不会因重启或更新 Collectify 而自动恢复。'
                            : '移除插件程序，重新安装后可继续使用保留的数据。',
                        checkboxLabel: '同时删除该插件的全部本机数据（不可恢复）',
                        checkboxChecked: false,
                        buttons: ['取消', '卸载'],
                        defaultId: 0,
                        cancelId: 0
                    });
                if (answer.response !== 1) return false;
                runtime.close(payload);
                await services.unload(payload);
                try {
                    registry.uninstall(payload, { deleteData: answer.checkboxChecked });
                } finally {
                    await services.load({ activate: false });
                    if (registry.plugins.has(payload) && registry.get(payload).enabled) await services.enable(payload);
                }
                updateTray();
                layout();
                publish();
                return true;
            }
            case 'plugin-restore': {
                const id = registry.restore(payload);
                await services.load({ activate: false });
                await services.enable(id);
                updateTray();
                publish();
                return id;
            }
            default:
                throw Error('未知的插件管理操作');
        }
    } finally {
        pluginOperation = false;
    }
}
function layout() {
    if (!win) return;
    runtime.layout(!overlay);
    services.layout(runtime.bounds, runtime.activeId, overlay);
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
                    win?.show();
                    win?.focus();
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
    registry.setEnabled(id, enabled);
    try {
        if (enabled) {
            await services.enable(id);
            await runtime.startBackground(id);
        } else {
            runtime.close(id);
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
async function hostAction(action, payload) {
    if (action.startsWith('distribution-')) {
        switch (action) {
            case 'distribution-status':
                return distribution.status();
            case 'distribution-save': {
                if (pluginOperation) throw Error('插件操作正在进行，请稍后修改源');
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
            case 'distribution-preview':
                await distribution.previewProfile(payload);
                return distribution.status();
            case 'distribution-apply':
                await distribution.applyProfile(payload);
                runtime.destroy();
                layout();
                await runtime.startBackgrounds();
                runtime.themeChanged();
                publish();
                return distribution.status();
            case 'distribution-install': {
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
        case 'plugin-reload': {
            const active = runtime.active();
            if (active) {
                runtime.close(active.id);
                await openPlugin(active.id, active.route);
            }
            return;
        }
        case 'plugin-enable':
            await pluginEnabled(payload.id, payload.enabled);
            return;
        case 'overlay':
            overlay = payload === true;
            layout();
            return;
        case 'workspace-info':
            return {
                directory: app.getPath('userData'),
                file: registry.hostFile,
                version: app.getVersion(),
                mcp: mcp.status()
            };
        case 'open-data-directory': {
            const error = await shell.openPath(app.getPath('userData'));
            if (error) throw Error(error);
            return;
        }
        case 'app-download':
            await shell.openExternal('https://github.com/sunycoder/Collectify/releases/latest');
            return;
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
            return mcp.start(payload.port);
        case 'mcp-stop':
            return mcp.stop();
        case 'mcp-copy':
            await copyText(JSON.stringify(mcp.connection(), null, 2));
            return;
        case 'export': {
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
        width: 1440,
        height: 960,
        minWidth: 1080,
        minHeight: 720,
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
    win.on('resize', layout);
    win.on('close', (event) => {
        if (
            !quitting &&
            tray &&
            (settings().keepInTray ||
                runtime.popouts.size > 0 ||
                runtime.backgroundActivity.size > 0 ||
                [...services.providers.values()].some((p) => p.keepAlive?.()))
        ) {
            event.preventDefault();
            win.hide();
        }
    });
    win.on('closed', () => {
        runtime.destroy();
        win = null;
    });
    await win.loadFile(path.join(__dirname, 'index.html'));
    publish();
}
app.on('second-instance', () => {
    win?.show();
    win?.focus();
});
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
    if (!win) void createWindow();
});
app.on('before-quit', () => {
    quitting = true;
    distribution?.dispose();
    runtime?.destroy();
    void services?.dispose();
    void mcp?.stop(false);
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
            download: (url, limit, options) => distribution.client.download(url, { limit, signal: options.signal })
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
        const externalDefault = path.join(
            app.isPackaged ? path.dirname(app.getPath('exe')) : path.join(__dirname, '..'),
            'default-config.json'
        );
        const defaultsFile = fs.existsSync(externalDefault)
            ? externalDefault
            : path.join(__dirname, '..', 'config', 'default-config.json');
        if (registry.getSetting('theme') === null) {
            const initial =
                !smoke && fs.existsSync(defaultsFile)
                    ? JSON.parse(fs.readFileSync(defaultsFile, 'utf8').replace(/^\uFEFF/, '')).settings || {}
                    : {};
            registry.setSetting('theme', Theme.validate(initial.theme || {}));
            registry.setSetting('keepInTray', initial.keepInTray === true);
        }
        runtime = new PluginRuntime({
            registry,
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
            defaultsFile,
            smoke,
            pick,
            openPlugin
        });
        runtime.services = services;
        services.on('event', ({ pluginId, name, data }) => runtime.emit(pluginId, name, data));
        services.on('changed', (id) => {
            runtime.emit(id, 'data-changed');
            publish();
        });
        await services.load({ activate: false });
        backup = new WorkspaceBackup(registry, settings, setSettings);
        backup.recover();
        const deploymentFile = [
            path.join(
                app.isPackaged ? path.dirname(app.getPath('exe')) : path.join(__dirname, '..'),
                'distribution.json'
            ),
            path.join(__dirname, '..', 'config', 'distribution.json')
        ].find((file) => fs.existsSync(file));
        const sourceCredentials = new CredentialStore(path.join(dataDirectory, 'source-credentials.enc'), safeStorage);
        await sourceCredentials.initialize();
        distribution = new Distribution({
            registry,
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
            deployment:
                !smoke && deploymentFile
                    ? JSON.parse(fs.readFileSync(deploymentFile, 'utf8').replace(/^\uFEFF/, ''))
                    : undefined,
            changed: () => {
                if (win && !win.isDestroyed()) win.webContents.send('distribution-state', distribution.status());
            }
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
        mcp = new LocalMcpService(registry, publish, () => [
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
        await services.activateEnabled();
        await runtime.startBackgrounds();
        if (!smoke) {
            distribution.start();
            tray = new Tray(path.join(__dirname, '..', 'assets', 'icon.png'));
            tray.setToolTip('Collectify');
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
                const verification = require('./smoke-shell'),
                    context = {
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
                        hostAction
                    };
                if (process.argv.includes('--smoke-distribution')) await require('./smoke-distribution').run(context);
                else if (process.argv.includes('--smoke-clipboard')) await require('./smoke-clipboard').run(context);
                else if (process.argv.includes('--smoke-official')) await require('./smoke-official').run(context);
                else if (process.argv.includes('--smoke-tools')) await require('./smoke-tools').run(context);
                else if (process.argv.includes('--smoke-navigation')) await require('./smoke-navigation').run(context);
                else if (process.argv.includes('--smoke-startup')) {
                    await verification.startup(context);
                    await require('./smoke-packages').run(context);
                    await require('./smoke-navigation').run(context);
                    await require('./smoke-tools').run(context);
                    await require('./smoke-clipboard').run(context);
                    await require('./smoke-distribution').run(context);
                } else {
                    await verification.run(context);
                    await require('./smoke-development').run(context);
                    await require('./smoke-packages').run(context);
                    await require('./smoke-navigation').run(context);
                    await require('./smoke-tools').run(context);
                    await require('./smoke-clipboard').run(context);
                    await require('./smoke-distribution').run(context);
                }
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
