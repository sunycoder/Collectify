const hostSdk = require(require('node:path').join(require('electron').app.getAppPath(),'src/plugin-system/backend-sdk.js'));
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// src/plugins/.shared/entity-repository.js
var require_entity_repository = __commonJS({
  "src/plugins/.shared/entity-repository.js"(exports2, module2) {
    var fs2 = require("node:fs");
    var path2 = require("node:path");
    var { DatabaseSync } = require("node:sqlite");
    var { ensureStorageSchema } = hostSdk.storage;
    var EntityRepository = class {
      constructor(file, { id, schema, tables, attachments = false }) {
        Object.assign(this, { file, id, schema, tables, attachments });
        fs2.mkdirSync(path2.dirname(file), { recursive: true });
        this.database((db) => {
          ensureStorageSchema(db);
          db.exec("CREATE TABLE IF NOT EXISTS domain_schema(id TEXT PRIMARY KEY,version INTEGER NOT NULL) STRICT");
          const row = db.prepare("SELECT * FROM domain_schema").get();
          if (row && (row.id !== id || row.version > 1)) throw Error("\u63D2\u4EF6\u9886\u57DF\u6570\u636E\u5E93\u8EAB\u4EFD\u6216\u7248\u672C\u4E0D\u5339\u914D");
          db.exec("BEGIN");
          try {
            db.exec(schema);
            db.exec(
              "CREATE TABLE IF NOT EXISTS domain_state(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,payload TEXT NOT NULL) STRICT;CREATE TABLE IF NOT EXISTS domain_audit(id INTEGER PRIMARY KEY,tool TEXT NOT NULL,created_at TEXT NOT NULL) STRICT;PRAGMA user_version=1"
            );
            if (!row) db.prepare("INSERT INTO domain_schema VALUES(?,1)").run(id);
            db.exec("COMMIT");
          } catch (error) {
            db.exec("ROLLBACK");
            throw error;
          }
        });
      }
      database(action) {
        const db = new DatabaseSync(this.file);
        try {
          db.exec("PRAGMA foreign_keys=ON;PRAGMA busy_timeout=5000;PRAGMA journal_mode=WAL");
          return action(db);
        } finally {
          db.close();
        }
      }
      read() {
        return this.database((db) => {
          db.exec("BEGIN");
          try {
            const state = db.prepare("SELECT * FROM domain_state WHERE id=1").get();
            this.revision = state?.revision || 0;
            if (!state) {
              db.exec("COMMIT");
              return null;
            }
            const data = JSON.parse(state.payload);
            for (const [table, d] of Object.entries(this.tables))
              data[table] = db.prepare(`SELECT * FROM ${table} ORDER BY sort_order,id`).all().map(
                (row) => Object.fromEntries(
                  Object.entries(d.fields).map(([field, col]) => [
                    field,
                    d.booleans?.includes(field) ? !!row[col] : row[col] ?? ""
                  ])
                )
              );
            if (this.attachments) {
              const relation = this.attachments;
              const rows = db.prepare(`SELECT * FROM ${relation.table} ORDER BY ${relation.position}`).all();
              const byOwner = /* @__PURE__ */ new Map();
              for (const row of rows) {
                const items = byOwner.get(row[relation.foreignKey]) || [];
                items.push(row[relation.value]);
                byOwner.set(row[relation.foreignKey], items);
              }
              for (const item of data[relation.owner]) item[relation.field] = byOwner.get(item.id) || [];
            }
            db.exec("COMMIT");
            return data;
          } catch (error) {
            db.exec("ROLLBACK");
            throw error;
          }
        });
      }
      upsert(db, table, writes) {
        const d = this.tables[table];
        if (!d) throw Error("\u63D2\u4EF6\u5B9E\u4F53\u8868\u4E0D\u5B58\u5728");
        if (!writes.length) return;
        if (d.nameKey) {
          const reserve = db.prepare(`UPDATE ${table} SET name_key=? WHERE id=?`);
          for (const { item } of writes) reserve.run(`reserved:${item.id}`, item.id);
        }
        const columns = [...Object.values(d.fields), ...d.nameKey ? ["name_key"] : [], "sort_order"];
        const update = columns.filter((c) => c !== "id").map((c) => `${c}=excluded.${c}`).join(",");
        const statement = db.prepare(
          `INSERT INTO ${table}(${columns.join(",")}) VALUES(${columns.map(() => "?").join(",")}) ON CONFLICT(id) DO UPDATE SET ${update}`
        );
        for (const { item, position } of writes) {
          statement.run(
            ...Object.keys(d.fields).map(
              (field) => d.booleans?.includes(field) ? Number(!!item[field]) : d.nullable?.includes(field) ? item[field] || null : item[field] ?? ""
            ),
            ...d.nameKey ? [item.name.toLocaleLowerCase()] : [],
            position
          );
          if (this.attachments && table === this.attachments.owner) {
            const relation = this.attachments;
            db.prepare(`DELETE FROM ${relation.table} WHERE ${relation.foreignKey}=?`).run(item.id);
            const attach = db.prepare(
              `INSERT INTO ${relation.table}(${relation.foreignKey},${relation.position},${relation.value}) VALUES(?,?,?)`
            );
            (item[relation.field] || []).forEach((value, i) => attach.run(item.id, i, value));
          }
        }
      }
      transaction(tool, action) {
        this.database((db) => {
          db.exec("BEGIN IMMEDIATE");
          try {
            const revision = db.prepare("SELECT revision FROM domain_state WHERE id=1").get()?.revision || 0;
            if (revision !== this.revision) throw Error("\u63D2\u4EF6\u6570\u636E\u5E93\u5DF2\u88AB\u5176\u4ED6\u5B9E\u4F8B\u66F4\u65B0\uFF0C\u8BF7\u91CD\u542F\u91CD\u8BD5");
            const entities = action(db);
            db.prepare("UPDATE domain_state SET revision=? WHERE id=1").run(revision + 1);
            if (tool)
              db.prepare("INSERT INTO domain_audit(tool,created_at) VALUES(?,?)").run(
                tool,
                (/* @__PURE__ */ new Date()).toISOString()
              );
            db.exec("COMMIT");
            this.revision = revision + 1;
            this.lastWrite = { entities };
          } catch (error) {
            db.exec("ROLLBACK");
            throw error;
          }
        });
      }
      patch(table, writes, tool) {
        this.transaction(tool, (db) => {
          this.upsert(db, table, writes);
          return writes.length;
        });
      }
      write(data, tool, previous) {
        this.transaction(tool, (db) => {
          let entities = 0;
          for (const table of Object.keys(this.tables).reverse()) {
            const keep = new Set(data[table].map((v) => v.id)), remove = db.prepare(`DELETE FROM ${table} WHERE id=?`);
            for (const row of previous?.[table] || db.prepare(`SELECT id FROM ${table}`).all())
              if (!keep.has(row.id)) remove.run(row.id);
          }
          for (const table of Object.keys(this.tables)) {
            const old = new Map((previous?.[table] || []).map((item, position) => [item.id, { item, position }]));
            const writes = data[table].flatMap((item, position) => {
              const prior = old.get(item.id);
              return prior && prior.position === position && JSON.stringify(prior.item) === JSON.stringify(item) ? [] : [{ item, position }];
            });
            this.upsert(db, table, writes);
            entities += writes.length;
          }
          const metadata = { ...data };
          for (const table of Object.keys(this.tables)) delete metadata[table];
          db.prepare(
            "INSERT INTO domain_state VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,payload=excluded.payload"
          ).run(this.revision + 1, JSON.stringify(metadata));
          return entities;
        });
      }
    };
    module2.exports = { EntityRepository };
  }
});

