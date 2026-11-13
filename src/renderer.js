const $ = (selector) => document.querySelector(selector);
const api = window.workbench;
let resolveShellReady;
const shellReady = new Promise((resolve) => {
    resolveShellReady = resolve;
});
let state = { plugins: [], settings: {} },
    toastTimer,
    selectedPlugin = null,
    transferDraft = null,
    transferMode = 'export';
let catalogState = { source: '', plugins: [], loaded: false },
    pluginBusy = false;
const paths = {
    layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    pin: '<path d="m16 3 5 5-4 1-4 4-1 4-5-5 4-1 4-4 1-4ZM7 17l-4 4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    folder: '<path d="M3 7V5a2 2 0 0 1 2-2h4l3 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    bookmark: '<path d="M6 4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17l-6-4-6 4V4Z"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    list: '<path d="M9 5h12M9 12h12M9 19h12M3 5h1M3 12h1M3 19h1"/>',
    sort: '<path d="M4 6h16M4 12h11M4 18h6"/>',
    external: '<path d="M14 3h7v7M21 3 11 13M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/>',
    arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
    copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
    edit: '<path d="m16 3 5 5L8 21H3v-5L16 3ZM13 6l5 5"/>',
    trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
    game: '<path d="M7 6h10a4 4 0 0 1 4 4l1 7a2 2 0 0 1-3 2l-3-3H8l-3 3a2 2 0 0 1-3-2l1-7a4 4 0 0 1 4-4Z"/><path d="M7 9v5M4.5 11.5h5M16 10h.1M19 13h.1"/>',
    build: '<path d="m14 3 7 7M12 5l7 7M9 8l7 7M3 21l8-8M13 4l2-2 8 8-2 2M4 16l4 4"/>',
    link: '<path d="m10 13 4-4M8 16l-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0M14 8l2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" transform="translate(1 -1) scale(.9)"/>',
    chart: '<path d="M3 3v18h18M7 16v-5M12 16V7M17 16v-9"/>',
    server: '<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.1M7 17.5h.1M15 6.5h3M15 17.5h3"/>',
    book: '<path d="M12 5v16M12 5C8 2 4 3 2 4v15c4-2 7-1 10 2 3-3 6-4 10-2V4c-2-1-6-2-10 1Z"/>',
    lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3"/>',
    globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
    sliders: '<path d="M3 6h4m4 0h10M3 18h10m4 0h4"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="18" r="2"/>',
    gear: '<path d="m9 3-1 3-3 1 1 3-2 2 2 2-1 3 3 1 1 3h6l1-3 3-1-1-3 2-2-2-2 1-3-3-1-1-3Z"/><circle cx="12" cy="12" r="3"/>',
    left: '<path d="m15 5-7 7 7 7"/>',
    right: '<path d="m9 5 7 7-7 7"/>',
    reload: '<path d="M20 8a9 9 0 1 0 0 8M20 3v5h-5"/>',
    up: '<path d="m6 13 6-6 6 6M12 7v14"/>',
    down: '<path d="m6 11 6 6 6-6M12 3v14"/>',
    upload: '<path d="M12 16V3m-5 5 5-5 5 5M3 15v6h18v-6"/>',
    download: '<path d="M12 3v13m-5-5 5 5 5-5M3 18v3h18v-3"/>'
};

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

