const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, fork } = require('node:child_process');
const { AutomaticUpdate } = require('../src/distribution/automatic');
const { installation, prepareInstallation, previousInstallation } = require('../src/distribution/install');
const { Distribution } = require('../src/distribution/manager');

function setup(options = {}) {
    let downloads = 0,
        installs = 0;
    const distribution = {
        generation: 0,
        update: { available: true, version: '5.8.0' },
        downloaded: null,
        download: async () => {
            downloads++;
            await options.download?.();
            distribution.downloaded = 'checked.exe';
        }
    };
    const automatic = new AutomaticUpdate({
        distribution,
        supported: () => ({ supported: options.supported !== false, reason: '开发模式' }),
        install: async () => {
            installs++;
            return options.install?.();
        },
        failedVersion: options.failedVersion
    });
    return { automatic, distribution, counts: () => ({ downloads, installs }) };
}
function gate() {
    let resolve;
    const promise = new Promise((done) => {
        resolve = done;
    });
    return { promise, resolve };
}
test('启动无人操作时自动下载校验后安装，运行期间检查只提示', async () => {
    const start = setup();
    await start.automatic.checked({ startup: true });
    assert.deepEqual(start.counts(), { downloads: 1, installs: 1 });
    const using = setup();
    using.automatic.touch();
    await using.automatic.checked({ startup: true });
    assert.equal(using.automatic.status().phase, 'available');
    assert.deepEqual(using.counts(), { downloads: 0, installs: 0 });
    const periodic = setup();
    await periodic.automatic.checked();
    assert.deepEqual(periodic.counts(), { downloads: 0, installs: 0 });
});
test('下载期间开始操作或点击稍后，保留已下载包，不突然重启；后续点击直接安装', async () => {
    for (const defer of ['touch', 'later']) {
        const wait = gate();
        const state = setup({ download: () => wait.promise });
        const task = state.automatic.begin({ startup: true });
        state.automatic[defer]();
        wait.resolve();
        await task;
        assert.equal(state.automatic.phase, 'ready');
        assert.deepEqual(state.counts(), { downloads: 1, installs: 0 });
        await state.automatic.begin();
        assert.deepEqual(state.counts(), { downloads: 1, installs: 1 });
    }
});
test('重复点击合并下载，插件拒绝退出后保持就绪，失败可重试', async () => {
    const wait = gate();
    const state = setup({ download: () => wait.promise, install: () => false });
    const first = state.automatic.begin();
    assert.equal(state.automatic.begin(), first);
    wait.resolve();
    await first;
    assert.equal(state.automatic.phase, 'ready');
    assert.deepEqual(state.counts(), { downloads: 1, installs: 1 });
    let fail = true;
    const broken = setup({
        download: () => {
            if (fail) throw Error('SHA-256 校验失败');
        }
    });
    await broken.automatic.begin();
    assert.equal(broken.automatic.phase, 'error');
    assert.equal(broken.counts().installs, 0);
    fail = false;
    await broken.automatic.begin();
    assert.equal(broken.counts().installs, 1);
});
test('换源/取消/退出使下载结果失效，开发模式与失败版本不自动安装', async () => {
    const wait = gate();
    const state = setup({ download: () => wait.promise });
    const job = state.automatic.begin();
    state.distribution.generation++;
    state.automatic.reset();
    wait.resolve();
    await job;
    assert.equal(state.automatic.phase, 'idle');
    assert.equal(state.counts().installs, 0);
    const developer = setup({ supported: false });
    await developer.automatic.checked({ startup: true });
    assert.equal(developer.counts().downloads, 0);
    await assert.rejects(developer.automatic.begin(), /开发模式/);
    const failed = setup({ failedVersion: '5.8.0' });
    await failed.automatic.checked({ startup: true });
    assert.equal(failed.automatic.phase, 'error');
    assert.equal(failed.counts().downloads, 0);
    await failed.automatic.begin();
    assert.equal(failed.counts().installs, 1, '失败版本允许用户主动重试');
});
test('分系统选择安装方式，macOS 挂载卷/开发运行及不匹配 Linux 包明确降级', () => {
    assert.equal(installation({ packaged: false }).supported, false);
    assert.equal(
        installation({ packaged: true, platform: 'win32', executable: 'C:\\Apps\\Collectify.exe' }).kind,
        'nsis'
    );
    assert.equal(
        installation({
            packaged: true,
            platform: 'darwin',
            executable: '/Applications/Collectify.app/Contents/MacOS/Collectify'
        }).target,
        '/Applications/Collectify.app'
    );
    assert.equal(
        installation({
            packaged: true,
            platform: 'darwin',
            executable: '/Volumes/Collectify/Collectify.app/Contents/MacOS/Collectify'
        }).supported,
        false
    );
    assert.equal(
        installation({ packaged: true, platform: 'linux', appImage: '/home/me/Collectify.AppImage' }).kind,
        'AppImage'
    );
    assert.equal(
        installation({ packaged: true, platform: 'linux', appImage: '', executable: '/opt/Collectify/collectify' })
            .kind,
        'deb'
    );
    assert.equal(
        installation({
            packaged: true,
            platform: 'linux',
            appImage: '/home/me/app.AppImage',
            fileName: 'Collectify.deb'
        }).supported,
        false
    );
});
test('未完成的安装记录阻止下次启动重复自动安装，新版本成功启动清理记录', (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'collectify-update-record-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.mkdirSync(path.join(dir, 'updates'));
    const record = path.join(dir, 'updates', 'install-result.json');
    fs.writeFileSync(record, JSON.stringify({ version: '5.8.0', status: 'pending' }));
    assert.equal(previousInstallation(dir, '5.7.19').version, '5.8.0');
    assert.equal(previousInstallation(dir, '5.8.0'), null);
    assert.equal(fs.existsSync(record), false);
});
test('跨次启动复用校验完整的已下载包，篡改缓存时重新下载', async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'collectify-update-cache-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    let requests = 0;
    const manager = new Distribution({
        registry: { getSetting: (_key, fallback = null) => fallback },
        credentials: { supported: () => true, read: () => null },
        version: '5.7.19',
        directory: dir,
        fetcher: async () => {
            requests++;
            return new Response('verified installer');
        }
    });
    t.after(() => manager.dispose());
    const bytes = Buffer.from('verified installer');
    manager.update = {
        available: true,
        version: '5.8.0',
        file: {
            name: 'Collectify-5.8.0-windows-x64-setup.exe',
            url: 'https://cdn.example.com/setup.exe',
            size: bytes.length,
            sha256: crypto.createHash('sha256').update(bytes).digest('hex')
        }
    };
    const target = path.join(dir, 'updates', manager.update.file.name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, bytes);
    await manager.download();
    assert.equal(requests, 0);
    assert.equal(manager.downloaded, target);
    manager.downloaded = null;
    fs.appendFileSync(target, 'changed');
    await manager.download();
    assert.equal(requests, 1);
    assert.deepEqual(fs.readFileSync(target), bytes);
    fs.appendFileSync(target, 'changed again');
    await assert.rejects(manager.installer(), /发生变化/);
    assert.equal(manager.downloaded, null, '交接前损坏的缓存应失效，重试才能重新下载');
});

