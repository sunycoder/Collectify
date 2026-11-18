/** 只记录操作标识和耗时，禁止记录正文、路径、密码及调用参数。 */
class OperationMetrics {
    constructor(limit = 100) {
        this.limit = limit;
        this.samples = new Map();
    }
    start(pluginId, action) {
        const started = performance.now();
        return () => {
            const key = pluginId + ':' + action;
            const row = this.samples.get(key) || { count: 0, maxMs: 0, durations: [] };
            const elapsed = performance.now() - started;
            row.count++;
            row.maxMs = Math.max(row.maxMs, elapsed);
            row.durations.push(elapsed);
            if (row.durations.length > 50) row.durations.shift();
            this.samples.delete(key);
            this.samples.set(key, row);
            if (this.samples.size > this.limit) this.samples.delete(this.samples.keys().next().value);
        };
    }
    snapshot() {
        return [...this.samples].map(([key, row]) => {
            const sorted = [...row.durations].sort((a, b) => a - b);
            return {
                key,
                count: row.count,
                maxMs: Math.round(row.maxMs),
                p50Ms: Math.round(sorted[Math.floor((sorted.length - 1) * 0.5)]),
                p95Ms: Math.round(sorted[Math.floor((sorted.length - 1) * 0.95)])
            };
        });
    }
}
module.exports = { OperationMetrics };
