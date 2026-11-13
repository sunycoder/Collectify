const { test } = require('node:test'),
    assert = require('node:assert/strict'),
    fs = require('node:fs'),
    os = require('node:os'),
    path = require('node:path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { Store } = require('../src/store');
const { LocalMcpService } = require('../src/plugins/.shared/legacy-mcp-service');
test('MCP真实客户端连接、认证、隐私、原子批量排期与停用', async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'collectify-mcp-')),
        store = new Store(path.join(dir, 'collectify.sqlite'));
    let changes = 0;
    const secret = store.save({
        type: 'credential',
        name: '密码不可提供',
        username: 'private-user',
        password: 'private-password'
    });
    const service = new LocalMcpService(store, () => {
        changes++;
    });
    await service.start(0);
    t.after(async () => {
        await service.stop();
        fs.rmSync(dir, { recursive: true, force: true });
    });
    assert.equal((await fetch(service.status().url, { method: 'POST', body: '{}' })).status, 401);
    assert.equal(
        (
            await fetch(service.status().url, {
                method: 'POST',
                headers: { Authorization: `Bearer ${service.config.token}`, Origin: 'https://example.org' },
                body: '{}'
            })
        ).status,
        403
    );
    const client = new Client({ name: 'test-client', version: '1' }),
        transport = new StreamableHTTPClientTransport(new URL(service.status().url), {
            requestInit: { headers: { Authorization: `Bearer ${service.config.token}` } }
        });
    await client.connect(transport);
    t.after(() => client.close());
    const list = await client.listTools();
    assert.equal(list.tools.length, 6);
    const bookmarks = await client.callTool({ name: 'list_bookmarks', arguments: {} });
    assert.ok(!JSON.stringify(bookmarks).includes('private-password'));
    assert.ok(!JSON.stringify(bookmarks).includes('private-user'));
    const fail = await client.callTool({
        name: 'save_tasks',
        arguments: {
            tasks: [
                { title: '不能部分保存' },
                { title: '坏排期', startAt: '2026-11-13T12:00:00Z', endAt: '2026-11-13T11:00:00Z' }
            ]
        }
    });
    assert.equal(fail.isError, true);
    assert.equal(store.data.tasks.length, 0);
    const saved = await client.callTool({
        name: 'save_tasks',
        arguments: {
            tasks: [
                {
                    title: 'AI安排事项',
                    startAt: '2026-11-13T10:00:00+08:00',
                    endAt: '2026-11-13T11:00:00+08:00',
                    priority: 'high'
                }
            ]
        }
    });
    assert.ok(!saved.isError);
    assert.equal(store.data.tasks.length, 1);
    assert.equal(changes, 1);
    const id = store.data.tasks[0].id;
    await client.callTool({ name: 'save_tasks', arguments: { tasks: [{ id, status: 'doing' }] } });
    assert.equal(store.data.tasks[0].title, 'AI安排事项');
    assert.equal(store.data.tasks[0].status, 'doing');
    await client.callTool({
        name: 'organize_bookmarks',
        arguments: { categoryName: 'AI整理', bookmarkIds: [secret.id] }
    });
    assert.equal(
        store.categories.find((c) => c.id === store.entries.find((e) => e.id === secret.id).categoryId).name,
        'AI整理'
    );
    assert.equal(store.entries.find((e) => e.id === secret.id).password, 'private-password');
    assert.equal(new Store(store.file).data.tasks[0].status, 'doing');
    assert.equal(
        store.repository.withDatabase((db) => db.prepare('SELECT count(*) n FROM mcp_audit').get().n),
        3
    );
    assert.equal(new LocalMcpService(store, () => {}).config.token, service.config.token);
    await client.close();
    await service.stop();
    assert.equal(service.status().enabled, false);
});
