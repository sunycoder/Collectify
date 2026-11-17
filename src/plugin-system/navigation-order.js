const { pluginId } = require('./manifest');
function validateOrder(value) {
    if (!Array.isArray(value) || value.length > 200 || new Set(value).size !== value.length)
        throw Error('插件顺序必须为最多 200 个不重复的插件 ID');
    for (const id of value) pluginId(id);
    return [...value];
}
module.exports = { validateOrder };
