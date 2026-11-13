let distributionState = null,
    sourceDirty = false,
    notifiedVersion = '';
const sourceFields = [
    'provider',
    'baseUrl',
    'project',
    'clientId',
    'ref',
    'catalogPath',
    'profilesPath',
    'allowInsecureHttp',
    'automaticChecks'
];
async function loadDistribution() {
    sourceDirty = false;
    renderDistribution(await call('distribution-status'));
}
function sourceInput() {
    return Object.fromEntries(
        sourceFields.map((key) => {
            const node = $('#source-' + key);
            return [key, node.type === 'checkbox' ? node.checked : node.value];
        })
    );
}
function renderDistribution(next) {
    distributionState = next;
    if (!sourceDirty)
        for (const key of sourceFields) {
            const input = $('#source-' + key);
            if (input.type === 'checkbox') input.checked = next.config[key];
            else input.value = next.config[key];
        }
    const busy = !!next.busy;
    for (const id of [
        'source-save',
        'source-login',
        'source-check',
        'source-download',
        'source-install',
        'source-profile-apply'
    ])
        $('#' + id).disabled = busy;
    $('#source-login').textContent = next.authenticated
        ? '重新登录'
        : '登录 ' + (next.config.provider === 'gitlab' ? 'GitLab' : 'GitHub');
    $('#source-logout').hidden = !next.authenticated;
    $('#source-cancel').hidden = !busy;
    $('#source-account').textContent = next.busy
        ? '正在' + next.busy + '…'
        : next.identity
          ? `已登录：${next.identity.name}（${next.identity.username}）`
          : next.authenticated
            ? '已保存授权，检查更新时读取账号信息'
            : '尚未登录；公开 GitHub 发布可匿名检查。';
    $('#source-groups').textContent = next.identity
        ? '已识别用户组：' + (next.identity.groups.join('、') || '无用户组')
        : '';
    $('#source-login-code').hidden = !next.pending?.userCode;
    $('#source-login-code').textContent = next.pending?.userCode
        ? '请在 GitHub 授权页输入设备码：' + next.pending.userCode
        : '';
    $('#source-error').textContent =
        next.error || (!next.secureStorage ? '系统安全存储不可用，请配置密钥环后再登录。' : '');
    const update = next.update;
    const updates = update?.available || next.pluginUpdates > 0 || next.profiles.some((profile) => profile.available);
    for (const id of ['settings-button', 'collapsed-settings-button']) {
        $('#' + id).classList.toggle('has-update', !!updates);
        $('#' + id).title = updates ? '设置 · 有可用更新或团队配置' : '设置';
    }
    $('#download-app').textContent = update?.available ? '有新版本 · ' + update.version : '下载与更新';
    if (update?.available && notifiedVersion !== update.version) {
        notifiedVersion = update.version;
        toast('发现 Collectify ' + update.version + '，可在设置中下载更新');
    }
    $('#source-download').hidden = !update?.available || next.downloaded;
    $('#source-install').hidden = !next.downloaded;
    $('#source-update-status').textContent =
        next.progress && next.busy === '下载安装包'
            ? `正在下载 ${Math.floor((next.progress.received / next.progress.total) * 100)}%`
            : next.updateError ||
              (update
                  ? update.available
                      ? `发现 ${update.version} · ${update.file.name}${next.downloaded ? ' · 已下载并通过 SHA-256 校验' : ''}`
                      : '当前已是该源的最新版本'
                  : '尚未检查。安装包下载完成后，由你确认安装。');
    $('#source-update-notes').hidden = !update?.notes;
    $('#source-update-notes').textContent = update?.notes || '';
    $('#source-plugin-status').textContent = next.pluginError
        ? '插件目录：' + next.pluginError
        : `可更新插件：${next.pluginUpdates || 0} 个，前往“插件 → 发现插件”确认更新。`;
    $('#source-profile-status').textContent =
        next.profileError ||
        (!next.authenticated
            ? '登录后检查所属团队的默认配置。'
            : next.profiles.length
              ? '可用团队配置：'
              : '检查更新后显示可用配置；需要维护者先发布配置索引。');
    const list = $('#source-profile-list');
    list.replaceChildren();
    for (const profile of next.profiles) {
        const row = el('article', 'catalog-plugin'),
            copy = el('div');
        copy.append(
            el('strong', '', profile.name),
            el(
                'p',
                '',
                `v${profile.version}${profile.appliedVersion ? ' · 已应用 v' + profile.appliedVersion : ' · 未应用'}`
            )
        );
        const action = button(
            profile.available ? '预览配置' : '已应用',
            null,
            () => distributionAction('preview', profile.id),
            'subtle'
        );
        action.disabled = busy || !profile.available;
        row.append(copy, action);
        list.append(row);
    }
    $('#source-profile-preview').hidden = !next.preview;
    if (next.preview) {
        const draft = next.preview;
        $('#source-profile-summary').textContent =
            `${draft.name} v${draft.version}：${draft.plugins.join('、') || '无插件数据'}。${draft.settings ? '包含初始工作台设置。' : ''}${draft.policy}${draft.missing.length ? '请先安装所需插件：' + draft.missing.join('、') : ''}`;
        $('#source-profile-apply').disabled = busy || !!draft.missing.length;
    }
    window.OfficeUI?.refresh();
}
async function distributionAction(action, payload) {
    $('#source-error').textContent = '';
    try {
        const result = await call('distribution-' + action, payload);
        renderDistribution(await call('distribution-status'));
        if (result?.pluginError) $('#source-plugin-status').textContent = '插件目录：' + result.pluginError;
        else if (action === 'check') {
            catalogState = await call('plugin-catalog-status');
            renderPluginCatalog();
            $('#source-plugin-status').textContent =
                `插件目录已刷新，${catalogState.plugins.filter((p) => p.updateAvailable).length} 个插件可更新。请在“插件 → 发现插件”中确认更新。`;
        }
        if (action === 'apply') {
            await refresh();
            toast('团队默认配置已补充，个人修改保留');
        }
    } catch (error) {
        $('#source-error').textContent = error.message;
    }
}
api.onEvent('distribution-state', renderDistribution);
$('#distribution-form').addEventListener('input', () => {
    sourceDirty = true;
});
$('#source-provider').addEventListener('change', () => {
    sourceDirty = true;
    $('#source-baseUrl').value = $('#source-provider').value === 'github' ? 'https://github.com' : '';
    $('#source-project').value = $('#source-provider').value === 'github' ? 'sunycoder/Collectify' : '';
    $('#source-clientId').value = '';
    $('#source-allowInsecureHttp').checked = false;
});
$('#distribution-form').onsubmit = async (event) => {
    event.preventDefault();
    const input = sourceInput();
    sourceDirty = false;
    await distributionAction('save', input);
    catalogState = await call('plugin-catalog-status');
    renderPluginCatalog();
};
$('#source-login').onclick = () =>
    sourceDirty ? ($('#source-error').textContent = '请先保存发布源，再登录') : distributionAction('login');
$('#source-logout').onclick = () => distributionAction('logout');
$('#source-cancel').onclick = () => distributionAction('cancel');
$('#source-check').onclick = () => distributionAction('check');
$('#source-download').onclick = () => distributionAction('download');
$('#source-install').onclick = () => distributionAction('install');
$('#source-profile-apply').onclick = () => distributionAction('apply', distributionState.preview?.token);
