const { test } = require('node:test'),
    assert = require('node:assert/strict');
const { request } = require('../src/distribution/transport');
const { transferMeter } = require('../src/distribution/transfer');
const { createProvider } = require('../src/distribution/providers');
const { validateConfig } = require('../src/distribution/config');
test('持续传输按空闲时间计时，超过连接时限仍可完成，并报告真实字节进度', async () => {
    let controller;
    const progress = [];
    const body = new ReadableStream({
        start(c) {
            controller = c;
        }
    });
    const timer = setInterval(() => controller.enqueue(new Uint8Array([1, 2])), 30);
    setTimeout(() => {
        clearInterval(timer);
        controller.close();
    }, 250);
    const bytes = await request('https://example.com/file', {
        fetcher: async () => new Response(body),
        connectTimeoutMs: 100,
        idleTimeoutMs: 1000,
        totalTimeoutMs: 3000,
        progress: (n, t) => progress.push(n)
    });
    assert.ok(bytes.length >= 4);
    assert.equal(progress[0], 0);
    assert.equal(progress.at(-1), bytes.length);
});
test('连接与流空闲分别超时，用户取消后释放流并给出中文原因', async () => {
    await assert.rejects(
        request('https://example.com/file', { fetcher: () => new Promise(() => {}), connectTimeoutMs: 15 }),
        /连接.*超时/
    );
    let cancelled = false;
    await assert.rejects(
        request('https://example.com/file', {
            fetcher: async () =>
                new Response(
                    new ReadableStream({
                        cancel() {
                            cancelled = true;
                        }
                    })
                ),
            idleTimeoutMs: 15
        }),
        /没有收到数据/
    );
    assert.equal(cancelled, true);
    const controller = new AbortController();
    const task = request('https://example.com/file', {
        fetcher: async () => new Response(new ReadableStream({})),
        signal: controller.signal
    });
    setTimeout(() => controller.abort(), 10);
    await assert.rejects(task, /取消/);
});
test('速度和剩余时间根据字节变化计算，停止接收后速度归零，未知总量不冒充百分比', () => {
    let now = 0;
    const meter = transferMeter({ total: 1000, now: () => now });
    assert.equal(meter(0).speed, 0);
    now = 1000;
    const status = meter(500);
    assert.equal(status.speed, 500);
    assert.equal(status.percent, 50);
    assert.equal(status.remaining, 1);
    now = 2000;
    assert.equal(meter(500).speed, 0);
    assert.equal(transferMeter()().percent, null);
});
test('GitLab 源码版本不能冒充更新包，空 Release 给出实际源码版本与发布操作', async () => {
    const config = validateConfig({
        provider: 'gitlab',
        baseUrl: 'https://gitlab.example.com',
        project: 'company/app'
    });
    await assert.rejects(
        createProvider(config).releaseUrl(async (url) => (url.includes('/releases?') ? [] : { version: '5.7.1' })),
        /只有源码版本 5\.7\.1.*尚未发布安装包/
    );
});
