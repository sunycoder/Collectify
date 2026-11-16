const fs = require('node:fs'),
    path = require('node:path');
function createLoginItem(app, { platform = process.platform, env = process.env, io = fs } = {}) {
    const supported = ['win32', 'darwin', 'linux'].includes(platform) && app.isPackaged;
    const file = path.join(env.XDG_CONFIG_HOME || app.getPath('appData'), 'autostart', 'collectify.desktop');
    function status() {
        const enabled =
            supported && (platform === 'linux' ? io.existsSync(file) : app.getLoginItemSettings().openAtLogin);
        return {
            supported,
            enabled: !!enabled,
            message: supported ? '登录系统后自动启动 Collectify' : '开发模式不修改系统启动项，请在安装版设置'
        };
    }
    function set(enabled) {
        if (typeof enabled !== 'boolean') throw Error('自启动参数不正确');
        if (!supported) throw Error('请在安装版中设置开机自启动');
        if (platform === 'linux') {
            if (enabled) {
                const executable = env.APPIMAGE || app.getPath('exe');
                if (/[\r\n\0]/.test(executable)) throw Error('程序路径不正确');
                const escaped = executable.replace(/([\\"`$])/g, '\\$1').replace(/%/g, '%%');
                io.mkdirSync(path.dirname(file), { recursive: true });
                io.writeFileSync(
                    file,
                    `[Desktop Entry]\nType=Application\nName=Collectify\nExec="${escaped}"\nTerminal=false\n`,
                    'utf8'
                );
            } else if (io.existsSync(file)) io.unlinkSync(file);
        } else
            app.setLoginItemSettings({
                openAtLogin: enabled,
                ...(platform === 'win32' ? { path: app.getPath('exe') } : {})
            });
        return status();
    }
    return { status, set };
}
module.exports = { createLoginItem };
