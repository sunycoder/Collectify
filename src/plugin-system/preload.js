const { contextBridge, ipcRenderer } = require('electron');
const call = async (action, payload) => {
    const result = await ipcRenderer.invoke('plugin-sdk', action, payload);
    if (!result.ok) throw Error(result.error);
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
    selectNavigation: (route) => call('navigation.select', route),
    invoke: (action, data) => call('backend.call', { action, data }),
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
    windows: { open: (options) => call('window.open', options) },
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
