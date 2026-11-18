const fs = require('node:fs'),
    path = require('node:path'),
    os = require('node:os');
const assert = require('node:assert/strict');
const { PluginTaskPool } = require('../support/host').requireHost('./plugin-system/process-task');
exports.run = async ({ win, hostAction }) => {
    await win.webContents.executeJavaScript('shellReady');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'collectify-process-smoke-'));
    const pool = new PluginTaskPool(dir);
    try {
        const file = path.join(dir, 'worker.cjs');
        fs.writeFileSync(
            file,
            "require('node:worker_threads').parentPort.postMessage({result:{pid:process.pid,value:42}});"
        );
        const task = pool.start(file, {});
        const response = await new Promise((resolve, reject) => {
            task.once('message', resolve);
            task.once('error', reject);
            task.once('exit', (code) => {
                if (code) reject(Error('独立进程退出 ' + code));
            });
        });
        assert.equal(response.result.value, 42);
        assert.notEqual(response.result.pid, process.pid);
        await task.exited;
        const info = await hostAction('workspace-info');
        assert.ok(info.performance.processes.length > 0);
        console.log('ARCHITECTURE PASS：独立计算进程返回、宿主进程隔离、打包入口和性能诊断。');
    } finally {
        await pool.stop();
        fs.rmSync(dir, { recursive: true, force: true });
    }
};
