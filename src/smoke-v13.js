const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),{execFileSync}=require('node:child_process');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
exports.run=async({win,store,desktopWidget})=>{
    const data=store.snapshot();data.settings.theme={...data.settings.theme,preset:'office',widgetMaterial:'glass',glassOpacity:42};store.commit(data);
    const js=code=>win.webContents.executeJavaScript(code);
    await js("document.querySelector('dialog[open]')?.close();refresh()");
    assert.ok(await js("getComputedStyle(document.querySelector('.settings-svg')).maskImage.includes(encodeURIComponent('设置')+'%20.svg')"));
    assert.equal(await js("(()=>{const image=new Image();image.src='../assets/'+encodeURIComponent('设置 .svg');return image.decode().then(()=>image.naturalWidth)})()"),200);
    await desktopWidget.open('floating');await delay(350);
    const region=()=>{
        if(process.platform!=='win32')return;
        const hwnd=desktopWidget.win.getNativeWindowHandle().readBigUInt64LE().toString();
        // PowerShell 不能直接读取 app.asar 内的虚拟路径，测试时写到独立临时目录。
        const probe=path.join(require('./verification-output').directory,'native-region-check.ps1');
        fs.writeFileSync(probe,fs.readFileSync(path.join(__dirname,'native-region-check.ps1')));
        const output=execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',probe,'-WindowHandle',hwnd],{windowsHide:true,encoding:'utf8'});
        const result=JSON.parse(output.trim());
        assert.ok(result.kind>=2,JSON.stringify(result));assert.ok(result.center);assert.ok(result.corners.every(value=>value===false),JSON.stringify(result));
    };
    region();
    await desktopWidget.open('desktop');await delay(200);region();
    const b=desktopWidget.win.getBounds();desktopWidget.win.setBounds({...b,width:380,height:560});await delay(350);region();
    await desktopWidget.open('floating');await delay(200);region();
    const wjs=code=>desktopWidget.win.webContents.executeJavaScript(code);
    // 网页的四个角也必须实际透明；不是只检验 border-radius 的声明值。
    desktopWidget.win.setBackgroundColor('#00000000');await wjs("render({...data,material:'acrylic'})");await delay(350);
    const image=await desktopWidget.win.webContents.capturePage(),size=image.getSize(),pixels=image.toBitmap();
    for(const [x,y]of [[0,0],[size.width-1,0],[0,size.height-1],[size.width-1,size.height-1]])assert.equal(pixels[(y*size.width+x)*4+3],0,'卡片角部像素必须完全透明');
    assert.ok(await wjs("parseFloat(getComputedStyle(document.querySelector('.widget-task strong')||document.querySelector('h1')).fontSize)>=14"));
    fs.writeFileSync(path.join(require('./verification-output').directory,'widget-corners-v13.png'),image.toPNG());
    desktopWidget.hide();
    console.log('V13 通过：指定设置 SVG、置顶/桌面模式切换及尺寸变化后的 Win32 四角裁剪、实际透明角像素。');
};
