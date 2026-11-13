const fs = require('node:fs'),
    path = require('node:path'),
    os = require('node:os'),
    cp = require('node:child_process');
const { run, SearchEngine } = require('../src/plugin-library/local-search/engine');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'collectify-native-search-')),
    instance = 'CollectifyTest' + Date.now();
async function main() {
    const vendor = path.resolve(__dirname, '../src/plugin-library/local-search/vendor/native');
    const file = path.join(root, 'files.efu');
    fs.writeFileSync(
        file,
        'Filename,Size,Date Modified,Date Created,Attributes\r\n"C:\\测试\\hello,文档.txt",12,133000000000000000,133000000000000000,32\r\n"C:\\测试\\文件夹",0,133000000000000000,133000000000000000,16\r\n'
    );
    fs.writeFileSync(
        path.join(root, 'Everything.ini'),
        '[Everything]\r\nrun_as_admin=0\r\nrun_in_background=1\r\nshow_tray_icon=0\r\nauto_include_fixed_volumes=0\r\nauto_include_removable_volumes=0\r\nfilelists=' +
            file +
            '\r\n'
    );
    const child = cp.spawn(
        path.join(vendor, 'Everything.exe'),
        [
            '-instance',
            instance,
            '-startup',
            '-minimized',
            '-config',
            path.join(root, 'Everything.ini'),
            '-db',
            path.join(root, 'Everything.db')
        ],
        { windowsHide: true, stdio: 'ignore' }
    );
    await new Promise((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
    });
    const engine = new SearchEngine(root);
    engine.started = true;
    engine.instance = instance;
    try {
        let ready = false;
        for (let i = 0; i < 25; i++) {
            try {
                await run(path.join(vendor, 'es.exe'), ['-instance', instance, '-get-everything-version'], {
                    timeout: 1000
                });
                ready = true;
                break;
            } catch {
                await new Promise((r) => setTimeout(r, 200));
            }
        }
        if (!ready) throw Error('Isolated Everything did not start');
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const args = [
            '-instance',
            instance,
            '-timeout',
            '3000',
            '-csv',
            '-full-path-and-name',
            '-size',
            '-date-modified',
            '-attributes',
            '-date-format',
            '3',
            '-size-format',
            '1',
            '-no-digit-grouping'
        ];
        const result = await engine.search({ query: 'hello', filter: { id: 'all', extensions: [] }, sort: 'name' });
        console.log('Engine result:', JSON.stringify(result));
        require('node:assert/strict').equal(result.total, 1);
        require('node:assert/strict').ok(result.items[0].path.includes('文档'));
        const folders = await engine.search({
            query: '文件夹',
            filter: { id: 'folder', extensions: [] },
            sort: 'name'
        });
        require('node:assert/strict').equal(folders.items.length, 1);
        require('node:assert/strict').equal(folders.items[0].directory, true);
        console.log('Native Everything integration passed using isolated fixture file list.');
    } finally {
        try {
            await run(path.join(vendor, 'es.exe'), ['-instance', instance, '-exit'], { timeout: 2000 });
        } catch {}
        child.kill();
        fs.rmSync(root, { recursive: true, force: true });
    }
}
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
