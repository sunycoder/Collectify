const fs = require('node:fs'),
    os = require('node:os'),
    path = require('node:path');
const { performance } = require('node:perf_hooks');
const { createStore } = require('../src/plugins/.shared/domain-store');
const schema = require('../src/plugins/bookmarks/schema');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'collectify-bench-'));
const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * p)];
try {
    const reports = [];
    for (const size of [100, 1000, 5000]) {
        const store = createStore(path.join(directory, `${size}.sqlite`), schema, {});
        const entries = Array.from({ length: size }, (_, i) => ({
            id: `entry-${i}`,
            name: `收藏-${i}`,
            type: 'web',
            url: `https://example.com/${i}`,
            categoryId: 'inbox',
            note: '测试备注'
        }));
        store.commit({ ...store.data, entries });
        const samples = [];
        for (let i = 0; i < 25; i++) {
            const started = performance.now();
            store.save({ ...store.entries[Math.floor(size / 2)], note: `编辑-${i}` });
            samples.push(performance.now() - started);
            if (store.repository.lastWrite.entities !== 1) throw Error('单条更新发生全量实体写入');
        }
        const full = [];
        for (let i = 0; i < 8; i++) {
            const snapshot = structuredClone(store.data);
            snapshot.entries[Math.floor(size / 2)].note = `全量-${i}`;
            const started = performance.now();
            store.commit(snapshot);
            full.push(performance.now() - started);
        }
        reports.push({
            size,
            entityP50Ms: +percentile(samples, 0.5).toFixed(2),
            entityP95Ms: +percentile(samples, 0.95).toFixed(2),
            snapshotP50Ms: +percentile(full, 0.5).toFixed(2),
            entitiesPerEdit: 1
        });
    }
    const output = {
        platform: process.platform,
        node: process.versions.node,
        generatedAt: new Date().toISOString(),
        reports
    };
    fs.mkdirSync(path.resolve('dist'), { recursive: true });
    fs.writeFileSync('dist/architecture-benchmark.json', JSON.stringify(output, null, 2) + '\n', 'utf8');
    console.table(reports);
} finally {
    fs.rmSync(directory, { recursive: true, force: true });
}
