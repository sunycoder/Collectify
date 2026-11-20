const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'),
    path = require('node:path'),
    os = require('node:os');
const { createStore } = require('../src/plugins/.shared/domain-store');
const taskDefinition = require('../src/plugins/tasks/schema');
const { saveTask } = require('../src/plugins/tasks/model');
const Calc = require('../src/plugin-library/calculator/engine');
function directory(t) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'collectify-workflows-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    return dir;
}
test('重复待办完成、跳过与重开保持唯一后继，月底跨二月后仍回到原日期，重启保留', (t) => {
    const file = path.join(directory(t), 'tasks.sqlite');
    let store = createStore(file, taskDefinition);
    const original = saveTask(store, {
        title: '月报',
        repeat: 'monthly',
        dueAt: new Date(2027, 0, 31, 10).toISOString(),
        status: 'todo'
    });
    const done = saveTask(store, { ...original, status: 'done' });
    assert.ok(done.nextTaskId);
    let next = store.data.tasks.find((task) => task.id === done.nextTaskId);
    assert.equal(new Date(next.dueAt).getDate(), 28);
    saveTask(store, { ...original, status: 'done' });
    saveTask(store, { ...original, status: 'todo' });
    saveTask(store, { ...original, status: 'done' });
    assert.equal(store.data.tasks.length, 2, '旧表单和重开不能重复生成');
    const skipped = saveTask(store, { ...next, status: 'done', skipped: true });
    next = store.data.tasks.find((task) => task.id === skipped.nextTaskId);
    assert.equal(new Date(next.dueAt).getDate(), 31);
    assert.equal(next.skipped, false);
    store = createStore(file, taskDefinition);
    assert.equal(store.data.tasks.length, 3);
    assert.equal(store.data.tasks.find((task) => task.id === skipped.id).skipped, true);
});
test('工作日重复跳过周末，修改锚点更新每月日期；无日期不能开启重复', (t) => {
    const store = createStore(path.join(directory(t), 'tasks.sqlite'), taskDefinition);
    const task = saveTask(store, {
        title: '日报',
        repeat: 'workdays',
        dueAt: new Date(2026, 10, 20, 9).toISOString(),
        status: 'todo'
    });
    const done = saveTask(store, { id: task.id, status: 'done' });
    assert.equal(new Date(store.data.tasks.find((t) => t.id === done.nextTaskId).dueAt).getDay(), 1);
    const changed = saveTask(store, {
        id: done.nextTaskId,
        repeat: 'monthly',
        dueAt: new Date(2026, 10, 26).toISOString()
    });
    assert.equal(changed.repeatDay, 26);
    assert.throws(() => saveTask(store, { title: '没有日期', repeat: 'daily' }), /需要/);
});
test('中文命名变量按顺序重算，坏定义阻止下游使用旧值，变量名中的 x 不误识别为乘号', () => {
    const calculate = (...expressions) => Calc.calculate(expressions.map((expression) => ({ expression })));
    let rows = calculate('单价 = 35', '数量 = 12', '单价 * 数量');
    assert.equal(rows[2].text, '420');
    rows = calculate('单价 = 40', '数量 = 12', '单价 * 数量');
    assert.equal(rows[2].text, '480');
    rows = calculate('单价 = 35', '单价 =', '单价 * 12');
    assert.ok(rows[1].error);
    assert.ok(rows[2].error);
    rows = calculate('a2x3=4', 'a2x3*2', '2x3', '(2+3)X4', 'atan2=3');
    assert.equal(rows[1].text, '8');
    assert.equal(rows[2].text, '6');
    assert.equal(rows[3].text, '20');
    assert.match(rows[4].error, /保留/);
});
test('统一搜索仅启用插件，声明字段可搜索嵌套公式，不读取凭据；单个插件出错不影响其他结果', async () => {
    const { PluginServices } = require('../src/plugin-system/services');
    const { PluginStorage } = require('../src/plugin-system/storage');
    const { matchRecord } = require('../src/plugin-system/content-search');
    assert.equal(
        matchRecord({ title: '测试', password: 'passwordneedle' }, 'passwordneedle', ['title'], 'title', 'home', '1'),
        null
    );
    const plugins = [
        { id: 'broken', enabled: true },
        {
            id: 'sheet',
            name: '稿纸',
            enabled: true,
            search: { keyPrefix: 'sheet:', fields: ['title', 'rows.*.expression'], title: 'title', route: 'home' }
        },
        { id: 'disabled', enabled: false }
    ];
    const fake = {
        registry: {
            list: () => plugins,
            storage: {
                export: () => ({
                    'sheet:1': { id: '1', title: '订单', rows: [{ expression: '单价=35' }] },
                    'private:1': { title: '单价', password: 'secret' }
                })
            }
        },
        providers: new Map([
            [
                'broken',
                {
                    search: () => {
                        throw Error('停用中');
                    }
                }
            ],
            [
                'disabled',
                {
                    search: () => {
                        throw Error('不应执行');
                    }
                }
            ]
        ]),
        perform: async (_id, run) => run()
    };
    const found = await PluginServices.prototype.searchContent.call(fake, '单价');
    assert.equal(found.length, 1);
    assert.equal(found[0].title, '订单');
    assert.deepEqual(found[0].payload, { focusId: '1' });
    assert.equal(typeof PluginStorage, 'function');
});
test('Diff 保存组合重新打开读取磁盘最新内容，重新定位取消不改变当前目录，备份保留组合', async (t) => {
    const dir = directory(t),
        left = path.join(dir, 'a.txt'),
        right = path.join(dir, 'b.txt');
    fs.writeFileSync(left, 'old');
    fs.writeFileSync(right, 'right');
    const backend = await require('../src/plugin-library/diff/backend').create(
        { file: path.join(dir, 'data.sqlite') },
        { electron: { dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) } } }
    );
    const pairs = await backend.call('pair-save', {
        name: '常用',
        paths: [left, right],
        settings: { ignoreWhitespace: true }
    });
    assert.equal(pairs.length, 1);
    assert.equal(await backend.call('pair-choose', { side: 1 }), null);
    assert.equal((await backend.call('state')).roots.filter(Boolean).length, 0);
    fs.writeFileSync(left, 'new');
    const reopened = await backend.call('import', { paths: pairs[0].paths });
    assert.equal(reopened[0].item.text, 'new');
    const backup = backend.exportData();
    assert.deepEqual(backup.pairs[0].paths, [left, right]);
    assert.equal(backend.planData(backup).pairs[0].settings.ignoreWhitespace, true);
    await assert.rejects(backend.call('pair-save', { paths: [left, path.join(dir, 'missing')] }));
    assert.equal((await backend.call('pair-list')).length, 1);
    await backend.dispose?.();
});
