const assert = require('node:assert/strict');
const fs = require('node:fs'),
    path = require('node:path');
const { ClipboardItem, nativeImage } = require('electron');
const { encodeZip, collectFiles, PluginPackages } = require('./plugin-system/package');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
exports.run = async ({ win, registry, runtime, hostAction }) => {
    const original = runtime.clipboard,
        originalPaste = runtime.pasteAdapter,
        packages = new PluginPackages(registry, path.join(path.dirname(registry.hostFile), 'clip-test-staging'));
    let current = new ClipboardItem({ 'text/plain': 'BACKGROUND_TEST_TEXT ' + 'x'.repeat(350) + ' SEARCH_TAIL' }),
        reads = 0,
        writes = [],
        pasteCalls = 0,
        writeCount = 0;
    runtime.pasteAdapter = async () => {
        pasteCalls++;
    };
    runtime.clipboard = {
        read: async () => {
            reads++;
            return [current];
        },
        write: async (value) => {
            writeCount++;
            writes = value;
            current = value[0];
        },
        writeText: async (value) => {
            writeCount++;
            writes = [value];
            current = new ClipboardItem({ 'text/plain': value });
        }
    };
    const until = async (predicate, label) => {
        for (let i = 0; i < 150; i++) {
            if (await predicate()) return;
            await delay(40);
        }
        throw Error(label || '剪贴板验证超时');
    };
    const id = 'collectify.clipboard-history',
        page = (code) => runtime.views.get(id).view.webContents.executeJavaScript(code);
    try {
        await win.webContents.executeJavaScript('shellReady');
        const prepared = packages.prepare(
            encodeZip(collectFiles(path.join(__dirname, 'plugin-library', 'clipboard-history')))
        );
        registry.install(prepared.directory);
        packages.cleanup(prepared);
        await hostAction('plugin-open', { id });
        await until(() => page("document.querySelector('#capture-status').textContent==='采集已暂停'"));
        assert.equal(reads, 0);
        await page("document.querySelector('#capture').click()");
        await until(() => registry.storage.get(id, 'history.v2')?.items.length === 1);
        await until(() => page("document.querySelectorAll('.history-item').length===1"));
        await page("document.querySelector('.history-item .row-actions button').click()");
        await until(() => registry.storage.get(id, 'history.v2').items[0].favorite === true);
        await hostAction('plugin-open', { id: 'collectify.json' });
        assert.equal(runtime.views.get(id).view.getVisible(), false);
        const bitmap = Buffer.alloc(640 * 220 * 4);
        for (let y = 0; y < 220; y++)
            for (let x = 0; x < 640; x++) {
                const index = (y * 640 + x) * 4;
                bitmap[index] = 180 + Math.floor(x / 20);
                bitmap[index + 1] = 80 + Math.floor(y / 2);
                bitmap[index + 2] = 45 + Math.floor(x / 4);
                bitmap[index + 3] = 255;
            }
        const png = nativeImage.createFromBitmap(bitmap, { width: 640, height: 220 });
        assert.equal(png.isEmpty(), false);
        current = new ClipboardItem({ 'image/png': new Blob([new Uint8Array(png.toPNG())], { type: 'image/png' }) });
        await until(
            () => registry.storage.get(id, 'history.v2').items.some((item) => item.kind === 'image'),
            '后台未记录图片'
        );
        current = new ClipboardItem({ 'text/uri-list': 'file:///D:/fixture/test.txt' });
        await until(
            () => registry.storage.get(id, 'history.v2').items.some((item) => item.kind === 'files'),
            '后台未记录文件列表'
        );
        win.hide();
        current = new ClipboardItem({ 'text/plain': 'WHILE_WINDOW_HIDDEN' });
        await until(() => registry.storage.get(id, 'history.v2').items.length === 4, '隐藏窗口后采集停止');
        await hostAction('plugin-open', { id });
        await until(() => page("document.querySelectorAll('.history-item').length===4"));
        await page("document.querySelector('[data-tab=image]').click()");
        await until(() =>
            page(
                "document.querySelectorAll('.history-item').length===1 && !!document.querySelector('.history-item img')?.src"
            )
        );
        const stable = registry.storage.get(id, 'history.v2').items.map(({ id, at }) => ({ id, at }));
        await page("document.querySelector('.history-item img').decode();");
        await page(
            "window.copyRebuilds=0;window.previewBefore=document.querySelector('.history-item img');window.copyObserver=new MutationObserver(changes=>{copyRebuilds+=changes.length;});copyObserver.observe(document.querySelector('#history'),{childList:true});void 0;"
        );
        await page("document.querySelector('.history-item').click()");
        await delay(1100);
        assert.equal(writes.length, 0, '单击选中不应改写剪贴板');
        await page("document.querySelector('.history-item').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))");
        await until(() => writes.length === 1);
        assert.ok(writes[0] instanceof ClipboardItem);
        assert.ok(writes[0].types.includes('image/png'));
        await delay(1200);
        assert.equal(await page('copyRebuilds'), 0, '双击图片复制不应重建列表');
        assert.equal(
            await page(
                "previewBefore===document.querySelector('.history-item img') && previewBefore.complete && previewBefore.naturalWidth>0"
            ),
            true,
            '双击后应保留已加载预览'
        );
        await page('copyObserver.disconnect();void 0;');
        assert.deepEqual(
            registry.storage.get(id, 'history.v2').items.map(({ id, at }) => ({ id, at })),
            stable,
            '复制历史不得重排或修改时间'
        );
        await page(
            "document.querySelector('.history-item').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:200,clientY:180}))"
        );
        assert.equal(await page("document.querySelector('#context-menu').matches(':popover-open')"), true);
        assert.ok((await page("document.querySelector('#context-menu').textContent")).includes('执行粘贴'));
        if (process.platform === 'win32') {
            await page("document.querySelector('#context-menu button[aria-label=执行粘贴]').click()");
            await until(() => pasteCalls === 1);
        } else {
            assert.equal(
                await page("document.querySelector('#context-menu button[aria-label=执行粘贴]').disabled"),
                true
            );
            await page("document.querySelector('#context-menu').hidePopover()");
        }
        await page(
            "document.querySelector('.history-item').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:200,clientY:180}));document.querySelector('#context-menu button[aria-label=悬浮中转]').click()"
        );
        await until(() => runtime.popouts.size === 1);
        const popout = [...runtime.popouts.values()][0];
        await until(() =>
            popout.window.webContents.executeJavaScript(
                "document.querySelector('h1')?.textContent.includes('悬浮中转')"
            )
        );
        assert.equal(popout.window.isAlwaysOnTop(), true);
        await page("document.querySelector('[data-tab=favorites]').click()");
        await until(() => page("document.querySelectorAll('.history-item').length===1"));
        await page("document.querySelector('#capture').click()");
        await until(() => runtime.backgroundActivity.size === 0);
        const before = reads;
        current = new ClipboardItem({ 'text/plain': 'MUST_NOT_RECORD' });
        await delay(1200);
        assert.equal(reads, before);
        await hostAction('plugin-enable', { id, enabled: false });
        assert.equal(runtime.backgrounds.has(id), false);
        assert.equal(runtime.popouts.size, 0);
        await hostAction('plugin-enable', { id, enabled: true });
        await hostAction('plugin-open', { id });
        await until(() => page("document.querySelectorAll('.history-item').length>0"));
        assert.equal(registry.storage.get(id, 'history.v2').items.length, 4);
        await page(
            "document.querySelector('#search').value='SEARCH_TAIL';document.querySelector('#search').dispatchEvent(new Event('input'))"
        );
        await until(() => page("document.querySelectorAll('.history-item').length===1"), '全文搜索未匹配预览外的内容');
        await page(
            "document.querySelector('#search').value='';document.querySelector('#search').dispatchEvent(new Event('input'))"
        );
        await until(() => page("document.querySelectorAll('.history-item').length===4"));
        await page("document.querySelector('[data-tab=all]').click()");
        await delay(120);
        await page(
            "window.copyRebuilds=0;window.previewBefore=document.querySelector('.history-item img');window.clipScrollBefore=document.querySelector('#history').scrollTop;window.copyObserver=new MutationObserver(changes=>{copyRebuilds+=changes.length;});copyObserver.observe(document.querySelector('#history'),{childList:true});void 0;"
        );
        for (const kind of ['text', 'files']) {
            const beforeCopy = writeCount;
            const recordId = registry.storage.get(id, 'history.v2').items.find((item) => item.kind === kind).id;
            await page(
                `document.querySelector('[data-id="${recordId}"]').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))`
            );
            await until(() => writeCount > beforeCopy);
            await delay(60);
        }
        assert.equal(await page('copyRebuilds'), 0, '双击文本或文件也不应重建图片列表');
        assert.equal(await page("previewBefore===document.querySelector('.history-item img')"), true);
        assert.equal(await page("clipScrollBefore===document.querySelector('#history').scrollTop"), true);
        await page('copyObserver.disconnect();void 0;');
        fs.writeFileSync(
            path.join(require('./verification-output').directory, 'clipboard-manager.png'),
            (await runtime.views.get(id).view.webContents.capturePage()).toPNG()
        );
        // 采集中删除当前剪贴板对应的图片，不能在下一次轮询时复活。
        await page("collectify.background.request({action:'capture',enabled:true})");
        const image = registry.storage.get(id, 'history.v2').items.find((item) => item.kind === 'image');
        await page(`collectify.background.request({action:'copy',id:${JSON.stringify(image.id)}})`);
        await page("document.querySelector('[data-tab=image]').click()");
        await until(() => page("document.querySelectorAll('.history-item').length===1"));
        await page("document.querySelector('.history-item [aria-label=删除]').click()");
        await until(() => !registry.storage.get(id, 'history.v2').items.some((item) => item.id === image.id));
        await delay(1200);
        assert.ok(
            !registry.storage.get(id, 'history.v2').items.some((item) => item.id === image.id),
            '已删除图片不应被原剪贴板重新采集'
        );
        assert.equal(registry.storage.get(id, 'entry.' + image.id), null);
        const other = nativeImage.createFromBitmap(Buffer.from([10, 20, 30, 255]), { width: 1, height: 1 });
        current = new ClipboardItem({ 'image/png': new Blob([new Uint8Array(other.toPNG())], { type: 'image/png' }) });
        await until(() => registry.storage.get(id, 'history.v2').items.some((item) => item.kind === 'image'));
        await page("window.confirm=()=>true;document.querySelector('#clear').click()");
        await until(() => registry.storage.get(id, 'history.v2').items.every((item) => item.favorite));
        await delay(1200);
        assert.equal(
            registry.storage.get(id, 'history.v2').items.length,
            1,
            '清空后应只剩收藏，不能留下一张重新采集的图片'
        );
        assert.equal(registry.storage.get(id, 'history.v2').items[0].favorite, true);
        assert.deepEqual(runtime.views.get(id).errors, []);
        assert.deepEqual(runtime.backgrounds.get(id).errors, []);
        await page("document.querySelector('#desktop-shortcut').click()");
        await until(() => runtime.popouts.has('shortcut:' + id));
        const shortcut = runtime.popouts.get('shortcut:' + id);
        await until(() =>
            shortcut.window.webContents.executeJavaScript(
                "typeof collectify==='object'&&!!document.querySelector('#open')"
            )
        );
        assert.deepEqual(shortcut.window.getSize(), [48, 48]);
        const beforeDrag = shortcut.window.getPosition();
        shortcut.window.showInactive();
        shortcut.window.focus();
        await delay(100);
        shortcut.window.webContents.sendInputEvent({
            type: 'mouseMove',
            x: 18,
            y: 18,
            globalX: beforeDrag[0] + 18,
            globalY: beforeDrag[1] + 18
        });
        shortcut.window.webContents.sendInputEvent({
            type: 'mouseDown',
            button: 'left',
            clickCount: 1,
            x: 18,
            y: 18,
            globalX: beforeDrag[0] + 18,
            globalY: beforeDrag[1] + 18
        });
        await delay(80);
        shortcut.window.webContents.sendInputEvent({
            type: 'mouseMove',
            x: 35,
            y: 32,
            globalX: beforeDrag[0] + 35,
            globalY: beforeDrag[1] + 32,
            modifiers: ['leftButtonDown']
        });
        await delay(100);
        shortcut.window.webContents.sendInputEvent({
            type: 'mouseUp',
            button: 'left',
            clickCount: 1,
            x: 35,
            y: 32,
            globalX: beforeDrag[0] + 35,
            globalY: beforeDrag[1] + 32
        });
        await delay(120);
        assert.notDeepEqual(shortcut.window.getPosition(), beforeDrag, '按钮中心应能拖动，不仅是边缘');
        assert.equal(
            await shortcut.window.webContents.executeJavaScript('collectify.context().then(value=>value.windowMode)'),
            'shortcut'
        );
        await hostAction('plugin-open', { id: 'collectify.json' });
        win.hide();
        await shortcut.window.webContents.executeJavaScript("document.querySelector('#open').click()");
        await until(() => runtime.activeId === id && win.isVisible());
        await until(() => registry.storage.get(id, 'history.v2').shortcutEnabled === true);
        shortcut.window.setPosition(80, 120);
        await delay(120);
        await hostAction('plugin-enable', { id, enabled: false });
        assert.equal(runtime.popouts.has('shortcut:' + id), false);
        await hostAction('plugin-enable', { id, enabled: true });
        await hostAction('plugin-open', { id });
        await until(() => runtime.popouts.has('shortcut:' + id));
        const restored = runtime.popouts.get('shortcut:' + id);
        await until(() => restored.window.webContents.executeJavaScript("typeof collectify==='object'"));
        assert.deepEqual(restored.window.getPosition(), [80, 120]);
        await restored.window.webContents.executeJavaScript(
            "document.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))"
        );
        await until(() => !runtime.popouts.has('shortcut:' + id));
        await until(() => registry.storage.get(id, 'history.v2').shortcutEnabled === false);
        console.log(
            'CLIPBOARD PASS：真实沙箱后台、窗口隐藏后文本/图片/文件采集、暂停、收藏筛选、图片格式复制、分块持久化、停用回收和重启保留通过；剪贴板为注入测试数据。'
        );
    } catch (error) {
        console.error('剪贴板页面诊断', runtime.views.get(id)?.errors, runtime.backgrounds.get(id)?.errors);
        console.error('后台状态', await page("collectify.background.request({action:'list'})"));
        throw error;
    } finally {
        runtime.close(id);
        runtime.clipboard = original;
        runtime.pasteAdapter = originalPaste;
    }
};
