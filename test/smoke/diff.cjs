const { app, BrowserWindow, protocol, dialog, nativeImage } = require('electron');
const fs = require('node:fs'),
    path = require('node:path'),
    os = require('node:os'),
    assert = require('node:assert/strict');
const { PluginRegistry } = require('../../src/plugin-system/registry'),
    { PluginRuntime } = require('../../src/plugin-system/runtime'),
    { PluginServices } = require('../../src/plugin-system/services'),
    { PluginPackages, collectFiles, encodeZip } = require('../../src/plugin-system/package');
const root = path.resolve(__dirname, '../..'),
    id = 'collectify.diff',
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'collectify-diff-ui-'));
protocol.registerSchemesAsPrivileged([
    {
        scheme: 'collectify-plugin',
        privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
    }
]);
app.disableHardwareAcceleration();
app.setAppPath(path.resolve(__dirname, '../..'));
app.setPath('userData', tmp);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
app.whenReady().then(async () => {
    let win, runtime, services;
    try {
        const files = require('../support/diff-fixtures').create(path.join(tmp, 'fixtures'));
        const registry = new PluginRegistry({
            builtinRoot: path.join(root, 'src/plugins'),
            userRoot: path.join(tmp, 'packages'),
            dataRoot: path.join(tmp, 'data'),
            hostFile: path.join(tmp, 'host.sqlite')
        });
        assert.equal(registry.defaults().length, 5);
        assert.equal(registry.plugins.has(id), false);
        const packages = new PluginPackages(registry, path.join(tmp, 'staging')),
            prepared = packages.prepare(
                encodeZip(collectFiles(path.join(root, 'src/plugin-library/diff')), { native: true, store: true })
            );
        registry.install(prepared.directory, prepared.manifest);
        packages.cleanup(prepared);
        let theme = require('../../src/theme').validate({ preset: 'office' });
        win = new BrowserWindow({ show: false, width: 1300, height: 880, webPreferences: { offscreen: true } });
        runtime = new PluginRuntime({
            registry,
            getWindow: () => win,
            getTheme: () => theme,
            changed: () => {},
            smoke: true
        });
        services = new PluginServices(registry, {
            getWindow: () => win,
            getSettings: () => ({ theme }),
            setSettings: () => {},
            smoke: true
        });
        runtime.services = services;
        runtime.clipboard = { read: async () => [], writeText: async () => {} };
        services.on('event', (e) => runtime.emit(e.pluginId, e.name, e.data));
        await services.load();
        assert.ok(!services.errors.has(id), services.errors.get(id));
        assert.equal(fs.existsSync(path.join(registry.dataRoot, id)), false, '未打开不读取文件、不建库');
        assert.equal(services.contributions().filter((t) => t.pluginId === id).length, 0, '不提供 AI 或 MCP 工具');
        win.showInactive();
        await runtime.open(id, 'open', 'text');
        let wc = runtime.views.get(id).view.webContents;
        const js = async (code) => {
            try {
                return await wc.executeJavaScript(code);
            } catch (error) {
                const detail = await wc
                    .executeJavaScript("document.querySelector('#error')?.textContent")
                    .catch(() => null);
                throw Error(code + '\n' + error.message + '\n' + detail);
            }
        };
        const until = async (predicate) => {
            for (let i = 0; i < 160; i++) {
                if (await predicate()) return;
                await delay(50);
            }
            throw Error('Diff UI 等待超时：' + (await js("document.querySelector('#error').textContent")));
        };
        const errors = [];
        wc.on('console-message', (event) => {
            if (event.level === 'error' || event.level === 3) {
                errors.push(event.message);
                console.error('DIFF RENDERER:', event.message);
            }
        });
        await js('DiffApp.ready');
        await js("window.firstGroup=DiffApp.workspaces.active;DiffApp.setTexts(['第一组原文','第一组修改'])");
        await js(
            "[...document.querySelectorAll('.comparison-workspaces button')].find(b=>b.textContent.includes('新对比')).click()"
        );
        await until(() => js("DiffApp.workspaces.groups.length===2 && DiffApp.models[0].getValue()===''"));
        await js("DiffApp.setTexts(['第二组原文','第二组修改'])");
        await js('DiffApp.workspaces.switchGroup(firstGroup)');
        assert.equal(await js('DiffApp.models[0].getValue()'), '第一组原文');
        await js('DiffApp.workspaces.switchGroup(DiffApp.workspaces.groups[1].id)');
        assert.equal(await js('DiffApp.models[1].getValue()'), '第二组修改');
        await js("DiffApp.setTexts(['',''])");
        await until(() => js('!!DiffApp.diff'));
        assert.equal(
            await js("document.querySelectorAll('#editor .monaco-diff-editor').length"),
            1,
            '仅初始化一个编辑器'
        );
        assert.equal(await js("document.querySelector('.brand img').naturalWidth>0"), true);
        await js(`DiffApp.importPaths(${JSON.stringify([files.left, files.right])})`);
        await js(
            "document.querySelector('.workspace-actions').open=true;document.querySelector('#comparison-name').value='常用测试组合';[...document.querySelectorAll('.workspace-actions button')].find(b=>b.textContent==='保存对比组合').click()"
        );
        await until(() => js("document.querySelectorAll('.saved-comparison-row').length===1"));
        assert.equal(await js("document.querySelector('.workspace-actions').open"), false, '保存后收起组合浮层');
        await js("document.querySelector('.workspace-actions').open=true");
        const savedVisible = await js(
            "(()=>{const row=document.querySelector('.saved-comparison-row').getBoundingClientRect();return !!document.elementFromPoint(row.left+10,row.top+10)?.closest('.workspace-actions')})()"
        );
        assert.equal(savedVisible, true, '组合列表不得被顶部容器裁剪或主内容遮挡');
        await delay(150);
        fs.writeFileSync(path.join(root, 'dist/diff-saved-combinations.png'), (await wc.capturePage()).toPNG());
        wc.sendInputEvent({ type: 'mouseDown', x: 10, y: 10, button: 'left', clickCount: 1 });
        wc.sendInputEvent({ type: 'mouseUp', x: 10, y: 10, button: 'left', clickCount: 1 });
        assert.equal(await js("document.querySelector('.workspace-actions').open"), false, '点击外部关闭组合列表');
        await js(
            "document.querySelector('.workspace-actions').open=true;document.querySelector('.saved-comparisons input').value='没有匹配';document.querySelector('.saved-comparisons input').dispatchEvent(new Event('input'))"
        );
        assert.equal(await js("document.querySelectorAll('.saved-comparison-row').length"), 0);
        await js(
            "document.querySelector('.saved-comparisons input').value='常用';document.querySelector('.saved-comparisons input').dispatchEvent(new Event('input'));document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))"
        );
        assert.equal(await js("document.querySelector('.workspace-actions').open"), false);
        await until(() => js('(DiffApp.diff.getLineChanges()||[]).length>0'));
        assert.equal(await js('DiffApp.models[0].getLanguageId()'), 'javascript');
        await until(() => js("document.querySelector('#editor .view-lines')?.textContent.includes('budget')"));
        await delay(150);
        fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
        fs.writeFileSync(path.join(root, 'dist/diff-text.png'), (await wc.capturePage()).toPNG());
        wc.debugger.attach('1.3');
        await js('DiffApp.items=[null,null]');
        const drag = { items: [], files: [files.left, files.right], dragOperationsMask: 1 };
        for (const type of ['dragEnter', 'dragOver', 'drop'])
            await wc.debugger.sendCommand('Input.dispatchDragEvent', { type, x: 600, y: 300, data: drag });
        await until(() => js("DiffApp.items[1]?.name==='after.js' && !document.querySelector('#error').textContent"));
        await js('DiffApp.clearCurrent()');
        for (const file of [files.left, files.right]) {
            const one = { items: [], files: [file], dragOperationsMask: 1 };
            for (const type of ['dragEnter', 'dragOver', 'drop'])
                await wc.debugger.sendCommand('Input.dispatchDragEvent', { type, x: 500, y: 350, data: one });
        }
        await until(() => js("DiffApp.items[0]?.name==='before.js' && DiffApp.items[1]?.name==='after.js'"));
        await js("DiffApp.setMode('folder')");
        assert.equal(
            await js("document.querySelector('#content-empty').hidden"),
            false,
            '空文件夹页应显示自己的空状态'
        );
        assert.equal(await js("document.querySelector('#text-panel').hidden"), true, '不能显示文本模式的旧文件');
        assert.equal(await js("document.querySelector('#pair-left').disabled"), true, '没有目录时不能弹空下拉框');
        assert.equal(await js("document.querySelector('#error').textContent"), '');
        await js("DiffApp.setMode('text')");
        assert.match(await js('DiffApp.models[0].getValue()'), /const budget = 100/);
        const selectBounds = await js(
            "(()=>{const r=document.querySelector('#view').tomselect.control.getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()"
        );
        wc.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...selectBounds });
        wc.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...selectBounds });
        await until(() => js("document.querySelector('#view').tomselect.dropdown.matches(':popover-open')"));
        assert.equal(
            await js(
                "(()=>{const r=document.querySelector('#view').tomselect.dropdown.getBoundingClientRect();return r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight})()"
            ),
            true,
            '下拉浮层不能被侧栏裁切或超出窗口'
        );
        await js('OfficeUI.close()');
        await js("document.querySelector('#view').tomselect.setValue('unified')");
        await until(() => js("DiffApp.settings.view==='unified'"));
        await js("document.querySelector('#view').tomselect.setValue('split')");
        await until(() => js("DiffApp.settings.view==='split'"));
        assert.equal(await js("document.querySelector('.privacy')"), null);
        wc.debugger.detach();
        await js(`DiffApp.importPaths(${JSON.stringify([files.roots[0]])})`);
        assert.equal(await js('DiffApp.mode'), 'folder');
        assert.equal(await js('DiffApp.folders.snapshot'), null, '单侧目录不应提前扫描');
        assert.equal(await js("document.querySelector('#error').textContent"), '');
        await js(`DiffApp.importPaths(${JSON.stringify([files.roots[1]])})`);
        assert.equal(await js('DiffApp.folders.snapshot.differences'), 4, '连续选择两个目录后自动扫描');
        await js("DiffApp.setMode('text')");
        assert.match(await js('DiffApp.models[0].getValue()'), /budget/);
        const originalClipboard = runtime.clipboard;
        runtime.clipboard = {
            read: async () => [
                {
                    types: ['text/uri-list'],
                    getType: async () =>
                        new Blob(
                            [
                                require('node:url').pathToFileURL(files.docxLeft).href +
                                    '\n' +
                                    require('node:url').pathToFileURL(files.docxRight).href
                            ],
                            { type: 'text/uri-list' }
                        )
                }
            ]
        };
        await js('DiffApp.paste(0)');
        assert.equal(await js('DiffApp.items[0].name'), 'before.docx');
        runtime.clipboard = originalClipboard;
        await js("DiffApp.saveSettings({language:'java',view:'unified'})");
        assert.equal(await js('DiffApp.models[1].getLanguageId()'), 'java');
        await js("DiffApp.saveSettings({view:'split'})");
        await js("DiffApp.setMode('text')");
        await js("DiffApp.setTexts(['hello old world','hello new world'])");
        await until(() => js('(DiffApp.diff.getLineChanges()||[]).length>0'));
        const report = await js('DiffApp.report()');
        assert.match(report.before, /old/);
        await js("document.querySelector('#export').click()");
        await until(() => js('!!preparedExport && !preparingExport'));
        assert.match(await js("document.querySelector('#export-summary').textContent"), /仅差异/);
        assert.equal(await js('preparedExport.report.parts.every(part=>part.added||part.removed)'), true);
        const exportBounds = await js(
            "(()=>{const r=document.querySelector('#export-dialog').getBoundingClientRect();return {inside:{x:Math.round(r.left+30),y:Math.round(r.top+30)},outside:{x:Math.max(2,Math.floor(r.left-10)),y:Math.round(r.top+20)}}})()"
        );
        wc.sendInputEvent({ type: 'mouseDown', ...exportBounds.inside, button: 'left', clickCount: 1 });
        wc.sendInputEvent({ type: 'mouseMove', ...exportBounds.outside });
        wc.sendInputEvent({ type: 'mouseUp', ...exportBounds.outside, button: 'left', clickCount: 1 });
        assert.equal(await js("document.querySelector('#export-dialog').open"), true, '导出弹窗内部拖到外部不关闭');
        wc.sendInputEvent({ type: 'mouseDown', ...exportBounds.outside, button: 'left', clickCount: 1 });
        wc.sendInputEvent({ type: 'mouseUp', ...exportBounds.outside, button: 'left', clickCount: 1 });
        await until(() => js("!document.querySelector('#export-dialog').open"));
        await js("document.querySelector('#export').click()");
        await until(() => js('!!preparedExport && !preparingExport'));
        await js(
            "document.querySelector('#export-scope').value='context';document.querySelector('#export-scope').dispatchEvent(new Event('change'))"
        );
        await until(() => js("preparedExport?.scope==='context' && !preparingExport"));
        assert.equal(await js('preparedExport.report.parts.some(part=>!part.added&&!part.removed)'), true);
        const summarySave = dialog.showSaveDialog,
            summaryFile = path.join(tmp, 'scoped-report.json');
        try {
            dialog.showSaveDialog = async () => ({ canceled: false, filePath: summaryFile });
            await js(
                "document.querySelector('#export-format').value='json';document.querySelector('#export-scope').value='differences';document.querySelector('#export-scope').dispatchEvent(new Event('change'))"
            );
            await until(() => js("preparedExport?.scope==='differences'&&!preparingExport"));
            await js("document.querySelector('#confirm-export').click()");
            await until(async () => fs.existsSync(summaryFile));
            const scoped = JSON.parse(fs.readFileSync(summaryFile, 'utf8'));
            assert.equal(scoped.scope, 'differences');
            assert.ok(scoped.parts.every((part) => part.added || part.removed));
        } finally {
            dialog.showSaveDialog = summarySave;
        }
        await js("document.querySelector('#cancel-export').click()");
        await js('DiffApp.next(1,true);DiffApp.merge(1)');
        await until(() => js("DiffApp.models[1].getValue()==='hello old world'"));
        await js("document.querySelector('#undo-merge').click()");
        await until(() => js("DiffApp.models[1].getValue()==='hello new world'"));
        await js("DiffApp.setMode('image')");
        assert.equal(await js("document.querySelector('#content-empty').hidden"), false);
        await js("DiffApp.setMode('text')");
        assert.equal(await js('DiffApp.models[1].getValue()'), 'hello new world', '各模式需独立保留编辑内容');
        const originalSave = dialog.showSaveDialog;
        for (const [before, after] of [
            ['one\nthree', 'one\ntwo\nthree'],
            ['one\ntwo\nthree', 'one\nthree'],
            ['A\n', 'B\n'],
            ['', 'added']
        ]) {
            await js(`DiffApp.setTexts(${JSON.stringify([before, after])})`);
            await until(() => js('(DiffApp.diff.getLineChanges()||[]).length>0'));
            await js('DiffApp.next(1,true);DiffApp.merge(1)');
            await until(() => js(`DiffApp.models[1].getValue()===${JSON.stringify(before)}`));
        }
        let format = 'html';
        await js("DiffApp.setTexts(['hello old world','hello new world'])");
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: path.join(tmp, 'report.' + format) });
        try {
            for (const value of ['html', 'json', 'pdf']) {
                format = value;
                const exported = await services.call(id, 'export', { format, report });
                assert.ok(exported.bytes > 20);
                if (format === 'pdf') assert.equal(fs.readFileSync(exported.file).subarray(0, 4).toString(), '%PDF');
            }
        } finally {
            dialog.showSaveDialog = originalSave;
        }
        fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
        await until(() => js("document.querySelector('#editor .view-lines')?.textContent.includes('hello')"));
        await delay(200);
        await js(`DiffApp.importPaths(${JSON.stringify([files.docxLeft, files.docxRight])})`);
        assert.match(await js('DiffApp.models[0].getValue()'), /合同：100/);
        await js(`DiffApp.importPaths(${JSON.stringify([files.xlsxLeft, files.xlsxRight])})`);
        assert.equal(await js('DiffApp.content'), 'document');
        assert.ok(
            await js("document.querySelector('.document-body').getBoundingClientRect().height > innerHeight * .55"),
            '表格内容区至少保留页面高度的 55%'
        );
        assert.ok(await js("document.querySelectorAll('.sheet-table td.changed').length>0"));
        await js(
            "document.querySelector('#sheet-result-query').value='不存在的业务ID';document.querySelector('#sheet-result-query').dispatchEvent(new Event('input'))"
        );
        assert.equal(await js('DiffApp.documents.sheetUI.filteredResult.rows.length'), 0);
        assert.equal(await js("document.querySelectorAll('#sheet-change-list .change-card').length"), 0);
        await js(
            "document.querySelector('#sheet-result-query').value='';document.querySelector('#sheet-result-query').dispatchEvent(new Event('input'))"
        );
        let copiedRow = '';
        runtime.clipboard.writeText = async (text) => {
            copiedRow = text;
        };
        await js("document.querySelector('.sheet-table th button').click()");
        await until(() => copiedRow.length > 0);
        assert.match(copiedRow, /\t/);
        await js("document.querySelector('[data-sheet-view=redline]').click()");
        assert.ok(
            await js(
                "document.querySelectorAll('#sheet-single del').length>0 && document.querySelectorAll('#sheet-single ins').length>0"
            )
        );
        assert.equal(await js("document.querySelector('#sheet-changes').hidden"), false);
        await js('DiffApp.documents.sheetUI.goto(0)');
        assert.ok(await js("document.querySelectorAll('.sheet-table td.focused').length>0"));
        await js("document.querySelector('#sheet-edit').click();void DiffApp.documents.sheetUI.edit(1,1,0)");
        await until(() => js("!!document.querySelector('dialog[open] textarea')"));
        await js(
            "document.querySelector('dialog[open] textarea').value='draft cell';document.querySelector('dialog[open] .dialog-actions button').click()"
        );
        await until(() => js("!!document.querySelector('.unsaved-changes-dialog[open]')"));
        await js("document.querySelector('[data-choice=cancel]').click()");
        await until(() => js("!document.querySelector('.unsaved-changes-dialog')"));
        assert.equal(await js("document.querySelector('dialog[open] textarea').value"), 'draft cell');
        wc.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
        wc.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
        await until(() => js("!!document.querySelector('.unsaved-changes-dialog[open]')"));
        await js("document.querySelector('[data-choice=discard]').click()");
        await until(() => js("!document.querySelector('dialog[open] textarea')"));
        await js('void DiffApp.documents.sheetUI.edit(1,1,0)');
        await until(() => js("!!document.querySelector('dialog[open] textarea')"));
        await js("document.querySelector('dialog[open] textarea').value='new cell'");
        const cellOutside = await js(
            "(()=>{const r=document.querySelector('dialog[open]').getBoundingClientRect();return {x:Math.max(2,Math.floor(r.left-10)),y:Math.round(r.top+20)}})()"
        );
        wc.sendInputEvent({ type: 'mouseDown', ...cellOutside, button: 'left', clickCount: 1 });
        wc.sendInputEvent({ type: 'mouseUp', ...cellOutside, button: 'left', clickCount: 1 });
        await until(() => js("!!document.querySelector('.unsaved-changes-dialog[open]')"));
        await js("document.querySelector('[data-choice=save]').click()");
        await until(() => js("DiffApp.items[1].sheets[0].rows[1][0].v==='new cell'"));
        const previousSave = dialog.showSaveDialog;
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: path.join(tmp, 'sheet.csv') });
        await js("document.querySelector('#sheet-export-csv').click()");
        await until(async () => fs.existsSync(path.join(tmp, 'sheet.csv')));
        assert.match(fs.readFileSync(path.join(tmp, 'sheet.csv'), 'utf8'), /new cell/);
        dialog.showSaveDialog = previousSave;
        await delay(100);
        fs.writeFileSync(path.join(root, 'dist/diff-sheet-redline.png'), (await wc.capturePage()).toPNG());
        const businessLeft = path.join(tmp, 'business-left.csv'),
            businessRight = path.join(tmp, 'business-right.csv');
        fs.writeFileSync(businessLeft, 'ID,Name,Type\n1,A,x\n2,B,x\n3,C,x', 'utf8');
        fs.writeFileSync(businessRight, 'ID,Name,Type\n3,C,x\n2,B2,x\n4,D,x\n1,A,x', 'utf8');
        await js(`DiffApp.importPaths(${JSON.stringify([businessLeft, businessRight])})`);
        await js(
            "document.querySelector('.sheet-key-options').open=true;document.querySelector('#sheet-key-columns input').click()"
        );
        assert.deepEqual(await js('DiffApp.documents.sheetUI.result.rowStats'), {
            left: 0,
            right: 1,
            matched: 3,
            changed: 1
        });
        assert.match(await js("document.querySelector('#sheet-key-status').textContent"), /匹配 3 行/);
        assert.equal((await js('DiffApp.report()')).rows.length, 4);
        fs.writeFileSync(path.join(root, 'dist/diff-business-keys.png'), (await wc.capturePage()).toPNG());
        fs.writeFileSync(businessRight, 'ID,Name,Type\n1,A,x\n1,B,x', 'utf8');
        await js(`DiffApp.importPaths(${JSON.stringify([businessLeft, businessRight])})`);
        assert.equal(await js('DiffApp.documents.sheetUI.options.keyColumns.length'), 0, '换文件后不可沿用旧键列');
        await js("document.querySelector('#sheet-key-columns input').click()");
        assert.equal(await js("document.querySelector('#sheet-key-status').dataset.warning"), 'true');
        await assert.rejects(js('DiffApp.report()'), /业务键/);
        await js("document.querySelector('#sheet-key-clear').click()");
        assert.equal(await js('DiffApp.documents.sheetUI.result.keyActive'), false);
        await js(`DiffApp.importPaths(${JSON.stringify([files.pptxLeft, files.pptxRight])})`);
        assert.equal(await js("document.querySelector('#document-left canvas').width"), 1000);
        await js("document.querySelector('#document-highlight').click()");
        await until(() => js("!document.querySelector('#document-difference').hidden"));
        const pdf = path.join(root, 'test/fixtures/local-search/sample.pdf');
        await js(`DiffApp.importPaths(${JSON.stringify([pdf, pdf])})`);
        assert.ok(await js('DiffApp.documents.pdfs[0].numPages>0'));
        await until(() => js("!document.querySelector('#document-difference').hidden"));
        assert.match(await js("document.querySelector('#summary').textContent"), /0 个差异像素/);
        const images = [path.join(tmp, 'before.png'), path.join(tmp, 'after.png')];
        const bytes = Buffer.alloc(20 * 20 * 4, 255);
        for (let i = 0; i < 2; i++) {
            const pixels = Buffer.from(bytes);
            if (i) pixels.fill(0, 0, 4 * 20);
            fs.writeFileSync(images[i], nativeImage.createFromBitmap(pixels, { width: 20, height: 20 }).toPNG());
        }
        await js(`DiffApp.importPaths(${JSON.stringify(images)})`);
        runtime.clipboard = {
            read: async () => [
                {
                    types: ['image/png'],
                    getType: async () => new Blob([fs.readFileSync(images[1])], { type: 'image/png' })
                }
            ]
        };
        await js('DiffApp.paste(1)');
        assert.equal(await js('DiffApp.items[1].name'), '粘贴的图片');
        runtime.clipboard = originalClipboard;
        await js("document.querySelector('#image-mode').value='difference';DiffApp.images.draw()");
        assert.match(await js("document.querySelector('#summary').textContent"), /20 个差异像素/);
        for (const mode of ['slider', 'fade', 'split'])
            await js(`document.querySelector('#image-mode').value='${mode}';DiffApp.images.draw()`);
        for (const mode of ['subtract', 'blink', 'details']) {
            await js(`DiffApp.images.setMode('${mode}')`);
            assert.equal(await js('DiffApp.images.mode'), mode);
        }
        await js("DiffApp.images.setMode('split')");
        assert.equal(await js('!!DiffApp.images.blink'), false, '退出闪烁后释放计时器');
        await js(
            "document.querySelector('#image-rotate').value='90';document.querySelector('#image-rotate').dispatchEvent(new Event('change'))"
        );
        await until(() => js('DiffApp.images.rotation===90'));
        await js('DiffApp.images.reset()');
        assert.equal(await js('DiffApp.images.rotation'), 0);
        await js('DiffApp.images.align()');
        assert.equal(await js('Number.isFinite(DiffApp.images.offset.x)'), true);
        await js('DiffApp.images.reset()');
        assert.ok(await js('DiffApp.images.analysis.regions.length>0'));
        assert.ok(await js("document.querySelectorAll('.image-options button').length>=6"), '图片工具面板应有真实操作');
        const ocrFile = path.join(tmp, 'ocr.png');
        const ocrData = await js(
            "(()=>{const canvas=document.createElement('canvas');canvas.width=900;canvas.height=220;const c=canvas.getContext('2d');c.fillStyle='white';c.fillRect(0,0,900,220);c.fillStyle='black';c.font='bold 48px Arial';c.fillText('HELLO DIFF 123',30,85);c.fillText('LOCAL TEXT TEST',30,160);return canvas.toDataURL('image/png').split(',')[1]})()"
        );
        fs.writeFileSync(ocrFile, Buffer.from(ocrData, 'base64'));
        await js(`DiffApp.importPaths(${JSON.stringify([ocrFile, ocrFile])})`);
        await js("document.querySelector('#ocr-language').value='eng';DiffApp.images.recognize()");
        assert.match(await js('DiffApp.images.ocrResults[0].text'), /HELLO.*DIFF/);
        assert.ok(await js('DiffApp.images.ocrResults[0].words.length>0'));
        await js("DiffApp.images.setMode('ocr-text')");
        assert.match(await js("document.querySelector('#ocr-result').textContent"), /HELLO/);
        await js("document.querySelector('#ocr-language').value='eng+chi_sim';DiffApp.images.recognize()");
        assert.match(await js('DiffApp.images.ocrResults[1].text'), /DIFF/, '随包中英文联合字库应能离线初始化并识别');
        await js(`DiffApp.importPaths(${JSON.stringify(images)})`);
        await js("DiffApp.images.setMode('split').then(()=>DiffApp.images.setZoom(4))");
        await js("document.querySelector('#image-add-region').click()");
        await delay(150);
        const frame = await js(
            "(()=>{const canvas=document.querySelector('#image-canvas'),viewport=DiffApp.images.viewport;viewport.scrollLeft=0;viewport.scrollTop=0;const r=canvas.getBoundingClientRect(),v=viewport.getBoundingClientRect();const x=Math.max(r.left,v.left)+8,y=Math.max(r.top,v.top)+8;return{x,y,w:Math.min(r.right,v.right,innerWidth)-x-8,h:Math.min(r.bottom,v.bottom,innerHeight)-y-8}})()"
        );
        assert.ok(frame.w > 8 && frame.h > 8, '关注区域必须在可见图像范围内拖动：' + JSON.stringify(frame));
        wc.sendInputEvent({
            type: 'mouseDown',
            button: 'left',
            clickCount: 1,
            x: Math.round(frame.x),
            y: Math.round(frame.y)
        });
        await delay(60);
        wc.sendInputEvent({
            type: 'mouseMove',
            x: Math.round(frame.x + Math.min(60, frame.w)),
            y: Math.round(frame.y + Math.min(60, frame.h))
        });
        await delay(60);
        wc.sendInputEvent({
            type: 'mouseUp',
            button: 'left',
            clickCount: 1,
            x: Math.round(frame.x + Math.min(60, frame.w)),
            y: Math.round(frame.y + Math.min(60, frame.h))
        });
        await until(() => js('DiffApp.images.manual.length>0'));
        await js("document.querySelector('#image-add-region').click()");
        fs.writeFileSync(path.join(root, 'dist/diff-image.png'), (await wc.capturePage()).toPNG());
        await js(`DiffApp.importPaths(${JSON.stringify(files.roots)})`);
        assert.equal(await js('DiffApp.mode'), 'folder');
        assert.equal(await js('DiffApp.folders.snapshot.differences'), 4);
        await delay(100);
        fs.writeFileSync(path.join(root, 'dist/diff-folder-aligned.png'), (await wc.capturePage()).toPNG());
        assert.equal(
            await js(
                'document.querySelector(\'[data-tree="0"] [data-relative="added.txt"]\').classList.contains(\'missing\')'
            ),
            true
        );
        assert.equal(
            await js(
                '(()=>{const a=document.querySelector(\'[data-tree="0"] [data-relative="removed.txt"]\').getBoundingClientRect(),b=document.querySelector(\'[data-tree="1"] [data-relative="removed.txt"]\').getBoundingClientRect();return a.top===b.top})()'
            ),
            true,
            '同路径左右行必须对齐'
        );
        await js(
            "document.querySelector('#folder-search').value='removed';document.querySelector('#folder-search').dispatchEvent(new Event('input'))"
        );
        assert.equal(await js('document.querySelectorAll(\'[data-tree="0"] .tree-row\').length'), 1);
        await js(
            "document.querySelector('#folder-search').value='';document.querySelector('#folder-search').dispatchEvent(new Event('input'))"
        );
        assert.equal(await js("document.querySelector('#pair-left').tomselect.isDisabled"), false);
        await js(
            "document.querySelector('#pair-left').tomselect.setValue('nested/changed.txt');document.querySelector('#pair-right').tomselect.setValue('nested/changed.txt')"
        );
        await until(() => js("DiffApp.items[0]?.name==='changed.txt'&&DiffApp.items[1]?.name==='changed.txt'"));
        assert.equal(await js("document.querySelector('#pair-left').tomselect.getValue()"), 'nested/changed.txt');
        await js("DiffApp.folders.selected=['nested/changed.txt','nested/changed.txt'];DiffApp.folders.openPair()");
        assert.equal(await js('DiffApp.models[0].getValue()'), 'AAAA');
        assert.equal(await js('DiffApp.models[1].getValue()'), 'BBBB');
        await js("DiffApp.folders.selected=['nested','nested'];DiffApp.folders.openPair()");
        assert.equal(await js('DiffApp.content'), 'subfolder');
        assert.match(await js("document.querySelector('#subfolder-panel').textContent"), /changed.txt/);
        fs.writeFileSync(path.join(root, 'dist/diff-folder.png'), (await wc.capturePage()).toPNG());
        await js(
            `DiffApp.setMode('text');DiffApp.setTexts(${JSON.stringify(['// 原始预算\nconst budget = 100;\n', '// 新预算\nconst budget = 120;\nconst approved = true;'])})`
        );
        theme = require('../../src/theme').validate({ preset: 'ink' });
        runtime.themeChanged();
        await delay(150);
        assert.equal(await js('document.body.dataset.scheme'), 'dark');
        win.setSize(700, 720);
        runtime.setBounds({ x: 0, y: 0, width: 700, height: 720 });
        await delay(150);
        assert.equal(await js('document.documentElement.scrollWidth<=innerWidth+1'), true);
        await js("document.querySelector('#toggle-tools').click()");
        assert.equal(await js("getComputedStyle(document.querySelector('#controls')).display"), 'none');
        await js("document.querySelector('#toggle-tools').click()");
        fs.writeFileSync(path.join(root, 'dist/diff-narrow.png'), (await wc.capturePage()).toPNG());
        await js("DiffApp.setMode('text')");
        await js("DiffApp.models[1].setValue('last unsaved input')");
        await runtime.prepareClose([id]);
        const originalMessage = dialog.showMessageBox;
        dialog.showMessageBox = async () => ({ response: 0 });
        assert.equal(await services.beforeClose([id], 'disable'), false, '取消停用保留工作副本');
        assert.equal(await js('DiffApp.models[1].getValue()'), 'last unsaved input');
        dialog.showMessageBox = async () => ({ response: 2 });
        assert.equal(await services.beforeClose([id], 'disable'), true);
        dialog.showMessageBox = originalMessage;
        const draft = await services.call(id, 'draft-read');
        assert.equal(draft.texts[1], 'last unsaved input', '离开握手应包含最后一次输入');
        assert.equal((await services.call(id, 'state')).settings.localDrafts, false, '手动保存不自动开启后续记录');
        await services.disable(id);
        runtime.close(id);
        registry.setEnabled(id, false);
        await assert.rejects(services.call(id, 'state'), /停用/);
        registry.setEnabled(id, true);
        await services.enable(id);
        await runtime.open(id, 'open', 'text');
        wc = runtime.views.get(id).view.webContents;
        await js('DiffApp.ready');
        assert.equal(await js('DiffApp.settings.language'), 'java');
        assert.equal(await js("document.querySelector('#draft-notice').hidden"), false);
        await js("document.querySelector('#restore-draft').click()");
        await until(() => js("DiffApp.models[1].getValue()==='last unsaved input'"));
        const originalSaveText = dialog.showSaveDialog;
        const textFile = path.join(tmp, 'saved-copy.txt');
        dialog.showSaveDialog = async () => ({ canceled: false, filePath: textFile });
        await js('document.querySelector(\'[data-save-text="1"]\').click()');
        await until(async () => fs.existsSync(textFile));
        assert.equal(fs.readFileSync(textFile, 'utf8'), 'last unsaved input');
        dialog.showSaveDialog = originalSaveText;
        await services.unload(id);
        runtime.close(id);
        registry.uninstall(id, { deleteData: false });
        assert.equal(registry.plugins.has(id), false);
        const again = packages.prepare(
            encodeZip(collectFiles(path.join(root, 'src/plugin-library/diff')), { native: true, store: true })
        );
        registry.install(again.directory, again.manifest);
        packages.cleanup(again);
        await services.load();
        assert.equal((await services.call(id, 'state')).settings.language, 'java');
        assert.equal(errors.length, 0, '渲染器不应出现脚本或资源错误');
        await services.dispose();
        runtime.destroy();
        win.destroy();
        console.log(
            'DIFF UI PASS:',
            process.platform,
            'Monaco 离线编辑/语言持久化、Word/Excel/PPTX/PDF、像素模式、目录指纹与配对、HTML/JSON/PDF 报告、窄屏、停用卸载重装。'
        );
        app.exit(0);
    } catch (error) {
        console.error(error);
        await services?.dispose().catch(() => {});
        runtime?.destroy();
        win?.destroy();
        app.exit(1);
    }
});
