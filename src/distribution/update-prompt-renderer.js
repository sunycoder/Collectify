const byId = (id) => document.getElementById(id);
function render(state) {
    window.ShiyueTheme.apply(state.theme);
    const update = state.automatic;
    const downloading = update.phase === 'downloading';
    const installing = update.phase === 'installing';
    byId('title').textContent =
        (installing ? '正在重启更新 ' : downloading ? '正在下载 ' : 'Collectify ') + update.version;
    byId('message').textContent =
        update.error ||
        (!update.supported
            ? update.reason
            : downloading
              ? '下载完成并校验后自动安装，个人数据保留。'
              : update.phase === 'ready'
                ? '新版本已就绪，重启后自动完成安装。'
                : installing
                  ? '正在保存工作并交接安装，请稍候…'
                  : '有新版本可用，点击后自动下载、安装并重新打开。');
    byId('progress').hidden = !downloading;
    byId('progress').value = state.progress?.total
        ? Math.floor((state.progress.received / state.progress.total) * 100)
        : 0;
    byId('update').textContent = update.phase === 'error' ? '重试更新' : '重启更新';
    byId('update').disabled = downloading || installing || !update.supported;
    byId('later').disabled = installing;
    byId('later').textContent = downloading ? '下载后稍后重启' : '稍后';
}
window.appUpdate.subscribe(render);
void window.appUpdate.action('status').then(render);
byId('later').onclick = () => void window.appUpdate.action('later');
byId('update').onclick = () => void window.appUpdate.action('update');
