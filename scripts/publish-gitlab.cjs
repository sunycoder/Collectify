// 只在 GitLab CI 中使用内置 CI_JOB_TOKEN；客户端不接收或保存发布凭据。
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const { createHash } = require('node:crypto');
const { generate } = require('./distribution-manifest.cjs');
async function publish({ env = process.env, fetcher = fetch, root = path.resolve(__dirname, '..'), build } = {}) {
    const { CI_API_V4_URL: api, CI_PROJECT_ID: project, CI_JOB_TOKEN: token, CI_COMMIT_TAG: tag } = env;
    if (!api || !project || !token || !tag) throw Error('请在 GitLab 的标签流水线中发布');
    const version = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version,
        directory = path.join(root, 'dist');
    const base = `${api}/projects/${encodeURIComponent(project)}`;
    const publisher = JSON.parse(fs.readFileSync(path.join(root, 'plugins/definitions.json'), 'utf8')).publisher;
    if (
        !publisher ||
        publisher.baseUrl.replace(/\/$/, '') + '/api/v4' !== api ||
        ![String(project), env.CI_PROJECT_PATH].includes(publisher.project)
    )
        throw Error('发布目标与当前 GitLab CI 不一致，请先运行 configure-source.cjs 配置公司发布源');
    async function request(url, options = {}) {
        const response = await fetcher(url, {
            ...options,
            redirect: 'error',
            headers: { 'JOB-TOKEN': token, ...options.headers }
        });
        if (!response.ok)
            throw Error(`GitLab 发布失败（HTTP ${response.status}），已上传文件请核对后重试，禁止覆盖已发布版本`);
        return response;
    }
    const plugin = tag.startsWith('plugin-');
    let assets, notes;
    if (plugin) {
        const built = build ? build() : require('./build-plugin-catalog.cjs').buildCatalog({ root, check: true });
        const item = built.plugins.find((p) => tag === `plugin-${p.id}-v${p.version}`);
        if (!item) throw Error('标签未对应任何插件');
        const name = `${item.id}-${item.version}.collectify-plugin`;
        assets = [
            {
                name,
                file: path.join(built.output, name),
                url: `${base}/packages/generic/${item.id}/${item.version}/${name}`
            }
        ];
        notes = `${item.name} ${item.version}\n\n需要 Collectify ${item.minHostVersion || '5.6.0'} 或更高版本。更新保留用户数据。`;
    } else {
        if (tag !== 'v' + version) throw Error('标签与主程序版本不一致');
        notes = fs.readFileSync(path.join(root, 'docs', 'releases', version + '.md'), 'utf8');
        const assetUrl = (name) => `${base}/packages/generic/collectify/${version}/${name}`;
        const manifest = generate({ directory, version, notes, assetUrl });
        require('./release-files.cjs').checksums(directory);
        assets = [...manifest.files.map((f) => f.name), 'collectify-update.json', 'SHA256SUMS.txt'].map((name) => ({
            name,
            file: path.join(directory, name),
            url: assetUrl(name)
        }));
    }
    const existing = await fetcher(`${base}/releases/${encodeURIComponent(tag)}`, {
        headers: { 'JOB-TOKEN': token },
        redirect: 'error'
    });
    if (existing.ok) throw Error('该 Release 已存在，请提高版本号，不覆盖已发布附件');
    if (existing.status !== 404) throw Error(`不能核对已有 Release（HTTP ${existing.status}）`);
    for (const asset of assets) {
        const existing = await fetcher(asset.url, { headers: { 'JOB-TOKEN': token }, redirect: 'error' });
        if (existing.ok) {
            const hash = createHash('sha256');
            let size = 0;
            for await (const chunk of existing.body) {
                size += chunk.length;
                hash.update(chunk);
            }
            const local = createHash('sha256');
            for await (const chunk of fs.createReadStream(asset.file)) local.update(chunk);
            if (size !== fs.statSync(asset.file).size || hash.digest('hex') !== local.digest('hex'))
                throw Error('已有同名不同内容的包，请提高版本号：' + asset.name);
            console.log('核对已有文件：' + asset.name);
            continue;
        }
        if (existing.status !== 404) throw Error(`无法核对已有包（HTTP ${existing.status}）`);
        await request(asset.url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: Readable.toWeb(fs.createReadStream(asset.file)),
            duplex: 'half'
        });
        console.log('已上传：' + asset.name);
    }
    await request(`${base}/releases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            name: plugin ? tag : 'Collectify ' + version,
            tag_name: tag,
            description: notes,
            assets: { links: assets.map((a) => ({ name: a.name, url: a.url, link_type: 'package' })) }
        })
    });
    console.log('GitLab 发布完成：' + tag);
}
if (require.main === module)
    publish().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
module.exports = { publish };
