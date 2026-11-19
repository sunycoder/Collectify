// 凭据按产品要求明文保存与复制；此项目不提供旧密文迁移。
async function passwordOf(entry) {
    return entry.password || '';
}

async function prepare(input, previous) {
    const result = { ...input },
        type = input.type || 'web';
    let url = null;
    if (input.url && ['web', 'credential'].includes(type)) {
        try {
            url = new URL(input.url);
        } catch {
            if (type === 'web') throw Error('请输入完整的 http:// 或 https:// 网址');
        }
    }
    if (url && (url.username || url.password)) {
        if (url.username) result.username = decodeURIComponent(url.username);
        if (url.password) result.password = decodeURIComponent(url.password);
        url.username = '';
        url.password = '';
        result.url = url.href;
        result.authMode = type === 'web' ? 'basic' : 'manual';
    }
    result.password = input.clearPassword
        ? ''
        : Object.hasOwn(result, 'password')
          ? String(result.password || '')
          : previous?.password;
    if (result.password && result.password.length > 5000) throw Error('密码过长，最多 5000 字符');
    delete result.clearPassword;
    if (type !== 'web') result.authMode = 'manual';
    return result;
}

function publicEntry(entry) {
    return { ...entry, hasPassword: !!entry.password };
}
module.exports = { prepare, publicEntry, passwordOf };
