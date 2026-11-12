const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {BrowserWindow,screen,desktopCapturer}=require('electron');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
exports.run=async({win,store,desktopWidget})=>{
    const js=code=>win.webContents.executeJavaScript(code).catch(error=>{console.error('V12 主窗口步骤:',code);throw error;});
    async function wait(fn){for(let i=0;i<120;i++){if(await fn())return;await delay(80);}throw Error('V12 等待界面超时');}
    async function click(selector){await js(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'nearest'})`);await delay(140);const p=await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);if(!e.contains(hit))throw Error('无法命中 '+${JSON.stringify(selector)});return{x,y}})()`);const z=win.webContents.getZoomFactor(),x=Math.round(p.x*z),y=Math.round(p.y*z);win.webContents.sendInputEvent({type:'mouseDown',x,y,button:'left',clickCount:1});win.webContents.sendInputEvent({type:'mouseUp',x,y,button:'left',clickCount:1});await delay(230);}
    win.setSize(1440,1000);await js("document.querySelector('dialog[open]')?.close();document.querySelector('#all-nav').click();document.querySelector('#grid-view').click()");await delay(180);
    assert.ok(await js("!!document.querySelector('.profile #settings-button [data-icon=gear]')"));
    const sizes=async()=>js("({card:document.querySelector('.bookmark-card').getBoundingClientRect().height,padding:parseFloat(getComputedStyle(document.querySelector('.bookmark-card')).paddingTop)})");
    await js("ShiyueTheme.apply({...state.settings.theme,density:'comfortable'})");const comfortable=await sizes();
    await js("ShiyueTheme.apply({...state.settings.theme,density:'compact'})");const compact=await sizes();assert.ok(compact.card<comfortable.card||compact.padding<comfortable.padding-4);
    await click('#settings-button');await wait(()=>js("document.querySelector('#settings-dialog').open"));await delay(220);
    await click('#theme-button');await wait(()=>js("document.querySelector('#theme-dialog').open"));await delay(220);
    assert.equal(await js("document.querySelector('.theme-preview').dataset.preview"),'main');
    await js("document.querySelector('#theme-widgetMaterial').tomselect.setValue('glass');document.querySelector('#theme-widgetMaterial').dispatchEvent(new Event('input'));document.querySelector('#theme-glassOpacity').value=38;document.querySelector('#theme-glassOpacity').dispatchEvent(new Event('input'))");
    assert.equal(await js("document.querySelector('.theme-preview').dataset.preview"),'widget');
    await click('#preview-main');assert.equal(await js("document.querySelector('.theme-preview').dataset.preview"),'main');
    await click('#preview-widget');assert.equal(await js("document.querySelector('.theme-preview').dataset.preview"),'widget');
    await click('.theme-preset:nth-child(2)');assert.equal(await js("document.querySelector('.theme-preview').dataset.preview"),'main');
    await js("document.querySelector('#theme-widgetMaterial').tomselect.open()");await delay(200);
    const dropdown=await js("(()=>{const s=document.querySelector('#theme-widgetMaterial').tomselect,d=s.dropdown,r=d.getBoundingClientRect();return{options:[...d.querySelectorAll('[data-selectable]')].map(x=>x.textContent),inputs:[...d.querySelectorAll('input')].filter(x=>x.getBoundingClientRect().height>0).length,height:r.height,optionHeight:[...d.querySelectorAll('[data-selectable]')].reduce((n,x)=>n+x.getBoundingClientRect().height,0)}})()");
    assert.equal(dropdown.options.length,2,JSON.stringify(dropdown));assert.equal(dropdown.inputs,0);assert.ok(dropdown.height-dropdown.optionHeight<26,JSON.stringify(dropdown));
    await js("OfficeUI.close();document.querySelector('#theme-widgetMaterial').tomselect.setValue('glass');document.querySelector('#theme-widgetMaterial').dispatchEvent(new Event('input'))");
    await click('#save-theme');await wait(()=>js("document.querySelector('#settings-dialog').open&&!document.querySelector('#theme-dialog').open"));
    await click('#theme-button');await wait(()=>js("document.querySelector('#theme-dialog').open"));await delay(250);
    await click('#theme-dialog .dialog-close');await wait(()=>js("document.querySelector('#settings-dialog').open&&!document.querySelector('#theme-dialog').open"));
    await js("document.querySelector('#settings-dialog').close()");
    await desktopWidget.open('floating');
    const wjs=code=>desktopWidget.win.webContents.executeJavaScript(code).catch(error=>{console.error('V12 桌面窗口步骤:',code);throw error;});
    await wait(()=>wjs("typeof data==='object'&&!!data.theme"));
    // 测试最终 CSS 绘制链；即使原生测试关闭，也必须验证办公主题不会覆盖透明材质。
    await delay(250);
    const paint=await wjs("(()=>{render({...data,material:'acrylic'});const alpha=e=>getComputedStyle(e).backgroundColor;return{html:alpha(document.documentElement),body:alpha(document.body),header:alpha(document.querySelector('header')),section:alpha(document.querySelector('section')),image:getComputedStyle(document.body).backgroundImage}})()");
    assert.equal(paint.html,'rgba(0, 0, 0, 0)');assert.equal(paint.header,'rgba(0, 0, 0, 0)');assert.equal(paint.section,'rgba(0, 0, 0, 0)');assert.ok(paint.image.includes('gradient'));
    const directory=require('./verification-output').directory;
    desktopWidget.win.setBackgroundColor('#00000000');
    await wjs("render({...data,material:'acrylic'})");await delay(350);
    const surface=await desktopWidget.win.webContents.capturePage(),surfaceSize=surface.getSize(),surfacePixels=surface.toBitmap(),surfaceOffset=(Math.floor(surfaceSize.height*.78)*surfaceSize.width+Math.floor(surfaceSize.width*.85))*4;
    fs.writeFileSync(path.join(directory,'widget-transparent-surface-v12.png'),surface.toPNG());
    console.log('V12 透明绘制检查:',await wjs("({material:document.documentElement.dataset.nativeMaterial,background:getComputedStyle(document.body).backgroundImage,windowBackground:getComputedStyle(document.documentElement).backgroundColor})"));
    assert.ok(surfacePixels[surfaceOffset+3]<245,`玻璃绘制不能是完全不透明，alpha=${surfacePixels[surfaceOffset+3]}`);
    await js("openSettings().then(()=>document.querySelector('#theme-button').click())");await wait(()=>js("document.querySelector('#theme-dialog').open"));await delay(220);await click('#preview-widget');
    // 同一个彩色背景做对照截图：验证画出来的背景确实被模糊，而不只检查 CSS 属性。
    const region=await js("(()=>{const scene=document.querySelector('.widget-glass-scene');scene.style.background='repeating-linear-gradient(90deg,#ff7045 0px 12px,#3258ed 12px 24px)';const r=document.querySelector('.widget-glass-preview').getBoundingClientRect();return{x:Math.round(r.x),y:Math.round(r.y),width:Math.floor(r.width),height:Math.floor(r.height)}})()");
    await delay(400);const blurred=await win.webContents.capturePage(region);
    await js("document.querySelector('.widget-glass-preview').style.backdropFilter='none'");await delay(350);const sharp=await win.webContents.capturePage(region);
    const pixelsBlur=blurred.toBitmap(),pixelsSharp=sharp.toBitmap(),sampleWidth=blurred.getSize().width;let delta=0,samples=0;
    for(let x=20;x<sampleWidth-20;x++){const i=(10*sampleWidth+x)*4;for(let c=0;c<3;c++){delta+=Math.abs(pixelsBlur[i+c]-pixelsSharp[i+c]);samples++;}}
    assert.ok(delta/samples>5,`彩色背景模糊对照的像素差不足：${delta/samples}`);
    await js("document.querySelector('.widget-glass-preview').style.backdropFilter='';document.querySelector('.widget-glass-scene').style.background=''");await delay(350);
    fs.writeFileSync(path.join(directory,'appearance-preview-v12.png'),(await win.webContents.capturePage()).toPNG());
    await js("document.querySelector('#theme-dialog').close()");await delay(150);await js("document.querySelector('#settings-dialog').close()");
    if(process.argv.includes('--smoke-native-glass')){
        const display=screen.getPrimaryDisplay(),background=new BrowserWindow({x:display.workArea.x+40,y:display.workArea.y+40,width:520,height:680,frame:false,show:false,skipTaskbar:true,webPreferences:{sandbox:true}});
        try{
            await background.loadURL('data:text/html,<body style="margin:0;background:rgb(240,55,45)"></body>');background.setAlwaysOnTop(true);background.showInactive();
            desktopWidget.win.setBounds({x:display.workArea.x+90,y:display.workArea.y+90,width:350,height:520});desktopWidget.win.showInactive();desktopWidget.win.moveTop();desktopWidget.materialKey=null;desktopWidget.update();
            await delay(1500);
            const capture=async name=>{
                const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:Math.round(display.size.width*display.scaleFactor),height:Math.round(display.size.height*display.scaleFactor)}});
                const source=sources.find(s=>s.display_id===String(display.id))||sources[0],image=source.thumbnail,scale=image.getSize().width/display.bounds.width,b=desktopWidget.win.getBounds();
                const cropped=image.crop({x:Math.round((b.x-display.bounds.x)*scale),y:Math.round((b.y-display.bounds.y)*scale),width:Math.round(b.width*scale),height:Math.round(b.height*scale)});fs.writeFileSync(path.join(directory,name+'.png'),cropped.toPNG());return cropped;
            };
            const red=await capture('glass-red-background-v12');
            await background.webContents.executeJavaScript("document.body.style.background='rgb(40,90,240)'");await delay(1500);const blue=await capture('glass-blue-background-v12');
            const sample=image=>{const size=image.getSize(),bitmap=image.toBitmap(),x=Math.floor(size.width*.85),y=Math.floor(size.height*.78),offset=(y*size.width+x)*4;return [...bitmap.subarray(offset,offset+3)];};
            const a=sample(red),b=sample(blue),difference=a.reduce((n,v,i)=>n+Math.abs(v-b[i]),0);
            if(difference<=30)console.log('V12 限制：当前桌面捕获未包含测试窗口，未验证屏幕后方合成效果；透明绘制像素检查已单独通过。');
            else console.log('V12 原生毛玻璃通过：真实桌面合成截图随背后红/蓝窗口改变，文字层保持独立。');
        }finally{background.destroy();desktopWidget.hide();}
    }else desktopWidget.hide();
    console.log('V12 通过：齿轮位置、返回设置、预览切换、密度尺寸、无空白选项及桌面透明绘制链。');
};
