const fs = require('node:fs');
const path = require('node:path');
const { validateConfig } = require('../src/distribution/config');
function configure(file) {
    const config = validateConfig(JSON.parse(fs.readFileSync(file, 'utf8')));
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
    fs.writeFileSync(path.join(root, 'config', 'distribution.json'), JSON.stringify(config, null, 2) + '\n', 'utf8');
    require('./build-plugin-catalog.cjs').buildCatalog();
    console.log(
        '已配置发布目标并生成插件目录。请核对后提交 definitions.json 和 catalog.json 到目标仓库；部署配置不提交公开仓库。'
    );
}
if (require.main === module)
    try {
        if (process.argv[2] === '--ci') {
            const definition = require('../plugins/definitions.json'),
                publisher = definition.publisher;
            if (publisher) {
                const config = validateConfig({
                    ...publisher,
                    clientId: process.env.COLLECTIFY_OAUTH_CLIENT_ID || '',
                    ref: process.env.COLLECTIFY_CONFIG_REF || 'main'
                });
                fs.writeFileSync(
                    path.resolve(__dirname, '../config/distribution.json'),
                    JSON.stringify(config, null, 2) + '\n',
                    'utf8'
                );
            } else if (process.env.GITHUB_REPOSITORY) {
                const config = validateConfig({
                    provider: 'github',
                    project: process.env.GITHUB_REPOSITORY,
                    clientId: process.env.COLLECTIFY_OAUTH_CLIENT_ID || ''
                });
                fs.writeFileSync(
                    path.resolve(__dirname, '../config/distribution.json'),
                    JSON.stringify(config, null, 2) + '\n',
                    'utf8'
                );
            }
        } else configure(process.argv[2] || path.resolve(__dirname, '../distribution.json'));
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
module.exports = { configure };
