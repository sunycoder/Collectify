const fs = require('node:fs'),
    path = require('node:path');
const defaults = {
    language: 'auto',
    view: 'split',
    wrap: true,
    editable: true,
    ignoreWhitespace: false,
    collapse: false,
    precision: 'advanced',
    fontSize: 13,
    ignoreRules: [],
    ignoreQuotes: false,
    ignoreDashes: false,
    localDrafts: false
};
function preferences(input = {}, base = defaults) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('Diff 偏好格式不正确');
    const next = { ...base };
    for (const key of [
        'wrap',
        'editable',
        'ignoreWhitespace',
        'collapse',
        'ignoreQuotes',
        'ignoreDashes',
        'localDrafts'
    ])
        if (key in input) {
            if (typeof input[key] !== 'boolean') throw Error('Diff 偏好开关无效');
            next[key] = input[key];
        }
    if (input.language !== undefined) {
        if (!/^[a-z][a-z0-9+#-]{0,39}$/.test(input.language)) throw Error('语言无效');
        next.language = input.language;
    }
    for (const [key, allowed] of [
        ['view', ['split', 'unified']],
        ['precision', ['advanced', 'legacy']]
    ])
        if (input[key] !== undefined) {
            if (!allowed.includes(input[key])) throw Error('Diff 偏好枚举无效');
            next[key] = input[key];
        }
    if (input.fontSize !== undefined) {
        if (!Number.isInteger(input.fontSize) || input.fontSize < 10 || input.fontSize > 24)
            throw Error('字号范围为 10–24');
        next.fontSize = input.fontSize;
    }
    if (input.ignoreRules !== undefined) {
        if (
            !Array.isArray(input.ignoreRules) ||
            input.ignoreRules.length > 20 ||
            input.ignoreRules.some((s) => typeof s !== 'string' || !s || s.length > 100)
        )
            throw Error('最多 20 条、每条 100 字的忽略规则');
        next.ignoreRules = [...input.ignoreRules];
    }
    return next;
}
function workspace(input) {
    if (
        !input ||
        typeof input.dirty !== 'boolean' ||
        !Array.isArray(input.texts) ||
        input.texts.length !== 2 ||
        input.texts.some((t) => typeof t !== 'string' || t.length > 2000000) ||
        !Array.isArray(input.names) ||
        input.names.length !== 2 ||
        input.names.some((s) => typeof s !== 'string' || s.length > 150)
    )
        throw Error('Diff 工作副本格式无效');
    if (Buffer.byteLength(JSON.stringify(input)) > 8 * 1024 * 1024)
        throw Error('Diff 工作副本超过 8 MiB，不能保存草稿');
    return {
        dirty: input.dirty,
        texts: [...input.texts],
        names: [...input.names],
        hasOtherEdits: input.hasOtherEdits === true
    };
}
function write(directory, name, data) {
    fs.mkdirSync(directory, { recursive: true });
    const tmp = path.join(directory, name + '.tmp');
    try {
        fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
        fs.renameSync(tmp, path.join(directory, name));
    } finally {
        fs.rmSync(tmp, { force: true });
    }
}
function read(directory, name) {
    try {
        return JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
    } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw Error('Diff 本地数据无法读取，原文件已保留：' + error.message);
    }
}
module.exports = { defaults, preferences, workspace, write, read };
