const { app } = require('electron');
const assert = require('node:assert/strict');
exports.run = async ({ services, win }) => {
    await win.webContents.executeJavaScript('shellReady');
    const provider = services.providers.get('collectify.tasks');
    let checks = 0;
    provider.beforeClose = () => {
        checks++;
        return false;
    };
    app.quit();
    await new Promise((resolve) => setTimeout(resolve, 180));
    assert.equal(checks, 1);
    assert.equal(win.isDestroyed(), false, '取消退出不能销毁主窗口');
    assert.ok(services.providers.size > 0, '取消退出不能释放后台');
    provider.beforeClose = () => true;
    let finished = false;
    void services.perform('collectify.tasks', async () => {
        await new Promise((resolve) => setTimeout(resolve, 120));
        finished = true;
    });
    app.once('will-quit', () => {
        try {
            assert.equal(finished, true, '退出必须等待已开始的业务操作');
            assert.equal(services.providers.size, 0, '退出前应释放所有后台');
            console.log('SHUTDOWN PASS：真实 app.quit 流程等待在途业务并完成后台清理。');
        } catch (error) {
            console.error(error);
            app.exit(1);
        }
    });
    app.quit();
    return new Promise(() => {});
};
