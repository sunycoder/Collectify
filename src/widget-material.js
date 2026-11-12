const os=require('node:os');
function nativeMaterial(platform=process.platform,release=os.release()){
    if(platform==='darwin')return 'vibrancy';
    if(platform==='win32'&&Number(release.split('.')[2])>=22621)return 'acrylic';
    return 'solid';
}
function applyWidgetMaterial(win,theme,{platform=process.platform,release=os.release(),smoke=false,reducedTransparency=false}={}){
    const kind=theme.widgetMaterial==='glass'&&!smoke&&!reducedTransparency?nativeMaterial(platform,release):'solid';
    try{
        if(platform==='win32')win.setBackgroundMaterial(kind==='acrylic'?'acrylic':'none');
        if(platform==='darwin')win.setVibrancy(kind==='vibrancy'?'under-window':null);
        win.setBackgroundColor(kind==='solid'?theme.surface:'#00000000');
        return kind;
    }catch{
        // 系统关闭透明效果或不支持原生材质时保留清晰的实色背景。
        win.setBackgroundColor(theme.surface);return 'solid';
    }
}
module.exports={nativeMaterial,applyWidgetMaterial};
