const { randomUUID } = require('node:crypto');
function string(value, max = 10000) {
    if (typeof value !== 'string') return '';
    if (value.length > max) throw new Error('内容过长');
    return value.trim();
}

function date(value) {
    if (!value) return '';
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw new Error('日期不正确');
    return new Date(value).toISOString();
}

function validateNote(input) {
    return {
        id: input.id || randomUUID(),
        title: string(input.title, 120) || '未命名便签',
        content: string(input.content, 30000),
        color: ['yellow', 'blue', 'pink', 'green'].includes(input.color) ? input.color : 'yellow',
        updatedAt: date(input.updatedAt) || new Date().toISOString()
    };
}

module.exports = { validateNote };