// src/plugins/.shared/domain-store.js
var require_domain_store = __commonJS({
  "src/plugins/.shared/domain-store.js"(exports2, module2) {
    var { EntityRepository } = require_entity_repository();
    var { AsyncLocalStorage } = require("node:async_hooks");
    var { randomUUID } = require("node:crypto");
    function createStore2(file, definition2, seed2 = {}) {
      if (typeof definition2.validate !== "function") throw Error("\u63D2\u4EF6\u5FC5\u987B\u58F0\u660E\u9886\u57DF\u6821\u9A8C\u5668");
      const store = Object.create(definition2.methods || null);
      const audit = new AsyncLocalStorage();
      store.withAudit = (name, action) => audit.run(name, action);
      store.file = file;
      store.snapshot = function() {
        return structuredClone(this.data);
      };
      store.validate = definition2.validate;
      store.repository = new EntityRepository(file, definition2);
      store.commit = function(data) {
        const clean = this.validate(data);
        definition2.prepareCommit?.(clean);
        this.repository.write(clean, audit.getStore(), this.data);
        this.data = clean;
      };
      store.updateEntities = function(table, items) {
        if (!definition2.tables[table] || !Array.isArray(items) || !items.length) throw Error("\u5B9E\u4F53\u66F4\u65B0\u53C2\u6570\u65E0\u6548");
        const current = this.data[table], positions = new Map(current.map((item, i) => [item.id, i]));
        const next = [...current], seen = /* @__PURE__ */ new Set(), writes = [];
        for (const item of items) {
          if (!item || typeof item.id !== "string" || !/^[a-zA-Z0-9-]{1,80}$/.test(item.id) || seen.has(item.id))
            throw Error("\u5B9E\u4F53 ID \u65E0\u6548\u6216\u91CD\u590D");
          seen.add(item.id);
          const position = positions.has(item.id) ? positions.get(item.id) : next.length;
          next[position] = item;
          writes.push({ item, position });
        }
        if (next.length > (definition2.tables[table].limit || 5e3)) throw Error("\u63D2\u4EF6\u6570\u636E\u8D85\u8FC7\u6570\u91CF\u9650\u5236");
        this.repository.patch(table, writes, audit.getStore());
        this.data = { ...this.data, [table]: next };
      };
      store.removeItem = function(table, id) {
        if (!definition2.tables[table] || !this.data[table].some((item) => item.id === id)) throw Error("\u5185\u5BB9\u4E0D\u5B58\u5728");
        this.commit({ ...this.data, [table]: this.data[table].filter((item) => item.id !== id) });
      };
      const base = {
        version: 2,
        ...Object.fromEntries(Object.keys(definition2.tables).map((table) => [table, []])),
        settings: {},
        configSource: "local",
        sourceName: ""
      };
      if (definition2.project) {
        const validate = store.validate.bind(store);
        store.validate = (data) => definition2.project(validate(data));
      }
      const existing = store.repository.read();
      if (existing) store.data = store.validate({ ...base, ...existing });
      else store.commit({ ...base, ...seed2 });
      return store;
    }
    function validateCollection(data, field, validator) {
      const items = (data[field] || []).map(validator);
      if (items.length > 5e3 || new Set(items.map((v) => v.id)).size !== items.length || items.some((v) => !v.id || !/^[a-zA-Z0-9-]{1,80}$/.test(v.id)))
        throw Error("\u63D2\u4EF6\u6570\u636E ID \u4E0D\u6B63\u786E\u6216\u91CD\u590D");
      return { version: 2, [field]: items, settings: data.settings || {} };
    }
    module2.exports = { createStore: createStore2, validateCollection, randomUUID };
  }
});

