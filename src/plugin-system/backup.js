const fs = require('node:fs'),
    path = require('node:path');
const { validateSnapshot } = require('./registry');
class WorkspaceBackup {
    constructor(registry, getSettings, setSettings) {
        Object.assign(this, { registry, getSettings, setSettings });
        this.journal = path.join(path.dirname(registry.hostFile), 'workspace-import-recovery.json');
    }
    export(ids, settings, includeCredentials) {
        const known = new Set(
            this.registry.database((db) => db.prepare('SELECT id FROM installed_plugins').all()).map((p) => p.id)
        );
        if (!Array.isArray(ids) || new Set(ids).size !== ids.length || ids.some((id) => !known.has(id)))
            throw Error('请选择有效的插件');
        if (!ids.length && !settings) throw Error('至少选择一种内容');
        const snapshot = this.registry.snapshot(includeCredentials, ids);
        return {
            format: 'collectify-workspace',
            version: 2,
            exportedAt: new Date().toISOString(),
            plugins: snapshot.plugins.filter((p) => ids.includes(p.id)),
            ...(settings ? { settings: this.getSettings() } : {})
        };
    }
    parse(raw) {
        if (raw?.format !== 'collectify-workspace' || raw.version !== 2) throw Error('请选择插件工作台格式的数据文件');
        validateSnapshot({ version: 1, plugins: raw.plugins });
        return raw;
    }
    import(raw, { ids, settings, mode }) {
        this.parse(raw);
        if (
            !Array.isArray(ids) ||
            ids.some((id) => !raw.plugins.some((p) => p.id === id)) ||
            (!ids.length && !settings)
        )
            throw Error('导入选择不正确');
        const plan = this.registry.planImport(
            { version: 1, plugins: raw.plugins.filter((p) => ids.includes(p.id)) },
            mode,
            { onlySelected: true }
        );
        const nextSettings = settings ? this.setSettings(raw.settings, true) : this.getSettings();
        const before = { plugins: this.registry.snapshot(true, ids), settings: this.getSettings(), ids };
        fs.writeFileSync(this.journal + '.before.json', JSON.stringify(before), 'utf8');
        fs.writeFileSync(this.journal, JSON.stringify(before), 'utf8');
        try {
            this.registry.applySnapshot(plan, { partial: true });
            if (settings) this.setSettings(nextSettings);
            fs.unlinkSync(this.journal);
        } catch (error) {
            try {
                this.recover();
            } catch (restore) {
                throw Error(`导入失败，恢复快照已保留：${error.message}；${restore.message}`);
            }
            throw error;
        }
    }
    recover() {
        if (!fs.existsSync(this.journal)) return false;
        const before = JSON.parse(fs.readFileSync(this.journal, 'utf8'));
        validateSnapshot(before.plugins);
        this.setSettings(before.settings, true);
        if (before.ids)
            for (const id of before.ids)
                if (!before.plugins.plugins.some((p) => p.id === id)) {
                    this.registry.storage.replace(id, {});
                    if (!this.registry.plugins.has(id))
                        this.registry.database((db) => db.prepare('DELETE FROM installed_plugins WHERE id=?').run(id));
                }
        this.registry.applySnapshot(before.plugins, { partial: !!before.ids });
        this.setSettings(before.settings);
        fs.unlinkSync(this.journal);
        return true;
    }
}
module.exports = { WorkspaceBackup };
