const $ = (selector) => document.querySelector(selector);
const api = {
    call: async (action, payload) => ({ ok: true, data: await collectify.invoke(action, payload) }),
    onEvent: (name, callback) =>
        collectify.onEvent((event) => {
            if (event.name === name) callback(event.data);
        }),
    onTabs: (callback) =>
        collectify.onEvent((event) => {
            if (event.name === 'tabs') callback(event.data);
        }),
    onSearch: (callback) =>
        collectify.onEvent((event) => {
            if (event.name === 'focus-search') callback();
        })
};
let state = { entries: [], categories: [], tasks: [], notes: [], settings: {} },
    actionCallback,
    menuAnchor,
    toastTimer;
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
    if (!result.ok) throw new Error(result.error);
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

function hideMenu() {
    const focused = $('#popup-menu').contains(document.activeElement);
    window.WorkspaceOverlay?.close($('#popup-menu'));
    $('#popup-menu').hidden = true;
    if (focused && menuAnchor?.isConnected) menuAnchor.focus();
}

function menu(anchor, items) {
    menuAnchor = anchor;
    const node = $('#popup-menu');
    node.replaceChildren();
    for (const item of items) {
        if (!item) {
            node.append(el('div', 'menu-separator'));
            continue;
        }
        node.append(
            button(
                item.label,
                item.icon,
                async () => {
                    hideMenu();
                    await item.run();
                },
                item.danger ? 'menu-danger' : ''
            )
        );
    }
    node.hidden = false;
    window.WorkspaceOverlay.show(anchor, node, { width: 228, placement: 'bottom-end' });
    node.querySelector('button')?.focus({ preventScroll: true });
}

async function showAction(options) {
    hideMenu();
    await call('overlay', true);
    $('#action-title').textContent = options.title;
    $('#action-description').textContent = options.description;
    $('#action-dialog .form-error').textContent = '';
    $('#target-label').hidden = !!options.hideTarget;
    if (!options.hideTarget && typeof categoryOptions === 'function')
        categoryOptions($('#target-category'), options.selected, options.exclude);
    $('#action-confirm').textContent = options.confirm;
    $('#action-confirm').className = options.danger ? 'primary danger' : 'primary';
    actionCallback = options.action;
    $('#action-dialog').showModal();
}

document.querySelectorAll('dialog').forEach((dialog) => {
    dialog.querySelectorAll('.dialog-close,.cancel-dialog').forEach((node) => {
        node.onclick = () => dialog.close();
    });
    dialog.addEventListener('close', () => {
        void call('overlay', !!document.querySelector('dialog[open]'));
    });
});
$('#action-confirm').onclick = async () => {
    const node = $('#action-confirm');
    node.disabled = true;
    try {
        await actionCallback($('#target-category').value);
        $('#action-dialog').close();
    } catch (error) {
        $('#action-dialog .form-error').textContent = error.message;
    } finally {
        node.disabled = false;
    }
};

document.querySelectorAll('[data-icon]').forEach((node) => node.append(icon(node.dataset.icon)));
collectify.onContextChanged((context) => {
    ShiyueTheme.apply(context.theme);
});
collectify.context().then((context) => ShiyueTheme.apply(context.theme));
api.onEvent('data-changed', () => void refresh().catch((error) => toast(error.message)));
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hideMenu();
});