// src/plugins/bookmarks/store.js
var require_store = __commonJS({
  "src/plugins/bookmarks/store.js"(exports2, module2) {
    var path2 = require("node:path");
    var { randomUUID } = require("node:crypto");
    var COLORS = ["sage", "blue", "orange", "purple", "rose", "slate"];
    var ICONS = ["game", "build", "link", "chart", "server", "book"];
    var INBOX = {
      id: "inbox",
      name: "\u672A\u5206\u7C7B",
      description: "\u8FD8\u6CA1\u51B3\u5B9A\u5F52\u5C5E\u7684\u5730\u5740\uFF0C\u5148\u653E\u5728\u8FD9\u91CC\u3002",
      color: "slate",
      icon: "link"
    };
    function text(input, key, max, required = false) {
      const value = typeof input?.[key] === "string" ? input[key].trim() : "";
      if (required && !value) throw new Error(`\u8BF7\u586B\u5199${{ name: "\u540D\u79F0", url: "\u7F51\u5740" }[key] || key}`);
      if (value.length > max) throw new Error("\u5185\u5BB9\u8D85\u8FC7\u957F\u5EA6\u9650\u5236");
      return value;
    }
    function validateEntry(input) {
      const type = ["web", "file", "folder", "text", "credential"].includes(input?.type) ? input.type : "web";
      let parsed;
      if (type === "web") {
        try {
          parsed = new URL(text(input, "url", 2048, type === "web"));
        } catch {
          throw new Error("\u8BF7\u8F93\u5165\u5B8C\u6574\u7684 http:// \u6216 https:// \u7F51\u5740");
        }
        if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password)
          throw new Error("\u7F51\u5740\u4EC5\u652F\u6301 HTTP / HTTPS\uFF0C\u4E14\u4E0D\u80FD\u5305\u542B\u8D26\u53F7\u5BC6\u7801");
      }
      const localPath = text(input, "localPath", 2048);
      if (["file", "folder"].includes(type) && !path2.posix.isAbsolute(localPath) && !path2.win32.isAbsolute(localPath))
        throw new Error("\u8BF7\u9009\u62E9\u672C\u5730\u6587\u4EF6\u6216\u6587\u4EF6\u5939\u7684\u7EDD\u5BF9\u8DEF\u5F84");
      const content = typeof input.content === "string" ? input.content : "";
      if (content.length > 3e4 || type === "text" && !content.trim())
        throw new Error("\u8BF7\u586B\u5199\u6587\u672C\u7247\u6BB5\uFF0C\u6700\u591A 30000 \u5B57");
      return {
        type,
        localPath: ["file", "folder"].includes(type) ? localPath : "",
        content: type === "text" ? content : "",
        name: text(input, "name", 80, true),
        // 账号资料的地址只作参考和复制，不交给网页加载器或系统执行。
        url: parsed?.href || (type === "credential" ? text(input, "url", 2048) : ""),
        categoryId: text(input, "categoryId", 80) || "inbox",
        environment: text(input, "environment", 60),
        note: text(input, "note", 5e3),
        username: text(input, "username", 200),
        password: typeof input.password === "string" ? input.password : void 0,
        authMode: input?.authMode === "basic" ? "basic" : "manual",
        mode: input?.mode === "external" ? "external" : "internal",
        favorite: input?.favorite === true,
        lastOpened: Number.isFinite(input?.lastOpened) && input.lastOpened >= 0 ? input.lastOpened : 0
      };
    }
    function validateCategory(input) {
      return {
        name: text(input, "name", 60, true),
        description: text(input, "description", 160),
        color: COLORS.includes(input?.color) ? input.color : "sage",
        icon: ICONS.includes(input?.icon) ? input.icon : "link"
      };
    }
    function validateId(id) {
      return typeof id === "string" && /^[a-zA-Z0-9-]{1,80}$/.test(id);
    }
    var BookmarkStore = class {
      get entries() {
        return this.data.entries;
      }
      get categories() {
        return this.data.categories;
      }
      snapshot() {
        return structuredClone(this.data);
      }
      validate(data) {
        if (Number.isInteger(data?.version) && data.version > 2)
          throw new Error("\u8BE5\u6570\u636E\u7531\u66F4\u9AD8\u7248\u672C\u7684\u8F6F\u4EF6\u521B\u5EFA\uFF0C\u8BF7\u5347\u7EA7 Collectify \u540E\u518D\u6253\u5F00\u3002\u539F\u6587\u4EF6\u672A\u6539\u52A8\u3002");
        if (!data || data.version !== 2 || !Array.isArray(data.categories) || !Array.isArray(data.entries) || data.categories.length > 200 || data.entries.length > 5e3)
          throw new Error("\u6536\u85CF\u914D\u7F6E\u683C\u5F0F\u6216\u6570\u91CF\u4E0D\u6B63\u786E");
        const categoryIds = /* @__PURE__ */ new Set(), entryIds = /* @__PURE__ */ new Set(), names = /* @__PURE__ */ new Set();
        const categories = data.categories.map((c) => {
          if (!validateId(c?.id) || categoryIds.has(c.id)) throw new Error("\u5206\u7C7B ID \u4E0D\u6B63\u786E\u6216\u91CD\u590D");
          const category = { id: c.id, ...validateCategory(c) };
          if (names.has(category.name.toLocaleLowerCase())) throw new Error("\u5206\u7C7B\u540D\u79F0\u91CD\u590D");
          categoryIds.add(c.id);
          names.add(category.name.toLocaleLowerCase());
          return category;
        });
        if (!categoryIds.has("inbox")) {
          if (names.has(INBOX.name)) throw new Error("\u672A\u5206\u7C7B\u4E3A\u7CFB\u7EDF\u4FDD\u7559\u540D\u79F0");
          categories.push({ ...INBOX });
          categoryIds.add("inbox");
        }
        const entries = data.entries.map((e) => {
          if (!validateId(e?.id) || entryIds.has(e.id)) throw new Error("\u6536\u85CF ID \u4E0D\u6B63\u786E\u6216\u91CD\u590D");
          entryIds.add(e.id);
          const entry = { id: e.id, ...validateEntry(e) };
          if (!categoryIds.has(entry.categoryId)) throw new Error("\u6536\u85CF\u6240\u5C5E\u5206\u7C7B\u4E0D\u5B58\u5728");
          return entry;
        });
        return {
          version: 2,
          categories,
          entries,
          configSource: ["default", "imported"].includes(data.configSource) ? data.configSource : "local",
          sourceName: text(data, "sourceName", 200)
        };
      }
      save(input) {
        const value = validateEntry(input), previous = this.entries.find((e) => e.id === input.id);
        if (input.id && !previous) throw new Error("\u6536\u85CF\u5DF2\u88AB\u5220\u9664\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5");
        const entry = { id: previous?.id || randomUUID(), ...value, lastOpened: previous?.lastOpened || 0 };
        if (!this.categories.some((c) => c.id === entry.categoryId)) throw Error("\u6536\u85CF\u6240\u5C5E\u5206\u7C7B\u4E0D\u5B58\u5728");
        entry.password ??= "";
        this.updateEntities("entries", [entry]);
        return entry;
      }
      remove(id) {
        if (!this.entries.some((e) => e.id === id)) throw new Error("\u6536\u85CF\u4E0D\u5B58\u5728");
        this.commit({ ...this.snapshot(), entries: this.entries.filter((e) => e.id !== id) });
      }
      saveCategory(input) {
        const value = validateCategory(input), previous = this.categories.find((c) => c.id === input.id);
        if (input.id && !previous) throw new Error("\u5206\u7C7B\u4E0D\u5B58\u5728");
        if (input.id === "inbox" || value.name === "\u672A\u5206\u7C7B") throw new Error("\u672A\u5206\u7C7B\u4E3A\u7CFB\u7EDF\u4FDD\u7559\u5206\u7C7B");
        const category = { id: previous?.id || randomUUID(), ...value };
        if (this.categories.some(
          (c) => c.id !== category.id && c.name.toLocaleLowerCase() === category.name.toLocaleLowerCase()
        ))
          throw Error("\u5206\u7C7B\u540D\u79F0\u91CD\u590D");
        this.updateEntities("categories", [category]);
        return category;
      }
      removeCategory(id, targetId) {
        if (id === "inbox" || id === targetId || !this.categories.some((c) => c.id === id) || !this.categories.some((c) => c.id === targetId))
          throw new Error("\u8BF7\u9009\u62E9\u6709\u6548\u7684\u63A5\u6536\u5206\u7C7B");
        const data = this.snapshot();
        data.categories = data.categories.filter((c) => c.id !== id);
        data.entries = data.entries.map((e) => e.categoryId === id ? { ...e, categoryId: targetId } : e);
        this.commit(data);
      }
      reorder(kind, ids) {
        if (!["entries", "categories"].includes(kind) || !Array.isArray(ids)) throw new Error("\u6392\u5E8F\u53C2\u6570\u4E0D\u6B63\u786E");
        const data = this.snapshot(), lookup = new Map(data[kind].map((item) => [item.id, item]));
        if (ids.length !== lookup.size || new Set(ids).size !== ids.length || ids.some((id) => !lookup.has(id)))
          throw new Error("\u6392\u5E8F\u5BF9\u8C61\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u8BD5");
        data[kind] = ids.map((id) => lookup.get(id));
        this.commit(data);
      }
      markOpened(id) {
        const entry = this.entries.find((e) => e.id === id);
        if (!entry) throw new Error("\u6536\u85CF\u4E0D\u5B58\u5728");
        this.updateEntities("entries", [{ ...entry, lastOpened: Date.now() }]);
      }
      import(raw, options = {}) {
        const incoming = this.validate({
          ...raw,
          entries: Array.isArray(raw?.entries) ? raw.entries.map((entry) => ({ ...entry, id: entry.id || randomUUID() })) : raw?.entries
        });
        if (incoming.entries.length > 1e3) throw new Error("\u4E00\u6B21\u6700\u591A\u5BFC\u5165 1000 \u6761\u6536\u85CF");
        const data = this.snapshot(), categoryMap = /* @__PURE__ */ new Map();
        if (options.mode === "replace") {
          const oldEntries = data.entries;
          data.categories = incoming.categories;
          data.entries = incoming.entries.map((entry) => {
            const old = oldEntries.find(
              (e) => e.type === entry.type && (entry.type === "web" ? e.url === entry.url : entry.type === "credential" ? e.name === entry.name && e.url === entry.url && e.username === entry.username : e.name === entry.name && e.localPath === entry.localPath && e.content === entry.content)
            );
            return {
              ...entry,
              id: old?.id || randomUUID(),
              password: entry.password === void 0 ? old?.password : entry.password,
              lastOpened: old?.lastOpened || 0
            };
          });
          const used = /* @__PURE__ */ new Set();
          for (const entry of data.entries) {
            if (used.has(entry.id)) entry.id = randomUUID();
            used.add(entry.id);
          }
          data.configSource = "imported";
          data.sourceName = options.sourceName || "JSON \u6587\u4EF6";
          this.commit(data);
          return data.entries.length;
        }
        for (const category of incoming.categories) {
          let local = data.categories.find((c) => c.name.toLocaleLowerCase() === category.name.toLocaleLowerCase());
          if (!local) {
            local = { ...category, id: randomUUID() };
            data.categories.push(local);
          } else if (options.override && local.id !== "inbox") {
            local = { ...category, id: local.id };
            data.categories = data.categories.map((c) => c.id === local.id ? local : c);
          }
          categoryMap.set(category.id, local.id);
        }
        let added = 0;
        for (const entry of incoming.entries) {
          const categoryId = categoryMap.get(entry.categoryId);
          const oldIndex = data.entries.findIndex(
            (e) => e.categoryId === categoryId && e.type === entry.type && (entry.type === "web" ? e.url === entry.url : entry.type === "credential" ? e.name === entry.name && e.url === entry.url && e.username === entry.username : e.name === entry.name && e.localPath === entry.localPath && e.content === entry.content)
          );
          if (oldIndex >= 0) {
            if (options.override)
              data.entries[oldIndex] = {
                ...entry,
                id: data.entries[oldIndex].id,
                categoryId,
                password: entry.password === void 0 ? data.entries[oldIndex].password : entry.password,
                lastOpened: data.entries[oldIndex].lastOpened
              };
            continue;
          }
          data.entries.push({ ...entry, id: randomUUID(), categoryId, lastOpened: 0 });
          added++;
        }
        data.configSource = "imported";
        data.sourceName = options.sourceName || "JSON \u6587\u4EF6";
        this.commit(data);
        return added;
      }
    };
    module2.exports = { BookmarkStore, validateEntry };
  }
});

