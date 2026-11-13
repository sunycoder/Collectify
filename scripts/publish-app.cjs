const fs = require('node:fs'),
    path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { checkVersion } = require('./release-files.cjs');
function publishApp() {
    const version = checkVersion(),
        tag = 'v' + version,
        repo = 'sunycoder/Collectify',
        out = path.resolve(__dirname, '../dist'),
        notes = path.resolve(__dirname, '../docs/releases', version + '.md');
    if (!fs.existsSync(notes)) throw Error('缺少当前版本发布说明');
    // 下载入口必须对应本次真实产物，避免平台打包器转换架构名称后留下失效链接。
    const readme = fs.readFileSync(path.resolve(__dirname, '../README.md'), 'utf8');
    for (const match of readme.matchAll(/releases\/download\/([^/]+)\/(Collectify-[^\s)]+)/g)) {
        if (match[1] === tag && !fs.existsSync(path.join(out, match[2])))
            throw Error('README 下载链接没有对应安装包：' + match[2]);
    }
    function gh(args) {
        const result = spawnSync('gh', args, { encoding: 'utf8', windowsHide: true });
        if (result.error) throw result.error;
        if (result.status !== 0) throw Error(result.stderr || '发布失败');
        return result.stdout;
    }
    const releases = JSON.parse(gh(['api', `repos/${repo}/releases?per_page=100`]));
    let release = releases.find((item) => item.tag_name === tag);
    if (!release) {
        gh([
            'release',
            'create',
            tag,
            '--repo',
            repo,
            '--title',
            'Collectify ' + version,
            '--notes-file',
            notes,
            '--draft',
            '--latest=false'
        ]);
        release = { draft: true, assets: [] };
    }
    for (const name of fs
        .readdirSync(out)
        .filter((name) => /^Collectify.*\.(exe|dmg|deb|AppImage)$/.test(name) || name === 'SHA256SUMS.txt')) {
        const file = path.join(out, name),
            digest = 'sha256:' + createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
            prior = release.assets.find((asset) => asset.name === name);
        if (prior) {
            if (prior.digest !== digest) throw Error('已存在同名不同内容的附件，请提高版本号：' + name);
            continue;
        }
        if (!release.draft) throw Error('正式版本不补写新附件，请发布新版本');
        gh(['release', 'upload', tag, file, '--repo', repo]);
    }
    if (release.draft) gh(['release', 'edit', tag, '--repo', repo, '--draft=false', '--latest']);
    console.log('主程序发布完成：' + tag);
}
if (require.main === module)
    try {
        publishApp();
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
module.exports = { publishApp };
