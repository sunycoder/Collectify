const { createHash } = require('node:crypto');
const CALLBACK = 'http://127.0.0.1:19287/oauth/callback';
function privateHost(host) {
    return /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(
        host
    );
}
function webUrl(value, config = {}) {
    const url = new URL(value);
    if (url.username || url.password || url.hash || value.length > 4000) throw Error('下载地址不能包含凭据或片段');
    if (
        url.protocol !== 'https:' &&
        !(url.protocol === 'http:' && config.allowInsecureHttp && privateHost(url.hostname))
    )
        throw Error('请使用 HTTPS；内网 IP 的 HTTP 需在源设置中明确允许');
    return url;
}
function cleanPath(value, label) {
    if (
        typeof value !== 'string' ||
        !value ||
        value.length > 500 ||
        value.split('/').some((v) => !v || v === '.' || v === '..') ||
        /[\\?#\u0000-\u001f]/.test(value)
    )
        throw Error(label + '不正确');
    return value;
}
function validateConfig(input = {}) {
    if (!['gitlab', 'github'].includes(input.provider)) throw Error('请选择 GitLab 或 GitHub');
    const config = {
        provider: input.provider,
        baseUrl: (input.baseUrl || (input.provider === 'github' ? 'https://github.com' : ''))
            .trim()
            .replace(/\/+$/, ''),
        project: cleanPath(input.project?.trim(), '项目路径'),
        ref: cleanPath(input.ref?.trim() || 'main', '分支'),
        catalogPath: cleanPath(input.catalogPath?.trim() || 'plugins/catalog.json', '插件目录路径'),
        profilesPath: cleanPath(input.profilesPath?.trim() || 'profiles/index.json', '团队配置索引路径'),
        clientId: String(input.clientId || '').trim(),
        allowInsecureHttp: input.allowInsecureHttp === true,
        automaticChecks: input.automaticChecks !== false
    };
    const base = webUrl(config.baseUrl, config);
    if (base.search || base.pathname.includes('%') || config.clientId.length > 200 || /\s/.test(config.clientId))
        throw Error('源地址或 Application ID 不正确');
    if (
        config.provider === 'github' &&
        (base.origin !== 'https://github.com' || base.pathname !== '/' || config.project.split('/').length !== 2)
    )
        throw Error('GitHub 源目前支持 github.com，项目格式为 owner/repository');
    return config;
}
function sourceKey(config) {
    return createHash('sha256').update(JSON.stringify(config)).digest('hex');
}
function authKey(config) {
    return sourceKey({ provider: config.provider, baseUrl: config.baseUrl, clientId: config.clientId });
}
module.exports = { CALLBACK, validateConfig, webUrl, cleanPath, sourceKey, authKey };
