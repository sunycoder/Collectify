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
// WebContentsView 反复设置同一可见状态/尺寸会触发额外合成，macOS 全屏时尤为明显。
function layoutView(view, show, bounds) {
    if (view.webContents?.isDestroyed()) return;
    if (view.getVisible() !== show) view.setVisible(show);
    if (show && bounds) {
        const current = view.getBounds();
        if (['x', 'y', 'width', 'height'].some((key) => current[key] !== bounds[key])) view.setBounds(bounds);
    }
}
function visibleBounds(bounds, work) {
    const width = Math.max(1, Math.min(bounds.width, work.width)),
        height = Math.max(1, Math.min(bounds.height, work.height));
    return {
        width,
        height,
        x: Math.round(Math.max(work.x, Math.min(bounds.x, work.x + work.width - width))),
        y: Math.round(Math.max(work.y, Math.min(bounds.y, work.y + work.height - height)))
    };
}
function bindStableLayout(window, layout, transition, platform = process.platform) {
    let timer;
    const finish = () => {
        clearTimeout(timer);
        transition(false);
        layout();
    };
    window.on('resize', () => {
        if (platform === 'darwin') {
            transition(true);
            clearTimeout(timer);
            timer = setTimeout(finish, 160);
        }
        layout();
    });
    for (const event of ['resized', 'enter-full-screen', 'leave-full-screen']) window.on(event, finish);
    window.on('closed', () => clearTimeout(timer));
}
module.exports = { revealWindow, stayResident, bindTray, layoutView, visibleBounds, bindStableLayout };
