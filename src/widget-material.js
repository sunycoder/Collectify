const os=require('node:os');
function nativeMaterial(platform=process.platform,release=os.release()){
    if(platform==='darwin')return 'vibrancy';
    if(platform==='win32'&&Number(release.split('.')[2])>=22621)return 'acrylic';
    return 'solid';
}
function applyWidgetMaterial(win,theme,{platform=process.platform,release=os.release(),smoke=false,reducedTransparency=false}={}){
    const kind=theme.widgetMaterial==='glass'&&!smoke&&!reducedTransparency?nativeMaterial(platform,release):'solid';
    try{
        // 先清除 Chromium 窗口底色，再启用系统背景材质，避免底色更新覆盖材质。
        win.setBackgroundColor(kind==='solid'?theme.surface:'#00000000');
        if(platform==='win32')win.setBackgroundMaterial(kind==='acrylic'?'acrylic':'none');
        if(platform==='darwin')win.setVibrancy(kind==='vibrancy'?'under-window':null);
        return kind;
    }catch{
        // 系统关闭透明效果或不支持原生材质时保留清晰的实色背景。
        win.setBackgroundColor(theme.surface);return 'solid';
    }
}

function roundedWindowShape(width,height,radius=20){
    const r=Math.min(radius,Math.floor(width/2),Math.floor(height/2)),shape=[];
    // 原生背景绘制超出 CSS 圆角时，用窗口区域同步裁剪；每一行对称，不留方形底角。
    for(let y=0;y<r;y++){
        const inset=Math.ceil(r-Math.sqrt(r*r-(r-y-.5)**2));
        shape.push({x:inset,y,width:width-inset*2,height:1},{x:inset,y:height-y-1,width:width-inset*2,height:1});
    }
    shape.push({x:0,y:r,width,height:Math.max(1,height-r*2)});
    return shape;
}
module.exports={nativeMaterial,applyWidgetMaterial,roundedWindowShape};
