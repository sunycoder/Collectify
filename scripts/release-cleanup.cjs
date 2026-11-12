const fs=require('node:fs'),path=require('node:path');
module.exports=async function(context){
  if(!context.artifactPaths?.some(p=>path.basename(p)==='Collectify-Setup.exe'))return [];
  const out=path.resolve(context.outDir),latest=path.join(out,'Collectify-Setup.exe');
  if(!fs.existsSync(latest)||fs.statSync(latest).size<1000000)throw Error('新安装包未完整生成，不清理旧包');
  // 仅清理输出目录顶层的旧Collectify包，绝不触碰用户数据或 win-unpacked。
  for(const file of fs.readdirSync(out)){
    if(file==='Collectify-Setup.exe')continue;
    if(/^(Env Workbench.*\.exe|Shiye-Setup.*\.exe(?:\.blockmap)?|Collectify-Setup.*\.exe(?:\.blockmap)?|builder-debug\.yml)$/.test(file)){
      const target=path.resolve(out,file);if(path.dirname(target)!==out)throw Error('清理路径越界');fs.unlinkSync(target);
    }
  }
  return [];
};
