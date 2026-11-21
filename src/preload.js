const { contextBridge, ipcRenderer } = require('electron');
// 首次真实操作即取消“启动后无人操作时自动重启”的资格，不发送内容或按键值。
for (const name of ['pointerdown', 'keydown', 'wheel'])
    window.addEventListener(name, () => ipcRenderer.send('app-update-activity'), { once: true, capture: true });
contextBridge.exposeInMainWorld('workbench', {
    onEvent: (name, callback) => {
        if (!['shell-state', 'distribution-state', 'plugin-transfer', 'plugin-market-request'].includes(name)) return;
        const listener = (_event, data) => callback(data);
        ipcRenderer.on(name, listener);
        return () => ipcRenderer.removeListener(name, listener);
    },
    call: (action, payload) => ipcRenderer.invoke('workbench', action, payload),
    onSearch: (callback) => {
        const listener = () => callback();
        ipcRenderer.on('focus-search', listener);
        return () => ipcRenderer.removeListener('focus-search', listener);
    },
    onTabs: (callback) => {
        const listener = (_event, data) => callback(data);
        ipcRenderer.on('tabs', listener);
        return () => ipcRenderer.removeListener('tabs', listener);
    }
});
