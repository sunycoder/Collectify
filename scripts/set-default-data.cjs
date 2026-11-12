// 从用户指定附件构建默认收藏；不输出或在日志中回显凭据。
const fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(process.argv[2],'utf8').replace(/\r/g,'');
const categories=[
    {id:'gm',name:'GM',description:'按内外网和版本区分游戏管理后台。',color:'blue',icon:'game'},
    {id:'jenkins',name:'Jenkins',description:'客户端和服务端构建平台。',color:'orange',icon:'build'},
    {id:'documents',name:'文档与共享',description:'项目文件与协作资料。',color:'sage',icon:'book'},
    {id:'repositories',name:'代码仓库',description:'复制 SVN 地址到本地 SVN 工具使用。',color:'purple',icon:'server'},
    {id:'network',name:'网络信息',description:'常用的本地网络资料。',color:'slate',icon:'server'},
    {id:'inbox',name:'未分类',description:'暂未整理的资源。',color:'slate',icon:'link'}
];
const entries=[];
function add(id,name,categoryId,type,value,extra={}){entries.push({id,name,categoryId,type,...(type==='web'?{url:value,mode:'internal',authMode:'manual'}:{content:value}),...extra});}
const shared=source.match(/文件共享\s*\n(https?:\/\/\S+)/);
if(!shared)throw Error('附件缺少文件共享地址');
add('shared-documents','文件共享','documents','web',shared[1],{note:'账号和密码尚未填写。'});
const svn=[...source.matchAll(/svn:\/\/[^\s]+/g)].map(match=>match[0]);
if(svn.length!==2)throw Error('附件 SVN 地址数量不符合预期');
add('project-svn','项目 SVN','repositories','text',svn[0],{note:'复制地址到 SVN 客户端使用；账号和密码尚未填写。'});
add('backend-svn','时间测试服后台 SVN','repositories','text',svn[1],{note:'后台管理工程的 SVN 地址。'});
const client=source.match(/客户端\s*\n(https?:\/\/\S+)\s*\naccount:([^\n]+)\npw:([^\n]+)/);
const server=source.match(/服务端\s*\n(https?:\/\/\S+)\s*\n([^\n]+)\n([^\n]+)/);
if(!client||!server)throw Error('附件 Jenkins 数据不完整');
for(const [id,name,match]of [['jenkins-client','客户端 Jenkins',client],['jenkins-server','服务端 Jenkins',server]])add(id,name,'jenkins','web',match[1],{username:match[2].trim(),password:match[3].trim()});
const gm=[...source.matchAll(/(外网时间测试服|外网trunk测试服|外网2\.0\.0测试服|内网时间测试服)[：:](https?:\/\/\S+)\s*\n([^\n]+)\n([^\n]+)/g)];
if(gm.length!==4)throw Error('附件 GM 数据不完整');
for(const [i,match]of gm.entries())add(['gm-external-time','gm-trunk','gm-2-0-0','gm-internal-time'][i],match[1],'gm','web',match[2],{username:match[3].trim(),password:match[4].trim(),environment:['外网 · 时间服','外网 · trunk','外网 · 2.0.0','内网 · 时间服'][i],favorite:i===1});
const backend=source.match(/时间测试服 后台\s*\n访问地址[：:](https?:\/\/\S+)\s*\nSVN地址[^\n]*\n\s*\n([^\n]+)\n([^\n]+)/);
if(!backend)throw Error('附件后台资料不完整');
add('time-backend','时间测试服后台','gm','web',backend[1],{username:backend[2].trim(),password:backend[3].trim(),environment:'内网 · 时间服',note:'后台工程 SVN 地址见“代码仓库”分类。'});
const ip=source.match(/个人IP\s*\n([^\n]+)\n([^\n]+)/);
if(!ip)throw Error('附件网络信息不完整');
add('personal-ip',`${ip[1].trim()} · 个人 IP`,'network','text',ip[2].trim(),{note:'局域网地址。'});
fs.writeFileSync(path.join(__dirname,'..','default-config.json'),JSON.stringify({version:2,initializeExamples:true,categories,entries},null,2)+'\n','utf8');
console.log(`Local default configuration written to ignored default-config.json: ${entries.length} resources in ${categories.length} categories.`);
