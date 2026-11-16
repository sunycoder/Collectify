const { test } = require('node:test'),
    assert = require('node:assert/strict');
const { LazyMcpService } = require('../src/lazy-mcp-service');
test('未启用 AI 的状态查询不加载 SDK，首次启用才加载一次', async () => {
    let loads = 0;
    const service = new LazyMcpService(
        { readMcpConfig: () => null, saveMcpConfig: () => {} },
        () => {},
        () => [],
        () => {
            loads++;
            return {
                z: {},
                LocalMcpService: class {
                    status() {
                        return { enabled: true };
                    }
                    async start() {
                        return this.status();
                    }
                    async stop() {}
                }
            };
        }
    );
    assert.equal(service.status().enabled, false);
    assert.equal(loads, 0);
    await service.start();
    assert.equal(loads, 1);
    service.status();
    await service.start();
    assert.equal(loads, 1);
});
test('网页和插件视图的同状态布局不重复刷新可见性和尺寸', () => {
    const { layoutView } = require('../src/window-lifecycle');
    let visible = true,
        bounds = { x: 0, y: 0, width: 800, height: 600 },
        changes = 0;
    const view = {
        getVisible: () => visible,
        setVisible: (v) => {
            visible = v;
            changes++;
        },
        getBounds: () => bounds,
        setBounds: (b) => {
            bounds = b;
            changes++;
        }
    };
    layoutView(view, true, { ...bounds });
    layoutView(view, true, { ...bounds });
    assert.equal(changes, 0);
    layoutView(view, true, { ...bounds, width: 900 });
    assert.equal(changes, 1);
    layoutView(view, false, bounds);
    layoutView(view, false, bounds);
    assert.equal(changes, 2);
});
test('并发启动 AI 只启动一次监听，紧接着停止会等待启动完成', async () => {
    let starts = 0,
        release,
        stopped = false;
    const service = new LazyMcpService(
        { readMcpConfig: () => null },
        () => {},
        () => [],
        () => ({
            z: {},
            LocalMcpService: class {
                async start() {
                    starts++;
                    await new Promise((resolve) => (release = resolve));
                    return { enabled: true };
                }
                async stop() {
                    stopped = true;
                }
            }
        })
    );
    const first = service.start(),
        second = service.start();
    await new Promise((resolve) => setImmediate(resolve));
    const stopping = service.stop();
    assert.equal(starts, 1);
    assert.equal(stopped, false);
    release();
    await Promise.all([first, second, stopping]);
    assert.equal(stopped, true);
});
