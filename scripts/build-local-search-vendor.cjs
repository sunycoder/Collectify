const fs = require('node:fs'),
    path = require('node:path'),
    cp = require('node:child_process');
const root = path.resolve(__dirname, '..'),
    deps = path.join(root, 'build-tools', 'local-search-deps', 'node_modules'),
    vendor = path.join(root, 'src', 'plugins', 'local-search', 'vendor');
const sheet = path.join(root, 'build-tools', 'sheetjs', 'package', 'xlsx.js');
if (!fs.existsSync(sheet)) throw Error('请先将官方 SheetJS 0.20.3 tarball 解压到 build-tools/sheetjs');
const bundled = require('esbuild').buildSync({
    entryPoints: [path.join(root, 'src', 'plugins', 'local-search', 'preview-worker.js')],
    outfile: path.join(vendor, 'preview-worker.cjs'),
    bundle: true,
    platform: 'node',
    target: 'node24',
    nodePaths: [deps],
    alias: { xlsx: sheet },
    metafile: true,
    logOverride: { 'unreachable-code': 'silent' }
});
const licenseRoot = path.join(vendor, 'dependency-licenses');
fs.mkdirSync(licenseRoot, { recursive: true });
const seen = new Set();
for (const name of Object.keys(bundled.metafile.inputs)) {
    let directory = path.dirname(path.resolve(root, name));
    while (directory !== path.dirname(directory)) {
        const manifest = path.join(directory, 'package.json');
        if (fs.existsSync(manifest)) {
            const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
            if (pkg.name && !seen.has(pkg.name)) {
                seen.add(pkg.name);
                for (const file of fs
                    .readdirSync(directory)
                    .filter((file) => /^(license|licence|copying|notice)(\.|$)/i.test(file)))
                    if (fs.statSync(path.join(directory, file)).isFile())
                        fs.copyFileSync(
                            path.join(directory, file),
                            path.join(licenseRoot, pkg.name.replaceAll('/', '-') + '-' + file)
                        );
            }
            break;
        }
        directory = path.dirname(directory);
    }
}
for (const file of ['pdf.js', 'pdf.worker.js'])
    fs.copyFileSync(path.join(deps, 'pdfjs-dist', 'legacy', 'build', file), path.join(vendor, file));
for (const [name, file] of [
    ['mammoth', 'LICENSE'],
    ['ag-psd', 'LICENSE'],
    ['fflate', 'LICENSE'],
    ['pdfjs-dist', 'LICENSE']
])
    fs.copyFileSync(path.join(deps, name, file), path.join(vendor, name + '.LICENSE'));
fs.copyFileSync(path.join(root, 'build-tools', 'sheetjs', 'package', 'LICENSE'), path.join(vendor, 'sheetjs.LICENSE'));
console.log('Local search preview dependencies bundled.');
