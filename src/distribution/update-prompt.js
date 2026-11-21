const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { BrowserWindow, ipcMain, screen } = require('electron');

// 原生插件视图位于宿主 DOM 之上；使用按需创建的子窗口，保证气泡不会被插件遮住。
class UpdatePrompt {
    constructor({ parent, status, action, blocked = () => false }) {
        Object.assign(this, { parent, status, action, blocked });
        this.window = null;
        this.ready = false;
        this.url = pathToFileURL(path.join(__dirname, 'update-prompt.html')).href;
        this.listeners = ['move', 'resize', 'show', 'hide', 'minimize', 'restore'].map((event) => {
            const listener = () => this.sync();
            parent.on(event, listener);
            return [event, listener];
        });
        ipcMain.handle('app-update-action', async (event, action) => {
            if (
                event.sender !== this.window?.webContents ||
                event.senderFrame?.url !== this.url ||
                event.senderFrame !== this.window.webContents.mainFrame
            )
                throw Error('无权操作更新');
            if (!['status', 'update', 'later', 'cancel'].includes(action)) throw Error('未知更新操作');
            if (action === 'status') return this.status();
            // 下载不占用渲染进程调用，进度/失败通过状态事件回传。
            Promise.resolve(this.action(action)).catch(() => {});
            return this.status();
        });
        this.onClosed = () => this.dispose();
        parent.once('closed', this.onClosed);
    }
    sync() {
        if (this.disposed) return;
        if (this.parent.isDestroyed()) return this.dispose();
        if (this.window?.isDestroyed()) {
            this.window = null;
            this.ready = false;
        }
        const state = this.status();
        const automatic = state.automatic;
        const visible = automatic && automatic.phase !== 'idle' && !automatic.deferred && state.update?.available;
        if (
            !visible ||
            this.parent.isDestroyed() ||
            !this.parent.isVisible() ||
            this.parent.isMinimized() ||
            this.blocked()
        ) {
            this.window?.hide();
            return;
        }
        if (!this.window) {
            this.window = new BrowserWindow({
                parent: this.parent,
                width: 324,
                height: 176,
                frame: false,
                resizable: false,
                minimizable: false,
                maximizable: false,
                skipTaskbar: true,
                show: false,
                transparent: true,
                backgroundColor: '#00000000',
                webPreferences: {
                    preload: path.join(__dirname, 'update-prompt-preload.js'),
                    sandbox: true,
                    contextIsolation: true,
                    nodeIntegration: false
                }
            });
            this.window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
            this.window.webContents.on('will-navigate', (event) => event.preventDefault());
            this.window.on('close', () => {
                if (!this.disposed) this.action('later');
            });
            this.window.once('ready-to-show', () => {
                this.ready = true;
                this.sync();
            });
            void this.window.loadURL(this.url).catch(() => {});
        }
        const bounds = this.parent.getContentBounds();
        const area = screen.getDisplayMatching(bounds).workArea;
        this.window.setPosition(
            Math.max(area.x, bounds.x + 12),
            Math.max(area.y, Math.min(area.y + area.height - 176, bounds.y + bounds.height - 188))
        );
        if (this.ready) {
            this.window.webContents.send('app-update-state', state);
            if (!this.window.isVisible()) this.window.showInactive();
        }
    }
    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.parent.removeListener('closed', this.onClosed);
        for (const [event, listener] of this.listeners) this.parent.removeListener(event, listener);
        ipcMain.removeHandler('app-update-action');
        if (this.window && !this.window.isDestroyed()) this.window.destroy();
        this.window = null;
    }
}
module.exports = { UpdatePrompt };
