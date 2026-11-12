const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {dialog}=require('electron');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
exports.run=async({win,store,desktopWidget})=>{
    const js=code=>win.webContents.executeJavaScript(code).catch(error=>{console.error('V11 step:',code);throw error;});
    async function until(fn){for(let i=0;i<120;i++){if(await fn())return;await delay(80);}throw Error('V11 timeout');}
    async function click(selector,rx=.5,ry=.5){
        const p=await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect(),x=r.x+r.width*${rx},y=r.y+r.height*${ry};const hit=document.elementFromPoint(x,y);if(!e.contains(hit))throw Error('not hittable '+${JSON.stringify(selector)});return{x,y}})()`);
        const z=win.webContents.getZoomFactor(),x=Math.round(p.x*z),y=Math.round(p.y*z);
        win.webContents.sendInputEvent({type:'mouseMove',x,y});win.webContents.sendInputEvent({type:'mouseDown',x,y,button:'left',clickCount:1});win.webContents.sendInputEvent({type:'mouseUp',x,y,button:'left',clickCount:1});await delay(190);
    }
    win.setSize(1440,1000);await js("document.querySelector('dialog[open]')?.close();document.querySelector('#tasks-nav').click();document.querySelector('#task-list-button').click();clearTaskFilters()");await delay(250);
    // 点击整行右侧空白可编辑，而复选框保持独立完成操作。
    await click('.checklist-row',.72,.5);await until(()=>js("document.querySelector('#task-dialog').open"));await js("document.querySelector('#task-dialog').close()");await delay(180);
    const taskId=await js("document.querySelector('.checklist-row').dataset.id"),previous=store.data.tasks.find(t=>t.id===taskId).status;
    await click('.checklist-row input');await until(()=>store.data.tasks.find(t=>t.id===taskId).status!==previous);assert.equal(await js("document.querySelector('#task-dialog').open"),false);
    assert.equal(await js("document.querySelectorAll('.sidebar #theme-button').length"),0);
    assert.equal(await js("document.querySelector('.profile #settings-button').getAttribute('aria-label')"),'设置');
    await click('#settings-button');await until(()=>js("document.querySelector('#settings-dialog').open"));await delay(220);
    await click('#theme-button');await until(()=>js("document.querySelector('#theme-dialog').open"));await delay(220);
    assert.equal(await js("document.querySelector('#theme-dialog h2').textContent"),'自定义外观');
    await js("document.querySelector('#theme-widgetMaterial').tomselect.setValue('glass');document.querySelector('#theme-widgetMaterial').dispatchEvent(new Event('input'));document.querySelector('#theme-glassOpacity').value=68;document.querySelector('#theme-glassOpacity').dispatchEvent(new Event('input'))");
    assert.equal(await js("document.documentElement.dataset.widgetMaterial"),'glass');
    const directory=require('./verification-output').directory;
    await delay(230);fs.writeFileSync(path.join(directory,'custom-appearance-v11.png'),(await win.webContents.capturePage()).toPNG());
    await js("document.querySelector('#save-theme').click()");await until(()=>store.data.settings.theme.widgetMaterial==='glass');
    assert.equal(store.data.settings.theme.glassOpacity,68);
    await desktopWidget.open('floating');await delay(150);
    assert.equal(await desktopWidget.win.webContents.executeJavaScript("document.documentElement.dataset.widgetMaterial"),'glass');
    assert.equal(await desktopWidget.win.webContents.executeJavaScript("document.documentElement.dataset.nativeMaterial"),'solid');
    const {applyWidgetMaterial,nativeMaterial}=require('./widget-material');
    assert.equal(applyWidgetMaterial(desktopWidget.win,store.data.settings.theme),nativeMaterial());
    assert.ok(desktopWidget.win.isAlwaysOnTop());
    applyWidgetMaterial(desktopWidget.win,store.data.settings.theme,{smoke:true});
    desktopWidget.hide();
    const note=store.saveNote({title:'可选择的数据',content:'单独替换便签'});await js('refresh()');
    const exportPath=path.join(directory,'workspace-ui-v11.json'),importPath=path.join(directory,'workspace-import-ui-v11.json');
    const originalSave=dialog.showSaveDialog,originalOpen=dialog.showOpenDialog;
    try{
        dialog.showSaveDialog=async()=>({canceled:false,filePath:exportPath});
        await js("openSettings('data')");await delay(220);await click('#settings-export');await until(()=>js("document.querySelector('#transfer-dialog').open"));await delay(220);
        await click('.transfer-options input[value=notes]');await click('#transfer-credentials input');await click('#transfer-confirm');await until(()=>fs.existsSync(exportPath));
        const exported=JSON.parse(fs.readFileSync(exportPath,'utf8'));assert.equal(exported.format,'collectify-workspace');assert.ok(exported.sections.includes('tasks'));assert.ok(!exported.sections.includes('notes'));assert.ok(exported.data.entries.every(e=>e.username===undefined&&e.password===undefined));
        fs.writeFileSync(importPath,JSON.stringify({format:'collectify-workspace',version:1,sections:['notes'],data:{notes:[{id:note.id,title:'导入后的便签',content:'已选择替换便签',color:'blue'}]}}));
        dialog.showOpenDialog=async()=>({canceled:false,filePaths:[importPath]});
        await js("openSettings('data')");await delay(220);await click('#settings-import');await until(()=>js("document.querySelector('#transfer-dialog').open"));await delay(220);
        assert.ok(await js("document.querySelector('.transfer-options input[value=tasks]').disabled"));
        const before=store.snapshot();
        await js("document.querySelector('#transfer-mode').tomselect.setValue('replace')");
        await delay(300);fs.writeFileSync(path.join(directory,'data-import-v11.png'),(await win.webContents.capturePage()).toPNG());
        await click('#transfer-confirm');await until(()=>store.data.notes.length===1&&store.data.notes[0].title==='导入后的便签');
        assert.deepEqual(store.entries,before.entries);assert.deepEqual(store.data.tasks,before.tasks);assert.deepEqual(store.data.settings,before.settings);
    }finally{dialog.showSaveDialog=originalSave;dialog.showOpenDialog=originalOpen;}
    console.log('V11 PASS: unified settings, custom glass preview/persistence/widget sync, full-row task details, independent checkbox, selective global export/import through native IPC.');
};
