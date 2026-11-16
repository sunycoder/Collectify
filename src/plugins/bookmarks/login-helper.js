const { BrowserWindow, ipcMain, screen } = require('electron');
const { visibleBounds } = require('../../window-lifecycle');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const credentials = require('../../credentials');
const { copyText } = require('../../clipboard-service');
const { loadAuxiliary } = require('../../auxiliary-window');

class LoginHelper {
    constructor(getParent, smoke, canShow = () => true) {
        this.getParent = getParent;
        this.smoke = smoke;
        this.canShow = canShow;
        this.win = null;
        this.entry = null;
        this.allowed = false;
        ipcMain.handle('login-helper', async (event, action) => {
            try {
                if (
                    !this.win ||
                    event.sender !== this.win.webContents ||
                    event.senderFrame !== this.win.webContents.mainFrame ||
                    event.senderFrame.url !== pathToFileURL(path.join(__dirname, 'login-helper.html')).href
                )
                    throw Error('无权访问登录资料');
                if (action === 'hide') {
                    this.hide(true);
                    return { ok: true };
                }
                if (!this.entry) throw Error('没有登录资料');
                const password = await credentials.passwordOf(this.entry);
                if (action === 'state')
                    return {
                        ok: true,
                        data: {
                            name: this.entry.name,
                            username: this.entry.username || '',
                            password,
                            authMode: this.entry.authMode
                        }
                    };
                if (action === 'copy-user') await copyText(this.entry.username || '');
                else if (action === 'copy-password') await copyText(password);
                else throw Error('未知操作');
                return { ok: true };
            } catch (error) {
                return { ok: false, error: error.message };
            }
        });
    }

    async show(entry) {
        if (!entry || (!entry.username && !entry.password)) return;
        this.entry = entry;
        this.allowed = true;
        if (!this.win) {
            const parent = this.getParent(),
                p = parent.getBounds();
            this.win = new BrowserWindow({
                parent,
                ...(process.platform === 'darwin' ? { type: 'panel' } : {}),
                fullscreenable: false,
                ...visibleBounds(
                    { width: 330, height: 250, x: Math.max(p.x + 20, p.x + p.width - 350), y: p.y + 190 },
                    screen.getDisplayMatching(p).workArea
                ),
                frame: false,
                resizable: false,
                skipTaskbar: true,
                show: false,
                backgroundColor: '#ffffff',
                title: '登录资料卡',
                icon: path.join(__dirname, '..', '..', '..', 'assets', 'icon.png'),
                webPreferences: {
                    preload: path.join(__dirname, 'login-helper-preload.js'),
                    sandbox: true,
                    contextIsolation: true,
                    nodeIntegration: false,
                    offscreen: this.smoke
                }
            });
            this.win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
            this.win.webContents.on('will-navigate', (event) => event.preventDefault());
            this.win.on('closed', () => {
                this.win = null;
            });
            this.loading = loadAuxiliary(this.win, path.join(__dirname, 'login-helper.html'));
        }
        await this.loading;
        if (!this.allowed || this.entry?.id !== entry.id || !this.win || this.win.isDestroyed()) return;
        const password = await credentials.passwordOf(entry);
        if (!this.win || this.win.isDestroyed() || !this.allowed || this.entry?.id !== entry.id) return;
        await this.win.webContents.executeJavaScript(
            `window.renderLoginCard(${JSON.stringify({
                name: entry.name,
                username: entry.username || '',
                password,
                authMode: entry.authMode
            })})`
        );
        // 远程页面仍处于活动标签时才由调用方显示；加载中切回首页会撤销 allowed。
        if (
            this.allowed &&
            this.entry?.id === entry.id &&
            this.parentVisible() &&
            !this.smoke &&
            this.win &&
            !this.win.isDestroyed() &&
            !this.win.isVisible()
        )
            this.win.showInactive();
    }

    parentVisible() {
        const parent = this.getParent();
        return this.canShow() && !!parent && !parent.isDestroyed() && parent.isVisible() && !parent.isMinimized();
    }

    hide(dismiss = false) {
        if (dismiss) this.allowed = false;
        if (this.win && !this.win.isDestroyed() && this.win.isVisible()) this.win.hide();
    }

    resume(entry) {
        if (
            this.allowed &&
            entry &&
            entry.id === this.entry?.id &&
            this.win &&
            !this.win.isDestroyed() &&
            this.parentVisible() &&
            !this.win.isVisible() &&
            !this.smoke
        )
            this.win.showInactive();
    }

    destroy() {
        this.win?.destroy();
        this.win = null;
    }
    dispose() {
        this.destroy();
        ipcMain.removeHandler('login-helper');
    }
}

module.exports = { LoginHelper };
