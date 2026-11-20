/* global state, catalogState, $, el, icon, button, call, task, toast, renderPluginIcon, pluginMarketHeader, refresh, selectSettingsPanel, openSettings */
let pluginManagerSignature = '';
const batchUpdates = new Set();
let batchUpdating = false,
    batchUpdateReport = '';
function renderPluginManager() {
    const signature = JSON.stringify({
        plugins: state.plugins.map(
            ({ id, name, description, version, enabled, defaultInstalled, distributable, icon, iconAsset, glyph }) => ({
                id,
                name,
                description,
                version,
                enabled,
                defaultInstalled,
                distributable,
                icon,
                iconAsset,
                glyph
            })
        ),
        restorable: state.restorableDefaults,
        catalog: catalogState.plugins.map((p) => [p.id, p.version, p.compatible]),
        diagnostics: state.diagnostics
    });
    if (signature === pluginManagerSignature) {
        renderPluginCatalog();
        return;
    }
    pluginManagerSignature = signature;
    $('#plugin-manager').replaceChildren();
    const checkUpdates = button('检查插件更新', 'reload', () => managePlugin('plugin-catalog-refresh'), 'subtle');
    checkUpdates.style.gridColumn = '1 / -1';
    $('#plugin-manager').append(checkUpdates);
    const available = catalogState.plugins.filter(
        (remote) =>
            state.plugins.some((p) => p.id === remote.id && comparePluginVersion(remote.version, p.version) > 0) &&
            remote.compatible !== false
    );
    for (const id of batchUpdates) if (!available.some((p) => p.id === id)) batchUpdates.delete(id);
    const updateBar = el('div', 'plugin-update-batch');
    const choose = button(
        '选择全部可更新插件',
        null,
        () => {
            available.forEach((p) => batchUpdates.add(p.id));
            pluginManagerSignature = '';
            renderPluginManager();
        },
        'subtle'
    );
    const update = button(
        `更新已选 ${batchUpdates.size} 项`,
        null,
        async () => {
            if (batchUpdating || pluginBusy) return;
            const queue = available.filter((p) => batchUpdates.has(p.id));
            if (!queue.length) return;
            batchUpdating = true;
            const report = [];
            for (const item of queue) {
                batchUpdateReport = `正在更新 ${item.name} · ${report.length + 1}/${queue.length}`;
                pluginManagerSignature = '';
                renderPluginManager();
                try {
                    await managePlugin('plugin-catalog-install', item.id, true);
                    const installed = state.plugins.find((p) => p.id === item.id);
                    report.push(
                        `${item.name}：${installed && comparePluginVersion(installed.version, item.version) >= 0 ? '成功' : '已取消'}`
                    );
                    batchUpdates.delete(item.id);
                } catch (error) {
                    report.push(`${item.name}：失败，${error.message}`);
                }
            }
            batchUpdating = false;
            batchUpdateReport = report.join('；');
            pluginManagerSignature = '';
            renderPluginManager();
        },
        'primary'
    );
    choose.disabled = update.disabled = batchUpdating;
    updateBar.append(choose, update, el('p', '', batchUpdateReport));
    if (available.length || batchUpdateReport) $('#plugin-manager').append(updateBar);
    for (const plugin of state.plugins) {
        const row = el('article', 'plugin-manager-row plugin-market-card'),
            copy = el('div', 'plugin-card-body'),
            label = el('label', 'plugin-switch'),
            input = document.createElement('input');
        copy.append(
            pluginMarketHeader(plugin, plugin.defaultInstalled ? '默认安装' : '可选插件'),
            el('p', 'plugin-card-description', plugin.description),
            el('small', 'plugin-card-version', `v${plugin.version}`)
        );
        input.type = 'checkbox';
        input.checked = plugin.enabled;
        input.dataset.togglePlugin = plugin.id;
        input.onchange = task(async () => {
            input.disabled = true;
            try {
                const changed = await call('plugin-enable', { id: plugin.id, enabled: input.checked });
                if (changed === false) input.checked = plugin.enabled;
            } catch (error) {
                input.checked = plugin.enabled;
                throw error;
            } finally {
                input.disabled = false;
            }
        });
        input.setAttribute('role', 'switch');
        input.setAttribute('aria-label', plugin.name + ' 启用状态');
        label.append(input, document.createTextNode(plugin.enabled ? '已启用' : '已停用'));
        row.append(copy);
        const actions = el('div', 'plugin-row-actions');
        actions.append(
            button(
                '打开',
                null,
                () => {
                    closeDialogsForPlugin();
                    return call('plugin-open', { id: plugin.id });
                },
                'subtle'
            )
        );
        actions.firstChild.disabled = !plugin.enabled;
        const remote = catalogState.plugins.find((item) => item.id === plugin.id);
        if (remote && comparePluginVersion(remote.version, plugin.version) > 0) {
            const selection = el('input');
            selection.type = 'checkbox';
            selection.checked = batchUpdates.has(plugin.id);
            selection.disabled = batchUpdating || remote.compatible === false;
            selection.setAttribute('aria-label', '选择更新 ' + plugin.name);
            selection.onchange = () => {
                selection.checked ? batchUpdates.add(plugin.id) : batchUpdates.delete(plugin.id);
                pluginManagerSignature = '';
                renderPluginManager();
            };
            actions.append(selection);
            copy.append(el('small', 'plugin-update-hint', `可更新：${plugin.version} → ${remote.version}`));
            const update = button('更新', null, () => managePlugin('plugin-catalog-install', plugin.id), 'primary');
            update.disabled = pluginBusy || remote.compatible === false;
            update.title = remote.compatibilityReason || `更新至 ${remote.version}`;
            actions.append(update);
        }
        const menu = el('div', 'plugin-action-menu');
        menu.setAttribute('popover', 'auto');
        menu.setAttribute('role', 'menu');
        const more = button(
            '更多操作',
            'more',
            () => {
                if (menu.matches(':popover-open')) {
                    menu.hidePopover();
                    return;
                }
                menu.showPopover();
                const anchor = more.getBoundingClientRect();
                const bounds = menu.getBoundingClientRect();
                menu.style.left =
                    Math.max(8, Math.min(anchor.right - bounds.width, innerWidth - bounds.width - 8)) + 'px';
                menu.style.top =
                    (anchor.bottom + bounds.height + 8 < innerHeight
                        ? anchor.bottom + 6
                        : anchor.top - bounds.height - 6) + 'px';
            },
            'icon-button plugin-more'
        );
        more.setAttribute('aria-haspopup', 'menu');
        more.setAttribute('aria-expanded', 'false');
        menu.addEventListener('toggle', () =>
            more.setAttribute('aria-expanded', String(menu.matches(':popover-open')))
        );
        const menuAction = (label, glyph, action, danger = false) => {
            const item = button(
                label,
                glyph,
                () => {
                    menu.hidePopover();
                    return managePlugin(action, plugin.id);
                },
                danger ? 'plugin-remove' : ''
            );
            item.setAttribute('role', 'menuitem');
            menu.append(item);
        };
        if (plugin.distributable) menuAction('导出插件包', 'download', 'plugin-package-export');
        menuAction('卸载插件', 'trash', 'plugin-uninstall', true);
        actions.append(more, menu);
        const footer = el('div', 'plugin-card-footer');
        footer.append(label, actions);
        row.append(footer);
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
async function managePlugin(action, payload, propagateError = false) {
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
        if (propagateError) throw error;
    } finally {
        pluginBusy = false;
        $('#plugin-operation-status').textContent = '';
        document
            .querySelectorAll('#installed-plugins button,#catalog-plugins button,#install-plugin-package')
            .forEach((n) => (n.disabled = false));
        pluginManagerSignature = null;
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
            row = el('article', 'catalog-plugin plugin-market-card'),
            copy = el('div', 'plugin-card-body');
        copy.append(
            pluginMarketHeader(installed || plugin, installed ? '已在工作台' : restorable ? '默认安装' : '可选插件'),
            el('p', 'plugin-card-description', plugin.description)
        );
        const action = button(
            installed ? '检查 / 更新' : '安装',
            null,
            () => managePlugin('plugin-catalog-install', plugin.id),
            installed && !plugin.updateAvailable ? 'subtle' : 'primary'
        );
        const upgradable = installed && comparePluginVersion(plugin.version, installed.version) > 0;
        if (installed) {
            action.textContent = upgradable ? `更新 ${installed.version} → ${plugin.version}` : '已安装';
            action.disabled = !upgradable;
        }
        if (plugin.compatible === false) {
            action.disabled = true;
            action.textContent = '需要升级';
            action.title = plugin.compatibilityReason;
            copy.append(el('p', 'form-error', plugin.compatibilityReason));
        }
        action.disabled = action.disabled || pluginBusy;
        const footer = el('div', 'plugin-card-footer');
        footer.append(
            el('small', 'plugin-card-version', `v${plugin.version} · ${Math.ceil(plugin.size / 1024)} KB`),
            action
        );
        row.append(copy, footer);
        target.append(row);
    }
}
function comparePluginVersion(a, b) {
    const x = a.split('.').map(BigInt),
        y = b.split('.').map(BigInt);
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i] ? 1 : -1;
    return 0;
}
async function openPluginDetails(id) {
    const installed = state.plugins.find((p) => p.id === id),
        remote = catalogState.plugins.find((p) => p.id === id),
        plugin = remote || installed;
    if (!plugin) return;
    const body = $('#plugin-details-body');
    body.replaceChildren();
    const head = el('div', 'plugin-details-heading');
    head.append(
        el('h2', '', plugin.name),
        el(
            'p',
            '',
            `v${plugin.version}${installed ? ' · 已安装 ' + installed.version : ''}${plugin.size ? ' · ' + Math.ceil(plugin.size / 1024) + ' KB' : ''}`
        )
    );
    body.append(head, el('p', '', plugin.description));
    const details = plugin.details || installed?.details || {};
    const section = (title, items) => {
        const heading = el('h3', '', title),
            list = el('ul');
        for (const value of items) list.append(el('li', '', value));
        body.append(heading, list);
    };
    section(
        '功能范围',
        details.features?.length ? details.features : ['发布者暂未提供详细功能说明，请以插件页面与说明文档为准。']
    );
    section(
        '使用限制',
        details.limitations?.length
            ? details.limitations
            : ['未提供格式限制详情，安装前请确认是否适合自己的文件和系统。']
    );
    const permissions = details.permissions || installed?.permissions;
    section(
        '权限',
        permissions?.length
            ? permissions.map(
                  (p) =>
                      ({
                          native: '可信原生后台：可访问本机文件并运行本地程序',
                          'clipboard.read': '主动读取剪贴板',
                          'clipboard.write': '写入剪贴板',
                          storage: '隔离本地存储',
                          background: '后台页面',
                          'clipboard.background': '后台剪贴板采集',
                          window: '插件独立窗口',
                          'desktop.paste': '向前台应用执行粘贴'
                      })[p] || p
              )
            : permissions
              ? ['无额外权限。']
              : ['目录未声明权限；安装确认以实际包清单为准。']
    );
    body.append(
        el(
            'p',
            'plugin-detail-requirements',
            `最低宿主：${plugin.minHostVersion || '未额外声明'} · 支持系统：${plugin.platforms?.join(' / ') || '未限制（不代表均已验证）'}`
        )
    );
    section(
        '平台验证',
        details.verification?.length
            ? details.verification.map(
                  (v) =>
                      `${{ win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[v.platform]} · ${{ local: '本机验证', ci: 'CI 验证', unverified: '尚未实测' }[v.status]} · ${v.date}：${v.scope}`
              )
            : ['发布者尚未提供逐平台验证记录。']
    );
    section('版本说明', details.changelog?.length ? details.changelog : ['未提供单独的版本说明。']);
    if (details.screenshots?.length) {
        body.append(el('h3', '', '界面预览'));
        for (const source of details.screenshots) {
            const image = el('img', 'plugin-detail-screenshot');
            image.src = source;
            image.alt = plugin.name + ' 界面预览';
            image.loading = 'lazy';
            body.append(image);
        }
    }
    const action = $('#plugin-details-action'),
        update = remote && installed && comparePluginVersion(remote.version, installed.version) > 0;
    action.textContent = installed
        ? update
            ? '更新到 ' + remote.version
            : installed.enabled
              ? '打开插件'
              : '启用并打开'
        : '安装插件';
    action.disabled = plugin.compatible === false || pluginBusy;
    action.onclick = task(async () => {
        action.disabled = true;
        try {
            if (!installed || update) {
                await managePlugin('plugin-catalog-install', id);
                if (state.plugins.some((p) => p.id === id)) await openPluginDetails(id);
                else action.disabled = false;
            } else {
                if (!installed.enabled) {
                    const result = await call('plugin-enable', { id, enabled: true });
                    if (result === false) {
                        action.disabled = false;
                        return;
                    }
                }
                closeDialogsForPlugin();
                await call('plugin-open', { id });
            }
        } catch (error) {
            action.disabled = false;
            throw error;
        }
    });
    $('#plugin-details-close').onclick = () => $('#plugin-details-dialog').close();
    await withDialogTransition(async () => {
        if (!$('#plugin-details-dialog').open) $('#plugin-details-dialog').showModal();
    });
}
