const assert = require('node:assert/strict'),
    path = require('node:path'),
    fs = require('node:fs');
const execFile = require('node:util').promisify(require('node:child_process').execFile);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
exports.run = async ({ win, store, desktopWidget }) => {
    console.log('V13 开始：检查设置图标和窗口模式。');
    const data = store.snapshot();
    data.settings.theme = { ...data.settings.theme, preset: 'office', widgetMaterial: 'glass', glassOpacity: 42 };
    store.commit(data);
    const js = (code) => win.webContents.executeJavaScript(code);
    await js("document.querySelector('dialog[open]')?.close();refresh()");
    console.log('V13 主界面刷新完成。');
    assert.ok(
        await js(
            "getComputedStyle(document.querySelector('.settings-svg')).maskImage.includes(encodeURIComponent('设置')+'%20.svg')"
        )
    );
    assert.equal(
        await js(
            "(()=>{const image=new Image();image.src='../assets/'+encodeURIComponent('设置 .svg');return image.decode().then(()=>image.naturalWidth)})()"
        ),
        200
    );
    await desktopWidget.open('floating');
    await delay(350);
    console.log('V13 桌面窗口打开完成。');
    const region = async () => {
        if (process.platform !== 'win32') return;
        const hwnd = desktopWidget.win.getNativeWindowHandle().readBigUInt64LE().toString();
        // PowerShell 不能直接读取 app.asar 内的虚拟路径，测试时写到独立临时目录。
        const probe = path.join(require('./verification-output').directory, 'native-region-check.ps1');
        fs.writeFileSync(probe, fs.readFileSync(path.join(__dirname, 'native-region-check.ps1')));
        // 原生窗口查询可能向窗口线程发消息，不能同步阻塞 Electron 的主线程。
        const { stdout } = await execFile(
            'powershell.exe',
            ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', probe, '-WindowHandle', hwnd],
            { windowsHide: true, encoding: 'utf8', timeout: 15000 }
        );
        const result = JSON.parse(stdout.trim());
        if (desktopWidget.systemCorners) {
            assert.equal(result.cornerResult, 0, JSON.stringify(result));
            assert.equal(result.cornerPreference, 2, '系统窗口应明确使用 DWM 圆角');
            assert.equal(result.kind, 0, '系统合成模式不能叠加自定义 HRGN');
        } else {
            assert.ok(result.kind >= 2, JSON.stringify(result));
            assert.ok(result.center);
            assert.ok(
                result.corners.every((value) => value === false),
                JSON.stringify(result)
            );
        }
    };
    await region();
    console.log('V13 首次原生圆角检查完成。');
    await desktopWidget.open('desktop');
    await delay(200);
    await region();
    console.log('V13 桌面模式检查完成。');
    const b = desktopWidget.win.getBounds();
    desktopWidget.win.setBounds({ ...b, width: 380, height: 560 });
    await delay(350);
    await region();
    await desktopWidget.open('floating');
    await delay(200);
    await region();
    // 原生窗口隐藏时不会持续合成，截图前需要实际显示以产生新帧。
    if (desktopWidget.systemCorners) desktopWidget.win.showInactive();
    console.log('V13 模式切换与缩放检查完成。');
    const wjs = (code) => desktopWidget.win.webContents.executeJavaScript(code);
    // 网页的四个角也必须实际透明；不是只检验 border-radius 的声明值。
    desktopWidget.win.setBackgroundColor('#00000000');
    await wjs("render({...data,material:'acrylic'})");
    await delay(350);
    const image = await desktopWidget.win.webContents.capturePage(),
        size = image.getSize(),
        pixels = image.toBitmap();
    if (!desktopWidget.systemCorners)
        for (const [x, y] of [
            [0, 0],
            [size.width - 1, 0],
            [0, size.height - 1],
            [size.width - 1, size.height - 1]
        ])
            assert.equal(pixels[(y * size.width + x) * 4 + 3], 0, '透明窗口的卡片角部像素必须完全透明');
    assert.equal(
        await wjs("getComputedStyle(document.querySelector('.widget-shell')).borderTopLeftRadius"),
        desktopWidget.systemCorners ? '8px' : '20px'
    );
    assert.ok(
        await wjs(
            "parseFloat(getComputedStyle(document.querySelector('.widget-task strong')||document.querySelector('h1')).fontSize)>=14"
        )
    );
    fs.writeFileSync(path.join(require('./verification-output').directory, 'widget-corners-v13.png'), image.toPNG());
    desktopWidget.hide();
    console.log(
        desktopWidget.systemCorners
            ? 'V13 通过：原生 DWM 圆角、无自定义区域叠加、切换与缩放后网页半径一致。桌面合成由 V12 单独检查。'
            : 'V13 通过：指定设置 SVG、透明窗口裁剪与角像素。此模式不验证原生系统背板。'
    );
};
