const $ = (s) => document.querySelector(s);
window.renderLoginCard = (data) => {
    $('#site').textContent = data.name;
    $('#username').value = data.username;
    $('#password').value = data.password;
    $('#help').textContent =
        data.authMode === 'basic'
            ? 'HTTP Basic 只响应浏览器认证弹框；网页表单请复制后粘贴。'
            : '复制后粘贴到网页对应输入框。';
};

async function refresh() {
    const r = await window.loginHelper.call('state');
    if (!r.ok) {
        $('#feedback').textContent = r.error;
        return;
    }
    window.renderLoginCard(r.data);
}

for (const action of ['copy-user', 'copy-password'])
    $('#' + action).onclick = async () => {
        const r = await window.loginHelper.call(action);
        $('#feedback').textContent = r.ok ? '已复制' : r.error;
    };
$('#close').onclick = () => window.loginHelper.call('hide');
window.loginHelper.onUpdate(refresh);
void refresh();
