// 描述信息只有文本和受限内嵌截图，不执行 Markdown/HTML，不加载任意远程媒体。
function validateDetails(input) {
    if (input === undefined) return undefined;
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('插件详情格式无效');
    const output = {};
    for (const field of ['features', 'limitations', 'changelog']) {
        if (input[field] === undefined) continue;
        if (
            !Array.isArray(input[field]) ||
            input[field].length > 12 ||
            input[field].some((s) => typeof s !== 'string' || s.length > 400)
        )
            throw Error('插件详情文本超限');
        output[field] = [...input[field]];
    }
    if (input.permissions !== undefined) {
        if (
            !Array.isArray(input.permissions) ||
            input.permissions.length > 20 ||
            input.permissions.some((s) => typeof s !== 'string' || s.length > 80)
        )
            throw Error('插件详情权限无效');
        output.permissions = [...input.permissions];
    }
    if (input.screenshots !== undefined) {
        if (
            !Array.isArray(input.screenshots) ||
            input.screenshots.length > 3 ||
            input.screenshots.some(
                (s) =>
                    typeof s !== 'string' ||
                    s.length > 110000 ||
                    !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(s)
            )
        )
            throw Error('插件详情截图无效或过大');
        output.screenshots = [...input.screenshots];
    }
    if (input.verification !== undefined) {
        if (!Array.isArray(input.verification) || input.verification.length > 6) throw Error('平台验证信息无效');
        output.verification = input.verification.map((v) => {
            if (
                !v ||
                !['win32', 'darwin', 'linux'].includes(v.platform) ||
                !['local', 'ci', 'unverified'].includes(v.status) ||
                !/^\d{4}-\d{2}-\d{2}$/.test(v.date) ||
                typeof v.scope !== 'string' ||
                v.scope.length > 300
            )
                throw Error('平台验证范围无效');
            return { platform: v.platform, status: v.status, date: v.date, scope: v.scope };
        });
    }
    return output;
}
module.exports = { validateDetails };
