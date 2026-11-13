let pluginCatalog = [];
async function refreshPlugins() {
    const result = await call('plugin-list');
    pluginCatalog = result.plugins;
    $('#plugin-nav').replaceChildren();
    const enabled = pluginCatalog.filter((p) => p.enabled);
    if (enabled.length) $('#plugin-nav').append(el('div', 'plugin-nav-heading', '工具插件'));
    for (const plugin of enabled) {
        const nav = button(plugin.name, 'grid', () => call('plugin-open', { id: plugin.id }), 'nav-item');
        nav.dataset.pluginId = plugin.id;
        nav.title = plugin.description;
        $('#plugin-nav').append(nav);
    }
    $('#plugin-manager').replaceChildren();
    for (const plugin of pluginCatalog) {
        const row = el('div', 'plugin-manager-row'),
            copy = el('div');
        copy.append(
            el('strong', '', plugin.name),
            el('p', '', plugin.description),
            el(
                'small',
                '',
                `${plugin.builtin ? '内置' : '本地'} · v${plugin.version} · API ${plugin.apiVersion} · ${plugin.permissions.join(' / ') || '无额外能力'}`
            )
        );
        const label = el('label', 'plugin-switch'),
            checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = plugin.enabled;
        checkbox.dataset.togglePlugin = plugin.id;
        checkbox.onchange = task(async () => {
            checkbox.disabled = true;
            try {
                await call('plugin-enable', { id: plugin.id, enabled: checkbox.checked });
                await refreshPlugins();
            } catch (error) {
                checkbox.checked = plugin.enabled;
                throw error;
            } finally {
                checkbox.disabled = false;
            }
        });
        label.append(checkbox, document.createTextNode('启用'));
        row.append(copy, label);
        if (!plugin.builtin)
            row.append(
                button(
                    '卸载',
                    null,
                    async () => {
                        await call('plugin-uninstall', plugin.id);
                        await refreshPlugins();
                    },
                    'quiet'
                )
            );
        $('#plugin-manager').append(row);
    }
    $('#plugin-diagnostics').textContent = result.diagnostics.map((item) => `${item.folder}：${item.error}`).join('\n');
    updateViews();
}
function renderPluginState(plugin) {
    $('#plugin-state').hidden = !plugin || (!plugin.loading && !plugin.error);
    $('#plugin-state-title').textContent = plugin?.error ? '插件暂时无法使用' : '正在打开插件';
    $('#plugin-state-message').textContent = plugin?.error || '';
    $('#plugin-retry').hidden = !plugin?.error;
    if (plugin && !plugin.loading && !plugin.error) requestAnimationFrame(reportPluginBounds);
}
function reportPluginBounds() {
    if ($('#plugins-page').hidden || !tabsState.plugin) return;
    const r = $('#plugin-stage').getBoundingClientRect();
    void call('plugin-bounds', { x: r.x, y: r.y, width: r.width, height: r.height }).catch((error) =>
        toast(error.message)
    );
}
new ResizeObserver(reportPluginBounds).observe($('#plugin-stage'));
$('#plugin-retry').onclick = task(() => call('plugin-reload'));
$('#install-plugin').onclick = task(async () => {
    if (await call('plugin-install')) toast('插件已安装');
    await refreshPlugins();
});
api.onEvent('plugins-changed', () => {
    void refreshPlugins().catch((error) => toast(error.message));
});
document.addEventListener(
    'DOMContentLoaded',
    () => {
        void refreshPlugins().catch((error) => toast(error.message));
    },
    { once: true }
);
