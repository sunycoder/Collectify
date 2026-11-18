/** @typedef {{ code: string, message: string }} PublicFailure */
/** @typedef {{ validate?: (input: any) => void, validateResult?: (result: any) => void, write?: boolean }} ActionContract */
/** @typedef {{ [action: string]: ActionContract }} ActionContracts */

/** @param {string} code @param {string} message */
function failure(code, message) {
    return Object.assign(new Error(message), { code });
}
/** @param {ActionContracts | undefined} contracts @param {string} action @param {any} payload */
function validateRequest(contracts, action, payload) {
    if (typeof action !== 'string' || !/^[a-z][a-z0-9.-]{0,80}$/.test(action))
        throw failure('INVALID_ACTION', '插件操作名称无效');
    if (!contracts) return;
    if (!Object.hasOwn(contracts, action)) throw failure('UNSUPPORTED_ACTION', '插件不支持该操作');
    try {
        contracts[action].validate?.(payload);
    } catch (error) {
        throw failure('INVALID_ARGUMENT', error instanceof Error ? error.message : '插件参数无效');
    }
}
/** @param {unknown} input */
function objectInput(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('请提供有效的参数对象');
}
/** @param {unknown} id */
function entityId(id) {
    if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(id)) throw Error('内容 ID 无效');
}
module.exports = { failure, validateRequest, objectInput, entityId };
