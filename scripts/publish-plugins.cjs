const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { buildCatalog } = require('./build-plugin-catalog.cjs');
const { sha256 } = require('../src/plugin-system/package');
const { download } = require('../src/plugin-system/catalog');

// 使用当前 GitHub CLI 登录或 Actions 的 GH_TOKEN，不保存或打印凭据。
function publish({
    run = (args) => spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 1024 * 1024 }),
    build = () => buildCatalog({ check: true }),
    fetcher = fetch
} = {}) {
    return (async () => {
        const result = build(),
            repo = result.repository,
            tag = result.tag;
        const invoke = (args) => {
            const response = run(args);
            if (response.error) throw response.error;
            if (response.status !== 0) throw Error(response.stderr || 'GitHub 发布命令失败');
            return response.stdout;
        };
        const list = JSON.parse(invoke(['api', `repos/${repo}/releases?per_page=100`]));
        let release = list.find((r) => r.tag_name === tag);
        const notes = path.join(result.output, 'release-notes.md');
        fs.writeFileSync(
            notes,
            'Collectify 官方页面插件。安装方式：设置 → 插件 → 发现插件 → 刷新。\n\n插件包只包含程序，不包含用户数据。\n',
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
                'Collectify 插件',
                '--notes-file',
                notes,
                '--draft',
                '--latest=false'
            ]);
            release = { draft: true, assets: [] };
        }
        for (const plugin of result.plugins) {
            const filename = path.basename(new URL(plugin.url).pathname),
                asset = release.assets.find((a) => a.name === filename);
            if (asset) {
                // 同版本程序包不可覆盖；已有附件必须与本次目录完全一致。
                // 优先使用官方 digest 字段；旧附件通过限量公共下载核验，绝不覆盖不同字节。
                if (asset.digest === `sha256:${plugin.sha256}` && asset.size === plugin.size) continue;
                const data = await download(plugin.url, plugin.size, { fetcher });
                if (data.length !== plugin.size || sha256(data) !== plugin.sha256)
                    throw Error(`已有插件包 ${filename} 与目录不一致，请增加版本号`);
                continue;
            }
            invoke(['release', 'upload', tag, path.join(result.output, filename), '--repo', repo]);
        }
        if (release.draft) invoke(['release', 'edit', tag, '--repo', repo, '--draft=false', '--latest=false']);
        console.log(`插件发布完成：${repo} / ${tag}（${result.plugins.length} 个）`);
        return result;
    })();
}
if (require.main === module)
    publish().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
module.exports = { publish };
