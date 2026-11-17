const fs = require('node:fs'),
    path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.resolve(__dirname, '..'),
    source = path.join(root, 'plugins/sources/he-calendar'),
    output = path.join(root, 'src/plugin-library/chinese-calendar');
async function build() {
    const vitePath = path.join(source, 'node_modules/vite/dist/node/index.js');
    if (!fs.existsSync(vitePath)) throw Error('先运行 npm ci --prefix plugins/sources/he-calendar --ignore-scripts');
    const { build } = await import(pathToFileURL(vitePath).href);
    await build({ configFile: path.join(source, 'vite.config.mjs') });
    const esbuild = require('esbuild');
    for (const [entry, filename] of [
        ['src/shared/calendar-core.js', 'calendar-core.cjs'],
        ['src/services/weather-models.js', 'weather-models.cjs'],
        ['src/tool-schemas.js', 'tool-schemas.cjs']
    ]) {
        await esbuild.build({
            entryPoints: [path.join(source, entry)],
            outfile: path.join(output, 'vendor', filename),
            bundle: true,
            platform: 'node',
            format: 'cjs',
            target: 'node22',
            minify: true,
            legalComments: 'inline'
        });
    }
    const licenses = [
        ['tyme4ts', 'LICENSE'],
        ['vue', 'LICENSE'],
        ['@vue/shared', 'LICENSE'],
        ['@vue/reactivity', 'LICENSE'],
        ['@vue/runtime-core', 'LICENSE'],
        ['@vue/runtime-dom', 'LICENSE'],
        ['dayjs', 'LICENSE'],
        ['lucide-vue-next', 'LICENSE']
    ];
    let notices =
        '本插件基于 he-calendar 1.5.2，Copyright (c) 2026 Kayu Tse，MIT License。\n上游提交：b75a5db40e6177a8b4eae9449e85ad02892c5eda\n\n';
    for (const [pkg, file] of licenses)
        notices +=
            '\n----- ' +
            pkg +
            ' -----\n' +
            fs.readFileSync(path.join(source, 'node_modules', pkg, file), 'utf8') +
            '\n';
    notices += '\n----- zod -----\n' + fs.readFileSync(path.join(root, 'node_modules/zod/LICENSE'), 'utf8');
    fs.writeFileSync(path.join(output, 'THIRD-PARTY-NOTICES.txt'), notices, 'utf8');
    console.log('Calendar UI, offline core and lazy MCP schemas built.');
}
build().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
