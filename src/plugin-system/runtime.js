const fs = require('node:fs');
const path = require('node:path');
const {
    BrowserWindow,
    WebContentsView,
    session,
    ipcMain,
    clipboard,
    nativeImage,
    ClipboardItem,
    screen
} = require('electron');
const { pasteToPreviousApplication } = require('./desktop-paste');
const { randomUUID } = require('node:crypto');
const { captureClipboard, writeSnapshot } = require('./clipboard-formats');
const { assetPath, pluginUrl } = require('./manifest');
const { tokens, validate } = require('../theme');
const { readPluginClipboard } = require('./clipboard-access');
const MIME = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.mjs': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.woff2': 'font/woff2',
    '.txt': 'text/plain'
};
const CSP =
    "default-src 'none'; script-src 'self' collectify-plugin://collectify.sdk; style-src 'self' collectify-plugin://collectify.sdk 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
const { SDK_FILES, SHARED_FILES } = require('./contract');

class PluginRuntime {
    constructor({ registry, getWindow, getTheme, changed, openPlugin, smoke = false }) {
        Object.assign(this, { registry, getWindow, getTheme, changed, openPlugin, smoke });
        this.clipboard = clipboard;
        this.views = new Map();
        this.backgrounds = new Map();
        this.popouts = new Map();
        this.pasteAdapter = pasteToPreviousApplication;
        this.pendingRequests = new Map();
        this.backgroundActivity = new Set();
        this.activeId = null;
        this.prepared = new Set();
        this.generation = 0;
        this.bounds = { x: 248, y: 72, width: 800, height: 600 };
        ipcMain.handle('plugin-sdk', async (event, action, payload) => {
            try {
                return { ok: true, data: await this.invoke(event, action, payload) };
            } catch (error) {
                return { ok: false, error: error.message };
            }
        });
    }
    active() {
        if (!this.activeId) return null;
        const p = this.registry.plugins.get(this.activeId),
            record = this.views.get(this.activeId);
        return p
            ? {
                  id: p.id,
                  name: p.name,
                  route: record?.route || p.navigation[0]?.id || 'home',
                  loading: !!record?.loading,
                  error: record?.error || ''
              }
            : null;
    }
    context(plugin) {
        return {
            apiVersion: 1,
            plugin: { id: plugin.id, name: plugin.name, version: plugin.version },
            theme: validate(this.getTheme()),
            tokens: tokens(this.getTheme())
        };
    }
    themeChanged() {
        for (const [id, record] of this.views)
            if (!record.view.webContents.isDestroyed())
                record.view.webContents.send('plugin-context', this.context(this.registry.get(id)));
        for (const record of this.popouts.values())
            if (!record.window.isDestroyed())
                record.window.webContents.send('plugin-context', this.context(this.registry.get(record.pluginId)));
        for (const provider of this.services?.providers.values() || []) provider.themeChanged?.();
    }
    async invoke(event, action, payload) {
        // 身份来自已创建的 WebContents，而不是插件可伪造的 payload.pluginId。
        const pair = [
            ...this.views,
            ...this.backgrounds,
            ...[...this.popouts.values()].map((record) => [record.pluginId, record])
        ].find(([, r]) => r.view.webContents === event.sender);
        if (!pair || event.senderFrame !== event.sender.mainFrame) throw Error('无权调用插件接口');
        const plugin = this.registry.get(pair[0], true);
        const isBackground = this.backgrounds.get(plugin.id) === pair[1];
        const page =
            pair[1].mode === 'shortcut'
                ? { ...plugin, entry: plugin.shortcut }
                : isBackground
                  ? { ...plugin, entry: plugin.background }
                  : plugin;
        if (event.senderFrame.url !== this.url(page)) throw Error('插件页面来源不正确');
        if (Buffer.byteLength(JSON.stringify(payload ?? null)) > 10 * 1024 * 1024) throw Error('插件请求过大');
        if (action === 'context')
            return {
                ...this.context(plugin),
                platform: process.platform,
                windowMode: pair[1].mode || (pair[1].window ? 'floating' : isBackground ? 'background' : 'main')
            };
        if (action === 'window.shortcut') {
            if (!plugin.permissions.includes('window') || !plugin.shortcut || typeof payload !== 'boolean')
                throw Error('插件未声明桌面快捷按钮入口与权限');
            return this.shortcut(plugin, payload);
        }
        if (action === 'window.reveal') {
            if (isBackground || !plugin.permissions.includes('window')) throw Error('请从插件前台主动打开主窗口');
            await this.openPlugin(plugin.id, plugin.navigation[0]?.id);
            return;
        }
        if (action === 'window.drag') {
            const record = pair[1];
            if (
                record.mode !== 'shortcut' ||
                !plugin.permissions.includes('window') ||
                !payload ||
                !['start', 'move', 'end'].includes(payload.phase) ||
                ![payload.x, payload.y].every((v) => Number.isFinite(v) && Math.abs(v) < 10000000)
            )
                throw Error('仅桌面快捷按钮可调整自身位置');
            if (payload.phase === 'start') {
                const [x, y] = record.window.getPosition();
                record.drag = { x, y, pointerX: payload.x, pointerY: payload.y };
                return;
            }
            if (!record.drag) return;
            const x = Math.round(record.drag.x + payload.x - record.drag.pointerX),
                y = Math.round(record.drag.y + payload.y - record.drag.pointerY),
                area = screen.getDisplayNearestPoint({ x, y }).workArea;
            record.window.setPosition(
                Math.max(area.x, Math.min(area.x + area.width - 48, x)),
                Math.max(area.y, Math.min(area.y + area.height - 48, y))
            );
            if (payload.phase === 'end') record.drag = null;
            return;
        }
        if (action === 'window.open') {
            if (isBackground || !plugin.permissions.includes('window')) throw Error('插件未声明独立窗口权限');
            return this.openWindow(plugin, payload);
        }
        if (action === 'desktop.paste') {
            if (isBackground || !plugin.permissions.includes('desktop.paste')) throw Error('插件未声明执行粘贴权限');
            if (
                pair[1].window ? !pair[1].window.isVisible() : this.activeId !== plugin.id || !pair[1].view.getVisible()
            )
                throw Error('请在当前插件窗口主动执行粘贴');
            return this.pasteAdapter({
                windows: [
                    this.getWindow(),
                    ...[...this.popouts.values()]
                        .filter((record) => record.pluginId === plugin.id)
                        .map((record) => record.window)
                ]
            });
        }
        if (action === 'background.active') {
            if (!isBackground) throw Error('只有后台页面可以设置运行状态');
            if (payload === true) this.backgroundActivity.add(plugin.id);
            else this.backgroundActivity.delete(plugin.id);
            return;
        }
        if (action === 'background.response') {
            if (!isBackground) throw Error('后台响应来源无效');
            const request = this.pendingRequests.get(payload?.id);
            if (!request || request.pluginId !== plugin.id) throw Error('后台请求已失效');
            clearTimeout(request.timer);
            this.pendingRequests.delete(payload.id);
            if (payload.error) request.reject(Error(String(payload.error).slice(0, 300)));
            else request.resolve(payload.data);
            return;
        }
        if (action === 'background.request') {
            if (isBackground) throw Error('后台不能向自身发起请求');
            await this.startBackground(plugin.id);
            const record = this.backgrounds.get(plugin.id);
            if (!record) throw Error('此插件没有后台页面');
            if (this.pendingRequests.size >= 100) throw Error('后台请求过多');
            return new Promise((resolve, reject) => {
                const id = randomUUID(),
                    timer = setTimeout(() => {
                        this.pendingRequests.delete(id);
                        reject(Error('插件后台响应超时'));
                    }, 15000);
                this.pendingRequests.set(id, { pluginId: plugin.id, resolve, reject, timer });
                record.view.webContents.send('plugin-background-request', { id, data: payload });
            });
        }
        if (action === 'plugin.notify') {
            this.emit(plugin.id, 'plugin-notify', payload);
            return;
        }
        if (action === 'navigation.select') {
            if (
                typeof payload !== 'string' ||
                !(this.services?.navigation(plugin.id) || plugin.navigation).some((n) => n.id === payload)
            )
                throw Error('插件导航不存在');
            pair[1].route = payload;
            this.changed();
            return;
        }
        if (action === 'backend.call') {
            if (!plugin.backend || !this.services) throw Error('插件没有后台调用权限');
            if (typeof payload?.action !== 'string') throw Error('插件后台操作不正确');
            return this.services.call(plugin.id, payload.action, payload.data);
        }
        if (action.startsWith('storage.')) {
            if (!plugin.permissions.includes('storage')) throw Error('插件未声明存储权限');
            if (action === 'storage.get') return this.registry.storage.get(plugin.id, payload?.key);
            if (action === 'storage.set') return this.registry.storage.set(plugin.id, payload?.key, payload.value);
            if (action === 'storage.delete') return this.registry.storage.delete(plugin.id, payload?.key);
            if (action === 'storage.batch') return this.registry.storage.batch(plugin.id, payload);
        }
        if (action === 'clipboard.snapshot') {
            if (!plugin.permissions.includes('clipboard.read')) throw Error('插件未声明剪贴板读取权限');
            const allowed = () =>
                this.registry.plugins.get(plugin.id)?.enabled === true &&
                (isBackground
                    ? plugin.permissions.includes('clipboard.background') && this.backgroundActivity.has(plugin.id)
                    : (pair[1].window || this.activeId === plugin.id) &&
                      (pair[1].window ? pair[1].window.isVisible() : pair[1].view.getVisible()) &&
                      !!(pair[1].window || this.getWindow())?.isVisible());
            return captureClipboard({ clipboard: this.clipboard, nativeImage, allowed });
        }
        if (action === 'clipboard.writeSnapshot') {
            if (!plugin.permissions.includes('clipboard.write')) throw Error('插件未声明剪贴板写入权限');
            return writeSnapshot({ clipboard: this.clipboard, ClipboardItem, nativeImage }, payload);
        }
        if (action === 'clipboard.write') {
            if (!plugin.permissions.includes('clipboard.write')) throw Error('插件未声明剪贴板写入权限');
            if (typeof payload !== 'string' || Buffer.byteLength(payload) > 1024 * 1024)
                throw Error('复制内容过大或格式不正确');
            await this.clipboard.writeText(payload);
            return;
        }
        if (action === 'clipboard.read') {
            if (!plugin.permissions.includes('clipboard.read')) throw Error('插件未声明剪贴板读取权限');
            return readPluginClipboard({
                readText: () => this.clipboard.readText(),
                allowed: () => {
                    const window = pair[1].window || this.getWindow();
                    return (
                        this.registry.plugins.get(plugin.id)?.enabled === true &&
                        (pair[1].window || this.activeId === plugin.id) &&
                        !pair[1].view.webContents.isDestroyed() &&
                        (pair[1].window ? pair[1].window.isVisible() : pair[1].view.getVisible()) &&
                        !!window?.isVisible() &&
                        !window.isMinimized()
                    );
                }
            });
        }
        throw Error('不支持的插件能力');
    }
    url(plugin) {
        return pluginUrl(plugin);
    }
    prepare(plugin) {
        const partition = `plugin:${plugin.id}`,
            isolated = session.fromPartition(partition);
        if (!this.prepared.has(partition)) {
            isolated.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
            isolated.setPermissionCheckHandler(() => false);
            isolated.on('will-download', (event) => event.preventDefault());
            isolated.protocol.handle('collectify-plugin', async (request) => {
                try {
                    const url = new URL(request.url);
                    if (url.hostname !== plugin.id && url.hostname !== 'collectify.sdk')
                        return new Response('Forbidden', { status: 403 });
                    const relative = decodeURIComponent(url.pathname.slice(1));
                    // 可信后台可发布短期预览资源；协议不接受本机路径，后台自行校验随机资源票据。
                    const resourceProvider = this.services?.providers.get(plugin.id);
                    if (url.hostname === plugin.id && relative.startsWith('__resources/')) {
                        if (!this.registry.get(plugin.id, true).backend || !resourceProvider?.resource)
                            return new Response('Forbidden', { status: 403 });
                        return await resourceProvider.resource(relative, request);
                    }
                    if (url.hostname === 'collectify.sdk' && !SDK_FILES.has(relative) && !SHARED_FILES.has(relative))
                        return new Response('Not found', { status: 404 });
                    const root =
                        url.hostname === 'collectify.sdk'
                            ? SDK_FILES.has(relative)
                                ? path.join(__dirname, 'sdk')
                                : path.join(__dirname, '..')
                            : this.registry.get(plugin.id, true).directory;
                    if (
                        url.hostname === plugin.id &&
                        plugin.backend &&
                        [plugin.backend, 'schema.js'].includes(relative)
                    )
                        return new Response('Forbidden', { status: 403 });
                    const file = assetPath(root, relative);
                    const extension = path.extname(file).toLowerCase();
                    if (!MIME[extension]) return new Response('Unsupported resource', { status: 403 });
                    return new Response(await fs.promises.readFile(file), {
                        headers: {
                            'Content-Type': `${MIME[extension]}; charset=utf-8`,
                            'Content-Security-Policy': resourceProvider?.resource
                                ? CSP.replace("connect-src 'none'", "connect-src 'self'") +
                                  "; media-src 'self' blob:; worker-src 'self' blob:"
                                : CSP,
                            'X-Content-Type-Options': 'nosniff',
                            'Cache-Control': 'no-store'
                        }
                    });
                } catch {
                    return new Response('Not found', { status: 404 });
                }
            });
            isolated.webRequest.onBeforeRequest((details, callback) => {
                let allowed = false;
                try {
                    const url = new URL(details.url);
                    allowed =
                        url.protocol === 'collectify-plugin:' && [plugin.id, 'collectify.sdk'].includes(url.hostname);
                } catch {}
                callback({ cancel: !allowed });
            });
            this.prepared.add(partition);
        }
        return partition;
    }
    async open(id, commandId, route, payload) {
        const plugin = this.registry.get(id, true),
            generation = ++this.generation;
        await this.startBackground(id);
        if (this.services?.errors.has(id)) throw Error(`插件后台加载失败：${this.services.errors.get(id)}`);
        if (commandId && !plugin.commands.some((c) => c.id === commandId)) throw Error('插件命令不存在');
        this.activeId = id;
        let record = this.views.get(id);
        if (!record) {
            const view = new WebContentsView({
                webPreferences: {
                    partition: this.prepare(plugin),
                    preload: path.join(__dirname, 'preload.js'),
                    sandbox: true,
                    nodeIntegration: false,
                    contextIsolation: true,
                    webSecurity: true,
                    offscreen: this.smoke && !process.argv.includes('--smoke-visible')
                }
            });
            record = { view, loading: true, error: '', errors: [], diagnostics: [] };
            this.views.set(id, record);
            view.webContents.on('console-message', (event) => {
                if (event.level === 3) {
                    record.errors.push(event.message);
                    if (record.errors.length > 50) record.errors.shift();
                    let file = '';
                    try {
                        const url = new URL(event.sourceId);
                        if ([id, 'collectify.sdk'].includes(url.hostname)) file = url.pathname.slice(1, 121);
                    } catch {}
                    const kind =
                        /\b(ReferenceError|TypeError|SyntaxError|RangeError|Error)\b/.exec(event.message)?.[1] ||
                        'ConsoleError';
                    record.diagnostics.push({
                        kind,
                        file,
                        line: Number.isInteger(event.lineNumber) ? event.lineNumber : 0
                    });
                    if (record.diagnostics.length > 50) record.diagnostics.shift();
                    if (this.smoke) console.error(`Plugin ${id}:`, event.message);
                }
            });
            view.webContents.on('preload-error', (_event, _file, error) => {
                record.errors.push(error.message);
                record.diagnostics.push({ kind: 'PreloadError', file: 'preload.js', line: 0 });
            });
            this.getWindow().contentView.addChildView(view);
            view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
            for (const name of ['will-navigate', 'will-redirect', 'will-frame-navigate'])
                view.webContents.on(name, (event) => event.preventDefault());
            view.webContents.on('render-process-gone', () => {
                record.error = '插件进程已退出，请重新打开';
                record.loading = false;
                view.setVisible(false);
                this.changed();
            });
            record.ready = view.webContents
                .loadURL(this.url(plugin))
                .then(() => {
                    record.loading = false;
                })
                .catch((error) => {
                    record.loading = false;
                    record.error = `插件加载失败：${error.message}`;
                });
        }
        this.changed();
        await record.ready;
        if (generation !== this.generation || !this.views.has(id)) return;
        if (!record.error) record.view.webContents.send('plugin-command', { id: commandId || plugin.commands[0].id });
        if (!record.error) {
            record.route = typeof route === 'string' ? route : record.route || plugin.navigation[0]?.id || 'home';
            record.view.webContents.send('plugin-navigate', { route: record.route, payload });
        }
        this.changed();
    }
    emit(id, name, data) {
        const record = this.views.get(id);
        if (record && !record.view.webContents.isDestroyed())
            record.view.webContents.send('plugin-event', { name, data });
        for (const record of this.popouts.values())
            if (record.pluginId === id && !record.window.isDestroyed())
                record.view.webContents.send('plugin-event', { name, data });
    }
    async openWindow(plugin, payload = {}) {
        const existing = [...this.popouts.values()].find(
            (record) => record.pluginId === plugin.id && record.mode !== 'shortcut'
        );
        if (existing) {
            existing.window.show();
            existing.window.focus();
            existing.view.webContents.send('plugin-navigate', { route: plugin.navigation[0]?.id, payload });
            return;
        }
        const window = new BrowserWindow({
            width: 800,
            height: 650,
            minWidth: 520,
            minHeight: 360,
            title: plugin.name + ' · 悬浮中转',
            alwaysOnTop: true,
            autoHideMenuBar: true,
            show: !this.smoke,
            webPreferences: {
                partition: this.prepare(plugin),
                preload: path.join(__dirname, 'preload.js'),
                sandbox: true,
                nodeIntegration: false,
                contextIsolation: true,
                webSecurity: true,
                offscreen: this.smoke
            }
        });
        const key = randomUUID(),
            record = { pluginId: plugin.id, window, view: { webContents: window.webContents }, errors: [] };
        this.popouts.set(key, record);
        window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        for (const event of ['will-navigate', 'will-redirect', 'will-frame-navigate'])
            window.webContents.on(event, (e) => e.preventDefault());
        window.webContents.on('console-message', (event) => {
            if (event.level === 3) record.errors.push(String(event.message).slice(0, 300));
        });
        window.on('closed', () => this.popouts.delete(key));
        try {
            await window.loadURL(this.url(plugin));
            window.webContents.send('plugin-navigate', { route: plugin.navigation[0]?.id, payload });
        } catch (error) {
            window.destroy();
            throw error;
        }
    }
    async shortcut(plugin, enabled) {
        const key = 'shortcut:' + plugin.id,
            existing = this.popouts.get(key);
        if (!enabled) {
            existing?.window.destroy();
            return;
        }
        if (existing) return;
        const work = screen.getPrimaryDisplay().workArea;
        const saved = this.registry.getSetting(key + ':position', {});
        const display =
            Number.isFinite(saved.x) && Number.isFinite(saved.y)
                ? screen.getDisplayNearestPoint({ x: saved.x, y: saved.y }).workArea
                : work;
        const x = Math.round(
            Math.max(
                display.x,
                Math.min(display.x + display.width - 48, Number.isFinite(saved.x) ? saved.x : work.x + work.width - 64)
            )
        );
        const y = Math.round(
            Math.max(
                display.y,
                Math.min(
                    display.y + display.height - 48,
                    Number.isFinite(saved.y) ? saved.y : work.y + Math.round(work.height * 0.45)
                )
            )
        );
        const window = new BrowserWindow({
            width: 48,
            height: 48,
            x,
            y,
            frame: false,
            transparent: true,
            backgroundColor: '#00000000',
            resizable: false,
            skipTaskbar: true,
            alwaysOnTop: true,
            hasShadow: false,
            show: false,
            title: plugin.name + ' · 快捷按钮',
            webPreferences: {
                partition: this.prepare(plugin),
                preload: path.join(__dirname, 'preload.js'),
                sandbox: true,
                nodeIntegration: false,
                contextIsolation: true,
                webSecurity: true,
                offscreen: this.smoke
            }
        });
        const record = {
            pluginId: plugin.id,
            mode: 'shortcut',
            window,
            view: { webContents: window.webContents },
            errors: []
        };
        this.popouts.set(key, record);
        window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        for (const name of ['will-navigate', 'will-redirect', 'will-frame-navigate'])
            window.webContents.on(name, (event) => event.preventDefault());
        window.webContents.on('console-message', (event) => {
            if (event.level === 3) record.errors.push(String(event.message).slice(0, 300));
        });
        let positionTimer, pendingPosition;
        const savePosition = () => {
            clearTimeout(positionTimer);
            if (pendingPosition) {
                this.registry.setSetting(key + ':position', pendingPosition);
                pendingPosition = null;
            }
        };
        window.on('move', () => {
            const [x, y] = window.getPosition();
            pendingPosition = { x, y };
            clearTimeout(positionTimer);
            positionTimer = setTimeout(savePosition, 100);
        });
        window.on('closed', () => {
            savePosition();
            this.popouts.delete(key);
        });
        try {
            await window.loadURL(this.url({ ...plugin, entry: plugin.shortcut }));
            if (!this.registry.plugins.get(plugin.id)?.enabled) {
                window.destroy();
                return;
            }
            if (!this.smoke) window.showInactive();
        } catch (error) {
            window.destroy();
            throw error;
        }
    }
    async startBackgrounds() {
        for (const p of this.registry.plugins.values())
            if (p.enabled && p.background)
                try {
                    await this.startBackground(p.id);
                } catch (error) {
                    this.registry.diagnostics.push({ folder: p.name, error: error.message });
                }
    }
    async startBackground(id) {
        const plugin = this.registry.get(id, true);
        if (!plugin.background) return;
        const prior = this.backgrounds.get(id);
        if (prior) return prior.ready;
        const view = new WebContentsView({
            webPreferences: {
                partition: this.prepare(plugin),
                preload: path.join(__dirname, 'preload.js'),
                sandbox: true,
                contextIsolation: true,
                nodeIntegration: false,
                webSecurity: true,
                backgroundThrottling: false,
                offscreen: true
            }
        });
        const record = { view, errors: [], ready: null };
        this.backgrounds.set(id, record);
        view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        for (const event of ['will-navigate', 'will-redirect', 'will-frame-navigate'])
            view.webContents.on(event, (e) => e.preventDefault());
        view.webContents.on('console-message', (event) => {
            if (event.level === 3) record.errors.push(String(event.message).slice(0, 300));
        });
        view.webContents.on('render-process-gone', () => this.stopBackground(id));
        record.ready = view.webContents.loadURL(this.url({ ...plugin, entry: plugin.background })).catch((error) => {
            this.stopBackground(id);
            throw Error(`插件后台加载失败：${error.message}`);
        });
        return record.ready;
    }
    stopBackground(id) {
        const record = this.backgrounds.get(id);
        this.backgrounds.delete(id);
        this.backgroundActivity.delete(id);
        for (const [key, request] of this.pendingRequests)
            if (request.pluginId === id) {
                clearTimeout(request.timer);
                request.reject(Error('插件后台已停止'));
                this.pendingRequests.delete(key);
            }
        if (record && !record.view.webContents.isDestroyed()) record.view.webContents.close();
    }
    deactivate() {
        this.activeId = null;
        this.generation++;
        this.layout(false);
    }
    setBounds(bounds) {
        if (!bounds || !['x', 'y', 'width', 'height'].every((k) => Number.isFinite(bounds[k])))
            throw Error('插件视图尺寸无效');
        const [w, h] = this.getWindow().getContentSize();
        const x = Math.max(0, Math.min(w, Math.round(bounds.x))),
            y = Math.max(0, Math.min(h, Math.round(bounds.y)));
        this.bounds = {
            x,
            y,
            width: Math.max(1, Math.min(w - x, Math.round(bounds.width))),
            height: Math.max(1, Math.min(h - y, Math.round(bounds.height)))
        };
    }
    layout(visible) {
        for (const [id, record] of this.views) {
            const show = !!visible && id === this.activeId && !record.loading && !record.error;
            record.view.setVisible(show);
            if (show) record.view.setBounds(this.bounds);
        }
    }
    close(id) {
        for (const record of [...this.popouts.values()]) if (record.pluginId === id) record.window.destroy();
        this.stopBackground(id);
        const record = this.views.get(id);
        if (record) {
            this.views.delete(id);
            const win = this.getWindow();
            if (win && !win.isDestroyed()) win.contentView.removeChildView(record.view);
            if (!record.view.webContents.isDestroyed()) record.view.webContents.close();
        }
        if (this.activeId === id) this.deactivate();
    }
    destroy() {
        for (const record of [...this.popouts.values()]) record.window.destroy();
        for (const id of [...this.backgrounds.keys()]) this.stopBackground(id);
        for (const id of [...this.views.keys()]) this.close(id);
    }
}
module.exports = { PluginRuntime };
