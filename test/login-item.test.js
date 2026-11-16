const { test } = require('node:test'),
    assert = require('node:assert/strict');
const { createLoginItem } = require('../src/login-item');
test('Windows/macOS 启动项读写系统真实状态，开发版不注册', () => {
    for (const platform of ['win32', 'darwin']) {
        let enabled = false,
            last;
        const app = {
            isPackaged: true,
            getPath: () => '/test/app',
            getLoginItemSettings: () => ({ openAtLogin: enabled }),
            setLoginItemSettings: (input) => {
                last = input;
                enabled = input.openAtLogin;
            }
        };
        const item = createLoginItem(app, { platform });
        assert.equal(item.set(true).enabled, true);
        assert.equal(item.set(false).enabled, false);
        assert.equal(Object.hasOwn(last, 'path'), platform === 'win32');
        app.isPackaged = false;
        const dev = createLoginItem(app, { platform });
        assert.equal(dev.status().supported, false);
        assert.throws(() => dev.set(true), /安装版/);
    }
});
test('Linux 自启动只管理自身 desktop 文件，路径带空格可保留', () => {
    const records = new Map();
    const app = {
        isPackaged: true,
        getPath: (key) => (key === 'exe' ? '/opt/My App/Collectify' : '/home/test/.config')
    };
    const item = createLoginItem(app, {
        platform: 'linux',
        env: {},
        io: {
            existsSync: (p) => records.has(p),
            mkdirSync: () => {},
            writeFileSync: (p, v) => records.set(p, v),
            unlinkSync: (p) => records.delete(p)
        }
    });
    assert.equal(item.set(true).enabled, true);
    assert.match([...records.values()][0], /Exec="\/opt\/My App\/Collectify"/);
    assert.equal(item.set(false).enabled, false);
});
