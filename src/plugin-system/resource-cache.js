// 只缓存随宿主发布的只读 SDK 资源；用户插件文件和临时预览不进入此缓存。
class ResourceCache {
    constructor(limit = 12 * 1024 * 1024) {
        this.limit = limit;
        this.bytes = 0;
        this.items = new Map();
        this.pending = new Map();
    }
    async get(key, read) {
        if (this.items.has(key)) {
            const value = this.items.get(key);
            this.items.delete(key);
            this.items.set(key, value);
            return value;
        }
        if (this.pending.has(key)) return this.pending.get(key);
        const task = Promise.resolve()
            .then(read)
            .then((value) => {
                if (value.length <= this.limit) {
                    while (this.bytes + value.length > this.limit && this.items.size) {
                        const oldest = this.items.keys().next().value;
                        this.bytes -= this.items.get(oldest).length;
                        this.items.delete(oldest);
                    }
                    this.items.set(key, value);
                    this.bytes += value.length;
                }
                return value;
            });
        this.pending.set(key, task);
        try {
            return await task;
        } finally {
            this.pending.delete(key);
        }
    }
    readFile(key, file) {
        const fs = require('node:fs');
        const stat = fs.statSync(file);
        const revision = `${key}:${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
        return this.get(revision, () => fs.promises.readFile(file));
    }
}
module.exports = { ResourceCache };
