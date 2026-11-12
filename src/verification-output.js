// 验证过程的截图和导入样例均为临时文件，与源码及真实用户数据分开。
const fs = require('node:fs');
const path = require('node:path');
const directory = path.join(require('node:os').tmpdir(), 'Collectify-verification');
fs.mkdirSync(directory, {recursive: true});
module.exports = {directory};
