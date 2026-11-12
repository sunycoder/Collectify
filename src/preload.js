const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('workbench', {
    onEvent: (name, callback) => {
        if (!['open-section', 'reminder', 'reminder-error', 'data-changed'].includes(name)) return;
        const listener = (_event, data) => callback(data);
        ipcRenderer.on(name, listener);
        return () => ipcRenderer.removeListener(name, listener);
    },
    call: (action, payload) => ipcRenderer.invoke('workbench', action, payload),
    onSearch: callback => {
        const listener = () => callback();
        ipcRenderer.on('focus-search', listener);
        return () => ipcRenderer.removeListener('focus-search', listener);
    },
    onTabs: callback => {
        const listener = (_event, data) => callback(data);
        ipcRenderer.on('tabs', listener);
        return () => ipcRenderer.removeListener('tabs', listener);
    }
});
