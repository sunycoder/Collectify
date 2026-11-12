const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {Store}=require('../src/store');const credentials=require('../src/credentials');
test('按用户要求明文保存，空密码可明确清除，保留开头结尾空白',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'collectify-password-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'collectify.sqlite'),store=new Store(file);
  const input=await credentials.prepare({name:'账号',type:'credential',username:'u',password:'  sample  '});const entry=store.save(input);
  assert.equal(new Store(file).entries.find(e=>e.id===entry.id).password,'  sample  ');assert.equal(await credentials.passwordOf(entry),'  sample  ');
  assert.equal((await credentials.prepare({name:'账号',type:'credential',password:''},entry)).password,'');
  assert.equal((await credentials.prepare({name:'账号',type:'credential'},entry)).password,'  sample  ');
});
test('含凭据 URL 拆分后保留可复制密码；文件资源清除登录字段',async()=>{
  const entry=await credentials.prepare({type:'web',url:'http://test:abc%20123@localhost:8080/'});
  assert.equal(entry.url,'http://localhost:8080/');assert.equal(entry.username,'test');assert.equal(entry.password,'abc 123');
  const file=await credentials.prepare({type:'file',username:'old',password:'secret',localPath:'C:\\test.txt'});assert.equal(file.password,'');assert.equal(file.username,'');
});