// src/plugins/bookmarks/schema.js
var require_schema = __commonJS({
  "src/plugins/bookmarks/schema.js"(exports2, module2) {
    module2.exports = {
      methods: require_store().BookmarkStore.prototype,
      validate: require_store().BookmarkStore.prototype.validate,
      prepareCommit(data) {
        for (const entry of data.entries) entry.password ??= "";
      },
      id: "collectify.bookmarks",
      schema: "CREATE TABLE IF NOT EXISTS categories(id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE, description TEXT NOT NULL, color TEXT NOT NULL, icon TEXT NOT NULL, sort_order INTEGER NOT NULL) STRICT;\r\nCREATE TABLE IF NOT EXISTS entries(id TEXT PRIMARY KEY, category_id TEXT NOT NULL REFERENCES categories(id) DEFERRABLE INITIALLY DEFERRED, type TEXT NOT NULL CHECK(type IN ('web','file','folder','text','credential')), name TEXT NOT NULL, url TEXT NOT NULL, local_path TEXT NOT NULL, content TEXT NOT NULL, environment TEXT NOT NULL, note TEXT NOT NULL, username TEXT NOT NULL, password TEXT NOT NULL, auth_mode TEXT NOT NULL CHECK(auth_mode IN ('manual','basic')), open_mode TEXT NOT NULL CHECK(open_mode IN ('internal','external')), favorite INTEGER NOT NULL CHECK(favorite IN (0,1)), last_opened INTEGER NOT NULL CHECK(last_opened>=0), sort_order INTEGER NOT NULL) STRICT;\r",
      tables: {
        categories: {
          limit: 200,
          fields: {
            id: "id",
            name: "name",
            description: "description",
            color: "color",
            icon: "icon"
          },
          nameKey: true
        },
        entries: {
          fields: {
            id: "id",
            categoryId: "category_id",
            type: "type",
            name: "name",
            url: "url",
            localPath: "local_path",
            content: "content",
            environment: "environment",
            note: "note",
            username: "username",
            password: "password",
            authMode: "auth_mode",
            mode: "open_mode",
            favorite: "favorite",
            lastOpened: "last_opened"
          },
          booleans: ["favorite"]
        }
      },
      attachments: false
    };
  }
});

// src/plugins/.shared/initial-examples.js
var require_initial_examples = __commonJS({
  "src/plugins/.shared/initial-examples.js"(exports2, module2) {
    function withInitialExamples(defaults, now = /* @__PURE__ */ new Date()) {
      const data = structuredClone(defaults);
      if (data.initializeExamples !== true) return data;
      const at = (days, hour, minute = 0) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, hour, minute).toISOString();
      const createdAt = now.toISOString();
      const bookmarkId = data.entries.find((entry) => entry.id === "gm-trunk")?.id || "";
      const tasks = [
        {
          id: "example-inbox",
          title: "\u793A\u4F8B \xB7 \u6536\u96C6\u4E00\u4E2A\u4E34\u65F6\u60F3\u6CD5",
          status: "inbox",
          priority: "low",
          important: false,
          urgent: false,
          note: "\u5148\u8BB0\u5F55\u6807\u9898\uFF0C\u4E4B\u540E\u518D\u8865\u5145\u65E5\u671F\u548C\u5907\u6CE8\u3002\u62D6\u52A8\u5361\u7247\u53EF\u6539\u53D8\u72B6\u6001\u3002"
        },
        {
          id: "example-release-check",
          title: "\u793A\u4F8B \xB7 \u53D1\u5E03\u524D\u68C0\u67E5",
          status: "todo",
          priority: "high",
          important: true,
          urgent: true,
          allDay: true,
          dueAt: at(0, 0),
          bookmarkId,
          note: "\u5168\u5929\u4E8B\u9879\u793A\u4F8B\uFF1A\u68C0\u67E5\u7248\u672C\u4E0E\u73AF\u5883\u3002\u6B64\u4EFB\u52A1\u4EC5\u7528\u4E8E\u6F14\u793A\uFF0C\u4E0D\u4F1A\u6267\u884C\u5B9E\u9645\u64CD\u4F5C\u3002"
        },
        {
          id: "example-environment-review",
          title: "\u793A\u4F8B \xB7 \u6838\u5BF9\u73AF\u5883\u5B89\u6392",
          status: "doing",
          priority: "medium",
          important: true,
          urgent: false,
          startAt: at(1, 9, 30),
          endAt: at(1, 10),
          dueAt: at(1, 10),
          bookmarkId,
          note: "\u660E\u5929 09:30\u201310:00\u3002\u6253\u5F00\u65E5\u5386\u67E5\u770B\u65F6\u95F4\u5757\uFF0C\u62D6\u52A8\u53EF\u8C03\u6574\u6392\u671F\u3002"
        },
        {
          id: "example-quick-reply",
          title: "\u793A\u4F8B \xB7 \u5904\u7406\u4E00\u6761\u7B80\u77ED\u56DE\u590D",
          status: "todo",
          priority: "medium",
          important: false,
          urgent: true,
          dueAt: at(1, 17),
          note: "\u7D27\u6025\u4F46\u4E0D\u91CD\u8981\u7684\u793A\u4F8B\uFF1B\u53EF\u5728\u56DB\u8C61\u9650\u4E2D\u62D6\u52A8\u6539\u53D8\u91CD\u8981\u4E0E\u7D27\u6025\u3002"
        },
        {
          id: "example-planning",
          title: "\u793A\u4F8B \xB7 \u6574\u7406\u4E0B\u4E00\u9636\u6BB5\u8BA1\u5212",
          status: "todo",
          priority: "low",
          important: false,
          urgent: false,
          startAt: at(2, 14),
          endAt: at(2, 14, 45),
          note: "\u540E\u5929 14:00\u201314:45\u3002\u5907\u6CE8\u53EF\u5199\u80CC\u666F\u3001\u6B65\u9AA4\u548C\u9A8C\u6536\u6761\u4EF6\u3002"
        },
        {
          id: "example-completed",
          title: "\u793A\u4F8B \xB7 \u5B8C\u6210\u4E00\u6B21\u8D44\u6E90\u6574\u7406",
          status: "done",
          priority: "medium",
          important: false,
          urgent: false,
          completedAt: createdAt,
          note: "\u5DF2\u5B8C\u6210\u793A\u4F8B\uFF0C\u53EF\u4EE5\u5C1D\u8BD5\u5F52\u6863\u6216\u91CD\u65B0\u6253\u5F00\u3002"
        }
      ].map((task) => ({ ...task, createdAt, remindAt: "", attachments: [] }));
      const notes = [
        {
          id: "example-note-welcome",
          title: "\u793A\u4F8B \xB7 \u4F60\u7684\u5DE5\u4F5C\u7A7A\u95F4",
          color: "blue",
          content: "\u6536\u85CF\u5E38\u7528\u7F51\u9875\u3001SVN \u5730\u5740\u548C\u7F51\u7EDC\u8D44\u6599\u3002\n\u7F51\u9875\u53EF\u5728\u5BA2\u6237\u7AEF\u5185\u6253\u5F00\uFF1BSVN \u4E0E IP \u4F5C\u4E3A\u6587\u672C\u76F4\u63A5\u590D\u5236\u3002\n\u8FD9\u4E9B\u793A\u4F8B\u53EF\u4EE5\u7F16\u8F91\u6216\u5220\u9664\u3002"
        },
        {
          id: "example-note-checklist",
          title: "\u793A\u4F8B \xB7 \u53D1\u5E03\u5907\u5FD8",
          color: "yellow",
          content: "1. \u6838\u5BF9\u76EE\u6807\u73AF\u5883\u4E0E\u7248\u672C\n2. \u786E\u8BA4\u6784\u5EFA\u7ED3\u679C\n3. \u8BB0\u5F55\u9A8C\u8BC1\u7ED3\u8BBA\n\u9700\u8981\u5B89\u6392\u65F6\u95F4\u65F6\uFF0C\u70B9\u51FB\u201C\u8F6C\u4E3A\u5F85\u529E\u201D\u3002"
        },
        {
          id: "example-note-ideas",
          title: "\u793A\u4F8B \xB7 \u968F\u624B\u8BB0\u5F55",
          color: "green",
          content: "\u4E34\u65F6\u60F3\u6CD5\u5148\u653E\u5728\u8FD9\u91CC\u3002\n\u4FBF\u7B7E\u9002\u5408\u8BB0\u5F55\u5185\u5BB9\uFF0C\u5F85\u529E\u9002\u5408\u8DDF\u8FDB\u72B6\u6001\uFF0C\u65E5\u5386\u5C55\u793A\u5DF2\u5B89\u6392\u7684\u65F6\u95F4\u3002"
        }
      ].map((note) => ({ ...note, updatedAt: createdAt }));
      const existingTaskIds = new Set((data.tasks || []).map((task) => task.id));
      const existingNoteIds = new Set((data.notes || []).map((note) => note.id));
      data.tasks = [...data.tasks || [], ...tasks.filter((task) => !existingTaskIds.has(task.id))];
      data.notes = [...data.notes || [], ...notes.filter((note) => !existingNoteIds.has(note.id))];
      return data;
    }
    module2.exports = { withInitialExamples };
  }
});

