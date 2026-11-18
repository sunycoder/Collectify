const { test } = require('node:test'),
    assert = require('node:assert/strict');
const fs = require('node:fs'),
    path = require('node:path'),
    os = require('node:os');
const { createStore } = require('../src/plugins/.shared/domain-store');
test('公共存储不依赖业务插件模型，插件定义负责自己的业务校验', () => {
    for (const file of ['domain-store.js', 'entity-repository.js']) {
        const source = fs.readFileSync(path.resolve(__dirname, '../src/plugins/.shared', file), 'utf8');
        assert.doesNotMatch(source, /require\(['"](?:\.\.\/)+(?:tasks|notes|bookmarks)\//);
        assert.doesNotMatch(source, /\b(?:validateTask|validateNote|validateEntry)\b/);
    }
});
test('实体更新只写目标记录，唯一键冲突和过期写入原子回滚，导入交换分类名称兼容', (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'architecture-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const definition = require('../src/plugins/bookmarks/schema'),
        file = path.join(dir, 'bookmarks.sqlite');
    const store = createStore(file, definition, {});
    const a = store.saveCategory({ name: 'A' }),
        b = store.saveCategory({ name: 'B' });
    const entry = store.save({ name: '资源', type: 'text', content: '内容', password: 'keep', categoryId: a.id });
    store.markOpened(entry.id);
    assert.equal(store.repository.lastWrite.entities, 1);
    const stale = createStore(file, definition, {}),
        prior = store.snapshot();
    assert.throws(() => store.saveCategory({ ...a, name: 'B' }), /重复/);
    assert.deepEqual(store.data, prior);
    const data = store.snapshot();
    data.categories = data.categories.map((c) =>
        c.id === a.id ? { ...c, name: 'B' } : c.id === b.id ? { ...c, name: 'A' } : c
    );
    store.commit(data);
    assert.throws(() => stale.markOpened(entry.id), /其他实例/);
    assert.equal(stale.entries[0].lastOpened, prior.entries[0].lastOpened);
    const reopened = createStore(file, definition, {});
    assert.equal(reopened.entries[0].password, 'keep');
    assert.equal(reopened.categories.find((c) => c.id === a.id).name, 'B');
});
test('契约拒绝非法动作和参数，耗时诊断有界且不保存正文', () => {
    const { validateRequest } = require('../src/plugin-system/request-contract');
    const contracts = require('../src/plugins/notes/contracts');
    assert.throws(
        () => validateRequest(contracts, 'unknown', {}),
        (error) => error.code === 'UNSUPPORTED_ACTION'
    );
    assert.throws(
        () => validateRequest(contracts, 'note-delete', '../escape'),
        (error) => error.code === 'INVALID_ARGUMENT'
    );
    const { OperationMetrics } = require('../src/plugin-system/operation-metrics');
    const metrics = new OperationMetrics(2);
    for (const action of ['a', 'b', 'c']) metrics.start('plugin', action)();
    assert.equal(metrics.snapshot().length, 2);
    assert.ok(metrics.snapshot().every((row) => Number.isFinite(row.p95Ms)));
});
test('独立任务进程成功返回、崩溃拒绝与停用回收，不访问插件外入口', async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'plugin-process-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const { PluginTaskPool } = require('../src/plugin-system/process-task');
    const success = path.join(dir, 'success.cjs');
    fs.writeFileSync(success, "require('node:worker_threads').parentPort.postMessage({result:42});");
    const pool = new PluginTaskPool(dir);
    t.after(() => pool.stop());
    const job = pool.start(success, {});
    const result = await new Promise((resolve, reject) => {
        job.once('message', resolve);
        job.once('error', reject);
    });
    assert.deepEqual(result, { result: 42 });
    await job.exited;
    const crash = path.join(dir, 'crash.cjs');
    fs.writeFileSync(crash, "throw Error('fixture crash');");
    const crashed = pool.start(crash, {});
    await new Promise((resolve) =>
        crashed.once('error', (error) => {
            assert.match(error.message, /fixture crash/);
            resolve();
        })
    );
    await crashed.exited;
    const hang = path.join(dir, 'hang.cjs');
    fs.writeFileSync(hang, 'setInterval(()=>{},1000);');
    const pending = pool.start(hang, {});
    pending.on('error', () => {});
    await pool.stop();
    assert.equal(pool.jobs.size, 0);
    assert.throws(() => pool.start(success, {}), /停用/);
    pool.activate();
    assert.throws(() => pool.start(__filename, {}), /插件自身/);
});
test('卸载等待超时不移除后台或清理数据，在途提交结束后允许重试', async () => {
    const { PluginServices } = require('../src/plugin-system/services');
    const registry = { get: () => ({ enabled: true }), plugins: new Map([['test', { directory: __dirname }]]) };
    const services = new PluginServices(registry, { cleanupTimeoutMs: 20 });
    let release;
    const pending = new Promise((resolve) => {
        release = resolve;
    });
    let disposed = false;
    services.providers.set('test', {
        dispose() {
            disposed = true;
        }
    });
    const operation = services.perform('test', () => pending);
    await assert.rejects(services.unload('test'), (error) => error.code === 'PLUGIN_CLEANUP_TIMEOUT');
    assert.equal(services.providers.has('test'), true);
    assert.equal(disposed, false);
    await assert.rejects(services.call('test', 'state'), /后台能力|卸载/);
    release();
    await operation;
    await services.unload('test');
    assert.equal(disposed, true);
    assert.equal(services.providers.has('test'), false);
});
