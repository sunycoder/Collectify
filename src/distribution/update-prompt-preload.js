const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('appUpdate', {
    action: (action) => ipcRenderer.invoke('app-update-action', action),
    subscribe: (callback) => ipcRenderer.on('app-update-state', (_event, state) => callback(state))
});
