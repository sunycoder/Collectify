const fs = require('node:fs');
const path = require('node:path');
const { validateConfig } = require('../src/distribution/config');
function configure(file = path.resolve(__dirname, '../config/app-defaults.json')) {
    const input = JSON.parse(fs.readFileSync(file, 'utf8'));
    const config = validateConfig(input.distribution);
    const root = path.resolve(__dirname, '..'),
        definitionFile = path.join(root, 'plugins', 'definitions.json');
    const definition = JSON.parse(fs.readFileSync(definitionFile, 'utf8'));
    if (config.provider === 'gitlab')
        definition.publisher = {
            provider: 'gitlab',
            baseUrl: config.baseUrl,
            project: config.project,
            allowInsecureHttp: config.allowInsecureHttp
        };
    else {
        delete definition.publisher;
        definition.repository = config.project;
    }
    fs.writeFileSync(definitionFile, JSON.stringify(definition, null, 2) + '\n', 'utf8');
    const appFile = path.join(root, 'config', 'app-defaults.json');
    const appDefaults = JSON.parse(fs.readFileSync(appFile, 'utf8'));
    appDefaults.distribution = config;
    fs.writeFileSync(appFile, JSON.stringify(appDefaults, null, 2) + '\n', 'utf8');
    require('./build-plugin-catalog.cjs').buildCatalog();
    console.log('已从 app-defaults.json 同步发布目标并生成插件目录，请核对后提交到对应仓库。');
}
if (require.main === module)
    try {
        if (process.argv[2] === '--ci') {
            configureCI();
        } else configure(process.argv[2]);
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
function configureCI({ root = path.resolve(__dirname, '..'), env = process.env } = {}) {
    const appFile = path.join(root, 'config', 'app-defaults.json');
    const value = JSON.parse(fs.readFileSync(appFile, 'utf8'));
    const definition = JSON.parse(fs.readFileSync(path.join(root, 'plugins', 'definitions.json'), 'utf8'));
    const target =
        definition.publisher ||
        (env.GITHUB_REPOSITORY
            ? { provider: 'github', baseUrl: 'https://github.com', project: env.GITHUB_REPOSITORY }
            : value.distribution);
    const same =
        value.distribution.provider === target.provider &&
        value.distribution.baseUrl === target.baseUrl &&
        value.distribution.project === target.project;
    value.distribution = validateConfig({
        ...value.distribution,
        ...target,
        clientId: env.COLLECTIFY_OAUTH_CLIENT_ID || (same ? value.distribution.clientId : ''),
        ref: env.COLLECTIFY_CONFIG_REF || value.distribution.ref
    });
    fs.writeFileSync(appFile, JSON.stringify(value, null, 2) + '\n', 'utf8');
}
module.exports = { configure, configureCI };
