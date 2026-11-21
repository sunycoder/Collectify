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
const pluginIcons = new Map();
function renderPluginIcon(plugin, glyph, includeDisabled = false) {
    const key = `${plugin.id}@${plugin.version}:${plugin.icon}`;
    const display = (source) => {
        if (!source || !glyph.isConnected) return;
        const image = el(
            'img',
            glyph.classList.contains('plugin-card-logo') ? 'plugin-card-image' : 'plugin-asset-icon'
        );
        image.src = source;
        image.alt = '';
        image.draggable = false;
        image.onerror = () => {
            if (glyph.isConnected) glyph.textContent = plugin.glyph;
        };
        glyph.replaceChildren(image);
    };
    const cached = pluginIcons.get(key);
    if (typeof cached === 'string') {
        display(cached);
        return;
    }
    const pending = cached || call('plugin-icon', { id: plugin.id, includeDisabled });
    pluginIcons.set(key, pending);
    pending
        .then((source) => {
            pluginIcons.set(key, source);
            display(source);
        })
        .catch(() => {
            if (pluginIcons.get(key) === pending) pluginIcons.delete(key);
        });
}
// 市场与导航共用插件自己的图标；旧目录和损坏图片仍显示可辨认的文字图标。
function pluginMarketHeader(plugin, badge) {
    const header = el('div', 'plugin-card-header'),
        logo = el('div', 'plugin-card-logo', plugin.glyph || plugin.name.slice(0, 1)),
        title = el('div', 'plugin-card-title');
    if (plugin.iconData || plugin.iconAsset) {
        const image = el('img');
        image.src = plugin.iconData || `../assets/${plugin.iconAsset}`;
        image.alt = '';
        image.draggable = false;
        image.onerror = () => logo.replaceChildren(document.createTextNode(plugin.glyph || plugin.name.slice(0, 1)));
        logo.replaceChildren(image);
    }
    title.append(el('strong', '', plugin.name), el('span', 'plugin-card-badge', badge));
    const info = button('详情', null, () => openPluginDetails(plugin.id), 'plugin-info-button');
    info.setAttribute('aria-label', plugin.name + ' 详情');
    header.append(logo, title, info);
    // 连接 DOM 后再交付异步图标，避免快速切换设置页时更新过期节点。
    if (plugin.icon) queueMicrotask(() => renderPluginIcon(plugin, logo, true));
    return header;
}
const paths = {
    layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    pin: '<path d="m16 3 5 5-4 1-4 4-1 4-5-5 4-1 4-4 1-4ZM7 17l-4 4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    folder: '<path d="M3 7V5a2 2 0 0 1 2-2h4l3 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    bookmark: '<path d="M6 4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17l-6-4-6 4V4Z"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    table: '<rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18M3 15h18M9 9v12M15 9v12"/>',
    'file-text':
        '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6M8 13h8M8 17h6"/>',
    'file-pdf':
        '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z"/><path d="M14 3v6h6M7 17h3m-3 0v-5h2a1.5 1.5 0 0 1 0 3H7m7-3v5m0-5h3m-3 2h2"/>',
    presentation: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M12 17v5m-5 0 5-3 5 3M8 12l3-3 3 2 3-3"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m4 17 5-5 4 4 3-3 5 5"/>',
    video: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m10 8 6 4-6 4Z"/>',
    music: '<path d="M9 17V5l11-2v12M9 9l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="17" cy="16" rx="3" ry="2"/>',
    archive: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M10 3v3h4V3m-4 6h4m-4 3h4m-4 4h4v3h-4Z"/>',
    code: '<path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 18"/>',
    filter: '<path d="M3 4h18l-7 8v7l-4 2v-9Z"/>',
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
    document.querySelectorAll('dialog[open]').forEach((dialog) => dialog.close());
}
let dialogTransitions = 0;
function syncOverlayState() {
    // theme 的 close 事件可能晚于其他已关闭窗口的 close；返回设置的意图仍需保留遮罩。
    return call('overlay', dialogTransitions > 0 || !!document.querySelector('dialog[open]'));
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
const singleNavigationExpanded = new Set();
let railSignature = '',
    navigationSignature = '',
    shellThemeSignature = '';
function renderShell(next) {
    state = next;
    const activeNavigation = state.plugins.find((plugin) => plugin.id === state.active?.id)?.navigation || [];
    const collapsed =
        state.settings.navigationCollapsed === true ||
        (activeNavigation.length <= 1 && !!state.active && !singleNavigationExpanded.has(state.active.id));
    document.body.classList.toggle('navigation-collapsed', collapsed);
    $('#toggle-navigation').setAttribute('aria-expanded', String(!collapsed));
    $('#toggle-navigation').setAttribute('aria-label', collapsed ? '展开导航' : '收起导航');
    $('#toggle-navigation').title = collapsed ? '展开导航' : '收起导航';
    $('#expand-navigation').setAttribute('aria-expanded', String(!collapsed));
    $('.plugin-context').inert = collapsed;
    const themeKey = JSON.stringify(state.settings.theme);
    if ($('#theme-dialog').hidden && themeKey !== shellThemeSignature) {
        ShiyueTheme.apply(state.settings.theme);
        shellThemeSignature = themeKey;
    }
    const enabled = state.plugins.filter((p) => p.enabled);
    const railKey = JSON.stringify(
        enabled.map(({ id, name, version, icon, iconAsset, glyph }) => ({ id, name, version, icon, iconAsset, glyph }))
    );
    if (railKey !== railSignature) {
        finishPluginDrag?.();
        railSignature = railKey;
        const currentIcons = new Set(state.plugins.map((p) => `${p.id}@${p.version}:${p.icon}`));
        for (const key of pluginIcons.keys()) if (!currentIcons.has(key)) pluginIcons.delete(key);
        const railScroll = $('#plugin-rail').scrollTop;
        $('#plugin-rail').replaceChildren();
        for (const plugin of enabled) {
            const node = button(plugin.name, null, () => call('plugin-open', { id: plugin.id }), 'plugin-entry');
            node.dataset.pluginId = plugin.id;
            node.title = plugin.name + ' · 拖动调整顺序；Alt + ↑ / ↓ 移动';
            node.setAttribute('aria-keyshortcuts', 'Alt+ArrowUp Alt+ArrowDown');
            node.classList.toggle('selected', state.active?.id === plugin.id);
            node.setAttribute('aria-pressed', String(state.active?.id === plugin.id));
            node.replaceChildren(el('span', 'plugin-glyph', plugin.glyph), el('span', 'plugin-name', plugin.name));
            $('#plugin-rail').append(node);
            if (plugin.icon) {
                // 挂接到 DOM 后再展示异步图标；失败时保留清单中的文字后备图标。
                renderPluginIcon(plugin, node.querySelector('.plugin-glyph'));
            } else if (plugin.iconAsset) {
                const glyph = node.querySelector('.plugin-glyph');
                const image = el('img', 'plugin-asset-icon');
                image.src = `../assets/${encodeURIComponent(plugin.iconAsset)}`;
                image.alt = '';
                image.draggable = false;
                glyph.replaceChildren(image);
            }
        }
        $('#plugin-rail').scrollTop = railScroll;
    }
    for (const node of $('#plugin-rail').children) {
        const selected = node.dataset.pluginId === state.active?.id;
        node.classList.toggle('selected', selected);
        node.setAttribute('aria-pressed', String(selected));
    }
    const active = state.plugins.find((p) => p.id === state.active?.id);
    $('#navigation-title').textContent = active?.name || '工作台';
    $('#navigation-description').textContent = active?.description || '启用所需的插件';
    $('#plugin-title').textContent = active?.name || 'Collectify';
    const navigationKey = JSON.stringify([active?.id, active?.navigation]);
    if (navigationKey !== navigationSignature) {
        navigationSignature = navigationKey;
        $('#plugin-navigation').replaceChildren();
        let group;
        for (const item of active?.navigation || []) {
            if (item.group && item.group !== group) {
                group = item.group;
                $('#plugin-navigation').append(el('div', 'navigation-group', group));
            }
            const node = button(
                item.label,
                item.icon || null,
                () => call('plugin-open', { id: active.id, route: item.id }),
                'plugin-subnav'
            );
            node.dataset.route = item.id;
            if (item.icon) {
                node.classList.add('has-icon');
                const label = el('span', 'subnav-label', item.label);
                node.replaceChildren(icon(item.icon), label);
            }
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
    }
    for (const node of $('#plugin-navigation').querySelectorAll('[data-route]'))
        node.classList.toggle('selected', state.active?.route === node.dataset.route);
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
    renderPluginTasks();
    requestAnimationFrame(reportBounds);
}
let taskListSignature = '';
function renderPluginTasks() {
    const tasks = state.tasks || [];
    $('#plugin-tasks-open').hidden = !tasks.length;
    $('#plugin-tasks-open').textContent = `${tasks.length} 个任务运行中`;
    const signature = JSON.stringify(tasks);
    if (signature === taskListSignature) return;
    taskListSignature = signature;
    const target = $('#plugin-tasks-list');
    target.replaceChildren();
    if (!tasks.length) {
        target.append(el('p', 'plugin-empty', '当前没有运行中的任务'));
        return;
    }
    for (const taskInfo of tasks) {
        const row = el('article', 'host-task-row'),
            copy = el('div');
        copy.append(el('strong', '', taskInfo.title), el('small', '', taskInfo.pluginName));
        const progress = el('progress');
        progress.max = 1;
        if (taskInfo.progress !== null) progress.value = taskInfo.progress;
        progress.setAttribute(
            'aria-label',
            taskInfo.progress === null ? '正在处理，进度未知' : Math.round(taskInfo.progress * 100) + '%'
        );
        copy.append(progress);
        row.append(
            copy,
            button(
                '查看',
                null,
                async () => {
                    closeDialogsForPlugin();
                    await call('plugin-open', { id: taskInfo.pluginId });
                },
                'subtle'
            )
        );
        if (taskInfo.cancellable)
            row.append(
                button(
                    '取消任务',
                    null,
                    async () => {
                        await call('plugin-task-cancel', { pluginId: taskInfo.pluginId, id: taskInfo.id });
                        toast('已请求取消：' + taskInfo.title);
                        await refresh();
                    },
                    'subtle'
                )
            );
        target.append(row);
    }
}
$('#plugin-tasks-open').onclick = () => withDialogTransition(async () => $('#plugin-tasks-dialog').showModal());
async function refresh() {
    renderShell(await call('state'));
}
function reportBounds() {
    const r = $('#plugin-stage').getBoundingClientRect();
    void call('plugin-bounds', { x: r.x, y: r.y, width: r.width, height: r.height }).catch((error) =>
        toast(error.message)
    );
}
// 导航排序由宿主管理，拖动整个入口，不向插件传递业务拖放数据。
let pluginDrag = null,
    pluginDragFrame = null,
    pluginDragClickUntil = 0,
    pluginOrderBusy = false;
function finishPluginDrag() {
    if (pluginDragFrame) cancelAnimationFrame(pluginDragFrame);
    pluginDragFrame = null;
    if (pluginDrag) {
        pluginDrag.node.classList.remove('sorting-source');
        pluginDrag.ghost?.remove();
        try {
            $('#plugin-rail').releasePointerCapture(pluginDrag.pointerId);
        } catch {}
        pluginDrag = null;
    }
    document
        .querySelectorAll('#plugin-rail .sort-before,#plugin-rail .sort-after')
        .forEach((n) => n.classList.remove('sort-before', 'sort-after'));
    document.body.classList.remove('plugin-sorting');
}
async function moveRailPlugin(id, targetId, placement, keyboard = false) {
    if (pluginOrderBusy) return;
    pluginOrderBusy = true;
    try {
        await call('plugin-move', { id, targetId, placement });
        await refresh();
        toast('插件顺序已保存');
        if (keyboard) [...$('#plugin-rail').children].find((n) => n.dataset.pluginId === id)?.focus();
    } catch (error) {
        toast('排序未保存：' + error.message);
        await refresh();
    } finally {
        pluginOrderBusy = false;
    }
}
function updatePluginDrag() {
    const drag = pluginDrag;
    if (!drag?.active) return;
    const rail = $('#plugin-rail'),
        rect = rail.getBoundingClientRect();
    if (drag.y < rect.top + 36) rail.scrollTop -= Math.max(2, (rect.top + 36 - drag.y) / 4);
    else if (drag.y > rect.bottom - 36) rail.scrollTop += Math.max(2, (drag.y - rect.bottom + 36) / 4);
    drag.ghost.style.top = drag.y - drag.offset + 'px';
    document
        .querySelectorAll('#plugin-rail .sort-before,#plugin-rail .sort-after')
        .forEach((n) => n.classList.remove('sort-before', 'sort-after'));
    const candidates = [...rail.children].filter((n) => n !== drag.node),
        inside =
            drag.x >= rect.left - 25 &&
            drag.x <= rect.right + 40 &&
            drag.y >= rect.top - 20 &&
            drag.y <= rect.bottom + 20;
    drag.target = null;
    if (inside && candidates.length) {
        const target =
                candidates.find((n) => {
                    const r = n.getBoundingClientRect();
                    return drag.y < r.top + r.height / 2;
                }) || candidates.at(-1),
            r = target.getBoundingClientRect(),
            placement = drag.y < r.top + r.height / 2 ? 'before' : 'after';
        target.classList.add('sort-' + placement);
        drag.target = { id: target.dataset.pluginId, placement };
    }
    pluginDragFrame = requestAnimationFrame(updatePluginDrag);
}
$('#plugin-rail').addEventListener('pointerdown', (event) => {
    const node = event.target.closest('[data-plugin-id]');
    if (!node || event.button !== 0 || pluginOrderBusy || event.altKey) return;
    const bounds = node.getBoundingClientRect();
    pluginDrag = {
        node,
        id: node.dataset.pluginId,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        x: event.clientX,
        y: event.clientY,
        offset: event.clientY - bounds.top,
        active: false
    };
});
document.addEventListener('pointermove', (event) => {
    const drag = pluginDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    drag.x = event.clientX;
    drag.y = event.clientY;
    if (!drag.active && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) > 7) {
        drag.active = true;
        const bounds = drag.node.getBoundingClientRect();
        drag.ghost = drag.node.cloneNode(true);
        drag.ghost.className += ' plugin-sort-ghost';
        drag.ghost.setAttribute('aria-hidden', 'true');
        drag.ghost.removeAttribute('data-plugin-id');
        drag.ghost.tabIndex = -1;
        Object.assign(drag.ghost.style, {
            left: bounds.left + 'px',
            width: bounds.width + 'px',
            height: bounds.height + 'px'
        });
        document.body.append(drag.ghost);
        drag.node.classList.add('sorting-source');
        document.body.classList.add('plugin-sorting');
        $('#plugin-rail').setPointerCapture(drag.pointerId);
        updatePluginDrag();
    }
    if (drag.active) event.preventDefault();
});
document.addEventListener('pointerup', (event) => {
    const drag = pluginDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (drag.active) {
        pluginDragClickUntil = performance.now() + 300;
        const target = drag.target;
        finishPluginDrag();
        if (target) void moveRailPlugin(drag.id, target.id, target.placement);
    } else finishPluginDrag();
});
$('#plugin-rail').addEventListener(
    'click',
    (event) => {
        if (performance.now() < pluginDragClickUntil) {
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    },
    true
);
$('#plugin-rail').addEventListener('dragstart', (event) => event.preventDefault());
document.addEventListener('pointercancel', finishPluginDrag);
window.addEventListener('blur', finishPluginDrag);
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && pluginDrag?.active) {
        pluginDragClickUntil = performance.now() + 300;
        finishPluginDrag();
    }
});
$('#plugin-rail').addEventListener('keydown', (event) => {
    if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    const node = event.target.closest('[data-plugin-id]');
    if (!node) return;
    event.preventDefault();
    const nodes = [...$('#plugin-rail').children],
        index = nodes.indexOf(node),
        target = nodes[index + (event.key === 'ArrowUp' ? -1 : 1)];
    if (target)
        void moveRailPlugin(
            node.dataset.pluginId,
            target.dataset.pluginId,
            event.key === 'ArrowUp' ? 'before' : 'after',
            true
        );
});
$('#reset-plugin-order').onclick = task(async () => {
    await call('plugin-order-reset');
    await refresh();
    toast('已恢复插件默认顺序');
});
new ResizeObserver(reportBounds).observe($('#plugin-stage'));
window.addEventListener('resize', reportBounds);
api.onEvent('shell-state', renderShell);
api.onEvent('plugin-transfer', (value) =>
    TransferUI.render($('#plugin-download-progress'), value, () => void call('plugin-download-cancel'))
);
api.onSearch(() => $('#workbench-search').click());
document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        $('#workbench-search').click();
    }
});
$('#plugin-retry').onclick = task(() => call('plugin-reload'));
$('#shell-home').onclick = () => void openSettings('plugins');
$('#enable-plugins').onclick = () => void openSettings('plugins');
function selectSettingsPanel(panel) {
    if (!$(`#settings-dialog .settings-panel[data-panel="${panel}"]`)) panel = 'general';
    if (!$('#theme-dialog').hidden && panel !== 'appearance') leaveAppearance();
    const enteringAppearance = panel === 'appearance' && $('#theme-dialog').hidden;
    document.querySelectorAll('.settings-panel').forEach((n) => (n.hidden = n.dataset.panel !== panel));
    document.querySelectorAll('[data-settings-panel]').forEach((n) => {
        n.classList.toggle('selected', n.dataset.settingsPanel === panel);
        if (n.dataset.settingsPanel === panel) n.setAttribute('aria-current', 'page');
        else n.removeAttribute('aria-current');
    });
    $('.settings-content').scrollTop = 0;
    if (enteringAppearance) startAppearance();
    window.OfficeUI?.refresh();
}
async function openSettings(panel = 'general') {
    return withDialogTransition(async () => {
        const info = await call('workspace-info');
        $('#app-version').textContent = info.version;
        $('#data-file').textContent = info.file;
        $('#data-directory').textContent = info.directory;
        $('#keep-in-tray').checked = state.settings.keepInTray;
        $('#open-at-login').checked = info.loginItem.enabled;
        $('#open-at-login').disabled = !info.loginItem.supported;
        $('#login-item-help').textContent = info.loginItem.message;
        $('#browser-open-mode').value = state.settings.browserOpenMode || 'internal';
        $('#mcp-port').value = info.mcp.port;
        renderMcpStatus(info.mcp);
        catalogState = await call('plugin-catalog-status');
        renderPluginManager();
        renderPluginCatalog();
        TransferUI.render(
            $('#plugin-download-progress'),
            await call('plugin-download-status'),
            () => void call('plugin-download-cancel')
        );
        await loadDistribution();
        selectSettingsPanel(typeof panel === 'string' ? panel : 'general');
        $('#settings-error').textContent = '';
        $('#settings-dialog').showModal();
    });
}
document.querySelectorAll('[data-settings-panel]').forEach((n) => {
    const glyphs = {
        general: 'gear',
        appearance: 'sliders',
        plugins: 'grid',
        distribution: 'globe',
        ai: 'server',
        data: 'download'
    };
    const label = el('span', '', n.textContent);
    n.replaceChildren(icon(glyphs[n.dataset.settingsPanel]), label);
    n.onclick = () => selectSettingsPanel(n.dataset.settingsPanel);
});
$('#collapsed-settings-button').onclick = task(() => openSettings());
$('#expand-navigation').onclick = task(() => {
    if (state.active) singleNavigationExpanded.add(state.active.id);
    return call('settings', { navigationCollapsed: false });
});
$('#toggle-navigation').onclick = task(() => {
    const collapsed = document.body.classList.contains('navigation-collapsed');
    if (state.active)
        collapsed ? singleNavigationExpanded.add(state.active.id) : singleNavigationExpanded.delete(state.active.id);
    return call('settings', { navigationCollapsed: !collapsed });
});
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
window.workbench.onEvent('plugin-market-request', ({ id }) => {
    void task(async () => {
        await openSettings('plugins');
        const installed = state.plugins.some((p) => p.id === id);
        document.querySelector(`[data-plugin-tab="${installed ? 'installed' : 'catalog'}"]`)?.click();
        if (!installed && !catalogState.loaded) await managePlugin('plugin-catalog-refresh');
        $('#catalog-search').value = id;
        renderPluginCatalog();
    })();
});
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
$('#download-app').onclick = task(async () => {
    await loadDistribution();
    selectSettingsPanel('distribution');
});
$('#keep-in-tray').onchange = task(() =>
    call('settings', { ...state.settings, keepInTray: $('#keep-in-tray').checked })
);
$('#open-at-login').onchange = task(async () => {
    const input = $('#open-at-login');
    const previous = !input.checked;
    input.disabled = true;
    try {
        const next = await call('login-item-set', input.checked);
        input.checked = next.enabled;
    } catch (error) {
        input.checked = previous;
        throw error;
    } finally {
        input.disabled = false;
    }
});
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
            if (mode === 'export') {
                const coverage = plugin?.backupCoverage;
                copy.append(
                    el(
                        'small',
                        'backup-coverage',
                        coverage
                            ? `内容：${coverage.content}；偏好：${coverage.preferences}；外部文件：不随备份复制`
                            : '覆盖范围未声明；已保留的 SDK 数据可导出，原文件不会随备份复制'
                    )
                );
            }
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
        if (result !== null && result !== false) {
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
                        id: state.active?.id || enabled.find((p) => p.id === state.lastPlugin)?.id || enabled[0].id
                    });
            } finally {
                resolveShellReady();
            }
        })()
);
