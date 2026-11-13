const { Worker } = require('node:worker_threads');
// 仅在有内存和时间限制的工作线程中编译脚本，不执行 AI 生成的代码。
function validateScripts(files) {
    return new Promise((resolve, reject) => {
        const source = `const{parentPort,workerData}=require('node:worker_threads'),vm=require('node:vm');const errors=[];for(const file of workerData){try{new vm.Script(file.content,{filename:file.path});}catch(error){errors.push({file:file.path,message:error.message});}}parentPort.postMessage(errors);`;
        const worker = new Worker(source, {
            eval: true,
            workerData: files,
            resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16 }
        });
        let done = false;
        const finish = (error, result) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            void worker.terminate();
            if (error) reject(error);
            else resolve(result);
        };
        const timer = setTimeout(() => finish(Error('脚本校验超时，请减小插件程序')), 5000);
        worker.once('message', (errors) => finish(null, errors));
        worker.once('error', (error) => finish(error));
        worker.once('exit', (code) => {
            if (!done) finish(Error(`脚本校验线程退出：${code}`));
        });
    });
}
module.exports = { validateScripts };
