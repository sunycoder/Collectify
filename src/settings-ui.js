async function openSettings(panel='general') {
    hideMenu();
    await call('overlay', true);
    $('#settings-error').textContent = '';
    const info = await call('workspace-info');
    $('#data-directory').textContent = info.directory;
    $('#data-file').textContent = info.file;
    $('#app-version').textContent = info.version;
    $('#mcp-port').value = info.mcp.port;
    renderMcpStatus(info.mcp);
    $('#settings-dialog').showModal();
    $('#widget-auto-restore').checked = state.settings?.widget?.autoRestore === true;
    selectSettingsPanel(typeof panel==='string'?panel:'general');
}

function selectSettingsPanel(panel){
    document.querySelectorAll('.settings-panel').forEach(node=>node.hidden=node.dataset.panel!==panel);
    document.querySelectorAll('[data-settings-panel]').forEach(node=>node.classList.toggle('selected',node.dataset.settingsPanel===panel));
}
document.querySelectorAll('[data-settings-panel]').forEach(node=>node.onclick=()=>selectSettingsPanel(node.dataset.settingsPanel));

function renderMcpStatus(status) {
    $('#mcp-status').textContent = status.enabled ? '已开启 · ' + status.url : '未开启';
    $('#mcp-status').classList.toggle('enabled', status.enabled);
    $('#mcp-stop').disabled = !status.enabled;
    $('#mcp-start').disabled = status.enabled;
    $('#mcp-copy').disabled = !status.enabled;
}

$('#settings-button').onclick = task(openSettings);
$('#open-data-directory').onclick = task(async () => {
    await call('open-data-directory');
});
$('#widget-auto-restore').onchange = task(async () => {
    await call('widget-auto-restore', $('#widget-auto-restore').checked);
    await refresh();
});
$('#mcp-start').onclick = async () => {
    const button = $('#mcp-start');
    button.disabled = true;
    try {
        const info = await call('mcp-start', {port: Number($('#mcp-port').value)});
        renderMcpStatus(info);
        $('#settings-error').textContent = '';
    } catch (e) {
        $('#settings-error').textContent = e.message;
        button.disabled = false;
    }
};
$('#mcp-stop').onclick = task(async () => renderMcpStatus(await call('mcp-stop')));
$('#mcp-copy').onclick = task(async () => {
    await call('mcp-copy');
    toast('MCP 连接配置已复制，包含本机连接令牌');
});

$('#backup-database').onclick = task(async()=>{ if(await call('backup-database')) toast('数据库备份已保存'); });
