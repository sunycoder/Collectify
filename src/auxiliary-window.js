// 子窗口只有在可信本地页面加载完成后才允许显示，防止空白窗口抢先出现。
async function loadAuxiliary(window, file) {
    window.setOpacity(0);
    try {
        await window.loadFile(file);
        const ready = await window.webContents.executeJavaScript(
            'document.readyState === "complete" && document.body && document.body.textContent.trim().length > 0'
        );
        if (!ready) throw Error('辅助窗口页面尚未准备好');
        window.setOpacity(1);
    } catch (error) {
        window.hide();
        throw error;
    }
}

module.exports = { loadAuxiliary };
