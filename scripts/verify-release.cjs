const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const asar = require('@electron/asar');
const root = path.resolve(__dirname, '..'), archive = path.join(root, 'dist', 'win-unpacked', 'resources', 'app.asar');
for (const relative of ['src/main.js','src/store.js','src/sqlite-repository.js','src/initial-examples.js','config/default-config.json','src/productivity-ui.js','src/renderer.js','src/ui-components.js','src/task-query.js','src/interaction-fixes.css','src/board.css','src/index.html','src/vendor/mcp-service.cjs']) {
  assert.ok(asar.extractFile(archive, path.join(...relative.split('/'))).equals(fs.readFileSync(path.join(root, relative))), `发布文件与源码不同：${relative}`);
}
const pkg = JSON.parse(asar.extractFile(archive, 'package.json'));
assert.equal(pkg.name, 'collectify'); assert.equal(pkg.version, '5.4.3');
const ico = fs.readFileSync(path.join(root, 'assets', 'icon.ico'));
const images = Array.from({length:ico.readUInt16LE(4)},(_,i)=>({size:ico.readUInt32LE(6+i*16+8),offset:ico.readUInt32LE(6+i*16+12)})).sort((a,b)=>b.size-a.size);
const largest = images[0], executable = fs.readFileSync(path.join(root,'dist','win-unpacked','Collectify.exe'));
assert.ok(executable.includes(ico.subarray(largest.offset,largest.offset+largest.size)), 'EXE 未嵌入统一图标');
assert.deepEqual(fs.readdirSync(path.join(root,'dist')).filter(file=>file.endsWith('.exe')), ['Collectify-Setup.exe']);
console.log('Release verified: Collectify 5.4.3, source/archive consistency, canonical icon, one latest installer.');