async function until(condition) {
    for (let i = 0; i < 400; i++) {
        if (condition()) return;
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw Error('安装助手测试等待超时');
}
test(
    'Windows 真正执行隔离安装助手：等待退出交接、静默参数、重新打开及损坏包拒绝',
    { skip: process.platform !== 'win32', timeout: 60000 },
    async (t) => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "collectify update 中文 '$()-"));
        const controllers = [];
        t.after(() => {
            for (const controller of controllers) if (controller.exitCode === null) controller.kill();
            fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
        });
        const source = path.join(root, 'fixture.cs');
        fs.writeFileSync(
            source,
            'using System; using System.IO; public class Fixture { public static int Main(string[] args) { string exe=Environment.GetCommandLineArgs()[0]; File.WriteAllText(exe+".raw", Environment.CommandLine); File.WriteAllText(exe+".invoked", string.Join("|",args)); return 0; } }',
            'utf8'
        );
        const build = path.join(root, 'build.ps1');
        fs.writeFileSync(
            build,
            'param($Source,$Output)\nAdd-Type -Path $Source -OutputAssembly $Output -OutputType ConsoleApplication\n',
            'utf8'
        );
        const fixture = path.join(root, 'fixture.exe');
        execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', build, source, fixture], {
            windowsHide: true
        });
        const bytes = fs.readFileSync(fixture);
        for (const corrupt of [false, true]) {
            const dir = path.join(root, corrupt ? 'corrupt' : 'good');
            const installed = path.join(dir, 'installed');
            fs.mkdirSync(installed, { recursive: true });
            const target = path.join(installed, 'Collectify.exe');
            fs.writeFileSync(target, bytes);
            const file = path.join(dir, 'Collectify-5.8.0-windows-x64-setup.exe');
            fs.writeFileSync(file, bytes);
            const options = {
                directory: path.join(dir, 'data'),
                file,
                executable: target,
                pid: 2147483647,
                plan: { supported: true, kind: 'nsis', target },
                update: {
                    version: '5.8.0',
                    file: { size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }
                }
            };
            let job, controller;
            if (corrupt) job = await prepareInstallation(options);
            else {
                const script = path.join(dir, 'controller.cjs');
                const input = path.join(dir, 'job.json');
                fs.writeFileSync(input, JSON.stringify(options));
                fs.writeFileSync(
                    script,
                    `const fs=require('node:fs');const {prepareInstallation}=require(${JSON.stringify(require.resolve('../src/distribution/install'))});let job;process.on('message',message=>{if(message==='commit')job.commit();if(message==='quit')process.exit(0)});const options=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));options.pid=process.pid;prepareInstallation(options).then(value=>{job=value;process.send('ready')}).catch(error=>{process.send(error.message);process.exit(1)});`,
                    'utf8'
                );
                const environment = { ...process.env };
                delete environment.NODE_TEST_CONTEXT;
                controller = fork(script, [input], {
                    execArgv: [],
                    env: environment,
                    windowsHide: true,
                    stdio: ['ignore', 'ignore', 'ignore', 'ipc']
                });
                controllers.push(controller);
                await new Promise((resolve, reject) => {
                    const timer = setTimeout(() => reject(Error('控制进程准备超时')), 25000);
                    controller.once('message', (value) => {
                        clearTimeout(timer);
                        value === 'ready' ? resolve() : reject(Error(value));
                    });
                    controller.once('error', reject);
                });
                job = { commit: () => controller.send('commit') };
            }
            assert.equal(fs.existsSync(file + '.invoked'), false, '未提交交接前绝不运行安装器');
            if (corrupt) fs.appendFileSync(file, 'tampered');
            job.commit();
            if (controller) {
                await new Promise((resolve) => setTimeout(resolve, 200));
                assert.equal(fs.existsSync(file + '.invoked'), false, '宿主仍存活时即使已提交也不能替换程序');
                controller.send('quit');
            }
            await until(() => fs.existsSync(target + '.invoked'));
            const result = JSON.parse(
                fs.readFileSync(path.join(dir, 'data', 'updates', 'install-result.json'), 'utf8')
            );
            assert.equal(
                result.status,
                corrupt ? 'error' : 'success',
                fs.readFileSync(path.join(dir, 'data', 'updates', result.job, 'helper.log'), 'utf8')
            );
            if (corrupt) assert.equal(fs.existsSync(file + '.invoked'), false);
            else {
                const raw = fs.readFileSync(file + '.raw', 'utf8');
                assert.equal(raw.trimEnd().endsWith('/S --updated /D=' + installed), true, raw);
            }
        }
    }
);
test(
    'Linux AppImage 真正执行隔离助手：原子替换、保留上版、自动打开',
    { skip: process.platform !== 'linux', timeout: 20000 },
    async (t) => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'collectify-update-linux-'));
        t.after(() => fs.rmSync(root, { recursive: true, force: true }));
        const target = path.join(root, 'Collectify.AppImage');
        fs.writeFileSync(target, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
        const file = path.join(root, 'next.AppImage');
        const bytes = Buffer.from('#!/bin/sh\ntouch "${0}.opened"\n');
        fs.writeFileSync(file, bytes);
        const job = await prepareInstallation({
            directory: path.join(root, 'data'),
            file,
            executable: target,
            pid: 2147483647,
            plan: { supported: true, kind: 'AppImage', target },
            update: {
                version: '5.8.0',
                file: { size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }
            }
        });
        job.commit();
        await until(() => fs.existsSync(target + '.opened'));
        assert.deepEqual(fs.readFileSync(target), bytes);
        assert.equal(fs.existsSync(target + '.collectify-previous'), true);
    }
);
