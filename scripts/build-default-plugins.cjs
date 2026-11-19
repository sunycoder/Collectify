const fs = require('node:fs'),
    path = require('node:path');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
const names = ['bookmarks', 'tasks', 'notes', 'timestamp', 'json'];
const output = path.join(root, 'src/default-packages');
async function buildDefaultPlugins({ check = false } = {}) {
    fs.mkdirSync(output, { recursive: true });
    for (const name of names) {
        const source = path.join(root, 'src/plugins', name),
            target = path.join(output, 'collectify.' + name);
        const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json'), 'utf8'));
        const files = new Map();
        function walk(dir, prefix = '') {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                if (entry.name.startsWith('.')) continue;
                const relative = prefix + entry.name;
                if (entry.isDirectory()) walk(path.join(dir, entry.name), relative + '/');
                else files.set(relative, fs.readFileSync(path.join(dir, entry.name)));
            }
        }
        walk(source);
        if (manifest.backend) {
            const hostModules = {
                'src/vendor/mcp-service.cjs': 'mcp',
                'src/plugin-system/storage.js': 'storage',
                'src/plugin-system/request-contract.js': 'contracts',
                'src/plugin-system/urls.js': 'urls',
                'src/window-lifecycle.js': 'windows',
                'src/auxiliary-window.js': 'auxiliary',
                'src/clipboard-service.js': 'clipboard'
            };
            const built = await esbuild.build({
                entryPoints: [path.join(source, manifest.backend)],
                bundle: true,
                platform: 'node',
                format: 'cjs',
                target: 'node24',
                write: false,
                external: ['electron'],
                legalComments: 'none',
                plugins: [
                    {
                        name: 'host-contract',
                        setup(build) {
                            build.onResolve({ filter: /^\./ }, (args) => {
                                const file = path
                                    .relative(root, path.resolve(args.resolveDir, args.path))
                                    .split(path.sep)
                                    .join('/');
                                const key =
                                    hostModules[file] || hostModules[file + '.js'] || hostModules[file + '.cjs'];
                                return key ? { path: 'collectify-host:' + key, external: true } : undefined;
                            });
                        }
                    }
                ]
            });
            let code = built.outputFiles[0].text;
            // 仅宿主公共接口留在包外，所有业务模型、仓储和校验代码都打入插件自身。
            for (const [file, key] of Object.entries(hostModules)) {
                code = code.split(`require("collectify-host:${key}")`).join(`hostSdk.${key}`);
            }
            const hostRequire = `const hostSdk = require(require('node:path').join(require('electron').app.getAppPath(),'src/plugin-system/backend-sdk.js'));\n`;
            files.set('backend.cjs', Buffer.from(hostRequire + code));
            manifest.backend = 'backend.cjs';
            manifest.runtime = 'native';
            manifest.permissions = [...new Set([...manifest.permissions, 'native'])];
        }
        if (name === 'tasks') {
            for (const file of [
                'vendor/tom-select.css',
                'vendor/flatpickr.css',
                'office-ui.css',
                'interaction-fixes.css',
                'glass-material.css',
                'vendor/tom-select.js',
                'vendor/flatpickr.js',
                'vendor/flatpickr-zh.js',
                'vendor/floating-ui.js',
                'overlay.js',
                'theme.js',
                'ui-components.js'
            ])
                files.set('shared/' + file, fs.readFileSync(path.join(root, 'src', file)));
            files.set('widget.html', Buffer.from(files.get('widget.html').toString().replaceAll('../../', 'shared/')));
            for (const license of [
                'tom-select.LICENSE',
                'flatpickr.LICENSE',
                'floating-ui-dom.LICENSE',
                'floating-ui-core.LICENSE',
                'floating-ui-utils.LICENSE'
            ])
                files.set('shared/vendor/' + license, fs.readFileSync(path.join(root, 'src/vendor', license)));
        }
        files.set('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
        let changed = !fs.existsSync(target);
        for (const [file, data] of files)
            if (!fs.existsSync(path.join(target, file)) || !fs.readFileSync(path.join(target, file)).equals(data))
                changed = true;
        if (changed) {
            if (check) throw Error(`默认插件构建不同步：${name}，请运行 npm run defaults:build`);
            fs.mkdirSync(target, { recursive: true });
            for (const [file, data] of files) {
                fs.mkdirSync(path.dirname(path.join(target, file)), { recursive: true });
                fs.writeFileSync(path.join(target, file), data);
            }
            require('./sign-native-plugin.cjs').signPlugin(
                target,
                path.join(root, 'build-tools/publisher/collectify-ed25519.pem')
            );
        }
        require('../src/plugin-system/native-signature').verifyDirectory(target);
    }
    return output;
}
if (require.main === module)
    buildDefaultPlugins({ check: process.argv.includes('--check') })
        .then(() => console.log('五个默认安装插件已构建并验证签名。'))
        .catch((error) => {
            console.error(error);
            process.exitCode = 1;
        });
module.exports = { buildDefaultPlugins };
