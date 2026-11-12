const {test}=require('node:test'),assert=require('node:assert/strict');
const {nativeMaterial,applyWidgetMaterial}=require('../src/widget-material'),Theme=require('../src/theme');
test('系统材质支持边界和实色回退不降低文字透明度',()=>{
    assert.equal(nativeMaterial('win32','10.0.22621'),'acrylic');assert.equal(nativeMaterial('win32','10.0.19045'),'solid');assert.equal(nativeMaterial('darwin','24.0.0'),'vibrancy');assert.equal(nativeMaterial('linux','6.0.0'),'solid');
    const calls=[],win={setBackgroundMaterial:value=>calls.push(['material',value]),setBackgroundColor:value=>calls.push(['color',value]),setVibrancy:value=>calls.push(['vibrancy',value])};
    const theme=Theme.validate({widgetMaterial:'glass',glassOpacity:70});
    assert.equal(applyWidgetMaterial(win,theme,{platform:'win32',release:'10.0.26200'}),'acrylic');assert.deepEqual(calls,[['material','acrylic'],['color','#00000000']]);
    calls.length=0;applyWidgetMaterial(win,Theme.validate(),{platform:'win32',release:'10.0.26200'});assert.deepEqual(calls,[['material','none'],['color','#ffffff']]);
    assert.equal(Theme.validate({glassOpacity:1}).glassOpacity,20);assert.equal(Theme.validate({glassOpacity:200}).glassOpacity,90);
});
test('系统减少透明效果设置优先，回退时不把整个窗口设为半透明',()=>{
    const calls=[],win={setBackgroundMaterial:v=>calls.push(['material',v]),setBackgroundColor:v=>calls.push(['color',v])};
    assert.equal(applyWidgetMaterial(win,Theme.validate({widgetMaterial:'glass'}),{platform:'win32',release:'10.0.26200',reducedTransparency:true}),'solid');
    assert.deepEqual(calls,[['material','none'],['color','#ffffff']]);
});
