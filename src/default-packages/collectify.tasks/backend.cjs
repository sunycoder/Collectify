const hostSdk = require(require('node:path').join(require('electron').app.getAppPath(),'src/plugin-system/backend-sdk.js'));
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// src/plugins/.shared/entity-repository.js
var require_entity_repository = __commonJS({
  "src/plugins/.shared/entity-repository.js"(exports2, module2) {
    var fs = require("node:fs");
    var path2 = require("node:path");
    var { DatabaseSync } = require("node:sqlite");
    var { ensureStorageSchema } = hostSdk.storage;
    var EntityRepository = class {
      constructor(file, { id, schema, tables, attachments = false, migrate }) {
        Object.assign(this, { file, id, schema, tables, attachments });
        fs.mkdirSync(path2.dirname(file), { recursive: true });
        this.database((db) => {
          ensureStorageSchema(db);
          db.exec("CREATE TABLE IF NOT EXISTS domain_schema(id TEXT PRIMARY KEY,version INTEGER NOT NULL) STRICT");
          const row = db.prepare("SELECT * FROM domain_schema").get();
          if (row && (row.id !== id || row.version > 1)) throw Error("\u63D2\u4EF6\u9886\u57DF\u6570\u636E\u5E93\u8EAB\u4EFD\u6216\u7248\u672C\u4E0D\u5339\u914D");
          db.exec("BEGIN");
          try {
            db.exec(schema);
            migrate?.(db);
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
    var path2 = require("node:path");
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
      const legacy = path2.join(context.dataDirectory, "collectify.sqlite");
      if (fs.existsSync(legacy)) {
        const db = new DatabaseSync(legacy, { readOnly: true });
        try {
          const data = { settings: {} };
          for (const [table, d] of Object.entries(definition2.tables))
            data[table] = db.prepare(`SELECT * FROM ${table} ORDER BY sort_order,id`).all().map(
              (row) => Object.fromEntries(
                Object.entries(d.fields).map(([f, c]) => [
                  f,
                  d.booleans?.includes(f) ? !!row[c] : row[c] ?? (f === "repeat" ? "none" : f === "repeatDay" ? 1 : "")
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

// src/plugins/tasks/recurrence.js
var require_recurrence = __commonJS({
  "src/plugins/tasks/recurrence.js"(exports2, module2) {
    var RULES = ["none", "daily", "workdays", "weekly", "monthly"];
    function nextOccurrence(task) {
      const anchor = task.startAt || task.dueAt;
      if (!anchor || !RULES.includes(task.repeat) || task.repeat === "none") return null;
      const source = new Date(anchor), next = new Date(source);
      if (task.repeat === "monthly") {
        next.setDate(1);
        next.setMonth(next.getMonth() + 1);
        const last = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
        next.setDate(Math.min(task.repeatDay || source.getDate(), last));
      } else {
        next.setDate(next.getDate() + (task.repeat === "weekly" ? 7 : 1));
        if (task.repeat === "workdays") while ([0, 6].includes(next.getDay())) next.setDate(next.getDate() + 1);
      }
      const days = Math.round(
        (Date.UTC(next.getFullYear(), next.getMonth(), next.getDate()) - Date.UTC(source.getFullYear(), source.getMonth(), source.getDate())) / 864e5
      );
      const shift = (value) => {
        if (!value) return "";
        const date = new Date(value);
        date.setDate(date.getDate() + days);
        return date.toISOString();
      };
      return {
        ...task,
        id: void 0,
        status: "todo",
        archived: false,
        skipped: false,
        completedAt: "",
        notifiedAt: "",
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        nextTaskId: "",
        ...Object.fromEntries(["startAt", "endAt", "dueAt", "remindAt"].map((field) => [field, shift(task[field])]))
      };
    }
    module2.exports = { RULES, nextOccurrence };
  }
});

// src/plugins/tasks/model.js
var require_model = __commonJS({
  "src/plugins/tasks/model.js"(exports2, module2) {
    var { randomUUID } = require("node:crypto");
    var STATUSES = ["inbox", "todo", "doing", "done"];
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
    function validateTask2(input) {
      const title = string(input?.title, 160);
      if (!title) throw new Error("\u8BF7\u586B\u5199\u5F85\u529E\u6807\u9898");
      const dueAt = date(input.dueAt), remindAt = date(input.remindAt), startAt = date(input.startAt), endAt = date(input.endAt);
      if (endAt && (!startAt || Date.parse(endAt) <= Date.parse(startAt))) throw new Error("\u7ED3\u675F\u65F6\u95F4\u5FC5\u987B\u665A\u4E8E\u5F00\u59CB\u65F6\u95F4");
      const repeat = input.repeat || "none";
      if (!require_recurrence().RULES.includes(repeat)) throw Error("\u91CD\u590D\u89C4\u5219\u65E0\u6548");
      if (repeat !== "none" && !startAt && !dueAt) throw Error("\u91CD\u590D\u5F85\u529E\u9700\u8981\u8BA1\u5212\u65F6\u95F4\u6216\u622A\u6B62\u65F6\u95F4");
      const attachments = (input.attachments || []).map((p) => string(p, 2048));
      const path2 = require("node:path");
      if (attachments.length > 20 || attachments.some((p) => !path2.posix.isAbsolute(p) && !path2.win32.isAbsolute(p)))
        throw new Error("\u8BF7\u9009\u62E9\u6709\u6548\u7684\u672C\u5730\u6587\u4EF6\u6216\u6587\u4EF6\u5939\uFF0C\u6700\u591A 20 \u9879");
      return {
        id: input.id || randomUUID(),
        title,
        status: STATUSES.includes(input.status) ? input.status : "inbox",
        priority: ["high", "medium", "low"].includes(input.priority) ? input.priority : "medium",
        note: string(input.note),
        dueAt,
        remindAt,
        startAt,
        endAt,
        allDay: input.allDay === true,
        important: input.important === void 0 ? input.priority === "high" : input.important === true,
        urgent: input.urgent === true,
        attachments,
        bookmarkId: string(input.bookmarkId, 80),
        archived: input.archived === true,
        notifiedAt: date(input.notifiedAt),
        createdAt: date(input.createdAt) || (/* @__PURE__ */ new Date()).toISOString(),
        completedAt: date(input.completedAt),
        repeat,
        repeatDay: Number.isInteger(input.repeatDay) && input.repeatDay >= 1 && input.repeatDay <= 31 ? input.repeatDay : new Date(startAt || dueAt || Date.now()).getDate(),
        nextTaskId: string(input.nextTaskId, 80),
        skipped: input.skipped === true
      };
    }
    function saveTask2(store, input) {
      const previous = (store.data || store.snapshot()).tasks.find((t) => t.id === input.id);
      if (input.id && !previous) throw new Error("\u5F85\u529E\u4E0D\u5B58\u5728");
      const next = validateTask2({ ...previous, ...input });
      next.nextTaskId = previous?.nextTaskId || "";
      if (!previous || previous.repeat !== next.repeat || previous.startAt !== next.startAt || previous.dueAt !== next.dueAt)
        next.repeatDay = new Date(next.startAt || next.dueAt || Date.now()).getDate();
      if (previous && (next.remindAt !== previous.remindAt || previous.status === "done" && next.status !== "done" || previous.archived && !next.archived))
        next.notifiedAt = "";
      if (next.status === "done") next.completedAt = previous?.completedAt || (/* @__PURE__ */ new Date()).toISOString();
      else {
        next.completedAt = "";
        next.skipped = false;
      }
      if (next.archived && next.status !== "done") throw new Error("\u8BF7\u5148\u5B8C\u6210\u5F85\u529E\uFF0C\u518D\u5F52\u6863");
      if (previous?.status !== "done" && next.status === "done" && next.repeat !== "none" && !next.nextTaskId) {
        const following = validateTask2(require_recurrence().nextOccurrence(next));
        next.nextTaskId = following.id;
        const data = store.snapshot();
        const position = data.tasks.findIndex((t) => t.id === next.id);
        if (position >= 0) data.tasks[position] = next;
        else data.tasks.push(next);
        data.tasks.push(following);
        store.commit(data);
        return next;
      }
      if (store.updateEntities) store.updateEntities("tasks", [next]);
      else {
        const data = store.snapshot();
        if (previous) data.tasks = data.tasks.map((t) => t.id === next.id ? next : t);
        else data.tasks.push(next);
        store.commit(data);
      }
      return next;
    }
    function dueReminders(tasks, now = Date.now()) {
      return tasks.filter(
        (t) => !t.archived && t.status !== "done" && t.remindAt && Date.parse(t.remindAt) <= now && !t.notifiedAt
      );
    }
    module2.exports = { validateTask: validateTask2, saveTask: saveTask2, dueReminders, STATUSES };
  }
});

// src/plugins/tasks/schema.js
var require_schema = __commonJS({
  "src/plugins/tasks/schema.js"(exports2, module2) {
    module2.exports = {
      methods: {
        saveTask(input) {
          return require_model().saveTask(this, input);
        }
      },
      validate: (data) => require_domain_store().validateCollection(data, "tasks", require_model().validateTask),
      id: "collectify.tasks",
      migrate(db) {
        const fields = new Set(
          db.prepare("PRAGMA table_info(tasks)").all().map((r) => r.name)
        );
        for (const [name, definition2] of Object.entries({
          repeat_rule: "TEXT NOT NULL DEFAULT 'none'",
          repeat_day: "INTEGER NOT NULL DEFAULT 1",
          next_task_id: "TEXT NOT NULL DEFAULT ''",
          skipped: "INTEGER NOT NULL DEFAULT 0"
        }))
          if (!fields.has(name)) db.exec(`ALTER TABLE tasks ADD COLUMN ${name} ${definition2}`);
      },
      schema: "CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, title TEXT NOT NULL CHECK(length(trim(title))>0), note TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('inbox','todo','doing','done')), priority TEXT NOT NULL CHECK(priority IN ('high','medium','low')), important INTEGER NOT NULL CHECK(important IN (0,1)), urgent INTEGER NOT NULL CHECK(urgent IN (0,1)), all_day INTEGER NOT NULL CHECK(all_day IN (0,1)), start_at TEXT, end_at TEXT, due_at TEXT, remind_at TEXT, notified_at TEXT, bookmark_id TEXT, archived INTEGER NOT NULL CHECK(archived IN (0,1)), created_at TEXT NOT NULL, completed_at TEXT, sort_order INTEGER NOT NULL, CHECK(archived=0 OR status='done'), CHECK(end_at IS NULL OR (start_at IS NOT NULL AND end_at>start_at))) STRICT;\r\nCREATE TABLE IF NOT EXISTS task_attachments(task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, position INTEGER NOT NULL CHECK(position>=0), path TEXT NOT NULL, PRIMARY KEY(task_id,position)) STRICT;\r",
      tables: {
        tasks: {
          fields: {
            id: "id",
            title: "title",
            note: "note",
            status: "status",
            priority: "priority",
            important: "important",
            urgent: "urgent",
            allDay: "all_day",
            startAt: "start_at",
            endAt: "end_at",
            dueAt: "due_at",
            remindAt: "remind_at",
            notifiedAt: "notified_at",
            bookmarkId: "bookmark_id",
            archived: "archived",
            createdAt: "created_at",
            completedAt: "completed_at",
            repeat: "repeat_rule",
            repeatDay: "repeat_day",
            nextTaskId: "next_task_id",
            skipped: "skipped"
          },
          booleans: ["important", "urgent", "allDay", "archived", "skipped"],
          nullable: ["startAt", "endAt", "dueAt", "remindAt", "notifiedAt", "bookmarkId", "completedAt"]
        }
      },
      attachments: {
        owner: "tasks",
        table: "task_attachments",
        foreignKey: "task_id",
        position: "position",
        value: "path",
        field: "attachments"
      }
    };
  }
});

// src/plugins/tasks/reminders.js
var require_reminders = __commonJS({
  "src/plugins/tasks/reminders.js"(exports2, module2) {
    var { dueReminders } = require_model();
    async function deliverReminders2(store, deliver, now = Date.now()) {
      const due = dueReminders(store.snapshot().tasks, now);
      for (const task of due) {
        await deliver(task);
        const current = store.data.tasks.find((t) => t.id === task.id);
        if (current && current.remindAt === task.remindAt && !current.archived && current.status !== "done") {
          const data = store.snapshot();
          data.tasks.find((t) => t.id === task.id).notifiedAt = new Date(now).toISOString();
          store.commit(data);
        }
      }
      return due.length;
    }
    module2.exports = { deliverReminders: deliverReminders2 };
  }
});

// src/plugins/tasks/widget-material.js
var require_widget_material = __commonJS({
  "src/plugins/tasks/widget-material.js"(exports2, module2) {
    var os = require("node:os");
    function nativeMaterial(platform = process.platform, release = os.release()) {
      if (platform === "darwin") return "vibrancy";
      if (platform === "win32" && Number(release.split(".")[2]) >= 22621) return "acrylic";
      return "solid";
    }
    function applyWidgetMaterial(win, theme, { platform = process.platform, release = os.release(), smoke = false, reducedTransparency = false } = {}) {
      const kind = theme.widgetMaterial === "glass" && !smoke && !reducedTransparency ? nativeMaterial(platform, release) : "solid";
      try {
        win.setBackgroundColor(kind === "solid" ? theme.surface : "#00000000");
        if (platform === "win32") win.setBackgroundMaterial(kind === "acrylic" ? "acrylic" : "none");
        if (platform === "darwin") win.setVibrancy(kind === "vibrancy" ? "under-window" : null);
        return kind;
      } catch {
        win.setBackgroundColor(theme.surface);
        return "solid";
      }
    }
    function roundedWindowShape(width, height, radius = 20) {
      const r = Math.min(radius, Math.floor(width / 2), Math.floor(height / 2)), shape = [];
      for (let y = 0; y < r; y++) {
        const inset = Math.ceil(r - Math.sqrt(r * r - (r - y - 0.5) ** 2));
        shape.push(
          { x: inset, y, width: width - inset * 2, height: 1 },
          { x: inset, y: height - y - 1, width: width - inset * 2, height: 1 }
        );
      }
      shape.push({ x: 0, y: r, width, height: Math.max(1, height - r * 2) });
      return shape;
    }
    module2.exports = { nativeMaterial, applyWidgetMaterial, roundedWindowShape };
  }
});

// src/plugins/tasks/desktop-widget.js
var require_desktop_widget = __commonJS({
  "src/plugins/tasks/desktop-widget.js"(exports2, module2) {
    var { BrowserWindow, ipcMain, screen, nativeTheme } = require("electron");
    var path2 = require("node:path");
    var { pathToFileURL } = require("node:url");
    var { loadAuxiliary } = hostSdk.auxiliary;
    var { applyWidgetMaterial, roundedWindowShape, nativeMaterial } = require_widget_material();
    var { visibleBounds } = hostSdk.windows;
    var DesktopWidget2 = class {
      constructor(store, onChange, openMain, smoke = false) {
        this.store = store;
        this.onChange = onChange;
        this.openMain = openMain;
        this.smoke = smoke;
        this.win = null;
        this.generation = 0;
        this.systemCorners = process.platform === "win32" && nativeMaterial() === "acrylic" && (!smoke || process.argv.includes("--smoke-native-glass"));
        ipcMain.handle("desktop-widget", async (event, action, payload) => {
          try {
            if (!this.win || event.sender !== this.win.webContents || event.senderFrame !== this.win.webContents.mainFrame || event.senderFrame.url !== pathToFileURL(path2.join(__dirname, "widget.html")).href)
              throw Error("\u65E0\u6743\u8C03\u7528");
            switch (action) {
              case "state":
                return { ok: true, data: this.snapshot() };
              case "toggle-task": {
                const task = this.store.data.tasks.find((t) => t.id === payload);
                if (!task || task.archived) throw Error("\u5F85\u529E\u4E0D\u5B58\u5728");
                this.store.saveTask({ ...task, status: task.status === "done" ? "todo" : "done" });
                this.onChange();
                break;
              }
              case "mode":
                await this.open(payload === "desktop" ? "desktop" : "floating");
                break;
              case "open-main":
                this.openMain();
                break;
              case "hide":
                this.hide();
                break;
              default:
                throw Error("\u672A\u77E5\u64CD\u4F5C");
            }
            return { ok: true };
          } catch (error) {
            return { ok: false, error: error.message };
          }
        });
      }
      snapshot() {
        return {
          tasks: this.store.snapshot().tasks,
          theme: this.store.data.settings.theme,
          mode: this.store.data.settings.widget.mode,
          material: this.material || "solid",
          cornerRadius: this.systemCorners ? 8 : 20
        };
      }
      update() {
        if (this.win && !this.win.isDestroyed()) {
          this.updateMaterial();
          this.win.webContents.send("widget-state", this.snapshot());
        }
      }
      updateMaterial() {
        if (this.updatingMaterial) return;
        this.updatingMaterial = true;
        try {
          const theme = this.store.data.settings.theme, reducedTransparency = nativeTheme.prefersReducedTransparency;
          const windowHandle = this.win.getNativeWindowHandle().toString("hex");
          const key = JSON.stringify([windowHandle, theme.widgetMaterial, theme.surface, reducedTransparency]);
          if (this.materialKey !== key) {
            this.material = applyWidgetMaterial(this.win, theme, {
              smoke: this.smoke && !process.argv.includes("--smoke-native-glass"),
              reducedTransparency
            });
            this.materialKey = key;
          }
          if (process.platform === "win32" && !this.systemCorners) {
            const { width, height } = this.win.getBounds(), shapeKey = `${windowHandle}:${theme.widgetMaterial}:${this.material}:${width}:${height}`;
            if (shapeKey !== this.shapeKey) {
              this.shapeKey = shapeKey;
              this.win.setShape(roundedWindowShape(width, height));
            }
          }
        } finally {
          this.updatingMaterial = false;
        }
      }
      persist(patch) {
        const data = this.store.snapshot();
        data.settings.widget = { ...data.settings.widget, ...patch };
        this.store.commit(data);
      }
      async open(mode = "floating") {
        const generation = ++this.generation;
        this.persist({ mode, visible: true });
        if (!this.win) {
          const available = screen.getPrimaryDisplay().workArea;
          const saved = this.store.data.settings.widget.bounds;
          const desired = saved && screen.getAllDisplays().some(
            (d) => saved.x < d.workArea.x + d.workArea.width && saved.x + saved.width > d.workArea.x && saved.y < d.workArea.y + d.workArea.height && saved.y + saved.height > d.workArea.y
          ) ? saved : { x: available.x + available.width - 385, y: available.y + 70, width: 350, height: 520 };
          const bounds = visibleBounds(desired, screen.getDisplayMatching(desired).workArea);
          this.win = new BrowserWindow({
            ...bounds,
            fullscreenable: false,
            minWidth: 300,
            minHeight: 300,
            frame: false,
            transparent: !this.systemCorners,
            roundedCorners: true,
            thickFrame: this.systemCorners,
            resizable: true,
            skipTaskbar: mode === "floating",
            title: "Collectify \xB7 \u684C\u9762\u5F85\u529E",
            backgroundColor: "#00000000",
            show: false,
            icon: path2.join(require("electron").app.getAppPath(), "assets", "icon.png"),
            webPreferences: {
              preload: path2.join(__dirname, "widget-preload.js"),
              nodeIntegration: false,
              sandbox: true,
              contextIsolation: true,
              offscreen: this.smoke && !process.argv.includes("--smoke-native-glass")
            }
          });
          this.win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
          this.win.webContents.on("will-navigate", (event) => event.preventDefault());
          let boundsTimer;
          const saveBounds = () => {
            clearTimeout(boundsTimer);
            boundsTimer = setTimeout(() => {
              if (this.win) this.persist({ bounds: this.win.getBounds() });
            }, 250);
          };
          this.win.on("move", saveBounds);
          this.win.on("resize", saveBounds);
          if (!this.systemCorners) this.win.on("resize", () => this.updateMaterial());
          this.win.on("closed", () => {
            clearTimeout(boundsTimer);
            this.win = null;
            this.materialKey = null;
            this.shapeKey = null;
          });
          this.updateMaterial();
          const window = this.win;
          this.loading = loadAuxiliary(window, path2.join(__dirname, "widget.html"));
        }
        try {
          await this.loading;
        } catch (error) {
          if (generation === this.generation && this.win && !this.win.isDestroyed()) this.win.destroy();
          throw error;
        }
        if (generation !== this.generation || !this.win || this.win.isDestroyed()) return;
        this.win.setSkipTaskbar(mode === "floating");
        this.materialKey = null;
        this.shapeKey = null;
        if (!this.smoke && !this.win.isVisible()) this.win.showInactive();
        this.win.setAlwaysOnTop(mode === "floating", "floating");
        this.update();
        this.onChange();
      }
      hide() {
        this.generation++;
        if (this.win) this.win.hide();
        this.persist({ visible: false });
        this.onChange();
      }
      destroy() {
        this.generation++;
        if (this.win) this.win.destroy();
      }
      dispose() {
        this.destroy();
        ipcMain.removeHandler("desktop-widget");
      }
    };
    module2.exports = { DesktopWidget: DesktopWidget2 };
  }
});

// src/plugins/tasks/task-query.js
var require_task_query = __commonJS({
  "src/plugins/tasks/task-query.js"(exports2, module2) {
    (function(root) {
      function localDay(value) {
        const d = new Date(value);
        if (!Number.isFinite(d.getTime())) return "";
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      }
      function matchesTaskDate2(task, selected, field = "dueAt") {
        if (!selected) return true;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(selected) || !["dueAt", "createdAt", "completedAt", "remindAt", "startAt"].includes(field))
          return false;
        return !!task[field] && localDay(task[field]) === selected;
      }
      function matchesFilters(task, filters = {}, now = /* @__PURE__ */ new Date()) {
        const filter = filters.filter || "active", query = (filters.query || "").trim().toLocaleLowerCase();
        return (filter === "archive" ? task.archived : !task.archived) && matchesTaskDate2(task, filters.date, filters.dateField || "dueAt") && (filter !== "today" || task.dueAt && localDay(task.dueAt) === localDay(now)) && (filter !== "overdue" || task.status !== "done" && task.dueAt && (task.allDay ? new Date(new Date(task.dueAt).setHours(24, 0, 0, 0)) : new Date(task.dueAt)) < now) && (filter !== "high" || task.priority === "high") && [task.title, task.note].some((value) => (value || "").toLocaleLowerCase().includes(query));
      }
      const api = { localDay, matchesTaskDate: matchesTaskDate2, matchesFilters };
      if (typeof module2 !== "undefined") module2.exports = api;
      else root.TaskQuery = api;
    })(typeof globalThis !== "undefined" ? globalThis : exports2);
  }
});

// src/plugins/tasks/contracts.js
var require_contracts = __commonJS({
  "src/plugins/tasks/contracts.js"(exports2, module2) {
    var { objectInput, entityId } = hostSdk.contracts;
    module2.exports = {
      state: {
        validateResult: (value) => {
          objectInput(value);
          if (!Array.isArray(value.tasks)) throw Error("\u5F85\u529E\u5217\u8868\u65E0\u6548");
        }
      },
      overlay: {},
      "pick-files": {},
      "pick-folder": {},
      "widget-open": {},
      "widget-auto-restore": {},
      settings: { write: true, validate: objectInput },
      "task-save": {
        write: true,
        validate: objectInput,
        validateResult: (value) => {
          objectInput(value);
          entityId(value.id);
        }
      },
      "task-delete": { write: true, validate: entityId },
      "task-remind": {
        write: true,
        validate: (input) => {
          objectInput(input);
          entityId(input.id);
          if (typeof input.remindAt !== "string") throw Error("\u63D0\u9192\u65F6\u95F4\u65E0\u6548");
        }
      },
      "unlink-bookmark": { write: true, validate: entityId },
      "open-file": {
        validate: (input) => {
          objectInput(input);
          entityId(input.id);
          if (!Number.isInteger(input.index) || input.index < 0 || input.index >= 20) throw Error("\u9644\u4EF6\u7D22\u5F15\u65E0\u6548");
        }
      },
      "save-many": {
        write: true,
        validate: (input) => {
          if (!Array.isArray(input) || !input.length || input.length > 200) throw Error("\u6279\u91CF\u5F85\u529E\u53C2\u6570\u65E0\u6548");
          input.forEach(objectInput);
        }
      }
    };
  }
});

// src/plugins/tasks/backend.js
var path = require("node:path");
var { shell, Notification } = require("electron");
var { createStore, validateCollection } = require_domain_store();
var { seed } = require_seed();
var definition = require_schema();
var { saveTask, validateTask } = require_model();
var { deliverReminders } = require_reminders();
var { DesktopWidget } = require_desktop_widget();
var { matchesTaskDate } = require_task_query();
function widgetSettings(input = {}) {
  const bounds = input.bounds && ["x", "y", "width", "height"].every((k) => Number.isFinite(input.bounds[k])) ? {
    x: Math.round(input.bounds.x),
    y: Math.round(input.bounds.y),
    width: Math.max(300, Math.min(700, Math.round(input.bounds.width))),
    height: Math.max(300, Math.min(1e3, Math.round(input.bounds.height)))
  } : null;
  return {
    visible: input.visible === true,
    autoRestore: input.autoRestore === true,
    mode: input.mode === "desktop" ? "desktop" : "floating",
    bounds
  };
}
exports.create = async (context) => {
  const store = createStore(
    context.file,
    {
      ...definition,
      validate: (data) => ({
        ...validateCollection(data, "tasks", validateTask),
        settings: { widget: widgetSettings(data.settings?.widget) }
      })
    },
    seed(context, definition)
  );
  const fullSnapshot = store.snapshot.bind(store);
  store.snapshot = () => ({
    ...fullSnapshot(),
    settings: {
      ...context.getSettings(),
      widget: store.data.settings.widget || { visible: false, autoRestore: false, mode: "floating", bounds: null }
    }
  });
  const widgetStore = {
    get data() {
      return store.snapshot();
    },
    snapshot: () => store.snapshot(),
    commit: (data) => store.commit(data),
    saveTask: (data) => store.saveTask(data)
  };
  const widget = new DesktopWidget(
    widgetStore,
    () => context.changed(),
    () => context.open(context.id, "list"),
    context.smoke
  );
  let timer, running = false, busy = false, reminderWork = null;
  async function reminders() {
    if (!running || busy || context.smoke) return;
    busy = true;
    try {
      reminderWork = deliverReminders(store, async (task) => {
        if (!running) return;
        const n = new Notification({
          title: `\u5F85\u529E\u63D0\u9192 \xB7 ${task.title}`,
          body: task.note.slice(0, 120) || "\u70B9\u51FB\u67E5\u770B\u5F85\u529E"
        });
        n.on("click", () => context.open(context.id, "list"));
        n.show();
      });
      await reminderWork;
      context.changed();
    } catch (error) {
      context.emit("reminder-error", error.message);
    } finally {
      busy = false;
      reminderWork = null;
    }
  }
  async function bookmarks() {
    return context.available("collectify.bookmarks") ? context.invoke("collectify.bookmarks", "list") : [...new Set(store.data.tasks.map((t) => t.bookmarkId).filter(Boolean))].map((id) => ({
      id,
      name: "\u5173\u8054\u6536\u85CF\uFF08\u6536\u85CF\u63D2\u4EF6\u5DF2\u505C\u7528\uFF09"
    }));
  }
  async function call(action, payload) {
    let result, write = false;
    switch (action) {
      case "state":
        return { ...store.snapshot(), entries: await bookmarks(), categories: [], notes: [] };
      case "task-save":
        result = store.saveTask(payload);
        write = true;
        break;
      case "task-remind": {
        const current = store.snapshot().tasks.find((item) => item.id === payload?.id);
        if (!current || current.archived || current.status === "done")
          throw Error("\u5F85\u529E\u5DF2\u5B8C\u6210\u3001\u5F52\u6863\u6216\u5220\u9664\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5");
        const time = Date.parse(payload.remindAt);
        if (!Number.isFinite(time) || time <= Date.now()) throw Error("\u8BF7\u9009\u62E9\u672A\u6765\u7684\u63D0\u9192\u65F6\u95F4");
        result = store.saveTask({ ...current, remindAt: new Date(time).toISOString() });
        write = true;
        break;
      }
      case "task-delete":
        store.removeItem("tasks", payload);
        write = true;
        break;
      case "save-many": {
        let data = store.snapshot();
        const staged = {
          snapshot: () => structuredClone(data),
          commit: (value) => {
            data = store.validate(value);
          }
        };
        result = payload.map((item) => saveTask(staged, item));
        store.commit(data);
        write = true;
        break;
      }
      case "unlink-bookmark": {
        const data = store.snapshot();
        data.tasks = data.tasks.map((t) => t.bookmarkId === payload ? { ...t, bookmarkId: "" } : t);
        store.commit(data);
        write = true;
        break;
      }
      case "pick-files":
        return context.pick("files");
      case "pick-folder":
        return [await context.pick("folder")].filter(Boolean);
      case "open-file": {
        const item = store.data.tasks.find((t) => t.id === payload.id), file = item?.attachments[payload.index];
        if (!file || !path.isAbsolute(file)) throw Error("\u9644\u4EF6\u4E0D\u5B58\u5728");
        if (payload.reveal) shell.showItemInFolder(file);
        else {
          const error = await shell.openPath(file);
          if (error) throw Error(error);
        }
        break;
      }
      case "widget-open":
        await widget.open(payload === "desktop" ? "desktop" : "floating");
        break;
      case "widget-auto-restore": {
        const data = store.snapshot();
        data.settings.widget.autoRestore = payload === true;
        store.commit(data);
        break;
      }
      case "settings":
        context.setSettings({ keepInTray: payload.keepInTray === true });
        break;
      case "overlay":
        return;
      default:
        throw Error("\u4E0D\u652F\u6301\u7684\u5F85\u529E\u63D2\u4EF6\u64CD\u4F5C");
    }
    if (write) {
      widget.update();
      context.changed();
    }
    return result;
  }
  return {
    contracts: require_contracts(),
    store,
    search: (query) => store.data.tasks.filter((t) => [t.title, t.note].some((v) => v.toLocaleLowerCase().includes(query))).map((t) => ({
      id: t.id,
      title: t.title,
      snippet: t.note.slice(0, 180),
      route: "list",
      payload: { focusId: t.id }
    })),
    widget,
    call,
    keepAlive: () => !!widget.win,
    async activate() {
      if (context.available("collectify.bookmarks")) {
        const known = new Set((await bookmarks()).map((e) => e.id)), data = store.snapshot();
        if (data.tasks.some((t) => t.bookmarkId && !known.has(t.bookmarkId))) {
          data.tasks = data.tasks.map(
            (t) => t.bookmarkId && !known.has(t.bookmarkId) ? { ...t, bookmarkId: "" } : t
          );
          store.commit(data);
          context.changed();
        }
      }
      running = true;
      timer = setInterval(() => void reminders(), 3e4);
      if (store.data.settings.widget?.autoRestore && store.data.settings.widget.visible)
        await widget.open(store.data.settings.widget.mode);
    },
    async deactivate() {
      running = false;
      clearInterval(timer);
      widget.destroy();
      if (reminderWork) await reminderWork.catch(() => {
      });
    },
    async dispose() {
      running = false;
      clearInterval(timer);
      if (reminderWork) await reminderWork.catch(() => {
      });
      widget.dispose();
    },
    themeChanged() {
      widget.update();
    },
    summary: () => ({ count: store.data.tasks.filter((t) => !t.archived && t.status !== "done").length }),
    navigation: () => [
      {
        id: "list",
        label: "\u6E05\u5355",
        count: store.data.tasks.filter((t) => !t.archived && t.status !== "done").length
      },
      { id: "matrix", label: "\u56DB\u8C61\u9650" },
      { id: "board", label: "\u770B\u677F" },
      { id: "calendar", label: "\u65E5\u5386" },
      { id: "archive", label: "\u5DF2\u5F52\u6863", count: store.data.tasks.filter((t) => t.archived).length }
    ],
    exportData: () => ({
      schemaVersion: 1,
      tasks: store.data.tasks,
      widget: { ...store.data.settings.widget, visible: false, bounds: null }
    }),
    planData(data, mode) {
      if (data?.schemaVersion !== 1 || !Array.isArray(data.tasks)) throw Error("\u5F85\u529E\u6570\u636E\u7248\u672C\u6216\u683C\u5F0F\u4E0D\u6B63\u786E");
      const items = mode === "merge" ? [...new Map([...store.data.tasks, ...data.tasks].map((t) => [t.id, t])).values()] : data.tasks;
      return {
        schemaVersion: 1,
        tasks: validateCollection({ tasks: items }, "tasks", validateTask).tasks,
        widget: { ...data.widget, visible: false, bounds: null }
      };
    },
    reconcileImport(data, plugins) {
      const bookmarks2 = plugins.find((p) => p.id === "collectify.bookmarks")?.data;
      if (!bookmarks2) return;
      data.tasks = data.tasks.map((t) => ({
        ...t,
        bookmarkId: t.bookmarkId ? bookmarks2.referenceMap?.[t.bookmarkId] || (bookmarks2.entries.some((e) => e.id === t.bookmarkId) ? t.bookmarkId : "") : ""
      }));
    },
    importData(data) {
      store.commit({ tasks: data.tasks, settings: { widget: data.widget || store.data.settings.widget } });
      widget.update();
    },
    mcpTools() {
      const { z } = hostSdk.mcp;
      const task = z.object({
        id: z.string().optional(),
        title: z.string().max(160).optional(),
        status: z.enum(["inbox", "todo", "doing", "done"]).optional(),
        priority: z.enum(["high", "medium", "low"]).optional(),
        important: z.boolean().optional(),
        urgent: z.boolean().optional(),
        allDay: z.boolean().optional(),
        startAt: z.string().optional(),
        endAt: z.string().optional(),
        dueAt: z.string().optional(),
        remindAt: z.string().optional(),
        note: z.string().max(1e4).optional(),
        bookmarkId: z.string().optional(),
        archived: z.boolean().optional()
      });
      return [
        {
          name: "list_tasks",
          description: "\u67E5\u8BE2\u5F85\u529E\u3001\u65E5\u7A0B\u6216\u5F52\u6863\u4E8B\u9879",
          inputSchema: {
            date: z.string().optional(),
            dateField: z.enum(["dueAt", "startAt", "remindAt", "createdAt", "completedAt"]).optional(),
            status: z.enum(["inbox", "todo", "doing", "done"]).optional(),
            query: z.string().optional(),
            archived: z.boolean().optional()
          },
          handler: (input) => store.data.tasks.filter(
            (t) => (input.archived ? t.archived : !t.archived) && (!input.status || t.status === input.status) && matchesTaskDate(t, input.date, input.dateField || "dueAt") && (!input.query || [t.title, t.note].some((s) => s.toLowerCase().includes(input.query.toLowerCase())))
          )
        },
        {
          name: "save_tasks",
          description: "\u6574\u6279\u6821\u9A8C\u5E76\u521B\u5EFA\u6216\u66F4\u65B0\u5F85\u529E\uFF0C\u5931\u8D25\u4E0D\u90E8\u5206\u4FDD\u5B58",
          write: true,
          inputSchema: { tasks: z.array(task).min(1).max(100) },
          handler: (input) => call("save-many", input.tasks)
        }
      ];
    }
  };
};
