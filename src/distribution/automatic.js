// 自动更新只协调状态，不直接操作系统安装器；安装由主进程在正常保存和退出后交接。
class AutomaticUpdate {
    constructor({ distribution, supported, install, changed = () => {}, failedVersion = '' }) {
        Object.assign(this, { distribution, supported, install, changed, failedVersion });
        this.phase = 'idle';
        this.error = '';
        this.active = false;
        this.deferred = false;
        this.disposed = false;
        this.task = null;
    }
    status() {
        return {
            phase: this.phase,
            error: this.error,
            reason: this.supported().reason || '',
            supported: this.supported().supported,
            version: this.distribution.update?.version || '',
            deferred: this.deferred
        };
    }
    touch() {
        this.active = true;
    }
    set(phase, error = '') {
        this.phase = phase;
        this.error = error;
        this.changed();
    }
    async checked({ startup = false } = {}) {
        if (this.disposed || !this.distribution.update?.available || this.task) return;
        if (this.notifiedVersion !== this.distribution.update.version) {
            this.notifiedVersion = this.distribution.update.version;
            this.deferred = false;
            this.phase = 'idle';
            if (this.failedVersion === this.notifiedVersion) {
                this.set('error', '上次更新未完成，仍在使用旧版本。请重试更新。');
                return;
            }
        }
        if (this.phase === 'error' || this.phase === 'ready') return;
        this.set('available');
        // 启动检查期间一旦用户开始操作，转为提示，避免联网较慢时突然重启正在使用的工作台。
        if (
            startup &&
            !this.active &&
            this.failedVersion !== this.distribution.update.version &&
            this.supported().supported
        )
            await this.begin({ startup: true });
    }
    begin({ startup = false } = {}) {
        if (this.task) return this.task;
        if (this.phase === 'installing' || this.disposed) return Promise.resolve();
        if (!this.supported().supported) return Promise.reject(Error(this.supported().reason));
        this.deferred = false;
        const generation = this.distribution.generation;
        const version = this.distribution.update?.version;
        this.task = (async () => {
            try {
                if (!this.distribution.downloaded) {
                    this.set('downloading');
                    await this.distribution.download();
                }
                if (this.disposed || generation !== this.distribution.generation) return;
                this.set('ready');
                if (this.deferred || (startup && this.active)) return;
                this.set('installing');
                if ((await this.install({ startup })) === false) this.set('ready');
            } catch (error) {
                if (!this.disposed && generation === this.distribution.generation) this.set('error', error.message);
            }
        })().finally(() => {
            this.task = null;
        });
        this.version = version;
        return this.task;
    }
    later() {
        this.deferred = true;
        this.changed();
    }
    cancelled() {
        this.deferred = true;
        this.set(this.distribution.downloaded ? 'ready' : 'available');
    }
    reset() {
        this.deferred = false;
        this.notifiedVersion = '';
        this.set('idle');
    }
    dispose() {
        this.disposed = true;
    }
}
module.exports = { AutomaticUpdate };
