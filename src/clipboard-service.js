const {clipboard} = require('electron');

async function copyText(value) {
    const text = String(value || '');
    // Windows 剪贴板可能被其他应用短暂占用；实际读回确认后才向界面报告成功。
    for (let attempt = 0; attempt < 4; attempt++) {
        try {
            await clipboard.writeText(text);
            await new Promise(resolve => setTimeout(resolve, 40 + attempt * 50));
            if (await clipboard.readText() === text) return;
        } catch { /* 重试原本这次复制，不向其他服务发送内容。 */
        }
    }
    throw Error('剪贴板暂时不可写，请稍后重试');
}

module.exports = {copyText};
