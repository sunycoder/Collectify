const path = require('node:path');
const { execFile } = require('node:child_process');
async function pasteToPreviousApplication({
    windows,
    platform = process.platform,
    hideApplication = () => {},
    restoreApplication = () => {},
    run = (file, args) =>
        new Promise((resolve, reject) =>
            execFile(file, args, { windowsHide: true, timeout: 10000 }, (error, _stdout, stderr) =>
                error ? reject(Error(stderr.trim() || '系统拒绝执行粘贴')) : resolve()
            )
        )
}) {
    if (!['win32', 'darwin'].includes(platform)) throw Error('当前平台请复制后切换目标应用手动粘贴');
    const visible = windows.filter((window) => window && !window.isDestroyed() && window.isVisible());
    if (!visible.some((window) => window.isFocused())) throw Error('请从当前剪贴板窗口主动执行粘贴');
    for (const window of visible) window.hide();
    if (platform === 'darwin') hideApplication();
    try {
        await new Promise((resolve) => setTimeout(resolve, 150));
        if (platform === 'darwin') {
            // 不拼接剪贴板内容；隐藏本应用后向此前应用发送标准粘贴快捷键。
            await run('/usr/bin/osascript', [
                '-e',
                'tell application "System Events" to keystroke "v" using command down'
            ]);
        } else
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
        if (platform === 'darwin') restoreApplication();
        visible[0]?.show();
        if (platform === 'darwin')
            throw Error(
                '无法执行粘贴，请在系统设置 → 隐私与安全性 → 辅助功能中允许 Collectify；也可切换目标应用按 ⌘V。' +
                    error.message
            );
        throw error;
    }
}
module.exports = { pasteToPreviousApplication };
