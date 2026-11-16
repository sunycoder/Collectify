const fs = require('node:fs'),
    path = require('node:path');
const base = require('../config/app-defaults.json');
// 开发只读取 config/local.json；已安装程序的覆盖文件位于用户数据目录。
const electronApp = process.versions.electron ? require('electron').app : null;
const localFile = electronApp?.isPackaged
    ? path.join(electronApp.getPath('appData'), 'Collectify', 'config', 'local.json')
    : path.join(__dirname, '..', 'config', 'local.json');
const local =
    !process.argv.includes('--smoke-test') && fs.existsSync(localFile)
        ? JSON.parse(fs.readFileSync(localFile, 'utf8').replace(/^\uFEFF/, ''))
        : {};
if (!local || typeof local !== 'object' || Array.isArray(local)) throw Error('本机配置必须是 JSON 对象');
const config = { ...base, ...local };
for (const key of ['settings', 'network', 'window', 'distribution', 'sources'])
    config[key] = { ...base[key], ...local[key] };
for (const name of ['oauthCallbackPort', 'mcpPort']) {
    const port = config.network[name];
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('默认端口配置不正确：' + name);
}
if (!['github', 'gitlab'].includes(config.distribution.provider)) throw Error('默认发布源不正确');
if (!Number.isInteger(config.network.updateIntervalMs) || config.network.updateIntervalMs < 60000)
    throw Error('更新检查间隔至少一分钟');
for (const name of ['width', 'height', 'minWidth', 'minHeight']) {
    if (!Number.isInteger(config.window[name]) || config.window[name] < 400 || config.window[name] > 10000)
        throw Error('默认窗口尺寸不正确：' + name);
}
module.exports = config;
