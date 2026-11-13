const { WebContentsView, session } = require('electron');
const { validUrl } = require('../../plugin-system/urls');
const credentials = require('./credentials');
const { LoginHelper } = require('./login-helper');
module.exports.create = function (context, store) {
    let active = null,
        dashboard = true,
        overlay = false,
        visible = false,
        browserTop = 96,
        bounds = { x: 300, y: 64, width: 800, height: 600 };
    const tabs = new Map(),
        prepared = new Set();
    const loginHelper = new LoginHelper(context.getWindow, context.smoke);
    function getEntry(id) {
        const entry = store.entries.find((e) => e.id === id);
        if (!entry) throw new Error('入口不存在');
        return entry;
    }

    function publish() {
        if (!context.getWindow() || context.getWindow().isDestroyed()) return;
        context.emit('tabs', {
            active,
            dashboard,
            tabs: [...tabs.values()].map((t) => ({
                id: t.id,
                entryId: t.entry.id,
                name: t.entry.name,
                environment: t.entry.environment,
                color: store.categories.find((c) => c.id === t.entry.categoryId)?.color || 'sage',
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
        loginHelper.hide(!visible || dashboard);
        for (const tab of tabs.values()) {
            const show = visible && !dashboard && !overlay && active === tab.id && !tab.error;
            tab.view.setVisible(show);
            if (show)
                tab.view.setBounds({
                    x: bounds.x,
                    y: bounds.y + browserTop,
                    width: bounds.width,
                    height: Math.max(1, bounds.height - browserTop)
                });
        }
        if (visible && !dashboard && !overlay) loginHelper.resume(tabs.get(active)?.entry);
    }
    function closeTab(id) {
        const tab = tabs.get(id);
        if (!tab) return;
        if (context.getWindow() && !context.getWindow().isDestroyed())
            context.getWindow().contentView.removeChildView(tab.view);
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
            const existing = [...tabs.values()].find((t) => t.entry.id === entry.id);
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
            isolatedSession.on('will-download', (_event, item) => item.setSaveDialogOptions({ title: '保存下载文件' }));
            prepared.add(partition);
        }
        // 远程网页不加载 preload，也没有任何工作台 IPC 或本机 Node 能力。
        const view = new WebContentsView({
            webPreferences: {
                partition,
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: true,
                webSecurity: true,
                allowRunningInsecureContent: false
            }
        });
        const id = require('node:crypto').randomUUID();
        const tab = { id, entry, view, title: entry.name, url, loading: true, error: '' };
        tabs.set(id, tab);
        context.getWindow().contentView.addChildView(view);
        const wc = view.webContents;
        let authAttempted = false;
        wc.on('login', (event, request, authInfo, callback) => {
            event.preventDefault();
            const current = store.entries.find((e) => e.id === entry.id) || entry;
            const ownOrigin = new URL(current.url).origin;
            if (
                authAttempted ||
                authInfo.isProxy ||
                authInfo.scheme.toLowerCase() !== 'basic' ||
                current.authMode !== 'basic' ||
                new URL(request.url).origin !== ownOrigin
            ) {
                callback();
                return;
            }
            authAttempted = true;
            credentials
                .passwordOf(current)
                .then((password) => callback(current.username, password))
                .catch(() => callback());
        });
        // 焦点在远程网页内时也能返回全局收藏搜索，不向网页暴露工作台 API。
        wc.on('before-input-event', (event, input) => {
            if (
                input.type === 'keyDown' &&
                (input.control || input.meta) &&
                input.key.toLowerCase() === 'k' &&
                !overlay
            ) {
                event.preventDefault();
                dashboard = true;
                layout();
                publish();
                context.getWindow().webContents.focus();
                context.emit('focus-search');
            }
        });
        wc.setWindowOpenHandler((details) => {
            if (validUrl(details.url)) openEntry(entry, details.url, true).catch(() => {});
            return { action: 'deny' };
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
        await wc.loadURL(url).catch(() => {});
    }

    return {
        tabs,
        openEntry,
        closeTab,
        publish,
        loginHelper,
        layout: (b, show) => {
            bounds = b;
            visible = show;
            layout();
        },
        async call(action, payload) {
            switch (action) {
                case 'external': {
                    const tab = tabs.get(payload);
                    const url = tab ? tab.url : getEntry(payload).url;
                    if (!validUrl(url)) throw new Error('地址不正确');
                    await shell.openExternal(url);
                    return { ok: true };
                }
                case 'login-card': {
                    const tab = tabs.get(active);
                    if (!tab) throw Error('请先打开网页');
                    await loginHelper.show(getEntry(tab.entry.id));
                    return { ok: true };
                }
                case 'home':
                    dashboard = true;
                    layout();
                    publish();
                    return { ok: true };
                case 'activate':
                    if (tabs.has(payload)) {
                        active = payload;
                        dashboard = false;
                        layout();
                        publish();
                        loginHelper?.hide();
                        loginHelper?.resume(tabs.get(payload).entry);
                    }
                    return { ok: true };
                case 'close':
                    closeTab(payload);
                    return { ok: true };
                case 'overlay':
                    overlay = payload === true;
                    layout();
                    if (!overlay && !dashboard) loginHelper?.resume(tabs.get(active)?.entry);
                    return { ok: true };
                case 'navigation': {
                    const tab = tabs.get(active);
                    if (tab) {
                        const history = tab.view.webContents.navigationHistory;
                        if (payload === 'back' && history.canGoBack()) history.goBack();
                        if (payload === 'forward' && history.canGoForward()) history.goForward();
                        if (payload === 'reload') {
                            tab.error = '';
                            layout();
                            void tab.view.webContents.loadURL(tab.url).catch(() => {});
                        }
                    }
                    return { ok: true };
                }

                case 'browser-bounds':
                    if (Number.isFinite(payload?.top)) browserTop = Math.max(0, Math.min(300, Math.round(payload.top)));
                    layout();
                    return;
                default:
                    throw Error('不支持的浏览器操作');
            }
        },
        destroy() {
            for (const id of [...tabs.keys()]) closeTab(id);
            loginHelper.destroy();
        },
        dispose() {
            for (const id of [...tabs.keys()]) closeTab(id);
            loginHelper.dispose();
        },
        get dashboard() {
            return dashboard;
        }
    };
};
