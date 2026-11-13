const fs = require('node:fs');
const path = require('node:path');
const { WebContentsView, session, ipcMain, clipboard } = require('electron');
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
    constructor({ registry, getWindow, getTheme, changed, smoke = false }) {
        Object.assign(this, { registry, getWindow, getTheme, changed, smoke });
        this.clipboard = clipboard;
        this.views = new Map();
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
        for (const provider of this.services?.providers.values() || []) provider.themeChanged?.();
    }
    async invoke(event, action, payload) {
        // 身份来自已创建的 WebContents，而不是插件可伪造的 payload.pluginId。
        const pair = [...this.views].find(([, r]) => r.view.webContents === event.sender);
        if (!pair || event.senderFrame !== event.sender.mainFrame) throw Error('无权调用插件接口');
        const plugin = this.registry.get(pair[0], true);
        if (event.senderFrame.url !== this.url(plugin)) throw Error('插件页面来源不正确');
        if (Buffer.byteLength(JSON.stringify(payload ?? null)) > 1100 * 1024) throw Error('插件请求过大');
        if (action === 'context') return this.context(plugin);
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
                    const window = this.getWindow();
                    return (
                        this.registry.plugins.get(plugin.id)?.enabled === true &&
                        this.activeId === plugin.id &&
                        !pair[1].view.webContents.isDestroyed() &&
                        pair[1].view.getVisible() &&
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
                            'Content-Security-Policy': CSP,
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
        for (const id of [...this.views.keys()]) this.close(id);
    }
}
module.exports = { PluginRuntime };
