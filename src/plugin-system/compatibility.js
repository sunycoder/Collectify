const HOST_VERSION = require('../../package.json').version;
function isVersion(value) {
    return typeof value === 'string' && /^\d+\.\d+\.\d+$/.test(value) && value.length < 60;
}
function compareVersion(a, b) {
    const x = a.split('.').map(BigInt),
        y = b.split('.').map(BigInt);
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
    return 0;
}
function compatibility(plugin, { hostVersion = HOST_VERSION, platform = process.platform } = {}) {
    if (plugin.minHostVersion && compareVersion(hostVersion, plugin.minHostVersion) < 0)
        return { compatible: false, compatibilityReason: `请先升级 Collectify 至 ${plugin.minHostVersion} 或更高版本` };
    if (plugin.platforms && !plugin.platforms.includes(platform))
        return { compatible: false, compatibilityReason: '此插件暂不支持当前系统' };
    return { compatible: true, compatibilityReason: '' };
}
function validateCompatibility(input) {
    if (input.minHostVersion !== undefined && !isVersion(input.minHostVersion))
        throw Error('插件最低主程序版本格式不正确');
    if (
        input.platforms !== undefined &&
        (!Array.isArray(input.platforms) ||
            !input.platforms.length ||
            new Set(input.platforms).size !== input.platforms.length ||
            input.platforms.some((platform) => !['win32', 'darwin', 'linux'].includes(platform)))
    )
        throw Error('插件支持的平台不正确');
    return {
        ...(input.minHostVersion ? { minHostVersion: input.minHostVersion } : {}),
        ...(input.platforms ? { platforms: [...input.platforms] } : {})
    };
}
module.exports = { HOST_VERSION, isVersion, compareVersion, compatibility, validateCompatibility };
