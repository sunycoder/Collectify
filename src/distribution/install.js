const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');

function installation({
    packaged,
    platform = process.platform,
    executable = process.execPath,
    appImage = process.env.APPIMAGE,
    fileName
}) {
    if (!packaged) return { supported: false, reason: '开发运行不替换源码，请使用安装版体验自动更新。' };
    if (platform === 'win32') return { supported: true, kind: 'nsis', target: executable };
    if (platform === 'darwin') {
        const match = executable.match(/^(.*\.app)\/Contents\/MacOS\/[^/]+$/);
        if (!match || match[1].startsWith('/Volumes/'))
            return { supported: false, reason: '请先把 Collectify 拖入“应用程序”，再使用自动更新。' };
        return { supported: true, kind: 'dmg', target: match[1] };
    }
    if (platform === 'linux') {
        const kind = appImage ? 'AppImage' : 'deb';
        if (fileName && !fileName.endsWith('.' + kind))
            return { supported: false, reason: '当前发布缺少与本机安装方式匹配的 ' + kind + ' 包，请手动选择安装包。' };
        return { supported: true, kind, target: appImage || executable };
    }
    return { supported: false, reason: '当前系统暂不支持自动安装。' };
}

// 脚本与参数分开传递，路径从不拼进 shell 源码。helper 在宿主退出且写入 commit 后才可安装。
async function prepareInstallation({
    directory,
    file,
    update,
    plan,
    executable = process.execPath,
    pid = process.pid
}) {
    if (!plan.supported) throw Error(plan.reason);
    if (plan.kind === 'dmg' || plan.kind === 'AppImage') {
        await fs.promises.access(path.dirname(plan.target), fs.constants.W_OK);
        if ((await fs.promises.lstat(plan.target)).isSymbolicLink())
            throw Error('自动更新不替换符号链接，请从实际安装位置运行。');
    }
    const windows = plan.kind === 'nsis';
    if (windows) {
        const relative = path.relative(path.dirname(plan.target), directory);
        if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)))
            throw Error('用户数据目录位于程序安装目录内，请先迁移数据后更新。');
    }
    const job = path.join(directory, 'updates', 'install-' + randomUUID());
    await fs.promises.mkdir(job, { recursive: true, mode: 0o700 });
    const helper = path.join(job, windows ? 'install.ps1' : 'install.sh');
    const source = await fs.promises.readFile(
        path.join(__dirname, windows ? 'install-windows.ps1' : 'install-unix.sh'),
        'utf8'
    );
    // Windows PowerShell 5.1 默认按本机 ANSI 解码脚本，中文注释也可能吞掉换行；显式写 UTF-8 BOM。
    await fs.promises.writeFile(helper, (windows ? '\uFEFF' : '') + source, 'utf8');
    const result = path.join(directory, 'updates', 'install-result.json');
    await fs.promises.writeFile(result, JSON.stringify({ version: update.version, status: 'pending' }), {
        mode: 0o600
    });
    const common = [
        String(pid),
        file,
        plan.target,
        executable,
        update.file.sha256,
        String(update.file.size),
        job,
        result,
        update.version
    ];
    let command, args;
    if (windows) {
        command = path.join(
            process.env.SystemRoot || 'C:\\Windows',
            'System32',
            'WindowsPowerShell',
            'v1.0',
            'powershell.exe'
        );
        const helperArgs = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper, ...common];
        const literal = (value) => "'" + value.replace(/'/g, "''") + "'";
        // Start-Process 创建独立隐藏控制台；直接继承 Node 的控制台会在宿主退出时丢失助手。
        // EncodedCommand 仅承载此处固定命令；所有路径均作为 PowerShell 单引号字符串转义。
        const argumentsText = helperArgs.map((value) => '"' + value + '"').join(' ');
        const bootstrap = `Start-Process -FilePath ${literal(command)} -ArgumentList ${literal(argumentsText)} -WindowStyle Hidden -RedirectStandardOutput ${literal(path.join(job, 'helper.log'))} -RedirectStandardError ${literal(path.join(job, 'helper-error.log'))}`;
        args = [
            '-NoProfile',
            '-NonInteractive',
            '-EncodedCommand',
            Buffer.from(bootstrap, 'utf16le').toString('base64')
        ];
    } else {
        command = '/bin/sh';
        args = [helper, plan.kind, ...common];
    }
    const log = fs.openSync(path.join(job, windows ? 'bootstrap.log' : 'helper.log'), 'a', 0o600);
    const child = spawn(command, args, { detached: !windows, stdio: ['ignore', log, log], windowsHide: true });
    fs.closeSync(log);
    let failure;
    child.once('error', (error) => {
        failure = error;
    });
    child.once('exit', (code) => {
        if (!windows || code !== 0) failure ||= Error('更新助手提前退出：' + code);
    });
    try {
        for (let attempt = 0; attempt < 400; attempt++) {
            if (failure) throw failure;
            if (fs.existsSync(path.join(job, 'ready'))) {
                child.unref();
                return {
                    commit: () => fs.writeFileSync(path.join(job, 'commit'), ''),
                    cancel: () => fs.writeFileSync(path.join(job, 'cancel'), '')
                };
            }
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        throw Error('更新助手启动超时，当前程序仍可继续使用。');
    } catch (error) {
        fs.writeFileSync(path.join(job, 'cancel'), '');
        child.unref();
        for (const name of ['bootstrap.log', 'helper.log', 'helper-error.log']) {
            const file = path.join(job, name);
            if (fs.existsSync(file)) error.message += '\n' + fs.readFileSync(file, 'utf8').slice(-2000);
        }
        throw error;
    }
}

function previousInstallation(directory, currentVersion) {
    const file = path.join(directory, 'updates', 'install-result.json');
    try {
        const result = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
        if (!/^\d+\.\d+\.\d+$/.test(result.version)) return null;
        if (result.version === currentVersion) {
            if (result.status === 'success' && /^install-[a-f0-9-]{36}$/.test(result.job)) {
                // 安装目录备份较大，首屏后延迟异步清理，不把磁盘删除放到启动关键路径。
                const timer = setTimeout(() => {
                    void fs.promises
                        .rm(path.join(directory, 'updates', result.job), { recursive: true, force: true })
                        .then(async () => {
                            const latest = JSON.parse(await fs.promises.readFile(file, 'utf8'));
                            if (latest.version === result.version && latest.job === result.job)
                                await fs.promises.unlink(file);
                        })
                        .catch(() => {});
                }, 30000);
                timer.unref();
            } else fs.unlinkSync(file);
            return null;
        }
        return { version: result.version, error: '上次更新未完成，仍在使用旧版本。可点击重试更新。' };
    } catch {
        return null;
    }
}
module.exports = { installation, prepareInstallation, previousInstallation };
