const http = require('node:http');
const { randomBytes, timingSafeEqual } = require('node:crypto');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { z } = require('zod');
const { saveTask } = require('../../productivity');
const { matchesTaskDate } = require('../../task-query');
const reply = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data) }] });

function redact(entry) {
    const { password, username, ...rest } = entry;
    return rest;
}

class LocalMcpService {
    constructor(store, onChange, options = {}) {
        this.store = store;
        this.onChange = onChange;
        this.http = null;
        this.port = null;
        this.config = store.repository.readMcpConfig() || {
            enabled: false,
            port: 17863,
            token: randomBytes(32).toString('hex')
        };
        if (!/^[a-f0-9]{64}$/.test(this.config.token)) this.config.token = randomBytes(32).toString('hex');
    }

    persist() {
        this.store.repository.saveMcpConfig(this.config);
    }

    status() {
        return {
            enabled: !!this.http,
            port: this.port || this.config.port,
            url: `http://127.0.0.1:${this.port || this.config.port}/mcp`,
            configured: this.config.enabled,
            tools: [
                'workspace_summary',
                'list_bookmarks',
                'list_tasks',
                'save_tasks',
                'save_note',
                'organize_bookmarks'
            ]
        };
    }

    connection() {
        return {
            mcpServers: {
                collectify: {
                    type: 'streamable_http',
                    url: this.status().url,
                    headers: { Authorization: `Bearer ${this.config.token}` }
                }
            }
        };
    }

    server() {
        const server = new McpServer({ name: 'collectify-workspace', version: '5.5.3' });
        const tool = (name, description, schema, write, handler) =>
            server.registerTool(
                name,
                {
                    description,
                    inputSchema: schema,
                    annotations: {
                        readOnlyHint: !write,
                        destructiveHint: false,
                        idempotentHint: !write,
                        openWorldHint: false
                    }
                },
                async (input) => {
                    try {
                        const data = write ? this.store.withAudit(name, () => handler(input)) : handler(input);
                        if (write) {
                            this.onChange();
                        }
                        return reply(data);
                    } catch (error) {
                        return { isError: true, content: [{ type: 'text', text: error.message }] };
                    }
                }
            );
        tool('workspace_summary', '读取Collectify收藏分类与待办概况。密码和登录资料不提供给 AI。', {}, false, () => ({
            categories: this.store.categories,
            bookmarks: this.store.entries.length,
            tasks: this.store.data.tasks.length,
            notes: this.store.data.notes.length,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            now: new Date().toISOString()
        }));
        tool(
            'list_bookmarks',
            '按关键词或分类查询资源收藏，不返回账号密码。',
            {
                query: z.string().optional(),
                categoryId: z.string().optional()
            },
            false,
            (input) =>
                this.store.entries
                    .filter(
                        (e) =>
                            (!input.categoryId || e.categoryId === input.categoryId) &&
                            (!input.query ||
                                [e.name, e.note, e.url].some((v) =>
                                    v.toLowerCase().includes(input.query.toLowerCase())
                                ))
                    )
                    .map(redact)
        );
        tool(
            'list_tasks',
            '查询待办与日程；date 使用本机日期 YYYY-MM-DD，可包含已归档。',
            {
                date: z
                    .string()
                    .regex(/^\d{4}-\d{2}-\d{2}$/)
                    .optional(),
                dateField: z.enum(['dueAt', 'startAt', 'remindAt', 'createdAt', 'completedAt']).optional(),
                status: z.enum(['inbox', 'todo', 'doing', 'done']).optional(),
                query: z.string().optional(),
                archived: z.boolean().optional()
            },
            false,
            (input) =>
                this.store.data.tasks.filter(
                    (t) =>
                        (input.archived ? t.archived : !t.archived) &&
                        (!input.status || t.status === input.status) &&
                        matchesTaskDate(t, input.date, input.dateField || 'dueAt') &&
                        (!input.query ||
                            [t.title, t.note].some((s) => s.toLowerCase().includes(input.query.toLowerCase())))
                )
        );
        const taskSchema = z.object({
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
        tool(
            'save_tasks',
            '批量创建/更新待办或安排日程。使用带时区的 ISO 时间；没有 id 则新建。整批校验后一次保存，失败不部分写入。调用前根据用户要求确定日期与时区。',
            { tasks: z.array(taskSchema).min(1).max(100) },
            true,
            (input) => {
                let staged = this.store.snapshot();
                const staging = {
                    snapshot: () => structuredClone(staged),
                    commit: (data) => {
                        staged = data;
                    }
                };
                const results = input.tasks.map((item) => saveTask(staging, item));
                this.store.commit(staged);
                return results;
            }
        );
        tool(
            'save_note',
            '根据用户意图新建或更新便签，不自动删除原内容。',
            {
                id: z.string().optional(),
                title: z.string().max(120),
                content: z.string().max(30000),
                color: z.enum(['yellow', 'blue', 'pink', 'green']).optional()
            },
            true,
            (input) => this.store.saveNote(input)
        );
        tool(
            'organize_bookmarks',
            '将已有收藏移动到指定分类；分类不存在时创建。保持收藏 ID、登录资料和地址不变。整批校验后保存。',
            {
                categoryName: z.string().min(1).max(60),
                bookmarkIds: z.array(z.string()).min(1).max(200)
            },
            true,
            (input) => {
                const data = this.store.snapshot();
                if (input.bookmarkIds.some((id) => !data.entries.some((e) => e.id === id)))
                    throw Error('部分收藏已不存在，请重新查询');
                let category = data.categories.find((c) => c.name.toLowerCase() === input.categoryName.toLowerCase());
                if (!category) {
                    category = {
                        id: require('node:crypto').randomUUID(),
                        name: input.categoryName,
                        color: 'blue',
                        icon: 'link',
                        description: ''
                    };
                    data.categories.push(category);
                }
                data.entries = data.entries.map((e) =>
                    input.bookmarkIds.includes(e.id)
                        ? {
                              ...e,
                              categoryId: category.id
                          }
                        : e
                );
                this.store.commit(data);
                return { categoryId: category.id, moved: input.bookmarkIds.length };
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

module.exports = { LocalMcpService };
