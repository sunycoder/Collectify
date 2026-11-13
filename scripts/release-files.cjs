const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const isInstaller = (name) => /^Collectify.*\.(exe|dmg|AppImage|deb)$/.test(name);
async function cleanup(context) {
    const out = path.resolve(context.outDir),
        latest = (context.artifactPaths || [])
            .filter((file) => isInstaller(path.basename(file)))
            .map((file) => path.resolve(file));
    if (!latest.length) return [];
    for (const file of latest)
        if (!fs.existsSync(file) || fs.statSync(file).size < 1000000) throw Error('新安装包未完整生成，不清理旧包');
    const keep = new Set(latest.map((file) => path.basename(file)));
    for (const name of fs.readdirSync(out)) {
        if (keep.has(name)) continue;
        if (
            isInstaller(name) ||
            /^(?:Env Workbench.*\.exe|Shiye-Setup.*\.exe(?:\.blockmap)?|Collectify.*\.blockmap|builder-debug\.yml)$/.test(
                name
            )
        ) {
            const file = path.resolve(out, name);
            if (path.dirname(file) !== out) throw Error('清理路径越界');
            if (fs.statSync(file).isFile()) fs.unlinkSync(file);
        }
    }
    return [];
}
function archives(directory) {
    if (!fs.existsSync(directory)) return [];
    return fs
        .readdirSync(directory, { withFileTypes: true })
        .flatMap((item) =>
            item.isDirectory()
                ? archives(path.join(directory, item.name))
                : item.name === 'app.asar'
                  ? [path.join(directory, item.name)]
                  : []
        );
}
function verify(directory = path.join(root, 'dist')) {
    const found = archives(directory);
    if (!found.length) throw Error('未找到主程序 app.asar');
    for (const file of found)
        execFileSync(process.execPath, [path.join(root, 'scripts', 'verify-release.cjs'), file], { stdio: 'inherit' });
    if (process.platform === 'win32')
        execFileSync(process.execPath, [path.join(root, 'scripts', 'verify-release.cjs')], { stdio: 'inherit' });
}
function checksums(directory = path.join(root, 'dist')) {
    const files = fs.readdirSync(directory).filter(isInstaller).sort();
    if (!files.length) throw Error('未找到安装包');
    const text =
        files
            .map(
                (name) =>
                    `${createHash('sha256')
                        .update(fs.readFileSync(path.join(directory, name)))
                        .digest('hex')}  ${name}`
            )
            .join('\n') + '\n';
    fs.writeFileSync(path.join(directory, 'SHA256SUMS.txt'), text, 'utf8');
    return files;
}
function checkVersion() {
    const version = require('../package.json').version;
    if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== 'v' + version)
        throw Error('标签必须与 package.json 版本一致');
    return version;
}
if (require.main === module) {
    try {
        if (process.argv[2] === 'verify') verify();
        else if (process.argv[2] === 'checksums') console.log('已生成校验文件：' + checksums().join('、'));
        else if (process.argv[2] === 'check-version') console.log(checkVersion());
        else throw Error('用法：node scripts/release-files.cjs verify|checksums|check-version');
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}
module.exports = { cleanup, checksums, isInstaller, checkVersion };
