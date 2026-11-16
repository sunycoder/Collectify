const { test } = require('node:test');
const assert = require('node:assert/strict');
const { revealWindow, stayResident } = require('../src/window-lifecycle');
test('Windows 双击托盘与 macOS 单击菜单栏图标都恢复主窗口', () => {
    const { EventEmitter } = require('node:events');
    const { bindTray } = require('../src/window-lifecycle');
    for (const platform of ['win32', 'darwin']) {
        const tray = new EventEmitter();
        let count = 0;
        bindTray(tray, () => count++, platform);
        tray.emit('double-click');
        assert.equal(count, 1);
        tray.emit('click');
        assert.equal(count, platform === 'darwin' ? 2 : 1);
    }
});
test('托盘恢复先还原最小化窗口，再显示并聚焦；已销毁窗口重建', async () => {
    const events = [];
    let window = {
        isDestroyed: () => false,
        isMinimized: () => true,
        restore: () => events.push('restore'),
        show: () => events.push('show'),
        focus: () => events.push('focus')
    };
    await revealWindow(
        () => window,
        async () => {
            throw Error('不应重建');
        }
    );
    assert.deepEqual(events, ['restore', 'show', 'focus']);
    window = null;
    await revealWindow(
        () => window,
        async () => {
            window = {
                isDestroyed: () => false,
                isMinimized: () => false,
                show: () => events.push('new'),
                focus: () => {}
            };
        }
    );
    assert.equal(events.at(-1), 'new');
});
test('Windows 托盘关闭策略与 macOS 常驻策略，明确退出始终放行', () => {
    for (const platform of ['win32', 'darwin', 'linux']) {
        assert.equal(stayResident({ platform, quitting: true, trayAvailable: true, keepInTray: true }), false);
        assert.equal(stayResident({ platform, trayAvailable: true, keepInTray: true }), true);
    }
    assert.equal(stayResident({ platform: 'darwin', trayAvailable: false }), true);
    assert.equal(stayResident({ platform: 'win32', trayAvailable: false, keepInTray: true }), false);
});
