const fs = require('node:fs');
const path = require('node:path');
class CredentialStore {
    constructor(file, encryption) {
        this.file = file;
        this.encryption = encryption;
        this.available = false;
        this.record = null;
        this.loadError = '';
        this.generation = 0;
    }
    async initialize() {
        const epoch = this.generation;
        this.available = await (this.encryption.isAsyncEncryptionAvailable
            ? this.encryption.isAsyncEncryptionAvailable()
            : this.encryption.isEncryptionAvailable());
        if (this.encryption.getSelectedStorageBackend?.() === 'basic_text') this.available = false;
        if (!fs.existsSync(this.file) || !this.available) return;
        try {
            const bytes = fs.readFileSync(this.file);
            const decoded = this.encryption.decryptStringAsync
                ? await this.encryption.decryptStringAsync(bytes)
                : { result: this.encryption.decryptString(bytes) };
            if (epoch !== this.generation) return;
            this.record = JSON.parse(decoded.result);
            if (decoded.shouldReEncrypt) await this.write(this.record.key, this.record.token);
        } catch {
            this.loadError = '登录凭据无法解密，请退出登录后重新授权';
        }
    }
    supported() {
        return this.available;
    }
    read(key) {
        if (this.loadError) throw Error(this.loadError);
        if (!this.record) return null;
        if (!this.supported()) throw Error('系统安全存储不可用，请先配置系统密钥环');
        return this.record.key === key ? this.record.token : null;
    }
    async write(key, token) {
        if (!this.supported()) throw Error('系统安全存储不可用，不能保存登录凭据');
        const epoch = this.generation,
            record = { key, token },
            text = JSON.stringify(record);
        const bytes = await (this.encryption.encryptStringAsync
            ? this.encryption.encryptStringAsync(text)
            : this.encryption.encryptString(text));
        if (epoch !== this.generation) throw Error('登录已取消');
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
        const temporary = this.file + '.tmp';
        fs.writeFileSync(temporary, bytes, { mode: 0o600 });
        fs.renameSync(temporary, this.file);
        this.record = record;
        this.loadError = '';
    }
    clear() {
        this.generation++;
        this.record = null;
        this.loadError = '';
        for (const file of [this.file, this.file + '.tmp']) if (fs.existsSync(file)) fs.unlinkSync(file);
    }
    invalidateWrites() {
        this.generation++;
    }
}
module.exports = { CredentialStore };
