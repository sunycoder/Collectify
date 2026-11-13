const { Store } = require('./legacy-store');
const { EntityRepository } = require('./entity-repository');
const { validateTask, validateNote } = require('../tasks/model');
const { AsyncLocalStorage } = require('node:async_hooks');
const { randomUUID } = require('node:crypto');

function createStore(file, definition, seed = {}) {
    const store = Object.create(Store.prototype);
    const audit = new AsyncLocalStorage();
    store.withAudit = (name, action) => audit.run(name, action);
    store.file = file;
    store.repository = new EntityRepository(file, definition);
    store.commit = function (data) {
        const clean = this.validate(data);
        for (const entry of clean.entries || []) entry.password ??= '';
        this.repository.write(clean, audit.getStore());
        this.data = clean;
    };
    const base = {
        version: 2,
        categories: [],
        entries: [],
        tasks: [],
        notes: [],
        settings: {},
        configSource: 'local',
        sourceName: ''
    };
    if (definition.validate) store.validate = (data) => definition.validate(data);
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
module.exports = { createStore, validateCollection, validateTask, validateNote, randomUUID };
