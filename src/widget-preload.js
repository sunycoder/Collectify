const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('desktop', {
    call: (action, payload) => ipcRenderer.invoke('desktop-widget', action, payload),
    onState: callback => {
        ipcRenderer.on('widget-state', (_event, data) => callback(data));
    }
});
