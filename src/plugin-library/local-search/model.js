const path = require('node:path');
const FILTERS = [
    { id: 'all', label: '全部', extensions: [] },
    { id: 'folder', label: '文件夹', extensions: [] },
    { id: 'sheet', label: '表格', extensions: ['xls', 'xlsx', 'csv'] },
    { id: 'word', label: '文档', extensions: ['doc', 'docx'] },
    { id: 'presentation', label: '演示文稿', extensions: ['ppt', 'pptx'] },
    { id: 'pdf', label: 'PDF', extensions: ['pdf'] },
    { id: 'image', label: '图片', extensions: ['png', 'jpg', 'jpeg', 'bmp', 'gif', 'svg', 'ico', 'webp', 'psd', 'ai'] },
    { id: 'video', label: '视频', extensions: ['mp4', 'ogv', 'ogm', 'webm'] },
    { id: 'audio', label: '音频', extensions: ['flac', 'm4a', 'mp3', 'ogg', 'oga', 'opus', 'wav'] },
    { id: 'archive', label: '压缩文件', extensions: ['zip', 'gz', '7z', 'rar', 'tar', 'bz2', 'xz'] },
    {
        id: 'text',
        label: '文本与代码',
        extensions: [
            'txt',
            'md',
            'json',
            'js',
            'ts',
            'java',
            'go',
            'xml',
            'yaml',
            'yml',
            'css',
            'html',
            'log',
            'ini',
            'sql',
            'csv'
        ]
    }
];
const SORTS = { modified: 'date-modified-descending', name: 'name-ascending', size: 'size-descending' };
function preferences(value = {}) {
    const filters = Array.isArray(value.filters) ? value.filters : [];
    const used = new Set(),
        result = [];
    for (const entry of [FILTERS[0], ...filters, ...FILTERS]) {
        if (!entry || typeof entry.id !== 'string' || used.has(entry.id)) continue;
        const builtin = FILTERS.find((item) => item.id === entry.id);
        if (!builtin && !/^custom-[a-z0-9-]{1,40}$/.test(entry.id)) continue;
        const extensions = builtin?.extensions || entry.extensions;
        if (!Array.isArray(extensions) || extensions.length > 40 || extensions.some((ext) => !/^\w{1,15}$/.test(ext)))
            continue;
        used.add(entry.id);
        result.push({
            id: entry.id,
            label: builtin?.label || String(entry.label || '自定义').slice(0, 30),
            extensions,
            enabled: entry.id === 'all' || entry.enabled !== false
        });
        if (result.length >= 30) break;
    }
    const all = result.find((entry) => entry.id === 'all');
    return {
        filters: [all, ...result.filter((entry) => entry.id !== 'all')],
        preview: value.preview !== false,
        sort: Object.hasOwn(SORTS, value.sort) ? value.sort : 'modified',
        engine: value.engine === 'folder' ? 'folder' : 'everything'
    };
}
function matches(file, query, filter) {
    if (filter?.id === 'folder' && !file.directory) return false;
    if (
        filter?.extensions.length &&
        (file.directory || !filter.extensions.includes(path.extname(file.path).slice(1).toLowerCase()))
    )
        return false;
    const haystack = file.path.toLocaleLowerCase();
    return query
        .trim()
        .toLocaleLowerCase()
        .split(/\s+/)
        .every((word) => haystack.includes(word));
}
function csv(text) {
    const rows = [];
    let row = [],
        cell = '',
        quoted = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (c === '"') {
            if (quoted && text[i + 1] === '"') {
                cell += '"';
                i++;
            } else quoted = !quoted;
        } else if (c === ',' && !quoted) {
            row.push(cell);
            cell = '';
        } else if ((c === '\n' || c === '\r') && !quoted) {
            if (c === '\r' && text[i + 1] === '\n') i++;
            row.push(cell);
            if (row.some(Boolean)) rows.push(row);
            row = [];
            cell = '';
        } else cell += c;
    }
    if (cell || row.length) {
        row.push(cell);
        rows.push(row);
    }
    return rows;
}
function queryText(query, filter) {
    // 默认是文件名/路径关键词，不把用户关键词当成 ES 命令或搜索语法。
    const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const words = query.replaceAll('"', '').trim().split(/\s+/).filter(Boolean);
    return (
        '^' +
        words.map((word) => '(?=.*' + escape(word) + ')').join('') +
        '.*' +
        (filter?.extensions.length ? '\\.(' + filter.extensions.map(escape).join('|') + ')$' : '')
    );
}
module.exports = { FILTERS, SORTS, preferences, matches, csv, queryText };
