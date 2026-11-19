const hostSdk = require(require('node:path').join(require('electron').app.getAppPath(),'src/plugin-system/backend-sdk.js'));
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// src/plugins/.shared/entity-repository.js
var require_entity_repository = __commonJS({
  "src/plugins/.shared/entity-repository.js"(exports2, module2) {
    var fs = require("node:fs");
    var path = require("node:path");
    var { DatabaseSync } = require("node:sqlite");
    var { ensureStorageSchema } = hostSdk.storage;
    var EntityRepository = class {
      constructor(file, { id, schema, tables, attachments = false }) {
        Object.assign(this, { file, id, schema, tables, attachments });
        fs.mkdirSync(path.dirname(file), { recursive: true });
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
    function validateCollection2(data, field, validator) {
      const items = (data[field] || []).map(validator);
      if (items.length > 5e3 || new Set(items.map((v) => v.id)).size !== items.length || items.some((v) => !v.id || !/^[a-zA-Z0-9-]{1,80}$/.test(v.id)))
        throw Error("\u63D2\u4EF6\u6570\u636E ID \u4E0D\u6B63\u786E\u6216\u91CD\u590D");
      return { version: 2, [field]: items, settings: data.settings || {} };
    }
    module2.exports = { createStore: createStore2, validateCollection: validateCollection2, randomUUID };
  }
});

// src/plugins/notes/model.js
var require_model = __commonJS({
  "src/plugins/notes/model.js"(exports2, module2) {
    var { randomUUID } = require("node:crypto");
    function string(value, max = 1e4) {
      if (typeof value !== "string") return "";
      if (value.length > max) throw new Error("\u5185\u5BB9\u8FC7\u957F");
      return value.trim();
    }
    function date(value) {
      if (!value) return "";
      if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error("\u65E5\u671F\u4E0D\u6B63\u786E");
      return new Date(value).toISOString();
    }
    function validateNote2(input) {
      return {
        id: input.id || randomUUID(),
        title: string(input.title, 120) || "\u672A\u547D\u540D\u4FBF\u7B7E",
        content: string(input.content, 3e4),
        color: ["yellow", "blue", "pink", "green"].includes(input.color) ? input.color : "yellow",
        updatedAt: date(input.updatedAt) || (/* @__PURE__ */ new Date()).toISOString()
      };
    }
    module2.exports = { validateNote: validateNote2 };
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
    var fs = require("node:fs");
    var path = require("node:path");
    var { DatabaseSync } = require("node:sqlite");
    var { withInitialExamples } = require_initial_examples();
    function seed2(context, definition2) {
      if (fs.existsSync(context.file)) {
        const db = new DatabaseSync(context.file, { readOnly: true });
        try {
          if (db.prepare("SELECT name FROM sqlite_master WHERE name='domain_state'").get() && db.prepare("SELECT id FROM domain_state LIMIT 1").get())
            return {};
        } finally {
          db.close();
        }
      }
      if (context.emptyInitialData) return { settings: {} };
      const legacy = path.join(context.dataDirectory, "collectify.sqlite");
      if (fs.existsSync(legacy)) {
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

// src/plugins/notes/schema.js
var require_schema = __commonJS({
  "src/plugins/notes/schema.js"(exports2, module2) {
    module2.exports = {
      methods: {
        saveNote(input) {
          if (input.id && !this.data.notes.some((n) => n.id === input.id)) throw Error("\u4FBF\u7B7E\u4E0D\u5B58\u5728");
          const note = require_model().validateNote({ ...input, updatedAt: (/* @__PURE__ */ new Date()).toISOString() });
          this.updateEntities("notes", [note]);
          return note;
        }
      },
      validate: (data) => require_domain_store().validateCollection(data, "notes", require_model().validateNote),
      id: "collectify.notes",
      schema: "CREATE TABLE IF NOT EXISTS notes(id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL, color TEXT NOT NULL CHECK(color IN ('yellow','blue','pink','green')), updated_at TEXT NOT NULL, sort_order INTEGER NOT NULL) STRICT;\r",
      tables: {
        notes: {
          fields: {
            id: "id",
            title: "title",
            content: "content",
            color: "color",
            updatedAt: "updated_at"
          }
        }
      },
      attachments: false
    };
  }
});

// src/plugins/notes/contracts.js
var require_contracts = __commonJS({
  "src/plugins/notes/contracts.js"(exports2, module2) {
    var { entityId, objectInput } = hostSdk.contracts;
    module2.exports = {
      state: {
        validateResult: (value) => {
          objectInput(value);
          if (!Array.isArray(value.notes)) throw Error("\u4FBF\u7B7E\u5217\u8868\u65E0\u6548");
        }
      },
      overlay: {},
      "note-save": {
        write: true,
        validate: objectInput,
        validateResult: (value) => {
          objectInput(value);
          entityId(value.id);
        }
      },
      "note-delete": { write: true, validate: entityId },
      "to-task": { validate: entityId },
      "note-sort": {
        write: true,
        validate: (value) => {
          if (!["manual", "updated"].includes(value)) throw Error("\u6392\u5E8F\u65B9\u5F0F\u65E0\u6548");
        }
      },
      "note-move": {
        write: true,
        validate: (input) => {
          objectInput(input);
          entityId(input.id);
          entityId(input.before);
        }
      }
    };
  }
});

// src/plugins/notes/backend.js
var { createStore, validateCollection } = require_domain_store();
var { validateNote } = require_model();
var { seed } = require_seed();
var definition = require_schema();
exports.create = async (context) => {
  const store = createStore(context.file, definition, seed(context, definition));
  async function call(action, payload) {
    switch (action) {
      case "state":
        return {
          notes: store.data.notes,
          settings: context.getSettings(),
          noteSort: store.data.settings.noteSort === "manual" ? "manual" : "updated"
        };
      case "note-sort": {
        if (!["manual", "updated"].includes(payload)) throw Error("\u4FBF\u7B7E\u6392\u5E8F\u65B9\u5F0F\u65E0\u6548");
        const data = store.snapshot();
        if (payload === "manual" && data.settings.noteSort !== "manual")
          data.notes.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
        data.settings.noteSort = payload;
        store.commit(data);
        context.changed();
        return;
      }
      case "note-move": {
        const data = store.snapshot();
        if (data.settings.noteSort !== "manual") throw Error("\u8BF7\u5148\u542F\u7528\u624B\u52A8\u6392\u5E8F");
        const from = data.notes.findIndex((n) => n.id === payload?.id), to = data.notes.findIndex((n) => n.id === payload?.before);
        if (from < 0 || to < 0 || from === to) throw Error("\u4FBF\u7B7E\u79FB\u52A8\u76EE\u6807\u65E0\u6548");
        const [note] = data.notes.splice(from, 1);
        data.notes.splice(
          data.notes.findIndex((n) => n.id === payload.before),
          0,
          note
        );
        store.commit(data);
        context.changed();
        return;
      }
      case "note-save": {
        const item = store.saveNote(payload);
        context.changed();
        return item;
      }
      case "note-delete":
        store.removeItem("notes", payload);
        context.changed();
        return;
      case "to-task": {
        const note = store.data.notes.find((n) => n.id === payload);
        if (!note) throw Error("\u4FBF\u7B7E\u4E0D\u5B58\u5728");
        if (!context.available("collectify.tasks")) throw Error("\u8BF7\u5148\u5728\u8BBE\u7F6E\u4E2D\u542F\u7528\u5F85\u529E\u63D2\u4EF6");
        return context.open("collectify.tasks", "create", { title: note.title, note: note.content });
      }
      case "overlay":
        return;
      default:
        throw Error("\u4E0D\u652F\u6301\u7684\u4FBF\u7B7E\u63D2\u4EF6\u64CD\u4F5C");
    }
  }
  return {
    contracts: require_contracts(),
    store,
    call,
    activate() {
    },
    deactivate() {
    },
    summary: () => ({ count: store.data.notes.length }),
    exportData: () => ({
      schemaVersion: 1,
      notes: store.data.notes,
      noteSort: store.data.settings.noteSort === "manual" ? "manual" : "updated"
    }),
    planData(data, mode) {
      if (data?.schemaVersion !== 1 || !Array.isArray(data.notes)) throw Error("\u4FBF\u7B7E\u6570\u636E\u7248\u672C\u6216\u683C\u5F0F\u4E0D\u6B63\u786E");
      const items = mode === "merge" ? [...new Map([...store.data.notes, ...data.notes].map((n) => [n.id, n])).values()] : data.notes;
      if (data.noteSort !== void 0 && !["manual", "updated"].includes(data.noteSort))
        throw Error("\u4FBF\u7B7E\u6392\u5E8F\u65B9\u5F0F\u65E0\u6548");
      return {
        schemaVersion: 1,
        notes: validateCollection({ notes: items }, "notes", validateNote).notes,
        noteSort: data.noteSort || store.data.settings.noteSort || "updated"
      };
    },
    importData(data) {
      store.commit({ notes: data.notes, settings: { noteSort: data.noteSort || "updated" } });
    },
    mcpTools() {
      const { z } = hostSdk.mcp;
      return [
        {
          name: "save_note",
          description: "\u65B0\u5EFA\u6216\u66F4\u65B0\u4FBF\u7B7E",
          write: true,
          inputSchema: {
            id: z.string().optional(),
            title: z.string().max(120),
            content: z.string().max(3e4),
            color: z.enum(["yellow", "blue", "pink", "green"]).optional()
          },
          handler: (input) => call("note-save", input)
        }
      ];
    }
  };
};
