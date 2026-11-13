const path = require('node:path');
require('esbuild').buildSync({
    entryPoints: [path.join(__dirname, '..', 'src', 'mcp-service.js')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    outfile: path.join(__dirname, '..', 'src', 'vendor', 'mcp-service.cjs')
});
const fs = require('node:fs');
for (const [pkg, license] of [
    ['@modelcontextprotocol/sdk', 'LICENSE'],
    ['zod', 'LICENSE']
]) {
    const root = path.join(__dirname, '..');
    fs.copyFileSync(
        path.join(root, 'node_modules', pkg, license),
        path.join(root, 'src', 'vendor', pkg.replaceAll('/', '-') + '.LICENSE')
    );
}
