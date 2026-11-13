const http = require('node:http');
const { randomBytes, timingSafeEqual } = require('node:crypto');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { z } = require('zod');
const SERVER_INSTRUCTIONS =
    'Collectify 是插件工作台。用户要求新增或扩展功能时，先调用 get_plugin_sdk 读取真实 SDK 合同，再创建草稿、写入文件、校验并安装，不要只把代码交给用户手工复制。仅在用户明确要求创建或更新时安装插件；不要修改宿主源码或尝试任意 Node.js/文件系统。安装后检查 get_plugin_runtime_status，加载成功不代表业务功能已完整测试。开发工具不读取剪贴板历史和插件数据库。';
class LocalMcpService {
    constructor(repository, onChange, getTools = () => []) {
        this.repository = repository;
        this.onChange = onChange;
        this.getTools = getTools;
        this.http = null;
        this.port = null;
        this.config = repository.readMcpConfig() || {
            enabled: false,
            port: 17863,
            token: randomBytes(32).toString('hex')
        };
        if (!/^[a-f0-9]{64}$/.test(this.config.token)) this.config.token = randomBytes(32).toString('hex');
    }
    persist() {
        this.repository.saveMcpConfig(this.config);
    }
    status() {
        return {
            enabled: !!this.http,
            port: this.port || this.config.port,
            url: 'http://127.0.0.1:' + (this.port || this.config.port) + '/mcp',
            configured: this.config.enabled,
            tools: this.getTools().map((t) => t.name)
        };
    }
    connection() {
        return {
            mcpServers: {
                collectify: {
                    type: 'streamable_http',
                    url: this.status().url,
                    headers: { Authorization: 'Bearer ' + this.config.token }
                }
            }
        };
    }
    server() {
        const server = new McpServer({ name: 'collectify', version: '5.5.3' }, { instructions: SERVER_INSTRUCTIONS });
        for (const tool of this.getTools())
            server.registerTool(
                tool.name,
                {
                    description: tool.description,
                    inputSchema: tool.inputSchema || {},
                    annotations: {
                        readOnlyHint: !tool.write,
                        destructiveHint: false,
                        idempotentHint: !tool.write,
                        openWorldHint: false
                    }
                },
                async (input) => {
                    try {
                        const result = await tool.handler(input);
                        if (tool.write) this.onChange();
                        return { content: [{ type: 'text', text: JSON.stringify(result ?? null) }] };
                    } catch (error) {
                        return { isError: true, content: [{ type: 'text', text: error.message }] };
                    }
                }
            );
        return server;
    }
    async start(port = this.config.port) {
        if (this.http) return this.status();
        if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('端口不正确');
        const listener = http.createServer(async (req, res) => {
            const end = (status, message) => {
                res.writeHead(status, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: message }));
            };
            if (req.url !== '/mcp') return end(404, 'Not found');
            if (req.headers.origin) return end(403, 'Browser-origin requests are not accepted');
            if (![`127.0.0.1:${this.port}`, `localhost:${this.port}`].includes(req.headers.host))
                return end(403, 'Invalid host');
            const provided = Buffer.from(req.headers.authorization || ''),
                expected = Buffer.from(`Bearer ${this.config.token}`);
            if (provided.length !== expected.length || !timingSafeEqual(provided, expected))
                return end(401, 'Unauthorized');
            if (req.method !== 'POST') return end(405, 'Use Streamable HTTP POST');
            let size = 0,
                chunks = [];
            try {
                for await (const chunk of req) {
                    size += chunk.length;
                    if (size > 256000) {
                        end(413, 'Request too large');
                        return;
                    }
                    chunks.push(chunk);
                }
                const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                const server = this.server(),
                    transport = new StreamableHTTPServerTransport({
                        sessionIdGenerator: undefined,
                        enableJsonResponse: true
                    });
                res.on('close', () => {
                    void transport.close();
                    void server.close();
                });
                await server.connect(transport);
                await transport.handleRequest(req, res, body);
            } catch {
                if (!res.headersSent) end(400, 'Invalid MCP request');
            }
        });
        try {
            await new Promise((resolve, reject) => {
                listener.once('error', reject);
                listener.listen(port, '127.0.0.1', resolve);
            });
        } catch (error) {
            listener.close();
            throw Error(`无法启动本机 MCP：${error.code || error.message}`);
        }
        this.http = listener;
        this.port = listener.address().port;
        this.config = { ...this.config, enabled: true, port: this.port };
        this.persist();
        return this.status();
    }

    async stop(persist = true) {
        const listener = this.http;
        this.http = null;
        this.port = null;
        if (listener) {
            listener.closeAllConnections();
            await new Promise((resolve) => listener.close(resolve));
        }
        if (persist) {
            this.config.enabled = false;
            this.persist();
        }
        return this.status();
    }
}

module.exports = { LocalMcpService, z };
