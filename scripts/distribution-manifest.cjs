const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
function generate({ directory, version, notes, assetUrl }) {
    const files = fs
        .readdirSync(directory)
        .sort()
        .flatMap((name) => {
            const match = name.match(
                /^Collectify-[\d.]+-(windows|macos|linux)-(x64|arm64|amd64|x86_64)(?:-setup)?\.(exe|dmg|deb|AppImage)$/
            );
            if (!match) return [];
            if (!name.startsWith(`Collectify-${version}-`)) throw Error('安装包与发布版本不一致：' + name);
            const data = fs.readFileSync(path.join(directory, name));
            return [
                {
                    name,
                    platform: { windows: 'win32', macos: 'darwin', linux: 'linux' }[match[1]],
                    arch: ['amd64', 'x86_64'].includes(match[2]) ? 'x64' : match[2],
                    size: data.length,
                    sha256: createHash('sha256').update(data).digest('hex'),
                    url: assetUrl(name)
                }
            ];
        });
    if (!files.length) throw Error('没有可发布的安装包');
    const value = { format: 'collectify-app-update', schemaVersion: 1, version, notes, files };
    fs.writeFileSync(path.join(directory, 'collectify-update.json'), JSON.stringify(value, null, 2) + '\n', 'utf8');
    return value;
}
module.exports = { generate };
