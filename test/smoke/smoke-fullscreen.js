const assert = require('node:assert/strict');
const http = require('node:http');
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
exports.run = async ({ win, services, hostAction, runtime }) => {
    const server = http.createServer((_req, res) =>
        res.end('<!doctype html><title>Local full-screen regression</title><h1>Test page</h1>')
    );
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    let helper;
    try {
        if (process.platform === 'darwin') {
            win.show();
            const entered = new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(Error('macOS 全屏超时')), 10000);
                win.once('enter-full-screen', () => {
                    clearTimeout(timer);
                    resolve();
                });
            });
            win.setFullScreen(true);
            await entered;
        }
        await hostAction('plugin-open', { id: 'collectify.bookmarks' });
        await runtime.views.get('collectify.bookmarks').view.webContents.executeJavaScript('refresh()');
        await wait(150);
        await win.webContents.executeJavaScript(
            "document.querySelector('#settings-dialog').open && document.querySelector('#settings-dialog').close()"
        );
        const entry = await services.call('collectify.bookmarks', 'save', {
            type: 'web',
            name: '全屏测试',
            url: `http://127.0.0.1:${server.address().port}/`,
            username: 'test-user',
            password: 'test-password'
        });
        await services.call('collectify.bookmarks', 'open', { id: entry.id, mode: 'internal' });
        const browser = services.providers.get('collectify.bookmarks').browser;
        await services.call('collectify.bookmarks', 'overlay', false);
        await wait(250);
        helper = browser.loginHelper;
        helper.smoke = false;
        await helper.show(entry);
        assert.equal(helper.win.isVisible(), true, '全屏回归必须实际显示资料卡，不能仅检查隐藏窗口');
        let hidden = 0,
            shown = 0;
        const onHide = () => hidden++,
            onShow = () => shown++;
        helper.win.on('hide', onHide);
        helper.win.on('show', onShow);
        for (let i = 0; i < 25; i++) {
            browser.layout({ x: 300, y: 64, width: 800, height: 600 }, true);
            browser.publish();
        }
        await wait(200);
        assert.equal(hidden, 0, '重复布局不能隐藏资料卡');
        assert.equal(shown, 0, '重复布局不能反复显示资料卡');
        helper.win.removeListener('hide', onHide);
        helper.win.removeListener('show', onShow);
        await services.call('collectify.bookmarks', 'home');
        assert.equal(helper.win.isVisible(), false);
        console.log(
            `FULLSCREEN LAYOUT PASS：${process.platform === 'darwin' ? '真实 macOS 全屏' : 'Windows 布局回归'}网页加载与资料卡重复布局无隐藏/显示抖动；本机测试网页。`
        );
    } finally {
        helper?.hide(true);
        if (helper) helper.smoke = true;
        if (win.isFullScreen()) win.setFullScreen(false);
        await new Promise((resolve) => server.close(resolve));
    }
};
