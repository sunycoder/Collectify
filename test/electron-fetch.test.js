const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { electronFetch } = require('../src/distribution/electron-fetch');

function networkFixture(run) {
    const req = new EventEmitter();
    req.abort = () => {
        req.aborted = true;
        req.emit('abort');
    };
    req.end = (body) => {
        req.body = body;
        queueMicrotask(() => run(req));
    };
    return {
        req,
        network: {
            request(options) {
                req.options = options;
                return req;
            }
        }
    };
}

test('Electron 手动重定向保留 Location，主动终止连接不导致已完成响应失败', async () => {
    const { req, network } = networkFixture((req) =>
        req.emit('redirect', 302, 'GET', 'https://cdn.example.com/file', {})
    );
    const response = await electronFetch('https://example.com/file', {}, network);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), 'https://cdn.example.com/file');
    assert.equal(req.aborted, true);
    assert.equal(req.options.redirect, 'manual');
    assert.equal(req.options.useSessionCookies, false);
});

test('Electron 流式响应保留错误状态、响应头和 POST 内容，分块读取不丢字节', async () => {
    const input = new EventEmitter();
    input.statusCode = 401;
    input.headers = { 'content-type': ['application/json'] };
    input.pause = () => {};
    input.resume = () => {};
    const { req, network } = networkFixture((req) => req.emit('response', input));
    const response = await electronFetch(
        'https://example.com/oauth/token',
        { method: 'POST', body: 'code=test' },
        network
    );
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('content-type'), 'application/json');
    assert.equal(req.body, 'code=test');
    const result = response.text();
    input.emit('data', Buffer.from('拒绝'));
    input.emit('data', Buffer.from('访问'));
    input.emit('end');
    assert.equal(await result, '拒绝访问');
});

test('Electron 请求在响应前和传输中均支持取消并释放底层连接', async () => {
    const pending = networkFixture(() => {});
    const first = new AbortController();
    const request = electronFetch('https://example.com', { signal: first.signal }, pending.network);
    first.abort(Error('用户取消'));
    await assert.rejects(request, /用户取消/);
    assert.equal(pending.req.aborted, true);
    const input = new EventEmitter();
    Object.assign(input, { statusCode: 200, headers: {}, pause() {}, resume() {} });
    const active = networkFixture((req) => req.emit('response', input));
    const second = new AbortController();
    const response = await electronFetch('https://example.com', { signal: second.signal }, active.network);
    const body = response.text();
    second.abort(Error('停止下载'));
    await assert.rejects(body, /停止下载/);
    assert.equal(active.req.aborted, true);
});
