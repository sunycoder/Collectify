const $ = (selector) => document.querySelector(selector),
    request = (action, data = {}) => collectify.background.request({ action, ...data });
let items = [],
    tab = 'all',
    selected = null,
    refreshVersion = 0,
    searchTimer,
    matchedIds = null,
    pointerBusy = false,
    pendingRefresh = false,
    platform = '';
const expanded = new Set(),
    imageCache = new Map(),
    observers = new Set();
const fullText = new Map();
const shapes = {
    copy: 'M8 8h12v12H8z M4 16V4h12',
    paste: 'M9 4h6v4H9z M7 6H4v15h16V6h-3 M8 13h8 M8 17h6',
    favorite: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z',
    trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 14h10l1-14 M10 10v7 M14 10v7',
    window: 'M14 3h7v7 M21 3 11 13 M10 4H4v16h16v-6',
    more: 'M5 12h.1 M12 12h.1 M19 12h.1'
};
function symbol(name) {
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(icon.namespaceURI, 'path');
    path.setAttribute('d', shapes[name] || shapes.copy);
    icon.append(path);
    return icon;
}
function node(tag, className, text) {
    const element = document.createElement(tag);
    element.className = className || '';
    if (text !== undefined) element.textContent = text;
    return element;
}
function action(label, text, handler) {
    const button = node('button', '', text);
    button.type = 'button';
    button.title = label;
    button.setAttribute('aria-label', label);
    if (['★', '⧉', '×', '…'].includes(text))
        button.replaceChildren(
            symbol(text === '★' ? 'favorite' : text === '×' ? 'trash' : text === '…' ? 'more' : 'copy')
        );
    button.onclick = (event) => {
        event.stopPropagation();
        void ToolUI.run(handler);
    };
    return button;
}
function relative(at) {
    const seconds = Math.max(0, Math.floor((Date.now() - new Date(at).getTime()) / 1000));
    if (seconds < 60) return '刚刚';
    if (seconds < 3600) return Math.floor(seconds / 60) + ' 分钟前';
    if (seconds < 86400) return Math.floor(seconds / 3600) + ' 小时前';
    return new Date(at).toLocaleString();
}
function size(bytes) {
    return bytes < 1024
        ? bytes + ' B'
        : bytes < 1024 * 1024
          ? (bytes / 1024).toFixed(1) + ' KB'
          : (bytes / 1024 / 1024).toFixed(1) + ' MB';
}
function select(id) {
    selected = id;
    document
        .querySelectorAll('.history-item')
        .forEach((row) => row.classList.toggle('selected', row.dataset.id === id));
}
async function copy(item) {
    select(item.id);
    await request('copy', { id: item.id });
    ToolUI.message('已复制，可切换到目标应用粘贴');
}
async function remove(item) {
    hideContext();
    await request('delete', { id: item.id });
    imageCache.delete(item.id);
    fullText.delete(item.id);
    expanded.delete(item.id);
    if (selected === item.id) selected = null;
    await refresh();
    ToolUI.message('记录已删除');
}
async function toggleFavorite(item) {
    await request('favorite', { id: item.id });
    await refresh();
}
async function toggleExpand(item) {
    if (expanded.has(item.id)) expanded.delete(item.id);
    else {
        expanded.add(item.id);
        if (item.kind === 'text') fullText.set(item.id, (await request('content', { id: item.id })).text);
    }
    render();
}
function hideContext() {
    if ($('#context-menu').matches(':popover-open')) {
        const focused = $('#context-menu').contains(document.activeElement);
        $('#context-menu').hidePopover();
        if (focused)
            [...document.querySelectorAll('.history-item')]
                .find((row) => row.dataset.id === selected)
                ?.focus({ preventScroll: true });
    }
}
async function floatItem(item) {
    hideContext();
    await collectify.windows.open({ focusItem: item?.id || selected });
}
function showContext(event, item) {
    event.preventDefault();
    event.stopPropagation();
    select(item.id);
    hideContext();
    const menu = $('#context-menu');
    menu.replaceChildren();
    const actions = [
        ['复制', 'copy', () => copy(item), 'Ctrl+C'],
        [
            '执行粘贴',
            'paste',
            async () => {
                await copy(item);
                await collectify.desktop.paste();
            },
            ''
        ],
        ['悬浮中转', 'window', () => floatItem(item), ''],
        [item.favorite ? '取消收藏' : '收藏', 'favorite', () => toggleFavorite(item), ''],
        [expanded.has(item.id) ? '收起预览' : '展开预览', 'more', () => toggleExpand(item), ''],
        ['删除', 'trash', () => remove(item), 'Delete']
    ];
    for (const [label, glyph, handler, shortcut] of actions) {
        const button = action(label, '', async () => {
            hideContext();
            await handler();
        });
        button.setAttribute('role', 'menuitem');
        button.append(symbol(glyph), node('span', '', label), node('small', '', shortcut));
        if (glyph === 'trash') button.classList.add('danger');
        if (glyph === 'paste' && platform !== 'win32') {
            button.disabled = true;
            button.title = '当前平台请复制后手动粘贴';
        }
        menu.append(button);
    }
    menu.showPopover();
    const rect = menu.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(event.clientX, innerWidth - rect.width - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(event.clientY, innerHeight - rect.height - 8)) + 'px';
    menu.querySelector('button').focus({ preventScroll: true });
}
function render() {
    for (const observer of observers) observer.disconnect();
    observers.clear();
    const history = $('#history'),
        scroll = history.scrollTop,
        visible = ClipboardHistory.filter(items, tab, '').filter(
            (item) => !$('#search').value.trim() || matchedIds?.has(item.id)
        );
    const existingImages = new Map(
        [...history.querySelectorAll('.history-item img')].map((image) => [
            image.closest('.history-item').dataset.id,
            image
        ])
    );
    const focusId = document.activeElement?.closest('.history-item')?.dataset.id;
    const anchor =
        scroll > 0
            ? [...history.querySelectorAll('.history-item')].find(
                  (row) => row.getBoundingClientRect().bottom > history.getBoundingClientRect().top
              )
            : null;
    const anchorId = anchor?.dataset.id,
        anchorTop = anchor?.getBoundingClientRect().top;
    history.replaceChildren();
    for (const button of document.querySelectorAll('[data-tab]')) {
        const key = button.dataset.tab;
        button.setAttribute('aria-pressed', String(tab === key));
        button.querySelector('small').textContent = String(ClipboardHistory.filter(items, key, '').length);
    }
    if (!visible.length) {
        const empty = node('div', 'history-empty'),
            copy = node('div', '', items.length ? '没有匹配的记录' : '剪贴板还没有记录');
        copy.append(
            node(
                'small',
                '',
                items.length ? '换个分类或搜索词试试' : '开启后台采集后，切到其他应用复制文本、图片或文件'
            )
        );
        empty.append(copy);
        history.append(empty);
    }
    for (const [itemIndex, item] of visible.entries()) {
        const row = node(
            'article',
            'history-item' + (expanded.has(item.id) ? ' expanded' : '') + (item.id === selected ? ' selected' : '')
        );
        row.dataset.id = item.id;
        row.tabIndex = 0;
        row.setAttribute(
            'aria-label',
            `${item.kind === 'image' ? '图片' : item.kind === 'files' ? '文件' : '文本'}，${relative(item.at)}`
        );
        row.onclick = () => select(item.id);
        row.ondblclick = () => void ToolUI.run(() => copy(item));
        row.oncontextmenu = (event) => showContext(event, item);
        row.onfocus = () => select(item.id);
        const actions = node('div', 'row-actions'),
            favorite = action(item.favorite ? '取消收藏' : '收藏', '★', async () => {
                await toggleFavorite(item);
            });
        favorite.setAttribute('aria-pressed', String(item.favorite));
        actions.append(
            favorite,
            action('复制', '⧉', () => copy(item)),
            action('删除', '×', () => remove(item)),
            action('更多操作', '…', () => {
                const r = row.getBoundingClientRect();
                showContext(
                    { clientX: r.right - 20, clientY: r.top + 35, preventDefault() {}, stopPropagation() {} },
                    item
                );
            })
        );
        row.append(actions);
        if (item.kind === 'image') {
            const wrap = node('div', 'image-wrap'),
                image = existingImages.get(item.id) || node('img');
            image.alt = '剪贴板图片预览';
            image.loading = 'lazy';
            const cached = imageCache.get(item.id);
            // 已解码的预览沿用原节点；缓存地址在插入前设置，不等待懒加载回调。
            if (cached && image.getAttribute('src') !== cached) image.src = cached;
            wrap.append(image);
            row.append(wrap);
            const load = () => {
                if (imageCache.has(item.id)) {
                    image.src = imageCache.get(item.id);
                    return;
                }
                void request('content', { id: item.id })
                    .then((content) => {
                        if (!image.isConnected) return;
                        const data = `data:${content.format};base64,${content.data}`;
                        imageCache.set(item.id, data);
                        image.src = data;
                    })
                    .catch((error) => {
                        image.alt = error.message;
                    });
            };
            if (!cached) {
                const observer = new IntersectionObserver(
                    (entries) => {
                        if (entries.some((entry) => entry.isIntersecting)) {
                            observer.disconnect();
                            observers.delete(observer);
                            load();
                        }
                    },
                    { root: history, rootMargin: '100px' }
                );
                observer.observe(image);
                observers.add(observer);
            }
        } else if (item.kind === 'files') {
            for (const file of item.files.slice(0, expanded.has(item.id) ? 100 : 3)) {
                const card = node('div', 'file-item'),
                    copy = node('div');
                copy.append(node('b', '', file.split(/[\\/]/).pop()), node('small', '', file));
                card.append(node('i', 'type-icon type-files'), copy);
                row.append(card);
            }
        } else
            row.append(
                node(
                    'div',
                    'history-content text',
                    expanded.has(item.id) ? fullText.get(item.id) || item.preview : item.preview
                )
            );
        const meta = node('div', 'history-meta'),
            date = node('time', '', relative(item.at));
        date.dateTime = item.at;
        date.title = new Date(item.at).toLocaleString();
        meta.append(date);
        if (item.kind === 'image' || item.characters > 180 || item.files.length > 3) {
            const toggle = action('展开或收起', expanded.has(item.id) ? '收起' : '⌄ 展开', () => toggleExpand(item));
            toggle.className = 'expand';
            meta.append(toggle);
        }
        meta.append(
            node(
                'span',
                '',
                `${item.kind === 'image' ? item.width + ' × ' + item.height + ' · ' : item.kind === 'files' ? item.files.length + ' 个文件 · ' : item.characters + ' 字符 · '}${size(item.bytes)}　${itemIndex + 1}`
            )
        );
        row.append(meta);
        history.append(row);
    }
    history.scrollTop = scroll;
    if (anchorId) {
        const next = [...history.querySelectorAll('.history-item')].find((row) => row.dataset.id === anchorId);
        if (next) history.scrollTop += next.getBoundingClientRect().top - anchorTop;
    }
    if (focusId)
        [...history.querySelectorAll('.history-item')]
            .find((row) => row.dataset.id === focusId)
            ?.focus({ preventScroll: true });
}
async function refresh() {
    if (pointerBusy) {
        pendingRefresh = true;
        return;
    }
    const version = ++refreshVersion,
        data = await request('list', { query: $('#search').value });
    if (version !== refreshVersion) return;
    if (pointerBusy) {
        pendingRefresh = true;
        return;
    }
    items = data.items;
    matchedIds = new Set(data.matches || data.items.map((item) => item.id));
    $('#capture').textContent = data.capturing ? '暂停采集' : '开启后台采集';
    $('#capture').setAttribute('aria-pressed', String(data.capturing));
    $('#capture-status').textContent =
        data.error || (data.capturing ? '● 后台采集中 · 切换应用也会记录' : '采集已暂停');
    for (const id of imageCache.keys()) if (!items.some((item) => item.id === id)) imageCache.delete(id);
    for (const id of fullText.keys()) if (!items.some((item) => item.id === id)) fullText.delete(id);
    render();
}
$('#capture').onclick = () =>
    void ToolUI.run(async () => {
        await request('capture', { enabled: $('#capture').getAttribute('aria-pressed') !== 'true' });
        await refresh();
    });
