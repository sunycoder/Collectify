const path = require('node:path');
const { shell, Notification } = require('electron');
const { createStore, validateCollection, validateTask } = require('../.shared/domain-store');
const { seed } = require('../.shared/seed');
const definition = require('./schema');
const { saveTask } = require('./model');
const { deliverReminders } = require('./reminders');
const { DesktopWidget } = require('./desktop-widget');
const { matchesTaskDate } = require('./task-query');
function widgetSettings(input = {}) {
    const bounds =
        input.bounds && ['x', 'y', 'width', 'height'].every((k) => Number.isFinite(input.bounds[k]))
            ? {
                  x: Math.round(input.bounds.x),
                  y: Math.round(input.bounds.y),
                  width: Math.max(300, Math.min(700, Math.round(input.bounds.width))),
                  height: Math.max(300, Math.min(1000, Math.round(input.bounds.height)))
              }
            : null;
    return {
        visible: input.visible === true,
        autoRestore: input.autoRestore === true,
        mode: input.mode === 'desktop' ? 'desktop' : 'floating',
        bounds
    };
}

exports.create = async (context) => {
    const store = createStore(
        context.file,
        {
            ...definition,
            validate: (data) => ({
                ...validateCollection(data, 'tasks', validateTask),
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
            widget: store.data.settings.widget || { visible: false, autoRestore: false, mode: 'floating', bounds: null }
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
        () => context.open(context.id, 'list'),
        context.smoke
    );
    let timer,
        running = false,
        busy = false,
        reminderWork = null;
    async function reminders() {
        if (!running || busy || context.smoke) return;
        busy = true;
        try {
            reminderWork = deliverReminders(store, async (task) => {
                if (!running) return;
                const n = new Notification({
                    title: `待办提醒 · ${task.title}`,
                    body: task.note.slice(0, 120) || '点击查看待办'
                });
                n.on('click', () => context.open(context.id, 'list'));
                n.show();
            });
            await reminderWork;
            context.changed();
        } catch (error) {
            context.emit('reminder-error', error.message);
        } finally {
            busy = false;
            reminderWork = null;
        }
    }
    async function bookmarks() {
        return context.available('collectify.bookmarks')
            ? context.invoke('collectify.bookmarks', 'list')
            : [...new Set(store.data.tasks.map((t) => t.bookmarkId).filter(Boolean))].map((id) => ({
                  id,
                  name: '关联收藏（收藏插件已停用）'
              }));
    }
    async function call(action, payload) {
        let result,
            write = false;
        switch (action) {
            case 'state':
                return { ...store.snapshot(), entries: await bookmarks(), categories: [], notes: [] };
            case 'task-save':
                result = store.saveTask(payload);
                write = true;
                break;
            case 'task-delete':
                store.removeItem('tasks', payload);
                write = true;
                break;
            case 'save-many': {
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
            case 'unlink-bookmark': {
                const data = store.snapshot();
                data.tasks = data.tasks.map((t) => (t.bookmarkId === payload ? { ...t, bookmarkId: '' } : t));
                store.commit(data);
                write = true;
                break;
            }
            case 'pick-files':
                return context.pick('files');
            case 'pick-folder':
                return [await context.pick('folder')].filter(Boolean);
            case 'open-file': {
                const item = store.data.tasks.find((t) => t.id === payload.id),
                    file = item?.attachments[payload.index];
                if (!file || !path.isAbsolute(file)) throw Error('附件不存在');
                if (payload.reveal) shell.showItemInFolder(file);
                else {
                    const error = await shell.openPath(file);
                    if (error) throw Error(error);
                }
                break;
            }
            case 'widget-open':
                await widget.open(payload === 'desktop' ? 'desktop' : 'floating');
                break;
            case 'widget-auto-restore': {
                const data = store.snapshot();
                data.settings.widget.autoRestore = payload === true;
                store.commit(data);
                break;
            }
            case 'settings':
                context.setSettings({ keepInTray: payload.keepInTray === true });
                break;
            case 'overlay':
                return;
            default:
                throw Error('不支持的待办插件操作');
        }
        if (write) {
            widget.update();
            context.changed();
        }
        return result;
    }
    return {
        store,
        widget,
        call,
        keepAlive: () => !!widget.win,
        async activate() {
            if (context.available('collectify.bookmarks')) {
                const known = new Set((await bookmarks()).map((e) => e.id)),
                    data = store.snapshot();
                if (data.tasks.some((t) => t.bookmarkId && !known.has(t.bookmarkId))) {
                    data.tasks = data.tasks.map((t) =>
                        t.bookmarkId && !known.has(t.bookmarkId) ? { ...t, bookmarkId: '' } : t
                    );
                    store.commit(data);
                    context.changed();
                }
            }
            running = true;
            timer = setInterval(() => void reminders(), 30000);
            if (store.data.settings.widget?.autoRestore && store.data.settings.widget.visible)
                await widget.open(store.data.settings.widget.mode);
        },
        async deactivate() {
            running = false;
            clearInterval(timer);
            widget.destroy();
            if (reminderWork) await reminderWork.catch(() => {});
        },
        async dispose() {
            running = false;
            clearInterval(timer);
            if (reminderWork) await reminderWork.catch(() => {});
            widget.dispose();
        },
        themeChanged() {
            widget.update();
        },
        summary: () => ({ count: store.data.tasks.filter((t) => !t.archived && t.status !== 'done').length }),
        navigation: () => [
            {
                id: 'list',
                label: '清单',
                count: store.data.tasks.filter((t) => !t.archived && t.status !== 'done').length
            },
            { id: 'matrix', label: '四象限' },
            { id: 'board', label: '看板' },
            { id: 'calendar', label: '日历' },
            { id: 'archive', label: '已归档', count: store.data.tasks.filter((t) => t.archived).length }
        ],
        exportData: () => ({
            schemaVersion: 1,
            tasks: store.data.tasks,
            widget: { ...store.data.settings.widget, visible: false, bounds: null }
        }),
        planData(data, mode) {
            if (data?.schemaVersion !== 1 || !Array.isArray(data.tasks)) throw Error('待办数据版本或格式不正确');
            const items =
                mode === 'merge'
                    ? [...new Map([...store.data.tasks, ...data.tasks].map((t) => [t.id, t])).values()]
                    : data.tasks;
            return {
                schemaVersion: 1,
                tasks: validateCollection({ tasks: items }, 'tasks', validateTask).tasks,
                widget: { ...data.widget, visible: false, bounds: null }
            };
        },
        reconcileImport(data, plugins) {
            const bookmarks = plugins.find((p) => p.id === 'collectify.bookmarks')?.data;
            if (!bookmarks) return;
            data.tasks = data.tasks.map((t) => ({
                ...t,
                bookmarkId: t.bookmarkId
                    ? bookmarks.referenceMap?.[t.bookmarkId] ||
                      (bookmarks.entries.some((e) => e.id === t.bookmarkId) ? t.bookmarkId : '')
                    : ''
            }));
        },
        importData(data) {
            store.commit({ tasks: data.tasks, settings: { widget: data.widget || store.data.settings.widget } });
            widget.update();
        },
        mcpTools() {
            const { z } = require('../../vendor/mcp-service.cjs');
            const task = z.object({
                id: z.string().optional(),
                title: z.string().max(160).optional(),
                status: z.enum(['inbox', 'todo', 'doing', 'done']).optional(),
                priority: z.enum(['high', 'medium', 'low']).optional(),
                important: z.boolean().optional(),
                urgent: z.boolean().optional(),
                allDay: z.boolean().optional(),
                startAt: z.string().optional(),
                endAt: z.string().optional(),
                dueAt: z.string().optional(),
                remindAt: z.string().optional(),
                note: z.string().max(10000).optional(),
                bookmarkId: z.string().optional(),
                archived: z.boolean().optional()
            });
            return [
                {
                    name: 'list_tasks',
                    description: '查询待办、日程或归档事项',
                    inputSchema: {
                        date: z.string().optional(),
                        dateField: z.enum(['dueAt', 'startAt', 'remindAt', 'createdAt', 'completedAt']).optional(),
                        status: z.enum(['inbox', 'todo', 'doing', 'done']).optional(),
                        query: z.string().optional(),
                        archived: z.boolean().optional()
                    },
                    handler: (input) =>
                        store.data.tasks.filter(
                            (t) =>
                                (input.archived ? t.archived : !t.archived) &&
                                (!input.status || t.status === input.status) &&
                                matchesTaskDate(t, input.date, input.dateField || 'dueAt') &&
                                (!input.query ||
                                    [t.title, t.note].some((s) => s.toLowerCase().includes(input.query.toLowerCase())))
                        )
                },
                {
                    name: 'save_tasks',
                    description: '整批校验并创建或更新待办，失败不部分保存',
                    write: true,
                    inputSchema: { tasks: z.array(task).min(1).max(100) },
                    handler: (input) => call('save-many', input.tasks)
                }
            ];
        }
    };
};
