const fs = require('node:fs'),
    path = require('node:path'),
    { execFile, spawn } = require('node:child_process');
const { SORTS, matches, csv, queryText } = require('./model');
function run(file, args, { signal, timeout = 7000, maxBuffer = 8 * 1024 * 1024 } = {}) {
    return new Promise((resolve, reject) =>
        execFile(
            file,
            args,
            { windowsHide: true, encoding: 'utf8', timeout, maxBuffer, signal },
            (error, stdout, stderr) => {
                if (error) {
                    const failure = Error(
                        error.killed ? '搜索引擎响应超时' : stderr?.trim() || `搜索引擎调用失败（${error.code}）`
                    );
                    failure.code = error.code;
                    reject(failure);
                } else resolve(stdout.replace(/^\uFEFF/, ''));
            }
        )
    );
}
class SearchEngine {
    constructor(directory, { platform = process.platform, runCommand = run } = {}) {
        this.directory = directory;
        this.platform = platform;
        this.run = runCommand;
        this.started = false;
        this.instance = '';
        this.owned = false;
    }
    native(name) {
        const source = path.join(__dirname, 'vendor', 'native', name),
            target = path.join(this.directory, 'native', name);
        if (!fs.existsSync(source)) throw Error('插件缺少随包搜索组件，请重新安装包含本地搜索的 Collectify');
        fs.mkdirSync(path.dirname(target), { recursive: true });
        const bytes = fs.readFileSync(source);
        if (!fs.existsSync(target) || !fs.readFileSync(target).equals(bytes)) fs.writeFileSync(target, bytes);
        return target;
    }
    async installed() {
        const candidates = [
            process.env.ProgramW6432,
            process.env.ProgramFiles,
            process.env['ProgramFiles(x86)'],
            process.env.LOCALAPPDATA
        ]
            .filter(Boolean)
            .map((root) => path.join(root, 'Everything', 'Everything.exe'));
        try {
            const output = await this.run(
                'reg.exe',
                ['query', 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\Everything.exe', '/ve'],
                { timeout: 1500 }
            );
            const match = output.match(/REG_SZ\s+(.+\.exe)/i);
            if (match) candidates.unshift(match[1].trim());
        } catch {}
        return candidates.find((candidate) => fs.existsSync(candidate)) || null;
    }
    async connect() {
        if (this.platform !== 'win32') throw Error('Everything 仅支持 Windows；请选择“文件夹搜索”');
        const es = this.native('es.exe');
        try {
            await this.run(es, ['-get-everything-version', '-timeout', '800']);
            this.started = true;
            this.instance = '';
            return { source: '已运行的 Everything' };
        } catch {}
        const installed = await this.installed();
        const executable = installed || this.native('Everything.exe');
        this.instance = installed ? '' : 'CollectifyLocalSearch';
        this.owned = !installed;
        if (!installed) {
            this.native('Everything.lng');
            const boot = path.join(path.dirname(executable), 'Everything.ini');
            if (!fs.existsSync(boot))
                fs.writeFileSync(boot, '[Everything]\r\napp_data=0\r\nrun_as_admin=0\r\n', 'utf8');
        }
        const args = ['-startup', '-minimized'];
        if (this.instance) {
            args.push(
                '-instance',
                this.instance,
                '-config',
                path.join(this.directory, 'Everything.ini'),
                '-db',
                path.join(this.directory, 'Everything.db')
            );
        }
        await new Promise((resolve, reject) => {
            const child = spawn(executable, args, { windowsHide: true, detached: true, stdio: 'ignore' });
            child.once('error', reject);
            child.once('spawn', () => {
                child.unref();
                resolve();
            });
        });
        for (let n = 0; n < 12; n++) {
            try {
                await this.run(es, [
                    ...(this.instance ? ['-instance', this.instance] : []),
                    '-get-everything-version',
                    '-timeout',
                    '500'
                ]);
                this.started = true;
                return { source: installed ? '已安装的 Everything' : '内置绿色版 Everything' };
            } catch {
                await new Promise((resolve) => setTimeout(resolve, 250));
            }
        }
        throw Error('Everything 尚未准备好。请打开引擎窗口完成索引设置，或先选择文件夹搜索。');
    }
    async search({ query, filter, sort, offset = 0, signal }) {
        if (!this.started) throw Error('请先点击“连接 Everything”，或选择文件夹搜索');
        const base = [
            ...(this.instance ? ['-instance', this.instance] : []),
            '-timeout',
            '3000',
            '-match-path',
            ...(filter?.id === 'folder' ? ['/ad'] : [])
        ];
        const search = queryText(query, filter);
        const exported = path.join(this.directory, `search-${require('node:crypto').randomUUID()}.csv`);
        const rowsArgs = [
            ...base,
            '-export-csv',
            exported,
            '-utf8-bom',
            '-full-path-and-name',
            '-size',
            '-date-modified',
            '-attributes',
            '-size-format',
            '1',
            '-no-digit-grouping',
            '-date-format',
            '3',
            '-sort',
            SORTS[sort] || SORTS.modified,
            '-n',
            String(offset + 150),
            '-viewport-offset',
            String(offset),
            '-viewport-count',
            '150',
            '-regex',
            search
        ];
        let output, count;
        try {
            const completed = await Promise.allSettled([
                this.run(this.native('es.exe'), rowsArgs, { signal }),
                this.run(this.native('es.exe'), [...base, '-get-result-count', '-regex', search], { signal })
            ]);
            for (const result of completed) if (result.status === 'rejected') throw result.reason;
            count = completed[1].value;
            output = await fs.promises.readFile(exported, 'utf8');
        } finally {
            await fs.promises.unlink(exported).catch(() => {});
        }
        const rows = csv(output.replace(/^\uFEFF/, '')),
            header = rows.shift() || [];
        const column = (pattern) => header.findIndex((value) => pattern.test(value));
        const name = column(/^(filename|full path and name)$/i),
            size = column(/^size$/i),
            date = column(/date modified/i),
            attr = column(/attributes/i);
        if (name < 0) throw Error('Everything 返回的数据格式无法识别');
        const items = rows.map((row) => ({
            path: row[name],
            size: Number(row[size]) || 0,
            modified: Date.parse(row[date]) || 0,
            directory: !!(Number(row[attr]) & 16) || /D/i.test(row[attr] || '')
        }));
        return { items, total: Number(count.trim()) || 0, limited: false, engine: 'everything' };
    }
    async window() {
        const executable = (await this.installed()) || this.native('Everything.exe');
        const child = spawn(executable, this.instance ? ['-instance', this.instance] : [], {
            stdio: 'ignore',
            detached: true
        });
        child.on('error', () => {});
        child.unref();
    }
    async stop() {
        if (this.owned) {
            try {
                await this.run(this.native('es.exe'), ['-instance', this.instance, '-exit'], { timeout: 2000 });
            } catch {}
        }
        this.started = false;
        this.owned = false;
    }
}
async function folderSearch(
    roots,
    {
        query = '',
        filter,
        sort = 'modified',
        offset = 0,
        signal,
        session = { queue: [...roots], items: [], visited: 0, skipped: [], current: null },
        maxVisited = 30000,
        maxMs = 5000
    } = {}
) {
    const { queue, items } = session;
    const initialVisited = session.visited;
    const started = Date.now();
    while (queue.length || session.current) {
        if (signal?.aborted) throw Error('搜索已取消');
        if (session.visited - initialVisited >= maxVisited || Date.now() - started > maxMs || items.length >= 100000)
            break;
        if (!session.current) {
            const directory = queue.shift();
            try {
                session.current = {
                    directory,
                    entries: await fs.promises.readdir(directory, { withFileTypes: true }),
                    index: 0
                };
            } catch {
                session.skipped.push(directory);
                continue;
            }
        }
        const current = session.current;
        while (current.index < current.entries.length) {
            if (signal?.aborted) throw Error('搜索已取消');
            if (
                session.visited - initialVisited >= maxVisited ||
                Date.now() - started > maxMs ||
                items.length >= 100000
            )
                break;
            const entry = current.entries[current.index++];
            session.visited++;
            if (entry.isSymbolicLink()) continue;
            const file = {
                path: path.join(current.directory, entry.name),
                directory: entry.isDirectory(),
                size: 0,
                modified: 0
            };
            if (file.directory) queue.push(file.path);
            if (!matches(file, query, filter)) continue;
            try {
                const stat = await fs.promises.stat(file.path);
                file.size = stat.size;
                file.modified = stat.mtimeMs;
            } catch {
                continue;
            }
            items.push(file);
        }
        if (current.index === current.entries.length) session.current = null;
    }
    const sorted = [...items].sort(
        sort === 'name'
            ? (a, b) => path.basename(a.path).localeCompare(path.basename(b.path))
            : sort === 'size'
              ? (a, b) => b.size - a.size
              : (a, b) => b.modified - a.modified
    );
    const pending = [...(session.current ? [session.current.directory] : []), ...queue];
    return {
        items: sorted.slice(offset, offset + 150),
        total: items.length,
        limited: pending.length > 0,
        canContinue: pending.length > 0 && items.length < 100000,
        pending: pending.slice(0, 5),
        pendingCount: pending.length,
        skipped: session.skipped.slice(0, 5),
        skippedCount: session.skipped.length,
        engine: 'folder',
        visited: session.visited
    };
}
module.exports = { SearchEngine, folderSearch, run };
