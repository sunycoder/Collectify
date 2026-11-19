// 已签名原生插件使用的公共后端接口。只承载公共能力，不包含任何业务插件模型。
exports.apiVersion = 1;
exports.storage = require('./storage');
exports.contracts = require('./request-contract');
exports.urls = require('./urls');
exports.windows = require('../window-lifecycle');
exports.auxiliary = require('../auxiliary-window');
exports.clipboard = require('../clipboard-service');
Object.defineProperty(exports, 'mcp', {
    get() {
        return require('../vendor/mcp-service.cjs');
    }
});