// src/plugins/.shared/seed.js
var require_seed = __commonJS({
  "src/plugins/.shared/seed.js"(exports2, module2) {
    var fs2 = require("node:fs");
    var path2 = require("node:path");
    var { DatabaseSync } = require("node:sqlite");
    var { withInitialExamples } = require_initial_examples();
    function seed2(context, definition2) {
      if (fs2.existsSync(context.file)) {
        const db = new DatabaseSync(context.file, { readOnly: true });
        try {
          if (db.prepare("SELECT name FROM sqlite_master WHERE name='domain_state'").get() && db.prepare("SELECT id FROM domain_state LIMIT 1").get())
            return {};
        } finally {
          db.close();
        }
      }
      if (context.emptyInitialData) return { settings: {} };
      const legacy = path2.join(context.dataDirectory, "collectify.sqlite");
      if (fs2.existsSync(legacy)) {
        const db = new DatabaseSync(legacy, { readOnly: true });
        try {
          const data = { settings: {} };
          for (const [table, d] of Object.entries(definition2.tables))
            data[table] = db.prepare(`SELECT * FROM ${table} ORDER BY sort_order,id`).all().map(
              (row) => Object.fromEntries(
                Object.entries(d.fields).map(([f, c]) => [
                  f,
                  d.booleans?.includes(f) ? !!row[c] : row[c] ?? ""
                ])
              )
            );
          if (definition2.attachments) {
            const relation = definition2.attachments;
            const rows = db.prepare(`SELECT * FROM ${relation.table} ORDER BY ${relation.position}`).all();
            for (const item of data[relation.owner])
              item[relation.field] = rows.filter((row) => row[relation.foreignKey] === item.id).map((row) => row[relation.value]);
          }
          for (const row of db.prepare("SELECT * FROM settings").all())
            data.settings[row.key] = JSON.parse(row.value_json);
          const meta = db.prepare("SELECT config_source,source_name FROM workspace_meta WHERE id=1").get();
          data.configSource = meta.config_source;
          data.sourceName = meta.source_name;
          return data;
        } finally {
          db.close();
        }
      }
      const raw = context.smoke ? { version: 2, categories: [], entries: [] } : context.initialData;
      const defaults = withInitialExamples(raw);
      return {
        ...Object.fromEntries(Object.keys(definition2.tables).map((key) => [key, defaults[key] || []])),
        settings: defaults.settings || {},
        configSource: "default",
        sourceName: "\u521D\u59CB\u6570\u636E"
      };
    }
    module2.exports = { seed: seed2 };
  }
});

// src/plugins/bookmarks/credentials.js
var require_credentials = __commonJS({
  "src/plugins/bookmarks/credentials.js"(exports2, module2) {
    async function passwordOf(entry) {
      return entry.password || "";
    }
    async function prepare(input, previous) {
      const result = { ...input }, type = input.type || "web";
      let url = null;
      if (input.url && ["web", "credential"].includes(type)) {
        try {
          url = new URL(input.url);
        } catch {
          if (type === "web") throw Error("\u8BF7\u8F93\u5165\u5B8C\u6574\u7684 http:// \u6216 https:// \u7F51\u5740");
        }
      }
      if (url && (url.username || url.password)) {
        if (url.username) result.username = decodeURIComponent(url.username);
        if (url.password) result.password = decodeURIComponent(url.password);
        url.username = "";
        url.password = "";
        result.url = url.href;
        result.authMode = type === "web" ? "basic" : "manual";
      }
      result.password = input.clearPassword ? "" : Object.hasOwn(result, "password") ? String(result.password || "") : previous?.password;
      if (result.password && result.password.length > 5e3) throw Error("\u5BC6\u7801\u8FC7\u957F\uFF0C\u6700\u591A 5000 \u5B57\u7B26");
      delete result.clearPassword;
      if (type !== "web") result.authMode = "manual";
      return result;
    }
    function publicEntry(entry) {
      return { ...entry, hasPassword: !!entry.password };
    }
    module2.exports = { prepare, publicEntry, passwordOf };
  }
});

