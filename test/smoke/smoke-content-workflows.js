const assert = require('node:assert/strict'),
    path = require('node:path');
exports.run = async ({ registry, services, runtime, hostAction, win }) => {
    const host = (code) => win.webContents.executeJavaScript(code);
    const page = (id, code) => runtime.views.get(id).view.webContents.executeJavaScript(code);
    const until = async (check, label) => {
        for (let i = 0; i < 150; i++) {
            if (await check()) return;
            await new Promise((resolve) => setTimeout(resolve, 40));
        }
        throw Error(label);
    };
    await host('shellReady');
    registry.install(path.resolve(__dirname, '../../src/plugin-library/calculator'));
    await services.load();
    const bookmarks = await services.call('collectify.bookmarks', 'state');
    const entry = await services.call('collectify.bookmarks', 'save', {
        name: 'workflow-needle 开发',
        url: 'https://example.invalid/dev',
        categoryId: bookmarks.categories[0].id,
        environment: '开发',
        resourceGroup: '测试环境组',
        password: 'workflow-private-only'
    });
    await services.call('collectify.bookmarks', 'save', {
        name: 'workflow-needle 生产',
        url: 'https://example.invalid/prod',
        categoryId: entry.categoryId,
        environment: '生产',
        resourceGroup: '测试环境组'
    });
    const task = await services.call('collectify.tasks', 'task-save', {
        title: 'workflow-needle 待办',
        repeat: 'daily',
        dueAt: new Date().toISOString(),
        status: 'todo'
    });
    await services.call('collectify.notes', 'note-save', { title: 'workflow-needle 便签', content: '备注' });
    const model = require('../../src/plugin-library/calculator/model');
    const sheet = model.createSheet();
    sheet.title = 'workflow-needle 稿纸';
    sheet.rows[0].expression = '单价 = 35';
    registry.storage.set('collectify.calculator', 'sheet:' + sheet.id, sheet);
    registry.storage.set('collectify.calculator', 'index', {
        schemaVersion: 1,
        active: sheet.id,
        fontSize: 22,
        keyboardOpen: false,
        sheets: [model.indexItem(sheet)]
    });
    const found = await hostAction('content-search', 'workflow-needle');
    assert.deepEqual([...new Set(found.map((r) => r.pluginId))].sort(), [
        'collectify.bookmarks',
        'collectify.calculator',
        'collectify.notes',
        'collectify.tasks'
    ]);
    assert.equal((await hostAction('content-search', 'workflow-private-only')).length, 0, '不索引密码');
    const activePage = runtime.views.get(runtime.activeId).view.webContents;
    activePage.sendInputEvent({ type: 'keyDown', keyCode: 'K', modifiers: ['control'] });
    activePage.sendInputEvent({ type: 'keyUp', keyCode: 'K', modifiers: ['control'] });
    await until(() => host("document.querySelector('#content-search-dialog').open"), '插件内快捷键未打开统一搜索');
    await host(
        "document.querySelector('#content-search-query').value='workflow-needle';document.querySelector('#content-search-query').dispatchEvent(new Event('input'))"
    );
    await until(
        () => host("document.querySelectorAll('.content-search-result').length>=5"),
        '全局搜索未显示跨插件结果'
    );
    const searchGeometry = await host(
        "(()=>{const r=document.querySelector('#content-search-query').getBoundingClientRect(),d=document.querySelector('#content-search-dialog').getBoundingClientRect();return {input:r.width,dialog:d.width,inside:r.left>=d.left && r.right<=d.right}})()"
    );
    assert.ok(
        searchGeometry.input > searchGeometry.dialog * 0.7 && searchGeometry.inside,
        '搜索输入区应充分利用弹窗宽度'
    );
    await new Promise((resolve) => setTimeout(resolve, 250));
    require('node:fs').writeFileSync(
        path.resolve(__dirname, '../../dist/workbench-search.png'),
        (await win.webContents.capturePage()).toPNG()
    );
    await host(
        "[...document.querySelectorAll('.content-search-result')].find(b=>b.textContent.includes('稿纸')).click()"
    );
    await until(
        () =>
            runtime.activeId === 'collectify.calculator' &&
            page('collectify.calculator', `initialized && sheet.id===${JSON.stringify(sheet.id)}`),
        '搜索稿纸首次打开未定位'
    );
    await hostAction('plugin-open', { id: 'collectify.tasks', route: 'list', data: { focusId: task.id } });
    await until(() => page('collectify.tasks', "document.querySelector('#task-dialog').open"), '搜索待办未定位');
    await page('collectify.tasks', "document.querySelector('#task-dialog').close()");
    await hostAction('plugin-open', { id: 'collectify.bookmarks', data: { focusId: entry.id } });
    await until(
        () => page('collectify.bookmarks', "document.querySelectorAll('.resource-environments button').length>=2"),
        '环境组切换入口未展示'
    );
    assert.ok(await page('collectify.bookmarks', "!!document.querySelector('.production-resource')"));
    const fs = require('node:fs'),
        { dialog } = require('electron');
    const localRoot = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'local-ui-batch-'));
    const originalDialog = { open: dialog.showOpenDialog, message: dialog.showMessageBox };
    try {
        for (const name of ['one', 'two']) {
            const folder = path.join(localRoot, name);
            fs.cpSync(path.resolve(__dirname, '../../src/plugin-templates/basic'), folder, { recursive: true });
            const file = path.join(folder, 'manifest.json'),
                manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
            manifest.id = 'example.batch-' + name;
            manifest.name = '批量测试 ' + name;
            fs.writeFileSync(file, JSON.stringify(manifest), 'utf8');
        }
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [localRoot] });
        dialog.showMessageBox = async () => ({ response: 1 });
        await host("openSettings('plugins')");
        await host("document.querySelector('#discover-local-plugins').click()");
        await until(
            () => host("document.querySelectorAll('#local-plugin-list input[data-local-id]').length===2"),
            '未批量发现开发插件'
        );
        await host("document.querySelector('#install-local-plugins').click()");
        await until(
            () =>
                host(
                    "document.querySelector('#local-plugin-status').textContent.includes('已加载') && !document.querySelector('#install-local-plugins').disabled"
                ),
            '未完成批量加载'
        );
        for (const name of ['one', 'two']) assert.ok(registry.plugins.has('example.batch-' + name));
        registry.storage.set('example.batch-one', 'saved', 'keep');
        fs.appendFileSync(path.join(localRoot, 'one/index.html'), '\n<!-- same-version edited -->');
        await host("document.querySelector('#reload-local-plugins').click()");
        await until(
            () => host("document.querySelector('#local-plugin-status').textContent.includes('发现 2')"),
            '重扫目录失败'
        );
        await host("document.querySelector('#install-local-plugins').click()");
        await until(
            () =>
                host(
                    "document.querySelector('#local-plugin-status').textContent.includes('已加载') && !document.querySelector('#install-local-plugins').disabled"
                ),
            '同版本批量重载失败'
        );
        assert.match(
            fs.readFileSync(path.join(registry.get('example.batch-one').directory, 'index.html'), 'utf8'),
            /same-version edited/
        );
        assert.equal(registry.storage.get('example.batch-one', 'saved'), 'keep');
        await host("document.querySelector('#settings-dialog').close()");
    } finally {
        dialog.showOpenDialog = originalDialog.open;
        dialog.showMessageBox = originalDialog.message;
        fs.rmSync(localRoot, { recursive: true, force: true });
    }
    // 使用真实批量更新页面，模拟网络结果，验证串行队列能继续并保留失败项供重试。
    await host(`(async()=>{
        window.workflowOriginalCall=call;window.workflowOriginalRefresh=refresh;
        window.workflowAttempts=[];window.workflowActive=0;window.workflowPeak=0;
        catalogState={loaded:true,source:'',plugins:state.plugins.filter(p=>['collectify.json','collectify.notes'].includes(p.id)).map(p=>({...p,version:'99.0.0',compatible:true}))};
        refresh=async()=>{};
        call=async(action,id)=>{
            if(action==='plugin-catalog-status') return catalogState;
            if(action!=='plugin-catalog-install') return workflowOriginalCall(action,id);
            workflowActive++;workflowPeak=Math.max(workflowPeak,workflowActive);workflowAttempts.push(id);
            await new Promise(r=>setTimeout(r,30));workflowActive--;
            if(id==='collectify.notes') throw Error('模拟网络失败');
            state.plugins.find(p=>p.id===id).version='99.0.0';return true;
        };
        await openSettings('plugins');pluginManagerSignature='';renderPluginManager();
        document.querySelector('.plugin-update-batch button').click();
        document.querySelectorAll('.plugin-update-batch button')[1].click();
    })()`);
    await until(() => host("!batchUpdating && batchUpdateReport.includes('失败')"), '批量更新结果未显示失败');
    assert.equal(await host('workflowAttempts.length'), 2);
    assert.equal(await host('workflowPeak'), 1);
    assert.match(await host('batchUpdateReport'), /成功/);
    assert.equal(await host("batchUpdates.has('collectify.notes')"), true);
    await host(
        "call=workflowOriginalCall;refresh=workflowOriginalRefresh;document.querySelector('#settings-dialog').close()"
    );
    for (const record of runtime.views.values()) assert.deepEqual(record.errors, []);
    console.log(
        'CONTENT WORKFLOWS PASS：四插件搜索与定位、不搜索密码、环境组与生产标记、真实批量更新页面串行处理并保留失败项。'
    );
};
