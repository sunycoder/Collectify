const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
exports.run=async({win,store})=>{
    win.webContents.on('console-message',event=>{if(event.level===3)console.error('V10 renderer:',event.message);});
    const js=code=>win.webContents.executeJavaScript(code).catch(error=>{console.error('V10 step:',code);throw error;});
    async function until(fn){for(let i=0;i<100;i++){if(await fn())return;await delay(70);}console.error('V10 diagnostic:',await js("({toast:document.querySelector('#toast').textContent,handler:typeof document.querySelector('#new-task').onclick,showTask:typeof showTask,taskSection:document.querySelector('#tasks-page').hidden,modals:[...document.querySelectorAll('dialog[open]')].map(x=>x.id)})"));throw Error('V10 timeout');}
    async function point(x,y){const z=win.webContents.getZoomFactor();x=Math.round(x*z);y=Math.round(y*z);win.webContents.sendInputEvent({type:'mouseMove',x,y});win.webContents.sendInputEvent({type:'mouseDown',x,y,button:'left',clickCount:1});win.webContents.sendInputEvent({type:'mouseUp',x,y,button:'left',clickCount:1});await delay(140);}
    async function click(selector){const p=await js(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}),r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);if(!e.contains(hit))throw Error('not hit-testable: '+${JSON.stringify(selector)});return {x,y}})()`);await point(p.x,p.y);}
    win.setSize(1280,900);await js("document.querySelector('dialog[open]')?.close();document.querySelector('#all-nav').click();document.querySelector('#list-view').click()");await delay(200);
    for(const [width,height]of [[1920,1080],[1080,760]]){
        win.setSize(width,height);await delay(180);
        assert.ok(await js("[...document.querySelectorAll('.card-open')].every(e=>getComputedStyle(e).whiteSpace==='nowrap'&&e.getBoundingClientRect().width>=85&&e.getBoundingClientRect().height<30)"));
        assert.ok(await js("[...document.querySelectorAll('.card-bottom')].every(e=>e.scrollWidth<=e.clientWidth+1)"));
    }
    await js("toast('背景提示');document.querySelector('#add-button').click()");await until(()=>js("document.querySelector('#entry-dialog').open"));
    assert.equal(await js("getComputedStyle(document.querySelector('#toast')).visibility"),'hidden');
    assert.equal(await js("getComputedStyle(document.querySelector('#entry-dialog')).overflow"),'hidden');
    assert.equal(await js("getComputedStyle(document.querySelector('#entry-dialog .dialog-scroll')).overflowY"),'auto');
    assert.ok(await js("(()=>{const d=document.querySelector('#entry-dialog'),r=d.getBoundingClientRect();return d.contains(document.elementFromPoint(r.x+30,r.y+30))})()"));
    // 真正点击遮罩关闭；点击内部字段不能关闭。
    await click('#entry-form input[name=name]');assert.ok(await js("document.querySelector('#entry-dialog').open"));
    await point(20,100);assert.equal(await js("document.querySelector('#entry-dialog').open"),false);
    await js("document.querySelector('#tasks-nav').click();document.querySelector('#new-task').click()");await until(()=>js("document.querySelector('#task-dialog').open"));
    await js("(()=>{const p=document.querySelector('#task-form').elements.startAt._flatpickr;p.setDate('2026-11-12T16:57',false);p.altInput.scrollIntoView({block:'center'})})()");await delay(150);
    await click('#task-form [name=startAt] + input');await delay(180);
    await click('.flatpickr-calendar.open .flatpickr-day.selected');
    assert.ok(await js("!document.activeElement.classList.contains('flatpickr-hour')"));
    const minute=()=>js("Number(document.querySelector('#task-form').elements.startAt._flatpickr.minuteElement.value)");
    const before=await minute();await click('.flatpickr-calendar.open .flatpickr-time .numInputWrapper:nth-child(3) .arrowUp');assert.equal(await minute(),(before+1)%60);
    await click('.flatpickr-calendar.open .flatpickr-time .numInputWrapper:nth-child(3) .arrowDown');assert.equal(await minute(),before);
    assert.ok(await js("document.querySelector('#task-dialog').open"));
    // 弹层在卡片外仍能点击，不能被遮罩关闭逻辑误伤。
    await js("document.querySelector('#task-form').elements.startAt._flatpickr.close();document.querySelector('#task-dialog').close()");
    await js("document.querySelector('#task-date-query')._flatpickr.setDate('2026-11-12',true);document.querySelector('#task-date-field').value='dueAt';document.querySelector('#task-board-button').click();document.querySelector('#new-task').click()");await until(()=>js("document.querySelector('#task-dialog').open"));
    await js("document.querySelector('#task-form').elements.title.value='UI回归 · 无截止日任务';document.querySelector('#task-form').requestSubmit()");
    await until(()=>js("!document.querySelector('#task-dialog').open"));
    assert.equal(await js("document.querySelector('#task-date-query').value"),'');
    assert.ok(await js("[...document.querySelectorAll('#task-board .task-title')].some(e=>e.textContent==='UI回归 · 无截止日任务')"));
    await js("document.querySelector('#task-list-button').click()");assert.ok(await js("document.querySelector('#task-list').textContent.includes('UI回归 · 无截止日任务')"));
    await js("document.querySelector('#task-matrix-button').click()");assert.ok(await js("document.querySelector('#task-matrix').textContent.includes('UI回归 · 无截止日任务')"));
    await js("document.querySelector('#task-date-query')._flatpickr.setDate('2026-11-12',true);renderProductivity()");
    assert.ok(await js("document.querySelector('#task-filter-summary').textContent.includes('按截止日：2026-11-12')"));
    await js("document.querySelector('#task-filter-summary button').click()");assert.equal(await js("document.querySelector('#task-date-query').value"),'');
    await js("document.querySelector('#new-task').click()");await delay(400);
    fs.writeFileSync(path.join(require('./verification-output').directory,'modal-ui-v10.png'),(await win.webContents.capturePage()).toPNG());
    await point(20,100);assert.equal(await js("document.querySelector('#task-dialog').open"),false);
    console.log('V10 PASS: single-line list actions, rounded scroll container, modal/toast layer, backdrop dismissal, date focus/minute step, saved task visibility across board/list/matrix and filter summary.');
};
