const { createStore, validateCollection, validateNote } = require('../.shared/domain-store');
const { seed } = require('../.shared/seed');
const definition = require('./schema');
exports.create = async (context) => {
    const store = createStore(
        context.file,
        { ...definition, validate: (data) => validateCollection(data, 'notes', validateNote) },
        seed(context, definition)
    );
    async function call(action, payload) {
        switch (action) {
            case 'state':
                return { notes: store.data.notes, settings: context.getSettings() };
            case 'note-save': {
                const item = store.saveNote(payload);
                context.changed();
                return item;
            }
            case 'note-delete':
                store.removeItem('notes', payload);
                context.changed();
                return;
            case 'to-task': {
                const note = store.data.notes.find((n) => n.id === payload);
                if (!note) throw Error('便签不存在');
                if (!context.available('collectify.tasks')) throw Error('请先在设置中启用待办插件');
                return context.open('collectify.tasks', 'create', { title: note.title, note: note.content });
            }
            case 'overlay':
                return;
            default:
                throw Error('不支持的便签插件操作');
        }
    }
    return {
        store,
        call,
        activate() {},
        deactivate() {},
        summary: () => ({ count: store.data.notes.length }),
        exportData: () => ({ schemaVersion: 1, notes: store.data.notes }),
        planData(data, mode) {
            if (data?.schemaVersion !== 1 || !Array.isArray(data.notes)) throw Error('便签数据版本或格式不正确');
            const items =
                mode === 'merge'
                    ? [...new Map([...store.data.notes, ...data.notes].map((n) => [n.id, n])).values()]
                    : data.notes;
            return { schemaVersion: 1, notes: validateCollection({ notes: items }, 'notes', validateNote).notes };
        },
        importData(data) {
            store.commit({ notes: data.notes, settings: {} });
        },
        mcpTools() {
            const { z } = require('../../vendor/mcp-service.cjs');
            return [
                {
                    name: 'save_note',
                    description: '新建或更新便签',
                    write: true,
                    inputSchema: {
                        id: z.string().optional(),
                        title: z.string().max(120),
                        content: z.string().max(30000),
                        color: z.enum(['yellow', 'blue', 'pink', 'green']).optional()
                    },
                    handler: (input) => call('note-save', input)
                }
            ];
        }
    };
};
