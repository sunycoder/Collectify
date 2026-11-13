const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pasteToPreviousApplication } = require('../src/plugin-system/desktop-paste');
function windowFixture(focused = true) {
    return {
        hidden: false,
        shown: false,
        isDestroyed: () => false,
        isVisible: () => true,
        isFocused: () => focused,
        hide() {
            this.hidden = true;
        },
        show() {
            this.shown = true;
        }
    };
}
test('主动粘贴先隐藏自身窗口，再调用固定助手，不拼接用户输入', async () => {
    const window = windowFixture();
    let invoked;
    await pasteToPreviousApplication({
        windows: [window],
        platform: 'win32',
        run: async (file, args) => {
            assert.equal(window.hidden, true);
            invoked = { file, args };
        }
    });
    assert.equal(invoked.file, 'powershell.exe');
    assert.ok(invoked.args.includes(String(process.pid)));
    assert.ok(invoked.args.some((arg) => arg.endsWith('paste-windows.ps1')));
});
test('无焦点和不支持的平台拒绝执行，失败恢复窗口', async () => {
    await assert.rejects(
        () =>
            pasteToPreviousApplication({
                windows: [windowFixture(false)],
                platform: 'win32',
                run: () => {
                    throw Error('不应调用');
                }
            }),
        /主动/
    );
    await assert.rejects(
        () => pasteToPreviousApplication({ windows: [windowFixture()], platform: 'darwin' }),
        /手动粘贴/
    );
    const window = windowFixture();
    await assert.rejects(
        () =>
            pasteToPreviousApplication({
                windows: [window],
                platform: 'win32',
                run: async () => {
                    throw Error('拒绝发送');
                }
            }),
        /拒绝/
    );
    assert.equal(window.shown, true);
});
