const { EntityRepository } = require('./entity-repository');
const { AsyncLocalStorage } = require('node:async_hooks');
const { randomUUID } = require('node:crypto');

function createStore(file, definition, seed = {}) {
    if (typeof definition.validate !== 'function') throw Error('插件必须声明领域校验器');
    const store = Object.create(definition.methods || null);
    const audit = new AsyncLocalStorage();
    store.withAudit = (name, action) => audit.run(name, action);
    store.file = file;
    store.snapshot = function () {
        return structuredClone(this.data);
    };
    store.validate = definition.validate;
    store.repository = new EntityRepository(file, definition);
    store.commit = function (data) {
        const clean = this.validate(data);
        definition.prepareCommit?.(clean);
        this.repository.write(clean, audit.getStore(), this.data);
        this.data = clean;
    };
    // 仅供插件后台调用；业务模型在进入此方法前完成单条校验。
    // 事务成功后才替换内存数组，失败时原记录和排序均保持不变。
    store.updateEntities = function (table, items) {
        if (!definition.tables[table] || !Array.isArray(items) || !items.length) throw Error('实体更新参数无效');
        const current = this.data[table],
            positions = new Map(current.map((item, i) => [item.id, i]));
        const next = [...current],
            seen = new Set(),
            writes = [];
        for (const item of items) {
            if (!item || typeof item.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(item.id) || seen.has(item.id))
                throw Error('实体 ID 无效或重复');
            seen.add(item.id);
            const position = positions.has(item.id) ? positions.get(item.id) : next.length;
            next[position] = item;
            writes.push({ item, position });
        }
        if (next.length > (definition.tables[table].limit || 5000)) throw Error('插件数据超过数量限制');
        this.repository.patch(table, writes, audit.getStore());
        this.data = { ...this.data, [table]: next };
    };
    store.removeItem = function (table, id) {
        if (!definition.tables[table] || !this.data[table].some((item) => item.id === id)) throw Error('内容不存在');
        // 删除后的排序连续性仍由完整集合提交维护，避免下一次新增复用排序位置。
        this.commit({ ...this.data, [table]: this.data[table].filter((item) => item.id !== id) });
    };
    const base = {
        version: 2,
        ...Object.fromEntries(Object.keys(definition.tables).map((table) => [table, []])),
        settings: {},
        configSource: 'local',
        sourceName: ''
    };
    if (definition.project) {
        const validate = store.validate.bind(store);
        store.validate = (data) => definition.project(validate(data));
    }
    const existing = store.repository.read();
    if (existing) store.data = store.validate({ ...base, ...existing });
    else store.commit({ ...base, ...seed });
    return store;
}
function validateCollection(data, field, validator) {
    const items = (data[field] || []).map(validator);
    if (
        items.length > 5000 ||
        new Set(items.map((v) => v.id)).size !== items.length ||
        items.some((v) => !v.id || !/^[a-zA-Z0-9-]{1,80}$/.test(v.id))
    )
        throw Error('插件数据 ID 不正确或重复');
    return { version: 2, [field]: items, settings: data.settings || {} };
}
module.exports = { createStore, validateCollection, randomUUID };
