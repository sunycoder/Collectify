// 主窗口可反复隐藏和恢复；入口统一处理最小化与已销毁窗口。
async function revealWindow(getWindow, createWindow) {
    let window = getWindow();
    if (!window || window.isDestroyed()) {
        await createWindow();
        window = getWindow();
    }
    if (!window || window.isDestroyed()) throw Error('主窗口未能恢复');
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
    return window;
}
function stayResident({ quitting, platform, trayAvailable, keepInTray, background }) {
    return !quitting && (platform === 'darwin' || (trayAvailable && (keepInTray || background)));
}
function bindTray(tray, reveal, platform = process.platform) {
    tray.on('double-click', reveal);
    if (platform === 'darwin') tray.on('click', reveal);
}
module.exports = { revealWindow, stayResident, bindTray };
