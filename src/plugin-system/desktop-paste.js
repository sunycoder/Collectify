const path = require('node:path');
const { execFile } = require('node:child_process');
async function pasteToPreviousApplication({
    windows,
    platform = process.platform,
    run = (file, args) =>
        new Promise((resolve, reject) =>
            execFile(file, args, { windowsHide: true, timeout: 10000 }, (error, _stdout, stderr) =>
                error ? reject(Error(stderr.trim() || '系统拒绝执行粘贴')) : resolve()
            )
        )
}) {
    if (platform !== 'win32') throw Error('当前平台请复制后切换目标应用手动粘贴');
    const visible = windows.filter((window) => window && !window.isDestroyed() && window.isVisible());
    if (!visible.some((window) => window.isFocused())) throw Error('请从当前剪贴板窗口主动执行粘贴');
    for (const window of visible) window.hide();
    try {
        await new Promise((resolve) => setTimeout(resolve, 150));
        await run('powershell.exe', [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            path.join(__dirname, 'paste-windows.ps1').replace(/app\.asar([\\/])/, 'app.asar.unpacked$1'),
            '-BlockedProcessId',
            String(process.pid)
        ]);
    } catch (error) {
        visible[0]?.show();
        throw error;
    }
}
module.exports = { pasteToPreviousApplication };
