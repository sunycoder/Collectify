const {BrowserWindow, ipcMain, screen, nativeTheme} = require('electron');
const path = require('node:path');
const {pathToFileURL} = require('node:url');
const {loadAuxiliary} = require('./auxiliary-window');
const {applyWidgetMaterial}=require('./widget-material');

class DesktopWidget {
    constructor(store, onChange, openMain, smoke = false) {
        this.store = store;
        this.onChange = onChange;
        this.openMain = openMain;
        this.smoke = smoke;
        this.win = null;
        ipcMain.handle('desktop-widget', async (event, action, payload) => {
            try {
                if (!this.win || event.sender !== this.win.webContents || event.senderFrame !== this.win.webContents.mainFrame || event.senderFrame.url !== pathToFileURL(path.join(__dirname, 'widget.html')).href) throw Error('无权调用');
                switch (action) {
                    case 'state':
                        return {ok: true, data: this.snapshot()};
                    case 'toggle-task': {
                        const task = this.store.data.tasks.find(t => t.id === payload);
                        if (!task || task.archived) throw Error('待办不存在');
                        this.store.saveTask({...task, status: task.status === 'done' ? 'todo' : 'done'});
                        this.onChange();
                        break;
                    }
                    case 'mode':
                        await this.open(payload === 'desktop' ? 'desktop' : 'floating');
                        break;
                    case 'open-main':
                        this.openMain();
                        break;
                    case 'hide':
                        this.hide();
                        break;
                    default:
                        throw Error('未知操作');
                }
                return {ok: true};
            } catch (error) {
                return {ok: false, error: error.message};
            }
        });
    }

    snapshot() {
        return {
            tasks: this.store.snapshot().tasks,
            theme: this.store.data.settings.theme,
            mode: this.store.data.settings.widget.mode,
            material: this.material||'solid'
        };
    }

    update() {
        if (this.win && !this.win.isDestroyed()) {
            this.updateMaterial();
            this.win.webContents.send('widget-state', this.snapshot());
        }
    }

    updateMaterial(){
        const theme=this.store.data.settings.theme,reducedTransparency=nativeTheme.prefersReducedTransparency;
        const key=JSON.stringify([theme.widgetMaterial,theme.surface,reducedTransparency]);
        if(this.materialKey!==key){this.material=applyWidgetMaterial(this.win,theme,{smoke:this.smoke&&!process.argv.includes('--smoke-native-glass'),reducedTransparency});this.materialKey=key;}
    }

    persist(patch) {
        const data = this.store.snapshot();
        data.settings.widget = {...data.settings.widget, ...patch};
        this.store.commit(data);
    }

    async open(mode = 'floating') {
        this.persist({mode, visible: true});
        if (!this.win) {
            const available = screen.getPrimaryDisplay().workArea;
            const saved = this.store.data.settings.widget.bounds;
            // 显示器断开后把窗口放回可见屏幕，保留大小。
            const bounds = saved && screen.getAllDisplays().some(d => saved.x < d.workArea.x + d.workArea.width && saved.x + saved.width > d.workArea.x && saved.y < d.workArea.y + d.workArea.height && saved.y + saved.height > d.workArea.y)
                ? saved : {x: available.x + available.width - 385, y: available.y + 70, width: 350, height: 520};
            this.win = new BrowserWindow({
                ...bounds,
                minWidth: 300,
                minHeight: 300,
                frame: false,
                transparent: true,
                resizable: true,
                skipTaskbar: mode === 'floating',
                title: 'Collectify · 桌面待办',
                backgroundColor: '#00000000',
                show: false,
                icon: path.join(__dirname, '..', 'assets', 'icon.png'),
                webPreferences: {
                    preload: path.join(__dirname, 'widget-preload.js'),
                    nodeIntegration: false,
                    sandbox: true,
                    contextIsolation: true,
                    offscreen: this.smoke&&!process.argv.includes('--smoke-native-glass')
                }
            });
            this.win.webContents.setWindowOpenHandler(() => ({action: 'deny'}));
            this.win.webContents.on('will-navigate', event => event.preventDefault());
            let boundsTimer;
            const saveBounds = () => {
                clearTimeout(boundsTimer);
                boundsTimer = setTimeout(() => {
                    if (this.win) this.persist({bounds: this.win.getBounds()});
                }, 250);
            };
            this.win.on('move', saveBounds);
            this.win.on('resize', saveBounds);
            this.win.on('closed', () => {
                clearTimeout(boundsTimer);
                this.win = null;
                this.materialKey=null;
            });
            // 首次 state 请求发出前就设置材质，避免旧的实色状态覆盖后来的玻璃更新。
            this.updateMaterial();
            await loadAuxiliary(this.win, path.join(__dirname, 'widget.html'));
        }
        this.win.setSkipTaskbar(mode === 'floating');
        this.materialKey=null;
        if (!this.smoke) this.win.showInactive();
        // Windows 修改任务栏样式可能重建 HWND；最后再设置置顶，避免样式更新撤销置顶。
        this.win.setAlwaysOnTop(mode === 'floating', 'floating');
        this.update();
        this.onChange();
    }

    hide() {
        if (this.win) this.win.hide();
        this.persist({visible: false});
        this.onChange();
    }

    destroy() {
        if (this.win) this.win.destroy();
    }
}

module.exports = {DesktopWidget};
