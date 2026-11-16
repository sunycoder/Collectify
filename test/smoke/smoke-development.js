const assert = require('node:assert/strict');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
exports.run = async ({ win, registry, runtime, mcp, hostAction }) => {
    await mcp.start(0);
    const client = new Client({ name: 'plugin-developer-smoke', version: '1.0.0' });
    const nativeClipboard = runtime.clipboard;
    let reads = 0,
        copied = '';
    // 注入测试文本，避免读取或覆盖用户当前系统剪贴板。
    runtime.clipboard = {
        readText: async () => {
            reads++;
            return 'TEST_PRIVATE_CLIPBOARD_CONTENT';
        },
        writeText: async (value) => {
            copied = value;
        }
    };
    const page = (code) => runtime.views.get('example.ai-clipboard').view.webContents.executeJavaScript(code);
    async function until(fn) {
        for (let i = 0; i < 120; i++) {
            if (await fn()) return;
            await delay(60);
        }
        throw Error('AI 插件开发验证等待超时');
    }
    async function call(name, args = {}) {
        const reply = await client.callTool({ name, arguments: args });
        if (reply.isError) throw Error(`${name}: ${reply.content?.[0]?.text}`);
        return JSON.parse(reply.content[0].text);
    }
    try {
        await client.connect(
            new StreamableHTTPClientTransport(new URL(mcp.status().url), {
                requestInit: { headers: { Authorization: `Bearer ${mcp.config.token}` } }
            })
        );
        assert.match(client.getInstructions(), /get_plugin_sdk/);
        const sdk = await call('get_plugin_sdk');
        assert.ok(sdk.permissions.includes('clipboard.read'));
        assert.ok(sdk.templates.some((t) => t.id === 'clipboard-history'));
        assert.ok((await client.listTools()).tools.some((t) => t.name === 'install_plugin_draft'));
        const draft = await call('create_plugin_draft', {
            pluginId: 'example.ai-clipboard',
            name: 'AI 剪贴板',
            description: '通过 MCP 创建的自有插件',
            template: 'clipboard-history'
        });
        const file = await call('read_plugin_file', { draftId: draft.draftId, path: 'app.js' });
        const authored = file.content + "\ndocument.documentElement.dataset.aiGenerated='true';\n";
        const written = await call('write_plugin_files', {
            draftId: draft.draftId,
            expectedRevision: 1,
            files: [{ path: 'app.js', content: authored }]
        });
        assert.equal(written.revision, 2);
        const validation = await call('validate_plugin_draft', { draftId: draft.draftId, expectedRevision: 2 });
        assert.equal(validation.valid, true, JSON.stringify(validation.issues));
        await win.webContents.executeJavaScript("openSettings('ai')");
        const installed = await call('install_plugin_draft', {
            draftId: draft.draftId,
            expectedRevision: 2,
            validationToken: validation.validationToken,
            enable: true,
            open: true
        });
        assert.equal(installed.enabled, true);
        assert.equal(installed.opened, true);
        assert.equal(await win.webContents.executeJavaScript("document.querySelector('#settings-dialog').open"), false);
        assert.equal(runtime.views.get('example.ai-clipboard').view.getVisible(), true);
        await until(() => page("document.documentElement.dataset.aiGenerated==='true' && loaded"));
        assert.equal(reads, 0, '安装和打开不应自动读取剪贴板');
        assert.equal(
            await win.webContents.executeJavaScript(
                '!!document.querySelector(\'[data-plugin-id="example.ai-clipboard"]\')'
            ),
            true
        );
        await page("document.querySelector('#read-once').click()");
        await until(() => registry.storage.get('example.ai-clipboard', 'history')?.length === 1);
        assert.equal(registry.storage.get('example.ai-clipboard', 'history')[0].text, 'TEST_PRIVATE_CLIPBOARD_CONTENT');
        await page("document.querySelector('.history-item button').click()");
        await until(() => copied === 'TEST_PRIVATE_CLIPBOARD_CONTENT');
        const list = await call('list_plugins'),
            status = await call('get_plugin_runtime_status', { pluginId: 'example.ai-clipboard' });
        assert.equal(status.state, 'ready');
        assert.equal(JSON.stringify({ list, status, sdk }).includes('TEST_PRIVATE_CLIPBOARD_CONTENT'), false);
        await hostAction('overlay', true);
        const before = reads;
        assert.equal(await page('collectify.clipboard.readText().then(()=>false).catch(()=>true)'), true);
        assert.equal(reads, before);
        await hostAction('overlay', false);
        await call('set_plugin_enabled', { pluginId: 'example.ai-clipboard', enabled: false });
        assert.equal(runtime.views.has('example.ai-clipboard'), false);
        assert.equal((await call('get_plugin_runtime_status', { pluginId: 'example.ai-clipboard' })).state, 'disabled');
        const update = await call('create_plugin_draft', {
            pluginId: 'example.ai-clipboard',
            name: 'AI 剪贴板',
            description: '更新后保留历史'
        });
        assert.equal(update.manifest.version, '1.0.1');
        const updateFile = await call('read_plugin_file', { draftId: update.draftId, path: 'app.js' });
        await call('write_plugin_files', {
            draftId: update.draftId,
            expectedRevision: 1,
            files: [{ path: 'app.js', content: updateFile.content + '\n// AI 更新验证\n' }]
        });
        const updateCheck = await call('validate_plugin_draft', { draftId: update.draftId, expectedRevision: 2 });
        assert.equal(updateCheck.valid, true);
        await call('install_plugin_draft', {
            draftId: update.draftId,
            expectedRevision: 2,
            validationToken: updateCheck.validationToken,
            enable: true,
            open: true
        });
        await until(() => page("loaded && document.querySelectorAll('.history-item').length===1"));
        assert.equal(registry.storage.get('example.ai-clipboard', 'history')[0].text, 'TEST_PRIVATE_CLIPBOARD_CONTENT');
        assert.equal(
            (
                await client.callTool({
                    name: 'create_plugin_draft',
                    arguments: { pluginId: 'collectify.tasks', name: '覆盖', description: '不应成功' }
                })
            ).isError,
            true
        );
        assert.equal(
            (
                await client.callTool({
                    name: 'read_plugin_file',
                    arguments: { draftId: draft.draftId, path: '../../host.sqlite' }
                })
            ).isError,
            true
        );
        await call('discard_plugin_draft', { draftId: draft.draftId, expectedRevision: 2 });
        await call('discard_plugin_draft', { draftId: update.draftId, expectedRevision: 2 });
        assert.equal(registry.get('example.ai-clipboard').enabled, true, '删除草稿不应卸载程序');
        await call('set_plugin_enabled', { pluginId: 'example.ai-clipboard', enabled: false });
        runtime.close('example.ai-clipboard');
        registry.uninstall('example.ai-clipboard');
        console.log(
            'MCP DEVELOPMENT PASS：真实 MCP 客户端读取 SDK、创建/写入/校验/安装/更新插件，自动注册导航、前台剪贴板 SDK、数据保留、启停和越权拒绝均通过；剪贴板使用注入的测试文本。'
        );
    } finally {
        runtime.clipboard = nativeClipboard;
        await client.close();
        await mcp.stop();
    }
};
