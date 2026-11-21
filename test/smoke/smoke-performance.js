const assert = require('node:assert/strict');
exports.run = async ({ win, hostAction, registry, runtime }) => {
    const host = (code) => win.webContents.executeJavaScript(code);
    await host('shellReady');
    const checks = await host(`(()=>{
        const rail=document.querySelector('#plugin-rail').firstElementChild;
        const nav=document.querySelector('#plugin-navigation').firstElementChild;
        const started=performance.now();
        for(let i=0;i<40;i++) renderShell({...state,tasks:[...(state.tasks||[])]});
        return {railPreserved:rail===document.querySelector('#plugin-rail').firstElementChild,
            navigationPreserved:nav===document.querySelector('#plugin-navigation').firstElementChild,
            repeatedStateMs:Math.round(performance.now()-started)};
    })()`);
    assert.equal(checks.railPreserved, true, '无目录变化不重建插件入口');
    assert.equal(checks.navigationPreserved, true, '无导航变化不重建二级入口');
    for (const plugin of registry.list().filter((p) => p.enabled)) await hostAction('plugin-open', { id: plugin.id });
    const pages = new Map([...runtime.views].map(([id, record]) => [id, record.view.webContents.id]));
    for (const plugin of registry.list().filter((p) => p.enabled)) {
        assert.equal(runtime.views.has(plugin.id), true, '默认插件切换一圈后应仍保留页面');
        await hostAction('plugin-open', { id: plugin.id });
        assert.equal(
            runtime.views.get(plugin.id).view.webContents.id,
            pages.get(plugin.id),
            '再次切换应复用原页面进程'
        );
    }
    const metrics = await hostAction('workspace-info');
    assert.ok(metrics.performance.pluginLoads.length > 0);
    assert.ok(metrics.performance.operations.some((m) => m.key.endsWith(':backend-load')));
    for (const record of runtime.views.values()) assert.deepEqual(record.errors, []);
    {
        assert.ok(runtime.sdkAssets.items.size > 0, '开发与正式包的 SDK 请求均应进入有界共享缓存');
        assert.ok(runtime.sdkAssets.bytes <= runtime.sdkAssets.limit);
        console.log(
            'SDK CACHE',
            JSON.stringify({ entries: runtime.sdkAssets.items.size, bytes: runtime.sdkAssets.bytes })
        );
    }
    console.log('PERFORMANCE PASS：默认插件切换复用页面、开发资源缓存、重复状态保留导航节点。', JSON.stringify(checks));
};
