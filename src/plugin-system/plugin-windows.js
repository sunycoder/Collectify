const path = require('node:path');
const { BrowserWindow, screen } = require('electron');
const { randomUUID } = require('node:crypto');
class PluginWindows {
    async openWindow(plugin, payload = {}) {
        const size = (value, fallback, min, max) =>
            Number.isFinite(value) ? Math.max(min, Math.min(max, Math.round(value))) : fallback;
        const existing = [...this.popouts.values()].find(
            (record) => record.pluginId === plugin.id && record.mode !== 'shortcut'
        );
        if (existing) {
            if (!existing.followActivePlugin || (this.ownerVisible && this.activeId === plugin.id)) {
                existing.window.show();
                existing.window.focus();
            }
            existing.view.webContents.send('plugin-navigate', { route: plugin.navigation[0]?.id, payload });
            return;
        }
        const window = new BrowserWindow({
            width: size(payload.width, 800, 360, 1400),
            height: size(payload.height, 650, 240, 1000),
            minWidth: size(payload.minWidth, 520, 360, 800),
            minHeight: size(payload.minHeight, 360, 240, 600),
            title: plugin.name + ' · ' + (typeof payload.title === 'string' ? payload.title.slice(0, 60) : '悬浮中转'),
            alwaysOnTop: true,
            autoHideMenuBar: true,
            show: !this.smoke && payload.followActivePlugin !== true,
            webPreferences: {
                partition: this.prepare(plugin),
                preload: path.join(__dirname, 'preload.js'),
                sandbox: true,
                nodeIntegration: false,
                contextIsolation: true,
                webSecurity: true,
                offscreen: this.smoke
            }
        });
        const key = randomUUID(),
            record = {
                pluginId: plugin.id,
                window,
                view: { webContents: window.webContents },
                errors: [],
                followActivePlugin: payload.followActivePlugin === true,
                loading: true
            };
        this.popouts.set(key, record);
        const savedBounds = this.registry.getSetting('windowBounds:' + plugin.id);
        if (
            savedBounds &&
            [savedBounds.x, savedBounds.y, savedBounds.width, savedBounds.height].every(Number.isFinite)
        ) {
            const area = screen.getDisplayMatching(savedBounds).workArea;
            const width = Math.min(area.width, Math.max(window.getMinimumSize()[0], savedBounds.width));
            const height = Math.min(area.height, Math.max(window.getMinimumSize()[1], savedBounds.height));
            window.setBounds({
                x: Math.max(area.x, Math.min(area.x + area.width - width, savedBounds.x)),
                y: Math.max(area.y, Math.min(area.y + area.height - height, savedBounds.y)),
                width,
                height
            });
        }
        window.on('close', () => {
            if (!window.isDestroyed()) this.registry.setSetting('windowBounds:' + plugin.id, window.getBounds());
        });
        window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        for (const event of ['will-navigate', 'will-redirect', 'will-frame-navigate'])
            window.webContents.on(event, (e) => e.preventDefault());
        window.webContents.on('console-message', (event) => {
            if (event.level === 3) record.errors.push(String(event.message).slice(0, 300));
        });
        window.on('closed', () => this.popouts.delete(key));
        try {
            await window.loadURL(this.url(plugin));
            if (window.isDestroyed()) return;
            record.loading = false;
            this.layoutOwnedWindows();
            window.webContents.send('plugin-navigate', { route: plugin.navigation[0]?.id, payload });
        } catch (error) {
            if (!window.isDestroyed()) window.destroy();
            throw error;
        }
    }
    async shortcut(plugin, enabled) {
        const key = 'shortcut:' + plugin.id,
            existing = this.popouts.get(key);
        if (!enabled) {
            existing?.window.destroy();
            return;
        }
        if (existing) return;
        const work = screen.getPrimaryDisplay().workArea;
        const saved = this.registry.getSetting(key + ':position', {});
        const display =
            Number.isFinite(saved.x) && Number.isFinite(saved.y)
                ? screen.getDisplayNearestPoint({ x: saved.x, y: saved.y }).workArea
                : work;
        const x = Math.round(
            Math.max(
                display.x,
                Math.min(display.x + display.width - 48, Number.isFinite(saved.x) ? saved.x : work.x + work.width - 64)
            )
        );
        const y = Math.round(
            Math.max(
                display.y,
                Math.min(
                    display.y + display.height - 48,
                    Number.isFinite(saved.y) ? saved.y : work.y + Math.round(work.height * 0.45)
                )
            )
        );
        const window = new BrowserWindow({
            width: 48,
            height: 48,
            x,
            y,
            frame: false,
            transparent: true,
            backgroundColor: '#00000000',
            resizable: false,
            skipTaskbar: true,
            alwaysOnTop: true,
            hasShadow: false,
            show: false,
            title: plugin.name + ' · 快捷按钮',
            webPreferences: {
                partition: this.prepare(plugin),
                preload: path.join(__dirname, 'preload.js'),
                sandbox: true,
                nodeIntegration: false,
                contextIsolation: true,
                webSecurity: true,
                offscreen: this.smoke
            }
        });
        const record = {
            pluginId: plugin.id,
            mode: 'shortcut',
            window,
            view: { webContents: window.webContents },
            errors: []
        };
        this.popouts.set(key, record);
        window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        for (const name of ['will-navigate', 'will-redirect', 'will-frame-navigate'])
            window.webContents.on(name, (event) => event.preventDefault());
        window.webContents.on('console-message', (event) => {
            if (event.level === 3) record.errors.push(String(event.message).slice(0, 300));
        });
        let positionTimer, pendingPosition;
        const savePosition = () => {
            clearTimeout(positionTimer);
            if (pendingPosition) {
                this.registry.setSetting(key + ':position', pendingPosition);
                pendingPosition = null;
            }
        };
        window.on('move', () => {
            const [x, y] = window.getPosition();
            pendingPosition = { x, y };
            clearTimeout(positionTimer);
            positionTimer = setTimeout(savePosition, 100);
        });
        window.on('closed', () => {
            savePosition();
            this.popouts.delete(key);
        });
        try {
            await window.loadURL(this.url({ ...plugin, entry: plugin.shortcut }));
            if (window.isDestroyed() || this.popouts.get(key) !== record) return;
            if (!this.registry.plugins.get(plugin.id)?.enabled) {
                window.destroy();
                return;
            }
            if (!this.smoke) window.showInactive();
        } catch (error) {
            window.destroy();
            throw error;
        }
    }
}
module.exports = { PluginWindows };
