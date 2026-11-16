const path = require('node:path');
require('esbuild')
    .build({
        entryPoints: [path.join(__dirname, '..', 'src', 'mcp-service.js')],
        bundle: true,
        external: ['./app-defaults'],
        plugins: [
            {
                name: 'runtime-defaults',
                setup(build) {
                    build.onResolve({ filter: /^\.\/app-defaults$/ }, () => ({
                        path: '../app-defaults',
                        external: true
                    }));
                }
            }
        ],
        preserveSymlinks: true,
        platform: 'node',
        format: 'cjs',
        target: 'node22',
        outfile: path.join(__dirname, '..', 'src', 'vendor', 'mcp-service.cjs')
    })
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
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
