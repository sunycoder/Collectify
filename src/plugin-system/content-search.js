// 搜索只返回插件声明的展示字段，不读取密码、令牌或任意本机文件。
function fieldValues(value, path) {
    const [head, ...tail] = path.split('.');
    if (head === '*') return Array.isArray(value) ? value.flatMap((item) => fieldValues(item, tail.join('.'))) : [];
    const next = value?.[head];
    return tail.length ? fieldValues(next, tail.join('.')) : typeof next === 'string' ? [next] : [];
}
function matchRecord(item, query, fields, title, route, id) {
    const values = fields.flatMap((field) => fieldValues(item, field));
    const found = values.find((value) => value.toLocaleLowerCase().includes(query));
    if (!found) return null;
    const position = found.toLocaleLowerCase().indexOf(query);
    return {
        id,
        title: String(item[title] || '未命名').slice(0, 160),
        snippet: found.slice(Math.max(0, position - 30), position + 100),
        route,
        payload: { focusId: id }
    };
}
module.exports = { fieldValues, matchRecord };
