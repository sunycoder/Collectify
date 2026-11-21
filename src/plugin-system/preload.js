const { contextBridge, ipcRenderer, webUtils } = require('electron');
for (const name of ['pointerdown', 'keydown', 'wheel'])
    window.addEventListener(name, () => ipcRenderer.send('app-update-activity'), { once: true, capture: true });
const call = async (action, payload) => {
    const result = await ipcRenderer.invoke('plugin-sdk', action, payload);
    if (!result.ok) throw Object.assign(Error(result.error), { code: result.code || 'PLUGIN_OPERATION_FAILED' });
    return result.data;
};
const subscribe = (channel, callback) => {
    const listener = (_event, data) => callback(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
};
// 不提供通用 invoke、文件系统、业务 Store 或 Electron 对象。
contextBridge.exposeInMainWorld('collectify', {
    context: () => call('context'),
    page: { setReclaimable: (safe, state) => call('page.reclaimable', { safe, state }) },
    confirmUnsaved: () => call('dialog.unsaved'),
    selectNavigation: (route) => call('navigation.select', route),
    invoke: (action, data) => call('backend.call', { action, data }),
    onPrepareClose: (callback) => {
        const unsubscribe = subscribe('plugin-prepare-close', async ({ id }) => {
            try {
                await callback();
                await call('lifecycle.response', { id });
            } catch (error) {
                await call('lifecycle.response', { id, error: error.message }).catch(() => {});
            }
        });
        void call('lifecycle.register').catch(() => {});
        return unsubscribe;
    },
    files: {
        paths: async (files) => {
            await call('files.drop-authorize');
            return Array.from(files)
                .slice(0, 2)
                .map((file) => webUtils.getPathForFile(file))
                .filter(Boolean);
        }
    },
    storage: {
        get: (key) => call('storage.get', { key }),
        set: (key, value) => call('storage.set', { key, value }),
        delete: (key) => call('storage.delete', { key }),
        batch: (changes) => call('storage.batch', changes)
    },
    clipboard: {
        readText: () => call('clipboard.read'),
        writeText: (text) => call('clipboard.write', text),
        snapshot: () => call('clipboard.snapshot'),
        writeSnapshot: (value) => call('clipboard.writeSnapshot', value)
    },
    background: {
        request: (data) => call('background.request', data),
        setActive: (value) => call('background.active', value)
    },
    notify: (data) => call('plugin.notify', data),
    windows: {
        setAlwaysOnTop: (enabled) => call('window.topmost', enabled),
        open: (options) => call('window.open', options),
        shortcut: (enabled) => call('window.shortcut', enabled),
        reveal: () => call('window.reveal'),
        drag: (position) => call('window.drag', position)
    },
    desktop: { paste: () => call('desktop.paste') },
    onBackgroundRequest: (callback) =>
        subscribe('plugin-background-request', async (request) => {
            try {
                const data = await callback(request.data);
                await call('background.response', { id: request.id, data });
            } catch (error) {
                await call('background.response', { id: request.id, error: error.message }).catch(() => {});
            }
        }),
    onContextChanged: (callback) => subscribe('plugin-context', callback),
    onCommand: (callback) => subscribe('plugin-command', callback),
    onNavigate: (callback) => subscribe('plugin-navigate', callback),
    onEvent: (callback) => subscribe('plugin-event', callback)
});
