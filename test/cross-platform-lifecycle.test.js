const { test } = require('node:test'),
    assert = require('node:assert/strict');
const { PluginServices } = require('../src/plugin-system/services');
const { visibleBounds } = require('../src/window-lifecycle');
test('macOS 连续尺寸变化期间收起辅助窗，原生全屏完成后恢复', async () => {
    const { EventEmitter } = require('node:events');
    const { bindStableLayout } = require('../src/window-lifecycle');
    const window = new EventEmitter(),
        states = [];
    let transitioning = false;
    bindStableLayout(
        window,
        () => states.push(transitioning),
        (value) => (transitioning = value),
        'darwin'
    );
    window.emit('resize');
    window.emit('resize');
    assert.deepEqual(states, [true, true]);
    window.emit('enter-full-screen');
    assert.equal(states.at(-1), false);
    await new Promise((resolve) => setTimeout(resolve, 180));
    assert.equal(states.length, 3, '原生完成事件取消旧的防抖回调');
    window.emit('closed');
});
test('多显示器负坐标和小工作区下，辅助窗口始终放回可见范围', () => {
    assert.deepEqual(
        visibleBounds({ x: 1800, y: 900, width: 500, height: 500 }, { x: -1280, y: 0, width: 1280, height: 720 }),
        { x: -500, y: 220, width: 500, height: 500 }
    );
    assert.deepEqual(
        visibleBounds({ x: -100, y: -50, width: 500, height: 500 }, { x: 0, y: 0, width: 320, height: 240 }),
        { x: 0, y: 0, width: 320, height: 240 }
    );
});
test('并发启用只激活一次，退出等待业务写入且拒绝新请求', async () => {
    const registry = { get: () => ({ enabled: true }) };
    const services = new PluginServices(registry, {});
    let activations = 0,
        release,
        disposed = false;
    services.providers.set('example.plugin', {
        activate: async () => {
            activations++;
            await new Promise((r) => setTimeout(r, 10));
        },
        deactivate: async () => {},
        dispose: () => {
            disposed = true;
        }
    });
    await Promise.all([services.enable('example.plugin'), services.enable('example.plugin')]);
    assert.equal(activations, 1);
    const work = services.perform('example.plugin', () => new Promise((resolve) => (release = resolve)));
    await new Promise((resolve) => setImmediate(resolve));
    const shutdown = services.dispose();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(disposed, false);
    await assert.rejects(
        services.perform('example.plugin', () => {}),
        /卸载/
    );
    release();
    await work;
    await shutdown;
    assert.equal(disposed, true);
});
test('一个插件清理失败不会跳过其他插件的清理', async () => {
    const services = new PluginServices({}, {});
    let disposed = false;
    services.providers.set('a', {
        dispose: () => {
            throw Error('failed');
        }
    });
    services.providers.set('b', {
        dispose: () => {
            disposed = true;
        }
    });
    await assert.rejects(services.dispose(), /退出失败/);
    assert.equal(disposed, true);
});
