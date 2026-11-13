const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('loginHelper', {
    call: (action) => ipcRenderer.invoke('login-helper', action),
    onUpdate: (callback) => ipcRenderer.on('login-helper-update', callback)
});
