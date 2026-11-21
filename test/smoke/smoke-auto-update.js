const assert = require('node:assert/strict');
const fs = require('node:fs');
const { UpdatePrompt } = require('../support/host').requireHost('./distribution/update-prompt');

async function until(test) {
    for (let count = 0; count < 200; count++) {
        if (await test()) return;
        await new Promise((resolve) => setTimeout(resolve, 30));
    }
    throw Error('更新气泡等待超时');
}
exports.run = async ({ win }) => {
    const originalVisible = win.isVisible;
    const errors = [];
    const actions = [];
    let blocked = false;
    const state = {
        theme: { preset: 'office' },
        update: { available: true, version: '99.0.0' },
        automatic: { phase: 'available', version: '99.0.0', supported: true, deferred: false },
        progress: null
    };
    const prompt = new UpdatePrompt({
        parent: win,
        status: () => state,
        blocked: () => blocked,
        action: (action) => {
            actions.push(action);
            if (action === 'later') state.automatic.deferred = true;
            prompt.sync();
        }
    });
    try {
        // 仅模拟父窗口可见性，气泡自身保持隐藏，避免测试抢占桌面焦点。
        win.isVisible = () => true;
        prompt.sync();
        prompt.window.showInactive = () => {};
        prompt.window.webContents.on('console-message', (event) => {
            if (event.level === 3) errors.push(event.message);
        });
        await until(() => prompt.ready);
        const content = prompt.window.webContents;
        await until(() => content.executeJavaScript("document.querySelector('#update').textContent==='重启更新'"));
        await content.executeJavaScript("document.querySelector('#update').click()");
        await until(() => actions.includes('update'));
        state.automatic.phase = 'downloading';
        state.progress = { received: 47, total: 100 };
        prompt.sync();
        await until(() => content.executeJavaScript("document.querySelector('progress').value===47"));
        assert.equal(await content.executeJavaScript("document.querySelector('#update').disabled"), true);
        assert.equal(
            await content.executeJavaScript(
                "getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()"
            ),
            '#2b63e6'
        );
        state.automatic.phase = 'error';
        state.automatic.error = '下载中断，请重试';
        prompt.sync();
        await until(() =>
            content.executeJavaScript("document.querySelector('#message').textContent==='下载中断，请重试'")
        );
        assert.equal(await content.executeJavaScript("document.querySelector('#update').textContent"), '重试更新');
        await content.executeJavaScript(
            'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'
        );
        if (process.env.UPDATE_PROMPT_SCREENSHOT)
            fs.writeFileSync(process.env.UPDATE_PROMPT_SCREENSHOT, (await content.capturePage()).toPNG());
        await content.executeJavaScript("document.querySelector('#later').click()");
        await until(() => actions.includes('later'));
        assert.equal(state.automatic.deferred, true);
        blocked = true;
        prompt.sync();
        assert.equal(prompt.window.isVisible(), false);
        assert.deepEqual(errors, []);
        console.log(
            'AUTO UPDATE UI PASS：真实隔离气泡、主题、更新按钮、下载进度、失败重试、稍后及遮挡处理通过；未执行真实安装器。'
        );
    } finally {
        win.isVisible = originalVisible;
        prompt.dispose();
    }
};
