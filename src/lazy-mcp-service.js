const { randomBytes } = require('node:crypto');
// 未启用 AI 连接时，不在首屏路径解析整份 MCP SDK。
class LazyMcpService {
    constructor(repository, changed, getTools, load = () => require('./vendor/mcp-service.cjs')) {
        Object.assign(this, { repository, changed, getTools, load });
        this.initial = repository.readMcpConfig() || {
            enabled: false,
            port: require('./app-defaults').network.mcpPort,
            token: randomBytes(32).toString('hex')
        };
        if (!/^[a-f0-9]{64}$/.test(this.initial.token || '')) this.initial.token = randomBytes(32).toString('hex');
    }
    get config() {
        return this.instance?.config || this.initial;
    }
    ensure() {
        if (!this.instance) {
            const { LocalMcpService, z } = this.load();
            this.instance = new LocalMcpService(this.repository, this.changed, () => this.getTools(z));
            this.instance.config = { ...this.initial };
        }
        return this.instance;
    }
    status() {
        return (
            this.instance?.status() || {
                enabled: false,
                port: this.initial.port,
                url: `http://127.0.0.1:${this.initial.port}/mcp`,
                configured: this.initial.enabled,
                tools: []
            }
        );
    }
    connection() {
        return this.ensure().connection();
    }
    async start(port) {
        if (this.starting) return this.starting;
        const service = this.ensure();
        this.starting = Promise.resolve().then(() => service.start(port));
        try {
            return await this.starting;
        } finally {
            this.starting = null;
        }
    }
    async stop(persist = true) {
        if (this.starting) await this.starting.catch(() => {});
        if (this.instance) return this.instance.stop(persist);
        if (persist) {
            this.initial.enabled = false;
            this.repository.saveMcpConfig(this.initial);
            this.changed();
        }
    }
}
module.exports = { LazyMcpService };
