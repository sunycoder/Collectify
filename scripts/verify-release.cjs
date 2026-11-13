const fs = require('node:fs'),
    path = require('node:path'),
    assert = require('node:assert/strict');
const asar = require('@electron/asar');
const root = path.resolve(__dirname, '..'),
    archive = process.argv[2]
        ? path.resolve(process.argv[2])
        : path.join(root, 'dist', 'win-unpacked', 'resources', 'app.asar');
function files(directory) {
    return (
        fs
            .readdirSync(path.join(root, directory), { withFileTypes: true })
            .filter((item) => path.join(directory, item.name) !== path.join('src', 'plugin-library'))
            // 构建器不打包 Git 元数据；其余业务源码、第三方库和原生组件仍逐字节核对。
            .filter((item) => !['.gitignore', '.gitattributes', '.gitkeep'].includes(item.name))
            .flatMap((item) =>
                item.isDirectory() ? files(path.join(directory, item.name)) : [path.join(directory, item.name)]
            )
    );
}
for (const relative of [...files('src'), ...files('assets'), ...files('config')]) {
    assert.ok(
        asar.extractFile(archive, path.join(...relative.split('/'))).equals(fs.readFileSync(path.join(root, relative))),
        `发布文件与源码不同：${relative}`
    );
}
const pkg = JSON.parse(asar.extractFile(archive, 'package.json'));
assert.equal(
    asar.listPackage(archive).some((file) => /[\\/]plugin-library[\\/]/.test(file)),
    false,
    '市场插件程序不能随宿主打包'
);
assert.ok(
    asar
        .extractFile(archive, path.join('assets', '设置 .svg'))
        .equals(fs.readFileSync(path.join(root, 'assets', '设置 .svg'))),
    '设置 SVG 与指定源文件不一致'
);
assert.equal(pkg.name, 'collectify');
assert.equal(pkg.version, require('../package.json').version);
if (process.argv[2]) {
    console.log(
        'Archive verified: complete host, plugin pages, native services, SDK, shared modules and assets match source.'
    );
    process.exit(0);
}
const ico = fs.readFileSync(path.join(root, 'assets', 'icon.ico'));
const images = Array.from({ length: ico.readUInt16LE(4) }, (_, i) => ({
    size: ico.readUInt32LE(6 + i * 16 + 8),
    offset: ico.readUInt32LE(6 + i * 16 + 12)
})).sort((a, b) => b.size - a.size);
const largest = images[0],
    executable = fs.readFileSync(path.join(root, 'dist', 'win-unpacked', 'Collectify.exe'));
assert.ok(executable.includes(ico.subarray(largest.offset, largest.offset + largest.size)), 'EXE 未嵌入统一图标');
assert.deepEqual(
    fs.readdirSync(path.join(root, 'dist')).filter((file) => file.endsWith('.exe')),
    [`Collectify-${pkg.version}-windows-x64-setup.exe`]
);
console.log(
    `Release verified: Collectify ${pkg.version}, source/archive consistency, canonical icon, one latest installer.`
);
