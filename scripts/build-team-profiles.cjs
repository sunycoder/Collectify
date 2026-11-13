const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { validateProfiles } = require('../src/distribution/profiles');
const { validateSnapshot } = require('../src/plugin-system/registry');
function build(directory = path.resolve(__dirname, '../profiles')) {
    const input = JSON.parse(fs.readFileSync(path.join(directory, 'definitions.json'), 'utf8'));
    if (!Array.isArray(input.profiles)) throw Error('profiles/definitions.json 格式不正确');
    const profiles = input.profiles.map((item) => {
        if (typeof item.file !== 'string') throw Error('每个配置需要 file 路径');
        const file = path.resolve(directory, item.file),
            relative = path.relative(directory, file);
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || fs.lstatSync(file).isSymbolicLink())
            throw Error('配置文件必须位于 profiles 目录内');
        const actual = path.relative(fs.realpathSync(directory), fs.realpathSync(file));
        if (actual.startsWith('..') || path.isAbsolute(actual)) throw Error('配置路径经过目录链接越界');
        if (fs.statSync(file).size > 20 * 1024 * 1024) throw Error('团队配置文件超过 20 MB');
        const data = fs.readFileSync(file),
            raw = JSON.parse(data);
        if (raw.format !== 'collectify-workspace' || raw.version !== 2) throw Error('请使用工作台导出文件');
        validateSnapshot({ version: 1, plugins: raw.plugins });
        const { file: _, ...metadata } = item;
        return { ...metadata, size: data.length, sha256: createHash('sha256').update(data).digest('hex') };
    });
    const index = { format: 'collectify-team-profiles', version: 1, profiles };
    validateProfiles(index);
    fs.writeFileSync(path.join(directory, 'index.json'), JSON.stringify(index, null, 2) + '\n', 'utf8');
    return index;
}
if (require.main === module)
    try {
        console.log(`已生成 ${build(process.argv[2]).profiles.length} 个团队配置索引`);
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
module.exports = { build };
