const fs = require('node:fs'),
    path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildCatalog } = require('./build-plugin-catalog.cjs');
const { sha256 } = require('../src/plugin-system/package');
const { download } = require('../src/plugin-system/catalog');
async function publish({
    run = (args) => spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 }),
    build = () => buildCatalog({ check: true }),
    fetcher = fetch,
    targetTag = process.env.RELEASE_TAG || ''
} = {}) {
    const result = build(),
        repo = result.repository;
    function invoke(args) {
        const response = run(args);
        if (response.error) throw response.error;
        if (response.status !== 0) throw Error(response.stderr || 'GitHub 发布命令失败');
        return response.stdout;
    }
    const releases = JSON.parse(invoke(['api', `repos/${repo}/releases?per_page=100`]));
    let published = 0;
    for (const plugin of result.plugins) {
        const tag = new URL(plugin.url).pathname.split('/')[5];
        if (targetTag && tag !== targetTag) continue;
        let release = releases.find((item) => item.tag_name === tag);
        const notes = path.join(result.output, plugin.id + '-release.md');
        fs.writeFileSync(
            notes,
            `${plugin.name} ${plugin.version}\n\n${plugin.description}\n\n需要 Collectify ${plugin.minHostVersion || '5.5.3'} 或以上版本。在设置 → 插件 → 发现插件中安装。\n\n程序包不包含用户数据，更新保留插件数据。\n`,
            'utf8'
        );
        if (!release) {
            invoke([
                'release',
                'create',
                tag,
                '--repo',
                repo,
                '--title',
                `${plugin.name} ${plugin.version}`,
                '--notes-file',
                notes,
                '--draft',
                '--latest=false'
            ]);
            release = { draft: true, assets: [] };
        }
        const filename = path.basename(new URL(plugin.url).pathname),
            asset = release.assets.find((item) => item.name === filename);
        if (asset) {
            if (asset.digest !== `sha256:${plugin.sha256}` || asset.size !== plugin.size) {
                const data = await download(plugin.url, plugin.size, { fetcher });
                if (data.length !== plugin.size || sha256(data) !== plugin.sha256)
                    throw Error(`已有插件包 ${filename} 与目录不一致，请增加版本号`);
            }
        } else invoke(['release', 'upload', tag, path.join(result.output, filename), '--repo', repo]);
        if (release.draft) invoke(['release', 'edit', tag, '--repo', repo, '--draft=false', '--latest=false']);
        published++;
        console.log(`插件发布完成：${repo} / ${tag}`);
    }
    if (!published) throw Error('发布标签未对应任何当前插件');
    return result;
}
if (require.main === module)
    publish().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
module.exports = { publish };