// src/plugins/bookmarks/login-helper.js
var require_login_helper = __commonJS({
  "src/plugins/bookmarks/login-helper.js"(exports2, module2) {
    var { BrowserWindow, ipcMain, screen } = require("electron");
    var { visibleBounds } = hostSdk.windows;
    var path2 = require("node:path");
    var { pathToFileURL } = require("node:url");
    var credentials2 = require_credentials();
    var { copyText: copyText2 } = hostSdk.clipboard;
    var { loadAuxiliary } = hostSdk.auxiliary;
    var LoginHelper = class {
      constructor(getParent, smoke, canShow = () => true) {
        this.getParent = getParent;
        this.smoke = smoke;
        this.canShow = canShow;
        this.win = null;
        this.entry = null;
        this.allowed = false;
        ipcMain.handle("login-helper", async (event, action) => {
          try {
            if (!this.win || event.sender !== this.win.webContents || event.senderFrame !== this.win.webContents.mainFrame || event.senderFrame.url !== pathToFileURL(path2.join(__dirname, "login-helper.html")).href)
              throw Error("\u65E0\u6743\u8BBF\u95EE\u767B\u5F55\u8D44\u6599");
            if (action === "hide") {
              this.hide(true);
              return { ok: true };
            }
            if (!this.entry) throw Error("\u6CA1\u6709\u767B\u5F55\u8D44\u6599");
            const password = await credentials2.passwordOf(this.entry);
            if (action === "state")
              return {
                ok: true,
                data: {
                  name: this.entry.name,
                  username: this.entry.username || "",
                  password,
                  authMode: this.entry.authMode
                }
              };
            if (action === "copy-user") await copyText2(this.entry.username || "");
            else if (action === "copy-password") await copyText2(password);
            else throw Error("\u672A\u77E5\u64CD\u4F5C");
            return { ok: true };
          } catch (error) {
            return { ok: false, error: error.message };
          }
        });
      }
      async show(entry) {
        if (!entry || !entry.username && !entry.password) return;
        this.entry = entry;
        this.allowed = true;
        if (!this.win) {
          const parent = this.getParent(), p = parent.getBounds();
          this.win = new BrowserWindow({
            parent,
            ...process.platform === "darwin" ? { type: "panel" } : {},
            fullscreenable: false,
            ...visibleBounds(
              { width: 330, height: 250, x: Math.max(p.x + 20, p.x + p.width - 350), y: p.y + 190 },
              screen.getDisplayMatching(p).workArea
            ),
            frame: false,
            resizable: false,
            skipTaskbar: true,
            show: false,
            backgroundColor: "#ffffff",
            title: "\u767B\u5F55\u8D44\u6599\u5361",
            icon: path2.join(require("electron").app.getAppPath(), "assets", "icon.png"),
            webPreferences: {
              preload: path2.join(__dirname, "login-helper-preload.js"),
              sandbox: true,
              contextIsolation: true,
              nodeIntegration: false,
              offscreen: this.smoke
            }
          });
          this.win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
          this.win.webContents.on("will-navigate", (event) => event.preventDefault());
          this.win.on("closed", () => {
            this.win = null;
          });
          this.loading = loadAuxiliary(this.win, path2.join(__dirname, "login-helper.html"));
        }
        await this.loading;
        if (!this.allowed || this.entry?.id !== entry.id || !this.win || this.win.isDestroyed()) return;
        const password = await credentials2.passwordOf(entry);
        if (!this.win || this.win.isDestroyed() || !this.allowed || this.entry?.id !== entry.id) return;
        await this.win.webContents.executeJavaScript(
          `window.renderLoginCard(${JSON.stringify({
            name: entry.name,
            username: entry.username || "",
            password,
            authMode: entry.authMode
          })})`
        );
        if (this.allowed && this.entry?.id === entry.id && this.parentVisible() && !this.smoke && this.win && !this.win.isDestroyed() && !this.win.isVisible())
          this.win.showInactive();
      }
      parentVisible() {
        const parent = this.getParent();
        return this.canShow() && !!parent && !parent.isDestroyed() && parent.isVisible() && !parent.isMinimized();
      }
      hide(dismiss = false) {
        if (dismiss) this.allowed = false;
        if (this.win && !this.win.isDestroyed() && this.win.isVisible()) this.win.hide();
      }
      resume(entry) {
        if (this.allowed && entry && entry.id === this.entry?.id && this.win && !this.win.isDestroyed() && this.parentVisible() && !this.win.isVisible() && !this.smoke)
          this.win.showInactive();
      }
      destroy() {
        this.win?.destroy();
        this.win = null;
      }
      dispose() {
        this.destroy();
        ipcMain.removeHandler("login-helper");
      }
    };
    module2.exports = { LoginHelper };
  }
});

// src/plugins/bookmarks/browser.js
var require_browser = __commonJS({
  "src/plugins/bookmarks/browser.js"(exports2, module2) {
    var { WebContentsView, session: session2, shell: shell2 } = require("electron");
    var { validUrl: validUrl2 } = hostSdk.urls;
    var credentials2 = require_credentials();
    var { LoginHelper } = require_login_helper();
    var { layoutView } = hostSdk.windows;
    module2.exports.create = function(context, store) {
      let active = null, dashboard = true, overlay = false, visible = false, browserTop = 96, bounds = { x: 300, y: 64, width: 800, height: 600 };
      const tabs = /* @__PURE__ */ new Map(), prepared = /* @__PURE__ */ new Set();
      const loginHelper = new LoginHelper(context.getWindow, context.smoke, () => visible && !dashboard && !overlay);
      function getEntry(id) {
        const entry = store.entries.find((e) => e.id === id);
        if (!entry) throw new Error("\u5165\u53E3\u4E0D\u5B58\u5728");
        return entry;
      }
      function publish() {
        if (!context.getWindow() || context.getWindow().isDestroyed()) return;
        context.emit("tabs", {
          active,
          dashboard,
          tabs: [...tabs.values()].map((t) => ({
            id: t.id,
            entryId: t.entry.id,
            name: t.entry.name,
            environment: t.entry.environment,
            color: store.categories.find((c) => c.id === t.entry.categoryId)?.color || "sage",
            title: t.title,
            url: t.url,
            loading: t.loading,
            error: t.error,
            hasCredentials: !!(t.entry.username || t.entry.password),
            back: t.view.webContents.navigationHistory.canGoBack(),
            forward: t.view.webContents.navigationHistory.canGoForward()
          }))
        });
      }
      function layout() {
        if (!visible || dashboard || overlay) loginHelper.hide(dashboard);
        for (const tab of tabs.values()) {
          const show = visible && !dashboard && !overlay && active === tab.id && !tab.error;
          layoutView(tab.view, show, {
            x: bounds.x,
            y: bounds.y + browserTop,
            width: bounds.width,
            height: Math.max(1, bounds.height - browserTop)
          });
        }
        if (visible && !dashboard && !overlay) loginHelper.resume(tabs.get(active)?.entry);
      }
      function closeTab(id) {
        const tab = tabs.get(id);
        if (!tab) return;
        if (context.getWindow() && !context.getWindow().isDestroyed())
          context.getWindow().contentView.removeChildView(tab.view);
        tab.view.webContents.close();
        tabs.delete(id);
        if (active === id) active = [...tabs.keys()].at(-1) || null;
        if (!active) dashboard = true;
        if (!tabs.size) loginHelper?.hide(true);
        layout();
        publish();
      }
      async function openEntry(entry, url = entry.url, extra = false) {
        if (!validUrl2(url)) throw new Error("\u4EC5\u652F\u6301 HTTP / HTTPS \u7F51\u9875");
        if (!extra) {
          const existing = [...tabs.values()].find((t) => t.entry.id === entry.id);
          if (existing) {
            active = existing.id;
            dashboard = false;
            layout();
            publish();
            return;
          }
        }
        const partition = `persist:entry-${entry.id}`;
        const isolatedSession = session2.fromPartition(partition);
        if (!prepared.has(partition)) {
          isolatedSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
          isolatedSession.setPermissionCheckHandler(() => false);
          isolatedSession.on("will-download", (_event, item) => item.setSaveDialogOptions({ title: "\u4FDD\u5B58\u4E0B\u8F7D\u6587\u4EF6" }));
          prepared.add(partition);
        }
        const view = new WebContentsView({
          webPreferences: {
            partition,
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
            allowRunningInsecureContent: false
          }
        });
        const id = require("node:crypto").randomUUID();
        const tab = { id, entry, view, title: entry.name, url, loading: true, error: "" };
        tabs.set(id, tab);
        context.getWindow().contentView.addChildView(view);
        const wc = view.webContents;
        let authAttempted = false;
        wc.on("login", (event, request, authInfo, callback) => {
          event.preventDefault();
          const current = store.entries.find((e) => e.id === entry.id) || entry;
          const ownOrigin = new URL(current.url).origin;
          if (authAttempted || authInfo.isProxy || authInfo.scheme.toLowerCase() !== "basic" || current.authMode !== "basic" || new URL(request.url).origin !== ownOrigin) {
            callback();
            return;
          }
          authAttempted = true;
          credentials2.passwordOf(current).then((password) => callback(current.username, password)).catch(() => callback());
        });
        wc.on("before-input-event", (event, input) => {
          if (input.type === "keyDown" && (input.control || input.meta) && input.key.toLowerCase() === "k" && !overlay) {
            event.preventDefault();
            dashboard = true;
            layout();
            publish();
            context.getWindow().webContents.focus();
            context.emit("focus-search");
          }
        });
        wc.setWindowOpenHandler((details) => {
          if (validUrl2(details.url)) openEntry(entry, details.url, true).catch(() => {
          });
          return { action: "deny" };
        });
        for (const eventName of ["will-navigate", "will-redirect", "will-frame-navigate"]) {
          wc.on(eventName, (event, destination) => {
            const target = typeof destination === "string" ? destination : event.url;
            if (!validUrl2(target)) event.preventDefault();
          });
        }
        wc.on("page-title-updated", (_event, title) => {
          tab.title = title;
          publish();
        });
        wc.on("did-start-loading", () => {
          tab.loading = true;
          tab.error = "";
          layout();
          publish();
        });
        wc.on("did-stop-loading", () => {
          tab.loading = false;
          publish();
        });
        wc.on("did-navigate", (_event, next) => {
          tab.url = next;
          publish();
        });
        wc.on("did-navigate-in-page", (_event, next, mainFrame) => {
          if (mainFrame) {
            tab.url = next;
            publish();
          }
        });
        wc.on("did-fail-load", (_event, code, description, _url, mainFrame) => {
          if (!mainFrame || code === -3) return;
          tab.error = `\u7F51\u9875\u52A0\u8F7D\u5931\u8D25\uFF1A${description} (${code})`;
          tab.loading = false;
          layout();
          publish();
        });
        wc.on("render-process-gone", () => {
          tab.error = "\u7F51\u9875\u8FDB\u7A0B\u5DF2\u9000\u51FA\uFF0C\u8BF7\u70B9\u51FB\u5237\u65B0\u91CD\u8BD5";
          layout();
          publish();
        });
        active = id;
        dashboard = false;
        layout();
        publish();
        await wc.loadURL(url).catch(() => {
        });
      }
      return {
        tabs,
        openEntry,
        closeTab,
        publish,
        loginHelper,
        layout: (b, show) => {
          bounds = b;
          visible = show;
          layout();
        },
        async call(action, payload) {
          switch (action) {
            case "external": {
              const tab = tabs.get(payload);
              const url = tab ? tab.url : getEntry(payload).url;
              if (!validUrl2(url)) throw new Error("\u5730\u5740\u4E0D\u6B63\u786E");
              await shell2.openExternal(url);
              return { ok: true };
            }
            case "login-card": {
              const tab = tabs.get(active);
              if (!tab) throw Error("\u8BF7\u5148\u6253\u5F00\u7F51\u9875");
              await loginHelper.show(getEntry(tab.entry.id));
              return { ok: true };
            }
            case "home":
              dashboard = true;
              layout();
              publish();
              return { ok: true };
            case "activate":
              if (tabs.has(payload)) {
                active = payload;
                dashboard = false;
                layout();
                publish();
                loginHelper?.hide();
                loginHelper?.resume(tabs.get(payload).entry);
              }
              return { ok: true };
            case "close":
              closeTab(payload);
              return { ok: true };
            case "overlay":
              overlay = payload === true;
              layout();
              if (!overlay && !dashboard) loginHelper?.resume(tabs.get(active)?.entry);
              return { ok: true };
            case "navigation": {
              const tab = tabs.get(active);
              if (tab) {
                const history = tab.view.webContents.navigationHistory;
                if (payload === "back" && history.canGoBack()) history.goBack();
                if (payload === "forward" && history.canGoForward()) history.goForward();
                if (payload === "reload") {
                  tab.error = "";
                  layout();
                  void tab.view.webContents.loadURL(tab.url).catch(() => {
                  });
                }
              }
              return { ok: true };
            }
            case "browser-bounds":
              if (Number.isFinite(payload?.top)) browserTop = Math.max(0, Math.min(300, Math.round(payload.top)));
              layout();
              return;
            default:
              throw Error("\u4E0D\u652F\u6301\u7684\u6D4F\u89C8\u5668\u64CD\u4F5C");
          }
        },
        destroy() {
          for (const id of [...tabs.keys()]) closeTab(id);
          loginHelper.destroy();
        },
        dispose() {
          for (const id of [...tabs.keys()]) closeTab(id);
          loginHelper.dispose();
        },
        get dashboard() {
          return dashboard;
        }
      };
    };
  }
});

