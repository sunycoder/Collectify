const { cleanPath } = require('./config');
const enc = encodeURIComponent;
function createProvider(config) {
    const gitlab = config.provider === 'gitlab';
    const api = gitlab ? config.baseUrl + '/api/v4' : 'https://api.github.com';
    const projectUrl = (project = config.project) =>
        gitlab ? `${api}/projects/${enc(project)}` : `${api}/repos/${project}`;
    return {
        api,
        authUrl: config.baseUrl + (gitlab ? '/oauth/authorize' : '/login/device/code'),
        tokenUrl: config.baseUrl + (gitlab ? '/oauth/token' : '/login/oauth/access_token'),
        fileUrl(project, ref, file) {
            cleanPath(project, '配置项目');
            cleanPath(ref, '配置分支');
            cleanPath(file, '文件路径');
            return gitlab
                ? `${projectUrl(project)}/repository/files/${enc(file)}/raw?ref=${enc(ref)}`
                : `${projectUrl(project)}/contents/${file.split('/').map(enc).join('/')}?ref=${enc(ref)}`;
        },
        headers(url, token) {
            const trusted =
                url.origin === new URL(api).origin &&
                url.pathname.startsWith(new URL(api).pathname.replace(/\/$/, '') + '/');
            return {
                Accept: gitlab
                    ? 'application/json, application/octet-stream'
                    : url.pathname.includes('/releases/assets/')
                      ? 'application/octet-stream'
                      : url.pathname.includes('/contents/')
                        ? 'application/vnd.github.raw+json'
                        : 'application/vnd.github+json',
                ...(trusted && token ? { Authorization: 'Bearer ' + token } : {}),
                ...(gitlab ? {} : { 'X-GitHub-Api-Version': '2022-11-28' })
            };
        },
        async identity(read) {
            const user = await read(api + '/user');
            const groups = [];
            for (let page = 1; page <= 100; page++) {
                const values = await read(
                    gitlab
                        ? `${api}/groups?min_access_level=10&all_available=false&per_page=100&page=${page}`
                        : `${api}/user/teams?per_page=100&page=${page}`
                );
                if (!Array.isArray(values)) throw Error('用户组返回格式不正确');
                groups.push(...values.map((v) => (gitlab ? v.full_path : `${v.organization.login}/${v.slug}`)));
                if (values.length < 100)
                    return {
                        id: String(user.id),
                        name: user.name || user.username || user.login,
                        username: user.username || user.login,
                        groups
                    };
            }
            throw Error('用户组超过分页限制，请联系维护者');
        },
        async releaseUrl(read) {
            let release;
            if (gitlab) {
                // GitLab 的最新 Release 可能属于插件，按主程序标签查找，避免插件更新遮住主程序。
                for (let page = 1; page <= 10; page++) {
                    const releases = await read(`${projectUrl()}/releases?per_page=100&page=${page}`);
                    if (!Array.isArray(releases)) throw Error('GitLab 发布列表格式不正确');
                    release = releases.find(
                        (item) =>
                            /^v\d+\.\d+\.\d+$/.test(item.tag_name) &&
                            !item.upcoming_release &&
                            item.assets?.links?.some((asset) => asset.name === 'collectify-update.json')
                    );
                    if (release || releases.length < 100) break;
                }
            } else release = await read(`${projectUrl()}/releases/latest`);
            if (!release) throw Error('该源尚未发布带更新清单的主程序版本');
            const assets = gitlab ? release.assets?.links : release.assets;
            const manifest = assets?.find((a) => a.name === 'collectify-update.json');
            if (!manifest) throw Error('该源尚未发布 collectify-update.json 更新清单');
            return gitlab
                ? manifest.direct_asset_url || manifest.url
                : `${api}/repos/${config.project}/releases/assets/${manifest.id}`;
        },
        // 把网页 Raw/Release 链接转换成支持 OAuth 的 API 请求；普通外站仅匿名下载。
        async resolve(value, read) {
            const url = new URL(value);
            if (gitlab && url.origin === new URL(config.baseUrl).origin) {
                const prefix = new URL(config.baseUrl).pathname.replace(/\/$/, '');
                const match = url.pathname.slice(prefix.length).match(/^\/(.+)\/-\/raw\/([^/]+)\/(.+)$/);
                if (match)
                    return this.fileUrl(
                        decodeURIComponent(match[1]),
                        decodeURIComponent(match[2]),
                        decodeURIComponent(match[3])
                    );
            }
            if (!gitlab && url.origin === 'https://github.com') {
                const match = url.pathname.match(/^\/([^/]+\/[^/]+)\/releases\/download\/([^/]+)\/(.+)$/);
                if (match) {
                    const release = await read(`${api}/repos/${match[1]}/releases/tags/${match[2]}`);
                    const asset = release.assets?.find((a) => a.name === decodeURIComponent(match[3]));
                    if (!asset) throw Error('发布附件不存在或无权下载');
                    return `${api}/repos/${match[1]}/releases/assets/${asset.id}`;
                }
            }
            return url.href;
        }
    };
}
module.exports = { createProvider };