$('#read-once').onclick = () =>
    void ToolUI.run(async () => {
        await request('once');
        await refresh();
    });
$('#clear').onclick = () =>
    void ToolUI.run(async () => {
        if (!confirm('清空所有未收藏的记录？收藏内容会保留。')) return;
        await request('clear');
        imageCache.clear();
        fullText.clear();
        selected = null;
        hideContext();
        await refresh();
        ToolUI.message('未收藏记录已清空');
    });
$('#search').oninput = () => {
    refreshVersion++;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void ToolUI.run(refresh), 120);
};
for (const button of document.querySelectorAll('[data-tab]'))
    button.onclick = () => {
        tab = button.dataset.tab;
        void collectify.selectNavigation(tab);
        render();
    };
collectify.onNavigate(({ route, payload }) => {
    if (payload?.focusItem) selected = payload.focusItem;
    if (['all', 'text', 'image', 'files', 'favorites'].includes(route)) {
        tab = route;
        render();
    }
});
collectify.onEvent((event) => {
    if (event.name === 'plugin-notify') void ToolUI.run(refresh);
});
$('#history').onkeydown = (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c') {
        const item = items.find((item) => item.id === selected);
        if (item && !window.getSelection().toString()) {
            event.preventDefault();
            void ToolUI.run(() => copy(item));
        }
    }
    if (event.key === 'Delete') {
        const item = items.find((item) => item.id === selected);
        if (item) {
            event.preventDefault();
            void ToolUI.run(() => remove(item));
        }
    }
    if (event.key === 'Enter' && event.target.classList.contains('history-item')) {
        event.preventDefault();
        const item = items.find((item) => item.id === event.target.dataset.id);
        if (item) void ToolUI.run(() => copy(item));
    }
    if (['ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        const rows = [...document.querySelectorAll('.history-item')],
            index = rows.findIndex((row) => row.dataset.id === selected),
            next = Math.max(0, Math.min(rows.length - 1, index + (event.key === 'ArrowUp' ? -1 : 1)));
        rows[next]?.focus();
    }
};
$('#float-window').onclick = () => void ToolUI.run(() => floatItem(items.find((item) => item.id === selected)));
document.addEventListener('pointerdown', (event) => {
    if (!event.target.closest('#context-menu')) hideContext();
});
document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hideContext();
});
$('#history').addEventListener('scroll', hideContext);
window.addEventListener('resize', hideContext);
$('#context-menu').onkeydown = (event) => {
    const buttons = [...$('#context-menu').querySelectorAll('button:not(:disabled)')],
        index = buttons.indexOf(document.activeElement);
    if (['ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    }
};
$('#history').addEventListener('pointerdown', () => {
    pointerBusy = true;
});
function releasePointer() {
    pointerBusy = false;
    if (pendingRefresh) {
        pendingRefresh = false;
        void ToolUI.run(refresh);
    }
}
window.addEventListener('pointerup', () => setTimeout(releasePointer, 0));
window.addEventListener('pointercancel', releasePointer);
window.addEventListener('blur', releasePointer);
for (const button of document.querySelectorAll('[data-tab]')) {
    const glyph =
        button.dataset.tab === 'favorites' ? symbol('favorite') : node('i', 'type-icon type-' + button.dataset.tab);
    glyph.classList.add('type-icon');
    if (button.dataset.tab === 'favorites')
        button.firstChild.textContent = button.firstChild.textContent.replace('★ ', '');
    button.prepend(glyph);
}
collectify.context().then((context) => {
    platform = context.platform;
    if (context.windowMode === 'floating') {
        $('h1').textContent = '剪贴板 · 悬浮中转';
        $('#float-window').hidden = true;
    }
});
void ToolUI.run(refresh);
