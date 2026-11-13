const fs = require('node:fs'),
    path = require('node:path');
// 只认宿主自身已登记的随包目录，不因清单 ID 相同就信任任意复制目录。
function builtinSource(source, registry) {
    const canonical = (file) => {
        const real = fs.realpathSync(file);
        return process.platform === 'win32' ? real.toLowerCase() : real;
    };
    const selected = canonical(source);
    return registry.defaults().find((plugin) => canonical(plugin.directory) === selected) || null;
}
function assertPageSource(source) {
    const file = path.join(source, 'manifest.json');
    if (!fs.existsSync(file) || fs.statSync(file).size > 32000) throw Error('请选择包含有效 manifest.json 的插件目录');
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    if (manifest.backend)
        throw Error(
            `“${String(manifest.name || manifest.id || '此插件').slice(0, 100)}”包含原生后台，不能通过页面插件入口安装。请选择当前 Collectify 自带的插件目录以启用/恢复，或升级包含该插件的 Collectify 主程序。`
        );
    return manifest;
}
module.exports = { builtinSource, assertPageSource };
