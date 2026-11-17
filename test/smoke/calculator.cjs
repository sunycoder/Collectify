const { app, BrowserWindow, protocol } = require('electron');
const fs = require('node:fs'),
    path = require('node:path'),
    os = require('node:os'),
    assert = require('node:assert/strict');
const { PluginRegistry } = require('../../src/plugin-system/registry');
const { PluginRuntime } = require('../../src/plugin-system/runtime');
const { PluginPackages, collectFiles, encodeZip } = require('../../src/plugin-system/package');
const root = path.resolve(__dirname, '../..'),
    id = 'collectify.calculator',
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'collectify-calc-ui-'));
protocol.registerSchemesAsPrivileged([
    {
        scheme: 'collectify-plugin',
        privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
    }
]);
app.disableHardwareAcceleration();
app.setPath('userData', tmp);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
app.whenReady().then(async () => {
    let runtime, win;
    try {
        fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
        const registry = new PluginRegistry({
            builtinRoot: path.join(root, 'src/plugins'),
            userRoot: path.join(tmp, 'packages'),
            dataRoot: path.join(tmp, 'data'),
            hostFile: path.join(tmp, 'host.sqlite')
        });
        assert.equal(registry.plugins.has(id), false);
        const packages = new PluginPackages(registry, path.join(tmp, 'staging')),
            data = encodeZip(collectFiles(path.join(root, 'src/plugin-library/calculator')), { store: true }),
            prepared = packages.prepare(data);
        registry.install(prepared.directory, prepared.manifest);
        packages.cleanup(prepared);
        assert.equal(
            fs.existsSync(path.join(registry.dataRoot, id, 'data.sqlite')),
            false,
            '安装不应初始化计算稿纸数据'
        );
        let theme = require('../../src/theme').validate({ preset: 'office' });
        win = new BrowserWindow({ show: false, width: 1200, height: 900, webPreferences: { offscreen: true } });
        runtime = new PluginRuntime({
            registry,
            getWindow: () => win,
            getTheme: () => theme,
            changed: () => {},
            smoke: true
        });
        let wc, js;
        const until = async (predicate) => {
            for (let i = 0; i < 160; i++) {
                if (await predicate()) return;
                await wait(50);
            }
            throw Error('计算稿纸界面等待超时');
        };
        const open = async () => {
            await runtime.open(id, 'open', 'home');
            wc = runtime.views.get(id).view.webContents;
            js = async (code) => {
                try {
                    return await wc.executeJavaScript(code);
                } catch (error) {
                    throw Error(code + '\n' + error.message);
                }
            };
            await until(() => js("document.querySelector('#save-status').textContent==='已自动保存'"));
        };
        const saved = () =>
            until(() => js("!operation && document.querySelector('#save-status').textContent==='已自动保存'"));
        const edit = async (index, text) => {
            await js(
                `(()=>{const input=document.querySelectorAll('.expression')[${index}];input.focus();input.value=${JSON.stringify(text)};input.dispatchEvent(new Event('input',{bubbles:true}));})()`
            );
            await saved();
        };
        await open();
        assert.equal(await js("document.querySelector('.brand img').naturalWidth>0"), true);
        assert.equal(runtime.backgrounds.size, 0);
        assert.equal(await js("document.querySelector('#math-keyboard').hidden"), true, '主页面不再渲染遮挡内容的键盘');
        const keyboard = () => [...runtime.popouts.values()].find((record) => record.pluginId === id);
        const keyboardJs = (code) => keyboard().view.webContents.executeJavaScript(code);
        await until(() => keyboard() && keyboardJs('keyboardOnly && !!keyboardOwner'));
        assert.equal(
            await keyboardJs("getComputedStyle(document.querySelector('#math-keyboard')).webkitAppRegion"),
            'drag'
        );
        assert.equal(
            await keyboardJs("getComputedStyle(document.querySelector('.keyboard-layout button')).webkitAppRegion"),
            'no-drag'
        );
        const originalMainBounds = win.getBounds();
        win.setBounds({ x: 0, y: 30, width: 500, height: 700 });
        const mainBounds = win.getBounds();
        keyboard().window.setBounds({
            x: mainBounds.x + mainBounds.width + 20,
            y: mainBounds.y,
            width: 600,
            height: 370
        });
        assert.ok(keyboard().window.getBounds().x >= mainBounds.x + mainBounds.width, '独立键盘可以移到主程序边界之外');
        win.setBounds(originalMainBounds);
        const clickKey = async (selector) => {
            const point = await keyboardJs(
                `(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`
            );
            keyboard().view.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 });
            keyboard().view.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 });
            await wait(50);
        };
        await js("document.querySelector('.expression').focus()");
        await clickKey('[data-key="sqrt"]');
        await clickKey('[data-key="9"]');
        await saved();
        await edit(0, '11/6');
        await js(
            "document.querySelector('#result-digits').value='2';document.querySelector('#result-digits').dispatchEvent(new Event('change'))"
        );
        assert.equal(await js("document.querySelector('.result-button').textContent"), '1.83');
        await js(
            "document.querySelector('#result-digits').value='12';document.querySelector('#result-digits').dispatchEvent(new Event('change'))"
        );
        await edit(0, 'sqrt(9)');
        assert.equal(await js("document.querySelector('.result-button').textContent"), '3');
        await js("document.querySelector('.expression').setSelectionRange(5,6)");
        await clickKey('[data-key="4"]');
        assert.equal(await js('sheet.rows[0].expression'), 'sqrt(4)');
        await js("document.querySelector('#keyboard-next').click()");
        await saved();
        assert.equal(await js('sheet.rows.length'), 2);
        await js("document.querySelectorAll('.row-delete')[1].click()");
        await saved();
        await js("document.querySelector('#undo-row').click()");
        assert.equal(await js('sheet.rows.length'), 2);
        await js("document.querySelectorAll('.row-delete')[1].click()");
        fs.writeFileSync(path.join(root, 'dist/calculator-keyboard.png'), (await wc.capturePage()).toPNG());
        await edit(0, '55+88+7689*543');
        assert.equal(await js("document.querySelector('.result-button').textContent"), '4,175,270');
        await js("document.querySelector('#add-row').click()");
        await edit(1, 'ans*2');
        assert.equal(await js("document.querySelectorAll('.result-button')[1].textContent"), '8,350,540');
        await edit(0, '0.1+0.2');
        assert.equal(await js("document.querySelectorAll('.result-button')[1].textContent"), '0.6');
        const writeBatch = registry.storage.batch.bind(registry.storage);
        registry.storage.batch = (...args) => {
            if (args[0] === id) throw Error('隔离测试：磁盘写入失败');
            return writeBatch(...args);
        };
        await js(
            "document.querySelector('.expression').value='7+8';document.querySelector('.expression').dispatchEvent(new Event('input'))"
        );
        await until(() => js("document.querySelector('#save-status').dataset.state==='error'"));
        await js("document.querySelector('#new-paper').click()");
        await until(() => js('!operation'));
        assert.equal(await js('index.sheets.length'), 1, '保存失败时不可切走并丢弃修改');
        assert.equal(await js('sheet.rows[0].expression'), '7+8');
        registry.storage.batch = writeBatch;
        await js("document.querySelector('#retry-save').click()");
        await saved();
        await edit(0, '0.1+0.2');
        const existingId = await js('sheet.id');
        registry.storage.batch = (...args) => {
            if (args[0] === id) throw Error('隔离测试：新建失败');
            return writeBatch(...args);
        };
        await js("document.querySelector('#new-paper').click()");
        await until(() => js("!operation && document.querySelector('#save-status').dataset.state==='error'"));
        assert.equal(await js('sheet.id'), existingId, '新建失败不能替换当前编辑对象');
        registry.storage.batch = writeBatch;
        await js("document.querySelector('#retry-save').click()");
        await saved();
        await js(
            "(()=>{const note=document.querySelector('.note');note.value='测试备注';note.dispatchEvent(new Event('input'));const title=document.querySelector('#paper-title');title.value='旅行预算';title.dispatchEvent(new Event('input'));})()"
        );
        await saved();
        const firstId = await js('sheet.id');
        await js(
            "document.querySelector('#examples-toggle').click();document.querySelector('[data-formula=\"sqrt(144)\"]').click()"
        );
        await saved();
        assert.equal(await js("document.querySelectorAll('.result-button')[2].textContent"), '12');
        await js("document.querySelector('#lock-paper').click()");
        await saved();
        assert.equal(await js("[...document.querySelectorAll('.expression')].every(n=>n.readOnly)"), true);
        assert.equal(await js("document.querySelector('#clear-paper').disabled"), true);
        assert.equal(await js("[...document.querySelectorAll('.keyboard-layout button')].every(b=>b.disabled)"), true);
        await js("document.querySelector('#new-paper').click()");
        await saved();
        await until(() => js("document.querySelectorAll('.sheet-item').length===2"));
        await edit(0, '10000*pow(1.05,10)');
        const secondId = await js('sheet.id');
        await keyboardJs("document.querySelector('#keyboard-close').click()");
        await until(() => !keyboard());
        await saved();
        assert.notEqual(secondId, firstId);
        await js("document.querySelector('#clear-paper').click()");
        await until(() => js("document.querySelector('#confirm-dialog').open"));
        await js("document.querySelector('#confirm-dialog').close('cancel')");
        assert.equal(await js('sheet.rows[0].expression'), '10000*pow(1.05,10)');
        await runtime.close(id);
        await open();
        assert.equal(await js("document.querySelector('#math-keyboard').hidden"), true);
        await js("document.querySelector('#keyboard-toggle').click()");
        await saved();
        await until(() => keyboard() && keyboardJs('keyboardOnly && !!keyboardOwner'));
        assert.equal(await js('sheet.id'), secondId);
        assert.equal(await js('sheet.rows[0].expression'), '10000*pow(1.05,10)');
        await js(`document.querySelector('[data-sheet-id="${firstId}"]').click()`);
        await saved();
        await until(() => js(`sheet.id===${JSON.stringify(firstId)}`));
        assert.equal(await js('sheet.locked'), true);
        assert.equal(await js("document.querySelector('.note').value"), '测试备注');
        await js("document.querySelector('#lock-paper').click()");
        await saved();
        await edit(0, '1/0');
        assert.equal(await js("document.querySelectorAll('.row-error')[1].hidden"), false);
        await edit(0, '55+88+7689*543');
        await edit(1, '4270-55+855+5525+88+66+4556+3.25*9825-5875/5+85+5369.55+83.45');
        await edit(2, '2^5+888+99x878.467');
        await js("document.querySelectorAll('.expression')[2].focus()");
        wc.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
        wc.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
        await until(() => js('sheet.rows.length===4'));
        await saved();
        await js("document.querySelectorAll('.row-delete')[3].click()");
        await saved();
        const clipboard = runtime.clipboard;
        let copied;
        runtime.clipboard = {
            writeText: (text) => {
                copied = text;
            }
        };
        await js("document.querySelector('.result-button').click()");
        await until(() => copied !== undefined);
        assert.equal(copied, '4175270');
        runtime.clipboard = clipboard;
        const directory = path.join(root, 'dist');
        runtime.layout(true);
        await wait(100);
        fs.writeFileSync(path.join(directory, 'calculator-preview.png'), (await wc.capturePage()).toPNG());
        await js("document.querySelector('#examples-toggle').click()");
        await wait(80);
        fs.writeFileSync(path.join(directory, 'calculator-examples-preview.png'), (await wc.capturePage()).toPNG());
        win.setContentSize(390, 850);
        runtime.layout(true);
        await wait(120);
        assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'), true);
        keyboard().window.setContentSize(390, 400);
        await wait(120);
        assert.equal(await keyboardJs('document.documentElement.scrollWidth<=innerWidth'), true);
        fs.writeFileSync(
            path.join(directory, 'calculator-keyboard-narrow.png'),
            (await keyboard().view.webContents.capturePage()).toPNG()
        );
        theme = require('../../src/theme').validate({ preset: 'ink' });
        runtime.themeChanged();
        await until(() => js("getComputedStyle(document.documentElement).colorScheme==='dark'"));
        await js("document.querySelector('#clear-paper').click()");
        await until(() => js("document.querySelector('#confirm-dialog').open"));
        await js("document.querySelector('#confirm-dialog').close('confirm')");
        await saved();
        assert.equal(await js('sheet.rows.length'), 1);
        assert.equal(await js('sheet.rows[0].expression'), '');
        const second = registry.storage.get(id, 'sheet:' + secondId);
        assert.equal(second.rows[0].expression, '10000*pow(1.05,10)', '清空不能影响其他稿纸');
        await js("document.querySelector('.sheet-item.selected .sheet-delete').click()");
        await until(() => js("document.querySelector('#confirm-dialog').open"));
        await js("document.querySelector('#confirm-dialog').close('confirm')");
        await saved();
        await until(() => js('index.sheets.length===1'));
        assert.equal(registry.storage.get(id, 'sheet:' + firstId), null);
        assert.deepEqual(runtime.views.get(id).errors, []);
        await runtime.close(id);
        registry.setEnabled(id, false);
        await assert.rejects(runtime.open(id, 'open', 'home'));
        registry.setEnabled(id, true);
        await open();
        assert.equal(await js('sheet.id'), secondId);
        await runtime.close(id);
        const exported = packages.export(id);
        registry.uninstall(id);
        const reinstall = packages.prepare(exported);
        registry.install(reinstall.directory, reinstall.manifest);
        packages.cleanup(reinstall);
        await open();
        assert.equal(await js('sheet.id'), secondId);
        await runtime.close(id);
        registry.uninstall(id, { deleteData: true });
        assert.equal(fs.existsSync(path.join(registry.dataRoot, id)), false);
        runtime.destroy();
        win.destroy();
        console.log(
            'CALCULATOR UI PASS:',
            process.platform,
            '真实沙箱页面/IPC、逐行重算、公式示例、锁定、多稿纸、自动保存重开、清空确认、窄屏深色主题、停用卸载重装。'
        );
        app.exit(0);
    } catch (error) {
        console.error(error);
        const record = runtime?.views.get(id);
        if (record)
            console.error(
                record.errors,
                await record.view.webContents
                    .executeJavaScript(
                        "({message:document.querySelector('#message')?.textContent,status:document.querySelector('#save-status')?.textContent})"
                    )
                    .catch(() => null)
            );
        runtime?.destroy();
        win?.destroy();
        app.exit(1);
    }
});
