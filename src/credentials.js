// 凭据按产品要求明文保存与复制；此项目不提供旧密文迁移。
async function passwordOf(entry) { return entry.password || ''; }

async function prepare(input, previous) {
    const result = {...input}, type = input.type || 'web';
    if (!['web','credential'].includes(type)) return {...result,username:'',password:'',authMode:'manual'};
    const url = input.url ? new URL(input.url) : null;
    if (url && (url.username || url.password)) {
        result.username = decodeURIComponent(url.username);
        result.password = decodeURIComponent(url.password);
        url.username = ''; url.password = ''; result.url = url.href; result.authMode = 'basic';
    }
    result.password = input.clearPassword ? '' : Object.hasOwn(result,'password') ? String(result.password || '') : previous?.password;
    if (result.password && result.password.length>5000) throw Error('密码过长，最多 5000 字符');
    delete result.clearPassword;
    return result;
}

function publicEntry(entry) { return {...entry,hasPassword:!!entry.password}; }
module.exports = {prepare,publicEntry,passwordOf};
