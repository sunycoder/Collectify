// 子进程只运行插件声明的计算线程；窗口、系统对话框和凭据仍由宿主控制。
const { Worker } = require('node:worker_threads');
let worker;
process.once('message', ({ file, options }) => {
    try {
        worker = new Worker(file, options);
        worker.on('message', (value) => {
            if (process.connected) process.send({ type: 'message', value });
        });
        worker.on('error', (error) => {
            if (process.connected) process.send({ type: 'failure', message: error.message });
        });
        worker.on('exit', (code) => {
            if (process.connected) process.send({ type: 'exit', code }, () => process.exit(code ? 1 : 0));
            else process.exit(code ? 1 : 0);
        });
    } catch (error) {
        if (process.connected) process.send({ type: 'failure', message: error.message }, () => process.exit(1));
        else process.exit(1);
    }
});
process.on('disconnect', () => process.exit(0));