function icon(name) {
    const node = el('i');
    // 图标仅使用固定源码；收藏名称、网址和备注始终通过 textContent 写入。
    node.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.link}</svg>`;
    return node;
}

async function call(action, payload) {
    const result = await api.call(action, payload);
    if (!result.ok) throw Error(result.error);
    return result.data;
}
function task(fn) {
    return async (...args) => {
        try {
            await fn(...args);
        } catch (error) {
            toast(error.message);
        }
    };
}

function toast(message, undo) {
    $('#toast').replaceChildren(el('span', '', message));
    if (undo) $('#toast').append(button('撤销', null, undo));
    $('#toast').hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(
        () => {
            $('#toast').hidden = true;
        },
        undo ? 7000 : 3500
    );
}

function button(label, glyph, handler, className = '') {
    const node = el('button', className);
    node.type = 'button';
    node.title = label;
    node.setAttribute('aria-label', label);
    if (glyph) node.append(icon(glyph));
    if (!className.includes('icon-button')) node.append(document.createTextNode(label));
    node.onclick = task(handler);
    return node;
}

function hideMenu() {}
function closeDialogsForPlugin() {
    appearanceParent = null;
    document.querySelectorAll('dialog[open]').forEach((dialog) => dialog.close());
}
let dialogTransitions = 0;
function syncOverlayState() {
    // theme 的 close 事件可能晚于其他已关闭窗口的 close；返回设置的意图仍需保留遮罩。
    return call(
        'overlay',
        dialogTransitions > 0 || appearanceParent !== null || !!document.querySelector('dialog[open]')
    );
}
async function withDialogTransition(action) {
    dialogTransitions++;
    try {
        await syncOverlayState();
        return await action();
    } finally {
        dialogTransitions--;
        await syncOverlayState();
    }
}
function renderShell(next) {
    state = next;
    const collapsed = state.settings.navigationCollapsed === true;
    document.body.classList.toggle('navigation-collapsed', collapsed);
    $('#toggle-navigation').setAttribute('aria-expanded', String(!collapsed));
    $('#toggle-navigation').setAttribute('aria-label', collapsed ? '展开导航' : '收起导航');
    $('#toggle-navigation').title = collapsed ? '展开导航' : '收起导航';
    $('#expand-navigation').setAttribute('aria-expanded', String(!collapsed));
    $('.plugin-context').inert = collapsed;
    if (!$('#theme-dialog').open) ShiyueTheme.apply(state.settings.theme);
    const enabled = state.plugins.filter((p) => p.enabled),
        query = $('#plugin-search').value.trim().toLowerCase();
    const railScroll = $('#plugin-rail').scrollTop;
    $('#plugin-rail').replaceChildren();
    for (const plugin of enabled.filter((p) => [p.name, p.description].some((s) => s.toLowerCase().includes(query)))) {
        const node = button(plugin.name, null, () => call('plugin-open', { id: plugin.id }), 'plugin-entry');
        node.dataset.pluginId = plugin.id;
        node.classList.toggle('selected', state.active?.id === plugin.id);
        node.setAttribute('aria-pressed', String(state.active?.id === plugin.id));
        node.replaceChildren(el('span', 'plugin-glyph', plugin.glyph), el('span', 'plugin-name', plugin.name));
        if (plugin.iconAsset) {
            const glyph = node.querySelector('.plugin-glyph');
            const image = el('img', 'plugin-asset-icon');
            image.src = `../assets/${encodeURIComponent(plugin.iconAsset)}`;
            image.alt = '';
            image.draggable = false;
            glyph.replaceChildren(image);
        }
        $('#plugin-rail').append(node);
    }
    $('#plugin-rail').scrollTop = railScroll;
    const active = state.plugins.find((p) => p.id === state.active?.id);
    $('#navigation-title').textContent = active?.name || '工作台';
    $('#navigation-description').textContent = active?.description || '启用所需的插件';
    $('#plugin-title').textContent = active?.name || 'Collectify';
    $('#plugin-navigation').replaceChildren();
    let group;
    for (const item of active?.navigation || []) {
        if (item.group && item.group !== group) {
            group = item.group;
            $('#plugin-navigation').append(el('div', 'navigation-group', group));
        }
        const node = button(
            item.label,
            null,
            () => call('plugin-open', { id: active.id, route: item.id }),
            'plugin-subnav'
        );
        node.dataset.route = item.id;
        node.classList.toggle('selected', state.active.route === item.id);
        if (item.count !== undefined) node.append(el('small', '', item.count));
        $('#plugin-navigation').append(node);
        node.draggable = item.draggable === true;
        node.ondragstart = (event) => {
            if (item.dragData)
                event.dataTransfer.setData(
                    'application/collectify-plugin',
                    JSON.stringify({ pluginId: active.id, data: item.dragData })
                );
        };
        node.ondragover = (event) => event.preventDefault();
        node.ondrop = task(async (event) => {
            event.preventDefault();
            try {
                const drag = JSON.parse(event.dataTransfer.getData('application/collectify-plugin'));
                if (drag.pluginId === active.id)
                    await call('plugin-open', { id: active.id, route: item.id, data: { drag: drag.data } });
            } catch (error) {
                toast(error.message);
            }
        });
    }
    $('#route-title').textContent = active?.navigation.find((n) => n.id === state.active.route)?.label || '';
    const failed = !!state.active?.error,
        loading = !!state.active?.loading;
    $('#plugin-state').hidden = !!state.active && !failed && !loading;
    $('#plugin-state-title').textContent = failed
        ? '插件暂时无法使用'
        : loading
          ? '正在打开插件'
          : '你的工作台，由插件组成';
    $('#plugin-state-message').textContent =
        state.active?.error || (!state.active ? '启用需要的插件，所有功能都从这里开始。' : '');
    $('#plugin-retry').hidden = !failed;
    $('#enable-plugins').hidden = !!state.active;
    renderPluginManager();
    requestAnimationFrame(reportBounds);
}
function renderPluginManager() {
    $('#plugin-manager').replaceChildren();
    for (const plugin of state.plugins) {
        const row = el('div', 'plugin-manager-row'),
            copy = el('div'),
            label = el('label', 'plugin-switch'),
            input = document.createElement('input');
        copy.append(
            el('strong', '', plugin.name),
            el('p', '', plugin.description),
            el('small', '', `${plugin.builtin ? '默认插件' : '本地插件'} · ${plugin.version}`)
        );
        input.type = 'checkbox';
        input.checked = plugin.enabled;
        input.dataset.togglePlugin = plugin.id;
        input.onchange = task(async () => {
            input.disabled = true;
            try {
                await call('plugin-enable', { id: plugin.id, enabled: input.checked });
            } catch (error) {
                input.checked = plugin.enabled;
                throw error;
            } finally {
                input.disabled = false;
            }
        });
        label.append(input, document.createTextNode('启用'));
        row.append(copy, label);
        const actions = el('div', 'plugin-row-actions');
        actions.append(
            button(
                '打开',
                null,
                () => {
                    closeDialogsForPlugin();
                    return call('plugin-open', { id: plugin.id });
                },
                'quiet'
            )
        );
        actions.firstChild.disabled = !plugin.enabled;
        if (plugin.distributable)
            actions.append(button('导出插件包', null, () => managePlugin('plugin-package-export', plugin.id), 'quiet'));
        actions.append(button('卸载', null, () => managePlugin('plugin-uninstall', plugin.id), 'quiet'));
        row.append(actions);
        $('#plugin-manager').append(row);
    }
    $('#restore-plugins').replaceChildren();
    if (state.restorableDefaults?.length) {
        $('#restore-plugins').append(el('h4', '', '恢复默认插件'));
        for (const plugin of state.restorableDefaults) {
            const row = el('div', 'plugin-manager-row'),
                copy = el('div');
            copy.append(el('strong', '', plugin.name), el('small', '', plugin.description));
            row.append(
                copy,
                button('恢复', null, () => managePlugin('plugin-restore', plugin.id), 'subtle')
            );
            $('#restore-plugins').append(row);
        }
    }
    $('#plugin-diagnostics').textContent = state.diagnostics?.map((d) => d.folder + '：' + d.error).join('\n') || '';
    renderPluginCatalog();
}
async function managePlugin(action, payload) {
    if (pluginBusy) return;
    pluginBusy = true;
    $('#plugin-operation-error').textContent = '';
    $('#plugin-operation-status').textContent =
        action === 'plugin-catalog-refresh'
            ? '正在读取插件目录…'
            : action === 'plugin-catalog-install'
              ? '正在下载并校验插件包…'
              : '正在处理…';
    document
        .querySelectorAll('#installed-plugins button,#catalog-plugins button,#install-plugin-package')
        .forEach((n) => (n.disabled = true));
    try {
        const result = await call(action, payload);
        if (action.startsWith('plugin-catalog-') && action !== 'plugin-catalog-install') catalogState = result;
        await refresh();
        if (result !== null && result !== false)
            toast(
                action === 'plugin-package-export'
                    ? '插件包已导出'
                    : action === 'plugin-catalog-refresh'
                      ? '目录已刷新'
                      : '操作已完成'
            );
        return result;
    } catch (error) {
        $('#plugin-operation-error').textContent = error.message;
    } finally {
        pluginBusy = false;
        $('#plugin-operation-status').textContent = '';
        document
            .querySelectorAll('#installed-plugins button,#catalog-plugins button,#install-plugin-package')
            .forEach((n) => (n.disabled = false));
        renderPluginManager();
    }
}
function renderPluginCatalog() {
    const target = $('#plugin-catalog-list');
    target.replaceChildren();
    if (document.activeElement !== $('#plugin-catalog-url')) $('#plugin-catalog-url').value = catalogState.source;
    $('#plugin-catalog-status').textContent = catalogState.loaded
        ? `目录提供 ${catalogState.plugins.length} 个插件 · ${new Date(catalogState.updatedAt).toLocaleString()}`
        : catalogState.source
          ? '首次进入时读取目录，也可点击刷新重新加载。'
          : '尚未配置在线目录，可以先使用“安装插件包”。';
    const query = $('#catalog-search').value.trim().toLowerCase(),
        items = catalogState.plugins.filter((p) =>
            [p.name, p.description, p.id].some((s) => s.toLowerCase().includes(query))
        );
    if (catalogState.loaded && !items.length) target.append(el('p', 'plugin-empty', '没有匹配的插件'));
    for (const plugin of items) {
        const installed = state.plugins.find((p) => p.id === plugin.id),
            restorable = state.restorableDefaults?.some((p) => p.id === plugin.id),
            row = el('article', 'catalog-plugin'),
            copy = el('div');
        copy.append(
            el('strong', '', plugin.name),
            el('p', '', plugin.description),
            el('small', '', `${plugin.id} · v${plugin.version} · ${Math.ceil(plugin.size / 1024)} KB`)
        );
        const action = button(
            restorable ? '恢复默认插件' : installed ? '检查 / 更新' : '安装',
            null,
            () => managePlugin(restorable ? 'plugin-restore' : 'plugin-catalog-install', plugin.id),
            'subtle'
        );
        const upgradable = installed && comparePluginVersion(plugin.version, installed.version) > 0;
        if (installed) {
            action.textContent = installed.builtin
                ? '随 Collectify 更新'
                : upgradable
                  ? `更新 ${installed.version} → ${plugin.version}`
                  : '已安装';
            action.disabled = installed.builtin || !upgradable;
        }
        action.disabled = action.disabled || pluginBusy;
        row.append(copy, action);
        target.append(row);
    }
}
function comparePluginVersion(a, b) {
    const x = a.split('.').map(BigInt),
        y = b.split('.').map(BigInt);
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
    return 0;
}
async function refresh() {
    renderShell(await call('state'));
}
function reportBounds() {
    const r = $('#plugin-stage').getBoundingClientRect();
    void call('plugin-bounds', { x: r.x, y: r.y, width: r.width, height: r.height }).catch((error) =>
        toast(error.message)
    );
}
new ResizeObserver(reportBounds).observe($('#plugin-stage'));
window.addEventListener('resize', reportBounds);
api.onEvent('shell-state', renderShell);
$('#plugin-search').oninput = () => renderShell(state);
document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        $('#plugin-search').focus();
    }
});
$('#plugin-retry').onclick = task(() => call('plugin-reload'));
$('#shell-home').onclick = () => void openSettings('plugins');
$('#enable-plugins').onclick = () => void openSettings('plugins');
function selectSettingsPanel(panel) {
    document.querySelectorAll('.settings-panel').forEach((n) => (n.hidden = n.dataset.panel !== panel));
    document
        .querySelectorAll('[data-settings-panel]')
        .forEach((n) => n.classList.toggle('selected', n.dataset.settingsPanel === panel));
}
async function openSettings(panel = 'general') {
    return withDialogTransition(async () => {
        const info = await call('workspace-info');
        $('#app-version').textContent = info.version;
        $('#data-file').textContent = info.file;
        $('#data-directory').textContent = info.directory;
        $('#keep-in-tray').checked = state.settings.keepInTray;
        $('#browser-open-mode').value = state.settings.browserOpenMode || 'internal';
        $('#mcp-port').value = info.mcp.port;
        renderMcpStatus(info.mcp);
        catalogState = await call('plugin-catalog-status');
        renderPluginCatalog();
        selectSettingsPanel(typeof panel === 'string' ? panel : 'general');
        $('#settings-error').textContent = '';
        $('#settings-dialog').showModal();
    });
}
document
    .querySelectorAll('[data-settings-panel]')
    .forEach((n) => (n.onclick = () => selectSettingsPanel(n.dataset.settingsPanel)));
$('#settings-button').onclick = task(() => openSettings());
$('#collapsed-settings-button').onclick = task(() => openSettings());
$('#expand-navigation').onclick = task(() => call('settings', { navigationCollapsed: false }));
$('#toggle-navigation').onclick = task(() =>
    call('settings', { navigationCollapsed: !state.settings.navigationCollapsed })
);
$('#browser-open-mode').onchange = task(() => call('settings', { browserOpenMode: $('#browser-open-mode').value }));
$('#install-plugin').onclick = () => managePlugin('plugin-install');
$('#install-plugin-package').onclick = () => managePlugin('plugin-package-install');
$('#save-plugin-catalog').onclick = () => managePlugin('plugin-catalog-configure', $('#plugin-catalog-url').value);
$('#refresh-plugin-catalog').onclick = () => managePlugin('plugin-catalog-refresh');
$('#official-plugin-catalog').onclick = task(async () => {
    const result = await managePlugin('plugin-catalog-configure', '');
    if (result) await managePlugin('plugin-catalog-refresh');
});
$('#catalog-search').oninput = renderPluginCatalog;
document.querySelectorAll('[data-plugin-tab]').forEach(
    (node) =>
        (node.onclick = task(async () => {
            const installed = node.dataset.pluginTab === 'installed';
            $('#installed-plugins').hidden = !installed;
            $('#catalog-plugins').hidden = installed;
            document.querySelectorAll('[data-plugin-tab]').forEach((n) => n.classList.toggle('selected', n === node));
            if (!installed && !catalogState.loaded) await managePlugin('plugin-catalog-refresh');
        }))
);
$('#open-data-directory').onclick = task(() => call('open-data-directory'));
$('#keep-in-tray').onchange = task(() =>
    call('settings', { ...state.settings, keepInTray: $('#keep-in-tray').checked })
);
function renderMcpStatus(status) {
    $('#mcp-status').textContent = status.enabled ? '已开启 · ' + status.url : '未开启';
    $('#mcp-start').disabled = status.enabled;
    $('#mcp-stop').disabled = !status.enabled;
    $('#mcp-copy').disabled = !status.enabled;
}
$('#mcp-start').onclick = task(async () =>
    renderMcpStatus(await call('mcp-start', { port: Number($('#mcp-port').value) }))
);
$('#mcp-stop').onclick = task(async () => renderMcpStatus(await call('mcp-stop')));
$('#mcp-copy').onclick = task(async () => {
    await call('mcp-copy');
    toast('连接配置已复制');
});
document.querySelectorAll('dialog').forEach((dialog) => {
    dialog
        .querySelectorAll('.dialog-close,.cancel-dialog')
        .forEach((button) => (button.onclick = () => dialog.close()));
    dialog.addEventListener('close', () => {
        // 在一次回调内先完成返回上一级等动作，再计算原生插件视图是否可以恢复。
        // 浏览器可在原生事件的两个监听器之间执行微任务，不能依赖监听器注册顺序。
        dialog.dispatchEvent(new Event('workspace-dialog-closed'));
        queueMicrotask(() => void syncOverlayState().catch((error) => toast(error.message)));
    });
});
async function openTransfer(mode) {
    transferMode = mode;
    transferDraft = null;
    if (mode === 'import') {
        transferDraft = await call('import-preview');
        if (!transferDraft) return;
    }
    return withDialogTransition(async () => {
        $('#settings-dialog').close();
        $('#transfer-error').textContent = '';
        $('#transfer-options').replaceChildren();
        const ids = transferDraft?.ids || (state.dataPlugins || state.plugins).map((p) => p.id);
        for (const id of ids) {
            const plugin = state.plugins.find((p) => p.id === id),
                label = el('label'),
                input = document.createElement('input'),
                copy = el('span');
            input.type = 'checkbox';
            input.value = id;
            input.checked = true;
            copy.append(el('strong', '', plugin?.name || id), el('small', '', plugin ? id : '未安装 · 保留的数据'));
            label.append(input, copy);
            $('#transfer-options').append(label);
        }
        $('#transfer-title').textContent = mode === 'export' ? '导出数据' : '导入数据';
        $('#transfer-file-summary').textContent = transferDraft?.name || '';
        $('#transfer-settings').disabled = mode === 'import' && !transferDraft.settings;
        $('#transfer-settings').checked = !$('#transfer-settings').disabled;
        $('#transfer-mode-label').hidden = mode !== 'import';
        $('#transfer-credentials').parentElement.hidden = mode !== 'export';
        $('#transfer-confirm').textContent = mode === 'export' ? '导出' : '确认导入';
        $('#transfer-dialog').showModal();
    });
}
$('#settings-export').onclick = task(() => openTransfer('export'));
$('#settings-import').onclick = task(() => openTransfer('import'));
$('#transfer-confirm').onclick = async () => {
    const button = $('#transfer-confirm');
    button.disabled = true;
    try {
        const ids = [...$('#transfer-options').querySelectorAll('input:checked')].map((n) => n.value),
            options = { ids, settings: $('#transfer-settings').checked };
        const result = await call(
            transferMode === 'export' ? 'export' : 'import',
            transferMode === 'export'
                ? { ...options, includeCredentials: $('#transfer-credentials').checked }
                : { ...options, token: transferDraft.token, mode: $('#transfer-mode').value }
        );
        if (result !== null) {
            $('#transfer-dialog').close();
            await refresh();
            toast('所选内容已处理');
        }
    } catch (error) {
        $('#transfer-error').textContent = error.message;
    } finally {
        button.disabled = false;
    }
};
document.addEventListener(
    'DOMContentLoaded',
    () =>
        void task(async () => {
            try {
                await refresh();
                const enabled = state.plugins.filter((p) => p.enabled);
                if (!state.active && enabled.length)
                    await call('plugin-open', {
                        id: enabled.find((p) => p.id === state.lastPlugin)?.id || enabled[0].id
                    });
            } finally {
                resolveShellReady();
            }
        })()
);
