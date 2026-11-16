const path = require('node:path');
const { createRequire } = require('node:module');
const { app } = require('electron');
// 始终引用被测应用自身的模块，打包测试不能误用工作区的业务源码。
exports.requireHost = createRequire(path.join(app.getAppPath(), 'src', 'main.js'));
