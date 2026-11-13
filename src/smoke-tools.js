const assert = require('node:assert/strict');
const fs = require('node:fs'),
    path = require('node:path');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
exports.run = async ({ win, registry, runtime, hostAction }) => {
    const host = (code) => win.webContents.executeJavaScript(code);
    const page = (id, code) => runtime.views.get(id).view.webContents.executeJavaScript(code);
    const until = async (predicate) => {
        for (let i = 0; i < 100; i++) {
            if (await predicate()) return;
            await delay(30);
        }
        throw Error('控件等待超时');
    };
    await host("openSettings('general')");
    await hostAction('settings', { browserOpenMode: 'external' });
    await until(() => host("!!document.querySelector('#browser-open-mode').tomselect"));
    const colors = await host(
        "(()=>{const select=document.querySelector('#browser-open-mode');select.value='external';select.dispatchEvent(new Event('change'));select.tomselect.open();const selected=select.tomselect.getOption('external'),other=select.tomselect.getOption('internal');other.classList.add('active');return{selected:getComputedStyle(selected).backgroundColor,hover:getComputedStyle(other).backgroundColor,selectedColor:getComputedStyle(selected).color,hoverColor:getComputedStyle(other).color};})()"
    );
    assert.notEqual(colors.selected, colors.hover);
    assert.notEqual(colors.selectedColor, colors.hoverColor);
    await host("document.querySelector('#settings-dialog').close()");
    await hostAction('plugin-open', { id: 'collectify.json' });
    await until(() => page('collectify.json', "!!document.querySelector('#indent').tomselect"));
    await page(
        'collectify.json',
        "document.querySelector('#indent').tomselect.setValue('4');document.querySelector('#input').value='{\"x\":1}';document.querySelector('#format').click()"
    );
    assert.equal(await page('collectify.json', "document.querySelector('#output').value"), '{\n    "x": 1\n}');
    await hostAction('plugin-open', { id: 'collectify.timestamp' });
    const p = (code) => page('collectify.timestamp', code);
    await until(() => p("[...document.querySelectorAll('select')].every(s=>!!s.tomselect)"));
    await p(
        "document.querySelector('#unit').tomselect.setValue('seconds');document.querySelector('#date-zone').tomselect.setValue('Asia/Shanghai');document.querySelector('#timestamp').value='0';document.querySelector('#convert-timestamp').click()"
    );
    assert.equal(await p("document.querySelector('#date-result').value"), '1970-01-01 08:00:00.000');
    await p(
        "document.querySelector('#zone').tomselect.setValue('Asia/Shanghai');document.querySelector('#datetime').value='1970-01-01 08:00:01.500';document.querySelector('#convert-date').click();document.querySelector('#output-unit').tomselect.setValue('seconds')"
    );
    assert.equal(await p("document.querySelector('#timestamp-result').value"), '1.5');
    await p("document.querySelector('#pause-clock').click()");
    const clock = await p("document.querySelector('#clock').textContent");
    await delay(1100);
    assert.equal(await p("document.querySelector('#clock').textContent"), clock);
    await p("document.querySelector('#switch-clock-unit').click()");
    assert.equal(await p("document.querySelector('#clock-unit').textContent"), '秒');
    await p(
        "document.querySelector('#batch-tab').click();document.querySelector('#batch-zone').tomselect.setValue('UTC');document.querySelector('#batch-input').value='0\\ninvalid\\n-1';document.querySelector('#convert-batch').click()"
    );
    assert.equal(await p("document.querySelector('#batch-output').value.split('\\n').length"), 3);
    assert.match(await p("document.querySelector('#batch-summary').textContent"), /成功 2 行，失败 1 行/);
    const values = registry.storage.export('collectify.timestamp');
    assert.ok(!JSON.stringify(values).includes('invalid'));
    await p("document.querySelector('#single-tab').click()");
    await delay(150);
    fs.writeFileSync(
        path.join(require('./verification-output').directory, 'timestamp-tools.png'),
        (await runtime.views.get('collectify.timestamp').view.webContents.capturePage()).toPNG()
    );
    for (const record of runtime.views.values()) assert.deepEqual(record.errors, []);
    console.log(
        'TOOLS PASS：宿主选中与悬停区分、JSON 和时间戳公共下拉框、双向时区转换、秒毫秒、暂停、批量逐行错误及隐私验证通过。'
    );
};
