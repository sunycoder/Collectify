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
        delete: (key) => call('storage.delete', { key })
    },
    clipboard: { readText: () => call('clipboard.read'), writeText: (text) => call('clipboard.write', text) },
    onContextChanged: (callback) => subscribe('plugin-context', callback),
    onCommand: (callback) => subscribe('plugin-command', callback),
    onNavigate: (callback) => subscribe('plugin-navigate', callback),
    onEvent: (callback) => subscribe('plugin-event', callback)
});