// src/plugins/bookmarks/backend.js
var fs = require("node:fs");
var path = require("node:path");
var { shell, session } = require("electron");
var { createStore } = require_domain_store();
var definition = require_schema();
var { seed } = require_seed();
var credentials = require_credentials();
var { copyText } = hostSdk.clipboard;
var { validUrl } = hostSdk.urls;
exports.create = async (context) => {
  const initial = seed(context, definition);
  if (initial.entries) initial.entries = await Promise.all(initial.entries.map((e) => credentials.prepare(e)));
  const store = createStore(
    context.file,
    {
      ...definition,
      project: ({ version, categories, entries, configSource, sourceName }) => ({
        version,
        categories,
        entries,
        configSource,
        sourceName
      })
    },
    initial
  );
  const browser = require_browser().create(context, store);
  const entry = (id) => {
    const item = store.entries.find((v) => v.id === id);
    if (!item) throw Error("\u6536\u85CF\u4E0D\u5B58\u5728");
    return item;
  };
  const changed = () => context.changed();
  async function call(action, payload) {
    let result, write = false;
    switch (action) {
      case "state":
        return {
          ...store.snapshot(),
          entries: store.entries.map(credentials.publicEntry),
          settings: context.getSettings()
        };
      case "list":
        return store.entries.map((e) => ({ id: e.id, name: e.name }));
      case "save": {
        const previous = store.entries.find((v) => v.id === payload.id);
        result = store.save(await credentials.prepare(payload, previous));
        write = true;
        if (previous && previous.url !== result.url) {
          for (const tab of [...browser.tabs.values()])
            if (tab.entry.id === result.id) browser.closeTab(tab.id);
          await session.fromPartition(`persist:entry-${result.id}`).clearStorageData();
        }
        for (const tab of browser.tabs.values()) if (tab.entry.id === result.id) tab.entry = result;
        result = credentials.publicEntry(result);
        break;
      }
      case "delete":
        store.remove(payload);
        for (const tab of [...browser.tabs.values()]) if (tab.entry.id === payload) browser.closeTab(tab.id);
        await session.fromPartition(`persist:entry-${payload}`).clearStorageData();
        if (context.available("collectify.tasks"))
          await context.invoke("collectify.tasks", "unlink-bookmark", payload);
        write = true;
        break;
      case "category-save":
        result = store.saveCategory(payload);
        write = true;
        break;
      case "category-delete":
        store.removeCategory(payload.id, payload.targetId);
        write = true;
        break;
      case "reorder":
        store.reorder(payload.kind, payload.ids);
        write = true;
        break;
      case "copy": {
        const e = entry(payload);
        await copyText(
          e.type === "text" ? e.content : ["file", "folder"].includes(e.type) ? e.localPath : e.url
        );
        break;
      }
      case "copy-text":
        if (typeof payload !== "string" || payload.length > 3e4) throw Error("\u590D\u5236\u5185\u5BB9\u4E0D\u6B63\u786E");
        await copyText(payload);
        break;
      case "password":
        return credentials.passwordOf(entry(payload));
      case "copy-credential": {
        const e = entry(payload.id);
        await copyText(payload.field === "username" ? e.username : await credentials.passwordOf(e));
        break;
      }
      case "resource-viewed":
        store.markOpened(payload);
        write = true;
        break;
      case "pick-resource":
        return context.pick(payload === "folder" ? "folder" : "file");
      case "relocate-resource": {
        const original = entry(payload);
        if (!["file", "folder"].includes(original.type)) throw Error("\u4E0D\u662F\u672C\u5730\u8D44\u6E90");
        const selectedPath = await context.pick(original.type);
        if (!selectedPath) return { canceled: true };
        const current = entry(payload);
        if (current.type !== original.type || current.localPath !== original.localPath)
          throw Error("\u6536\u85CF\u5DF2\u88AB\u4FEE\u6539\uFF0C\u8BF7\u91CD\u65B0\u6253\u5F00\u540E\u5B9A\u4F4D");
        const stat = await fs.promises.stat(selectedPath);
        if (current.type === "folder" ? !stat.isDirectory() : !stat.isFile()) throw Error("\u8D44\u6E90\u7C7B\u578B\u4E0D\u5339\u914D");
        store.save({ ...current, localPath: selectedPath });
        write = true;
        break;
      }
      case "move-many": {
        const ids = payload?.ids;
        if (!Array.isArray(ids) || !ids.length || ids.length > 200 || new Set(ids).size !== ids.length)
          throw Error("\u8BF7\u9009\u62E9 1 \u81F3 200 \u6761\u6536\u85CF");
        const data = store.snapshot();
        if (!data.categories.some((c) => c.id === payload.categoryId)) throw Error("\u76EE\u6807\u5206\u7C7B\u4E0D\u5B58\u5728");
        if (ids.some((id) => !data.entries.some((e) => e.id === id))) throw Error("\u90E8\u5206\u6536\u85CF\u5DF2\u5220\u9664\uFF0C\u8BF7\u91CD\u65B0\u9009\u62E9");
        data.entries = data.entries.map(
          (e) => ids.includes(e.id) ? { ...e, categoryId: payload.categoryId } : e
        );
        store.commit(data);
        result = { moved: ids.length };
        write = true;
        break;
      }
      case "reveal-resource": {
        const e = entry(payload);
        if (!["file", "folder"].includes(e.type)) throw Error("\u4E0D\u662F\u672C\u5730\u8D44\u6E90");
        shell.showItemInFolder(e.localPath);
        break;
      }
      case "open": {
        const e = entry(typeof payload === "string" ? payload : payload.id), mode = ["internal", "external"].includes(payload?.mode) ? payload.mode : context.getSettings().browserOpenMode || "internal";
        if (["file", "folder"].includes(e.type)) {
          try {
            await fs.promises.stat(e.localPath);
          } catch (error2) {
            if (["ENOENT", "ENOTDIR"].includes(error2.code)) return { missing: true, path: e.localPath };
            throw error2;
          }
          const error = await shell.openPath(e.localPath);
          if (error) throw Error(error);
        } else if (e.type !== "web") throw Error("\u8BF7\u4ECE\u6536\u85CF\u8BE6\u60C5\u67E5\u770B\u8BE5\u8D44\u6E90");
        else if (mode === "external") {
          if (!validUrl(e.url)) throw Error("\u7F51\u5740\u4E0D\u6B63\u786E");
          await shell.openExternal(e.url);
        } else {
          await browser.openEntry(e);
          if (e.username || e.password) await browser.loginHelper.show(e);
        }
        store.markOpened(e.id);
        write = true;
        break;
      }
      case "organize": {
        const data = store.snapshot();
        if (payload.bookmarkIds.some((id) => !data.entries.some((e) => e.id === id)))
          throw Error("\u90E8\u5206\u6536\u85CF\u4E0D\u5B58\u5728");
        let category = data.categories.find((c) => c.name.toLowerCase() === payload.categoryName.toLowerCase());
        if (!category) {
          category = {
            id: require("node:crypto").randomUUID(),
            name: payload.categoryName,
            description: "",
            color: "blue",
            icon: "link"
          };
          data.categories.push(category);
        }
        data.entries = data.entries.map(
          (e) => payload.bookmarkIds.includes(e.id) ? { ...e, categoryId: category.id } : e
        );
        store.commit(data);
        result = { categoryId: category.id, moved: payload.bookmarkIds.length };
        write = true;
        break;
      }
      default:
        return (await browser.call(action, payload))?.data;
    }
    if (write) changed();
    return result;
  }
  return {
    store,
    browser,
    call,
    layout: browser.layout,
    activate() {
    },
    deactivate() {
      browser.destroy();
    },
    dispose() {
      browser.dispose();
    },
    summary: () => ({ count: store.entries.length }),
    navigation: () => [
      { id: "all", label: "\u5168\u90E8\u6536\u85CF", count: store.entries.length },
      { id: "favorite", label: "\u5DF2\u7F6E\u9876", count: store.entries.filter((e) => e.favorite).length },
      { id: "recent", label: "\u6700\u8FD1\u6253\u5F00" },
      { id: "new-category", label: "\u65B0\u5EFA\u5206\u7C7B", group: "\u5206\u7C7B" },
      ...store.categories.map((c) => ({
        id: `category:${c.id}`,
        label: c.name,
        count: store.entries.filter((e) => e.categoryId === c.id).length,
        group: "\u5206\u7C7B",
        draggable: c.id !== "inbox",
        dragData: { kind: "category", id: c.id }
      }))
    ],
    exportData: (includeCredentials) => ({
      schemaVersion: 1,
      categories: store.categories,
      entries: store.entries.map(
        (e) => includeCredentials === false ? Object.fromEntries(Object.entries(e).filter(([key]) => !["username", "password"].includes(key))) : e
      ),
      configSource: store.data.configSource,
      sourceName: store.data.sourceName
    }),
    planData(data, mode) {
      if (data?.schemaVersion !== 1) throw Error("\u6536\u85CF\u6570\u636E\u7248\u672C\u4E0D\u652F\u6301");
      const staged = Object.create(store);
      staged.data = store.snapshot();
      staged.commit = function(value) {
        this.data = this.validate(value);
      };
      staged.import(
        { version: 2, categories: data.categories, entries: data.entries },
        { mode, override: true, sourceName: data.sourceName || "\u63D2\u4EF6\u6570\u636E" }
      );
      const referenceMap = {};
      for (const source of data.entries) {
        const categoryName = data.categories.find((c) => c.id === source.categoryId)?.name;
        const category = staged.categories.find((c) => c.name === categoryName);
        const target = staged.entries.find(
          (e) => e.categoryId === category?.id && e.type === source.type && (e.type === "web" ? e.url === source.url : e.type === "credential" ? e.name === source.name && e.url === source.url && e.username === source.username : e.name === source.name && e.localPath === source.localPath && e.content === source.content)
        );
        if (target) referenceMap[source.id] = target.id;
      }
      return {
        schemaVersion: 1,
        categories: staged.categories,
        entries: staged.entries,
        configSource: "imported",
        sourceName: data.sourceName || "\u63D2\u4EF6\u6570\u636E",
        referenceMap
      };
    },
    importData(data) {
      store.commit({ ...store.snapshot(), ...data });
      browser.destroy();
    },
    mcpTools() {
      const { z } = hostSdk.mcp;
      return [
        {
          name: "list_bookmarks",
          description: "\u67E5\u8BE2\u6536\u85CF\uFF0C\u4E0D\u8FD4\u56DE\u8D26\u53F7\u5BC6\u7801",
          inputSchema: { query: z.string().optional(), categoryId: z.string().optional() },
          handler: (input) => store.entries.filter(
            (e) => (!input.categoryId || e.categoryId === input.categoryId) && (!input.query || [e.name, e.note, e.url].some(
              (v) => v.toLowerCase().includes(input.query.toLowerCase())
            ))
          ).map(
            (e) => Object.fromEntries(
              Object.entries(e).filter(([key]) => !["username", "password"].includes(key))
            )
          )
        },
        {
          name: "organize_bookmarks",
          description: "\u5C06\u5DF2\u6709\u6536\u85CF\u6279\u91CF\u79FB\u52A8\u5230\u5206\u7C7B\uFF0C\u4FDD\u7559\u767B\u5F55\u8D44\u6599",
          write: true,
          inputSchema: {
            categoryName: z.string().min(1).max(60),
            bookmarkIds: z.array(z.string()).min(1).max(200)
          },
          handler: (input) => call("organize", input)
        }
      ];
    }
  };
};
