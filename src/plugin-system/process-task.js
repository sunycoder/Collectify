const { fork } = require('node:child_process');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');

/** 单个解析任务的故障隔离边界。兼容 Worker 的 message/error/exit 与 terminate 接口。 */
class ProcessTask extends EventEmitter {
    constructor(file, options = {}) {
        super();
        this.finished = false;
        this.result = false;
        this.child = fork(path.join(__dirname, 'task-process.cjs'), [], {
            env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
            execArgv: [],
            serialization: 'advanced',
            windowsHide: true,
            stdio: ['ignore', 'ignore', 'ignore', 'ipc']
        });
        this.exited = new Promise((resolve) =>
            this.child.once('exit', (code, signal) => {
                this.finished = true;
                clearTimeout(this.timer);
                this.emit('exit', code ?? (signal ? 1 : 0));
                resolve(code);
            })
        );
        this.child.on('message', (message) => {
            if (this.finished) return;
            if (message.type === 'message') {
                this.result = !message.value?.progress;
                this.emit('message', message.value);
            } else if (message.type === 'failure') this.emit('error', Error(message.message));
        });
        this.child.on('error', (error) => this.emit('error', error));
        this.child.send({ file, options }, (error) => {
            if (error && !this.finished) this.emit('error', error);
        });
        this.timer = setTimeout(() => {
            if (!this.finished) {
                this.emit('error', Error('插件计算任务超时，已停止'));
                void this.terminate();
            }
        }, 65000);
        this.timer.unref();
    }
    terminate() {
        this.terminating = true;
        if (!this.finished) this.child.kill();
        return this.exited;
    }
}

class PluginTaskPool {
    constructor(directory, limit = 2) {
        this.directory = fs.realpathSync(directory);
        this.limit = limit;
        this.jobs = new Set();
        this.stopping = false;
    }
    start(file, options) {
        if (this.stopping) throw Error('插件正在停用');
        if ([...this.jobs].filter((job) => !job.terminating).length >= this.limit)
            throw Error('插件计算任务繁忙，请稍候重试');
        const real = fs.realpathSync(file);
        if (!real.startsWith(this.directory + path.sep)) throw Error('任务入口必须属于插件自身');
        const job = new ProcessTask(real, options);
        this.jobs.add(job);
        job.once('exit', () => this.jobs.delete(job));
        return job;
    }
    async stop() {
        this.stopping = true;
        await Promise.allSettled([...this.jobs].map((job) => job.terminate()));
        this.jobs.clear();
    }
    activate() {
        this.stopping = false;
    }
}
module.exports = { ProcessTask, PluginTaskPool };
