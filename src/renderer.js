const $ = selector => document.querySelector(selector);
const api = window.workbench;
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
    left: '<path d="m15 5-7 7 7 7"/>', right: '<path d="m9 5 7 7-7 7"/>',
    reload: '<path d="M20 8a9 9 0 1 0 0 8M20 3v5h-5"/>',
    up: '<path d="m6 13 6-6 6 6M12 7v14"/>', down: '<path d="m6 11 6 6 6-6M12 3v14"/>',
    upload: '<path d="M12 16V3m-5 5 5-5 5 5M3 15v6h18v-6"/>', download: '<path d="M12 3v13m-5-5 5 5 5-5M3 18v3h18v-3"/>'
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

document.querySelectorAll('[data-icon]').forEach(node => node.append(icon(node.dataset.icon)));
let state = {categories: [], entries: []}, filter = 'all', categoryId = '', editing = null, editingCategory = null;
let categoryColor = 'sage', categoryIcon = 'link', actionCallback, dragData, toastTimer, menuAnchor;
let tabsState = {tabs: [], active: null, dashboard: true};
let currentSection = 'bookmarks', credentialEntry = null;
let collectionScroll = 0, lastOpenedEntryId = null, viewedResource = null;
let view = localStorage.getItem('bookmark-view') || 'grid';

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
    toastTimer = setTimeout(() => {
        $('#toast').hidden = true;
    }, undo ? 7000 : 3500);
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

function symbol(category, className = 'category-symbol') {
    const node = el('span', `${className} ${category.color}`);
    node.append(icon(category.icon));
    return node;
}

function getCategory(id) {
    return state.categories.find(c => c.id === id);
}

async function refresh() {
    state = await call('state');
    if (!$('#theme-dialog').open) window.ShiyueTheme.apply(state.settings?.theme);
    if (filter === 'category' && !getCategory(categoryId)) filter = 'all';
    render();
    if (typeof renderProductivity === 'function') renderProductivity();
    updateViews();
}

function updateViews() {
    $('#dashboard').hidden = !tabsState.dashboard || currentSection !== 'bookmarks';
    $('#tasks-page').hidden = !tabsState.dashboard || currentSection !== 'tasks';
    $('#notes-page').hidden = !tabsState.dashboard || currentSection !== 'notes';
    $('#workspace').hidden = tabsState.dashboard;
    $('#tasks-nav').classList.toggle('selected', currentSection === 'tasks');
    $('#notes-nav').classList.toggle('selected', currentSection === 'notes');
    if (currentSection !== 'bookmarks') {
        document.querySelectorAll('[data-filter],.category-row').forEach(n => n.classList.remove('selected'));
        $('#breadcrumb-current').textContent = currentSection === 'tasks' ? '我的待办' : '便签';
    }
    if (typeof officeCalendar !== 'undefined' && officeCalendar && currentSection === 'tasks' && tabsState.dashboard) requestAnimationFrame(() => officeCalendar.updateSize());
}

function selectFilter(next, id = '') {
    currentSection = 'bookmarks';
    filter = next;
    categoryId = id;
    $('#search').value = '';
    hideMenu();
    render();
    return call('home').catch(error => toast(error.message));
}

function filteredEntries() {
    const query = $('#search').value.trim().toLocaleLowerCase();
    let entries = state.entries.filter(e => (filter !== 'category' || e.categoryId === categoryId) && (filter !== 'favorite' || e.favorite) && (filter !== 'recent' || e.lastOpened)
        && [e.name, e.url, e.localPath, e.content, e.note, e.environment, getCategory(e.categoryId)?.name || ''].some(s => (s || '').toLocaleLowerCase().includes(query)));
    const sort = filter === 'recent' ? 'recent' : $('#sort').value;
    if (sort === 'name') entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    if (sort === 'recent') entries.sort((a, b) => b.lastOpened - a.lastOpened);
    return entries;
}

function render() {
    $('#config-source').textContent = `${state.configSource === 'imported' ? '已导入 · ' + state.sourceName : state.configSource === 'default' ? '默认配置 · ' + state.sourceName : '本机收藏'} · 自动持久化`;
    $('#total-count').textContent = state.entries.length;
    $('#favorite-count').textContent = state.entries.filter(e => e.favorite).length;
    document.querySelectorAll('[data-filter]').forEach(n => n.classList.toggle('selected', n.dataset.filter === filter));
    const current = getCategory(categoryId);
    const title = filter === 'category' ? current.name : {
        all: '全部收藏',
        favorite: '已置顶',
        recent: '最近打开'
    }[filter];
    $('#heading').textContent = title;
    $('#breadcrumb-current').textContent = title;
    $('#description').textContent = filter === 'category' ? current.description || `属于 ${current.name} 的工作地址，都在这里。` : {
        all: '常用的工作地址，按你的习惯整理。',
        favorite: '把最常用的地址留在手边。',
        recent: '刚刚用过的地址，随时接着打开。'
    }[filter];
    $('#category-menu-button').hidden = filter !== 'category' || categoryId === 'inbox';
    $('#categories').replaceChildren();
    for (const category of [...state.categories.filter(c => c.id !== 'inbox'), ...state.categories.filter(c => c.id === 'inbox')]) {
        const count = state.entries.filter(e => e.categoryId === category.id).length;
        const row = el('div', `category-row${filter === 'category' && categoryId === category.id ? ' selected' : ''}`);
        row.dataset.id = category.id;
        const nav = button(category.name, null, () => selectFilter('category', category.id), 'nav-item');
        nav.replaceChildren(symbol(category), el('span', '', category.name), el('b', '', count));
        row.append(nav);
        if (category.id !== 'inbox') row.append(button('分类操作', 'more', event => categoryMenu(event.currentTarget, category), 'icon-button category-more'));
        row.draggable = category.id !== 'inbox';
        row.ondragstart = event => {
            dragData = {kind: 'category', id: category.id};
            event.dataTransfer.setData('text/plain', category.name);
            event.dataTransfer.effectAllowed = 'move';
        };
        row.ondragover = event => {
            if (dragData && dragData.id !== category.id) {
                event.preventDefault();
                row.classList.add('drop-target');
            }
        };
        row.ondragleave = () => row.classList.remove('drop-target');
        row.ondrop = task(async event => {
            event.preventDefault();
            row.classList.remove('drop-target');
            if (dragData?.kind === 'entry') {
                const entry = state.entries.find(e => e.id === dragData.id);
                if (entry) await moveEntry(entry, category.id);
            } else if (dragData?.kind === 'category' && category.id !== 'inbox') await reorder('categories', dragData.id, category.id);
        });
        row.ondragend = clearDrag;
        $('#categories').append(row);
    }
    const overview = $('#category-overview');
    overview.replaceChildren();
    overview.hidden = filter !== 'all' || !!$('#search').value.trim();
    const overviewCategories = state.categories.filter(c => c.id !== 'inbox').slice(0, 3);
    for (const category of overviewCategories) {
        const node = button(category.name, null, () => selectFilter('category', category.id), 'category-summary');
        const info = el('div');
        info.append(el('span', 'summary-name', category.name), el('small', '', '浏览分类'));
        node.replaceChildren(symbol(category), info, el('span', 'summary-count', String(state.entries.filter(e => e.categoryId === category.id).length).padStart(2, '0')));
        overview.append(node);
    }
    if (overviewCategories.length < 3) overview.append(button('创建一个新分类', 'plus', () => showCategory(), 'category-summary category-summary-new'));
    const entries = filteredEntries();
    $('#result-count').textContent = `${entries.length} 条收藏`;
    $('#clear-search').hidden = !$('#search').value;
    $('#search-shortcut').hidden = !!$('#search').value;
    $('#sort').disabled = filter === 'recent';
    $('#entries').className = `collections ${view}`;
    $('#entries').replaceChildren();
    $('#grid-view').classList.toggle('active', view === 'grid');
    $('#list-view').classList.toggle('active', view === 'list');
    $('#empty').hidden = entries.length > 0;
    $('#empty-title').textContent = $('#search').value ? '没有找到匹配的收藏' : filter === 'recent' ? '还没有打开过收藏' : filter === 'favorite' ? '把常用的收藏置顶到这里' : '给这个分类收下第一个地址';
    $('#empty-description').textContent = $('#search').value ? '换个关键词，或清空搜索再看看。' : filter === 'recent' ? '打开任意收藏后，会按时间排列在这里。' : filter === 'favorite' ? '点击收藏卡片上的图钉，就能快速找到它。' : '填上名称和网址，下次就能一键打开。';
    $('#empty-add').hidden = !!$('#search').value || ['recent', 'favorite'].includes(filter);
    if (filter === 'category' || filter === 'recent') {
        if (entries.length) $('#entries').append(section(entries, filter === 'category' ? current : null, filter === 'category'));
    } else for (const category of state.categories) {
        const items = entries.filter(e => e.categoryId === category.id);
        if (items.length) $('#entries').append(section(items, category, filter === 'all' && !$('#search').value));
    }
}

function section(entries, category, add) {
    const node = el('section', 'collection-section');
    if (filter !== 'category' && category) {
        const heading = el('div', 'section-heading');
        heading.append(symbol(category), el('h2', '', category.name), el('span', '', entries.length));
        if (add) heading.append(button('添加收藏', 'plus', () => showEditor(null, category.id), 'section-add'));
        node.append(heading);
    }
    const grid = el('div', 'bookmark-grid');
    for (const entry of entries) grid.append(card(entry));
    if (add && $('#sort').value === 'manual') {
        const create = button('添加到这个分类', null, () => showEditor(null, category.id), 'add-card');
        const circle = el('span', 'add-circle');
        circle.append(icon('plus'));
        create.replaceChildren(circle, el('span', '', '添加到这个分类'));
        grid.append(create);
    }
    node.append(grid);
    return node;
}

function card(entry) {
    const category = getCategory(entry.categoryId), node = el('article', `bookmark-card ${category.color}`);
    node.dataset.id = entry.id;
    node.tabIndex = 0;
    node.setAttribute('role', 'link');
    node.setAttribute('aria-label', `打开 ${entry.name}`);
    node.onclick = task(event => {
        if (!event.target.closest('button') && !window.getSelection().toString()) return open(entry);
    });
    node.onkeydown = task(event => {
        if (event.target === node && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            return open(entry);
        }
    });
    const top = el('div', 'card-top');
    top.append(symbol(category, 'site-icon'));
    const tags = el('div', 'card-tags');
    if (entry.favorite) {
        const pinned = el('span', 'pin-marker');
        pinned.title = '已置顶';
        pinned.append(icon('pin'));
        tags.append(pinned);
    }
    if (entry.environment) tags.append(el('span', `tag${/prod|生产|正式/i.test(entry.environment) ? ' production' : ''}`, entry.environment));
    if (entry.username || entry.hasPassword) {
        const lock = icon('lock');
        lock.title = '包含登录资料';
        tags.append(lock);
    }
    top.append(tags);
    const name = el('h3', 'card-name', entry.name);
    name.title = entry.name;
    const note = el('p', 'card-note', entry.note || '\u00a0');
    note.title = entry.note;
    const resourceLabels = {web: '网页', file: '文件', folder: '文件夹', text: '文本片段', credential: '账号资料'};
    tags.prepend(el('span', 'resource-type-tag', resourceLabels[entry.type || 'web']));
    const address = el('div', 'card-address');
    address.title = entry.url || entry.localPath || '';
    let displayText = entry.localPath || entry.username || (entry.type === 'text' ? entry.content.replace(/\s+/g, ' ').slice(0, 70) : '');
    if (entry.url) {
        const display = new URL(entry.url);
        displayText = display.host + (display.pathname === '/' ? '' : display.pathname) + display.search + display.hash;
    }
    address.append(icon({
        file: 'book',
        folder: 'folder',
        text: 'edit',
        credential: 'lock'
    }[entry.type] || 'globe'), el('span', '', displayText));
    const bottom = el('div', 'card-bottom');
    const label = el('span', 'card-open', entry.type === 'text' ? '查看文本' : entry.type === 'credential' ? '查看资料' : ['file', 'folder'].includes(entry.type) ? '打开本地资源' : entry.mode === 'external' ? '浏览器打开' : '打开网页');
    label.append(icon('arrow'));
    bottom.append(label, button(entry.favorite ? '取消置顶' : '置顶收藏', 'pin', async () => {
            await call('save', {...entry, favorite: !entry.favorite});
            await refresh();
        }, `icon-button${entry.favorite ? ' pinned' : ''}`),
        button(entry.type === 'text' ? '复制内容' : ['file', 'folder'].includes(entry.type) ? '复制路径' : '复制网址', 'copy', async () => {
            await call('copy', entry.id);
            toast('已复制');
        }, 'icon-button'), button('更多操作', 'more', event => entryMenu(event.currentTarget, entry), 'icon-button'));
    node.append(top, name, note, address, bottom);
    node.draggable = $('#sort').value === 'manual' && filter !== 'recent';
    node.ondragstart = event => {
        dragData = {kind: 'entry', id: entry.id};
        node.classList.add('dragging');
        event.dataTransfer.setData('text/plain', entry.name);
        event.dataTransfer.effectAllowed = 'move';
    };
    node.ondragend = clearDrag;
    node.ondragover = event => {
        if (dragData?.kind === 'entry' && dragData.id !== entry.id && node.draggable) {
            event.preventDefault();
            node.classList.add('drop-target');
        }
    };
    node.ondragleave = () => node.classList.remove('drop-target');
    node.ondrop = task(async event => {
        event.preventDefault();
        node.classList.remove('drop-target');
        if (dragData?.kind === 'entry' && node.draggable) await reorder('entries', dragData.id, entry.id);
    });
    return node;
}

function clearDrag() {
    dragData = null;
    document.querySelectorAll('.drop-target,.dragging').forEach(n => n.classList.remove('drop-target', 'dragging'));
}

async function reorder(kind, source, target) {
    const ids = state[kind].map(item => item.id), from = ids.indexOf(source), to = ids.indexOf(target);
    if (from < 0 || to < 0 || from === to) return;
    ids.splice(from, 1);
    ids.splice(to, 0, source);
    await call('reorder', {kind, ids});
    await refresh();
}

async function moveEntry(entry, target) {
    if (entry.categoryId === target) return;
    await call('save', {...entry, categoryId: target});
    await refresh();
    toast(`已移至 ${getCategory(target).name}`, async () => {
        const latest = state.entries.find(e => e.id === entry.id);
        if (latest && getCategory(entry.categoryId)) {
            await call('save', {...latest, categoryId: entry.categoryId});
            await refresh();
            toast('已撤销移动');
        }
    });
}

async function open(entry, mode) {
    if (entry.type === 'text') {
        viewedResource = entry;
        await call('overlay', true);
        $('#resource-title').textContent = entry.name;
        $('#resource-note').textContent = entry.note;
        $('#resource-body').textContent = entry.content;
        $('#resource-dialog').showModal();
        await call('resource-viewed', entry.id);
        await refresh();
        return;
    }
    if (entry.type === 'credential') {
        await call('resource-viewed', entry.id);
        await showCredentials(entry);
        await refresh();
        return;
    }
    if (entry.type === 'web' || !entry.type) {
        collectionScroll = window.scrollY;
        lastOpenedEntryId = entry.id;
    }
    await call('open', {id: entry.id, mode});
    await refresh();
    if (!tabsState.dashboard) window.scrollTo(0, 0);
}

async function returnToCollection() {
    currentSection = 'bookmarks';
    await call('home');
    updateViews();
    requestAnimationFrame(() => {
        window.scrollTo(0, collectionScroll);
        if (lastOpenedEntryId) document.querySelector(`.bookmark-card[data-id="${lastOpenedEntryId}"]`)?.focus({preventScroll: true});
    });
}

$('#back-to-library').onclick = task(returnToCollection);
$('#copy-resource').onclick = task(async () => {
    await call('copy', viewedResource.id);
    toast('文本已复制');
});

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
        node.append(button(item.label, item.icon, async () => {
            hideMenu();
            await item.run();
        }, item.danger ? 'menu-danger' : ''));
    }
    node.hidden = false;
    window.WorkspaceOverlay.show(anchor, node, {width: 228, placement: 'bottom-end'});
    node.querySelector('button')?.focus({preventScroll: true});
}

function entryMenu(anchor, entry) {
    const siblings = state.entries.filter(e => e.categoryId === entry.categoryId),
        index = siblings.findIndex(e => e.id === entry.id);
    const items = [
        {label: '编辑收藏', icon: 'edit', run: () => showEditor(entry)},
        {label: '创建关联待办', icon: 'list', run: () => showTask(null, {bookmarkId: entry.id, title: entry.name})},
        {
            label: '移动到分类…',
            icon: 'folder',
            run: () => showAction({
                title: '移动收藏',
                description: entry.name,
                selected: entry.categoryId,
                confirm: '移动',
                action: target => moveEntry(entry, target)
            })
        },
    ];
    if (entry.type === 'web' || entry.type === 'credential') items.splice(1, 0, {
        label: '查看登录资料',
        icon: 'lock',
        run: () => showCredentials(entry)
    });
    if (entry.type === 'web' || !entry.type) items.push({
        label: entry.mode === 'external' ? '在客户端内打开' : '在浏览器打开',
        icon: 'external',
        run: () => open(entry, entry.mode === 'external' ? 'internal' : 'external')
    });
    if (['file', 'folder'].includes(entry.type)) items.push({
        label: '在文件管理器中定位',
        icon: 'folder',
        run: () => call('reveal-resource', entry.id)
    });
    if (index > 0) items.push({
        label: '向前移动',
        icon: 'up',
        run: () => reorder('entries', entry.id, siblings[index - 1].id)
    });
    if (index < siblings.length - 1) items.push({
        label: '向后移动',
        icon: 'down',
        run: () => reorder('entries', entry.id, siblings[index + 1].id)
    });
    items.push(null, {
        label: '删除收藏',
        icon: 'trash',
        danger: true,
        run: () => showAction({
            title: '删除这条收藏？',
            description: `${entry.name}\n将关闭相关网页，并清除这个收藏的本地登录数据。`,
            hideTarget: true,
            danger: true,
            confirm: '删除收藏',
            action: async () => {
                await call('delete', entry.id);
                await refresh();
                toast('收藏已删除');
            }
        })
    });
    menu(anchor, items);
}

function categoryMenu(anchor, category) {
    const categories = state.categories.filter(c => c.id !== 'inbox'),
        index = categories.findIndex(c => c.id === category.id);
    const items = [{label: '编辑分类', icon: 'edit', run: () => showCategory(category)}];
    if (index > 0) items.push({
        label: '上移分类',
        icon: 'up',
        run: () => reorder('categories', category.id, categories[index - 1].id)
    });
    if (index < categories.length - 1) items.push({
        label: '下移分类',
        icon: 'down',
        run: () => reorder('categories', category.id, categories[index + 1].id)
    });
    items.push(null, {
        label: '删除分类', icon: 'trash', danger: true, run: () => {
            const count = state.entries.filter(e => e.categoryId === category.id).length;
            return showAction({
                title: `删除“${category.name}”？`,
                description: `其中的 ${count} 条收藏会转移至下方分类，收藏不会被删除。`,
                exclude: category.id,
                confirm: '转移并删除分类',
                danger: true,
                action: async targetId => {
                    await call('category-delete', {id: category.id, targetId});
                    await refresh();
                    toast('分类已删除，收藏已转移');
                }
            });
        }
    });
    menu(anchor, items);
}

function categoryOptions(select, selected, exclude) {
    select.replaceChildren();
    for (const category of state.categories) if (category.id !== exclude) {
        const option = el('option', '', category.name);
        option.value = category.id;
        select.append(option);
    }
    select.value = getCategory(selected) && selected !== exclude ? selected : 'inbox';
}

async function showEditor(entry = null, target = '') {
    hideMenu();
    await call('overlay', true);
    editing = entry?.id || null;
    const form = $('#entry-form');
    form.reset();
    form.querySelector('.form-error').textContent = '';
    $('#dialog-title').textContent = entry ? '编辑收藏' : '添加收藏';
    categoryOptions(form.elements.categoryId, entry?.categoryId || target || (filter === 'category' ? categoryId : state.categories.find(c => c.id !== 'inbox')?.id));
    for (const field of ['url', 'name', 'environment', 'note', 'mode', 'username', 'authMode', 'type', 'localPath', 'content']) form.elements[field].value = entry?.[field] || ({
        mode: 'internal',
        authMode: 'manual',
        type: 'web'
    }[field] || '');
    updateResourceFields();
    let editablePassword = entry?.password || '';
    if (!editablePassword && entry?.hasPassword) {
        try {
            editablePassword = await call('password', entry.id);
        } catch {
            toast('旧密码无法在当前系统读取，请重新填写；原密文已保留');
        }
    }
    form.elements.password.value = editablePassword;
    form.elements.password.placeholder = '直接查看、编辑或复制';
    form.elements.favorite.checked = entry?.favorite || false;
    $('#entry-details').open = !!entry;
    $('#entry-dialog').showModal();
}

function updateResourceFields() {
    const form = $('#entry-form'), type = form.elements.type.value, web = type === 'web',
        account = type === 'credential', local = ['file', 'folder'].includes(type);
    $('#resource-url-label').hidden = !web && !account;
    form.elements.url.required = web;
    form.elements.url.disabled = !web && !account;
    $('#resource-path-label').hidden = !local;
    form.elements.localPath.required = local;
    form.elements.localPath.disabled = !local;
    $('#resource-content-label').hidden = type !== 'text';
    form.elements.content.required = type === 'text';
    form.elements.content.disabled = type !== 'text';
    $('.credential-editor').hidden = !web && !account;
    if (account) $('#entry-details').open = true;
}

$('#resource-type').onchange = updateResourceFields;
$('#choose-resource').onclick = task(async () => {
    const value = await call('pick-resource', $('#resource-type').value);
    if (value) {
        $('#entry-form').elements.localPath.value = value;
        if (!$('#entry-form').elements.name.value) $('#entry-form').elements.name.value = value.split(/[\\/]/).at(-1);
    }
});

function renderPickers() {
    $('#icon-picker').replaceChildren();
    $('#color-picker').replaceChildren();
    const names = {game: '游戏', build: '构建', link: '链接', chart: '报表', server: '服务器', book: '文档'};
    for (const glyph of Object.keys(names)) {
        const node = button(names[glyph], glyph, () => {
            categoryIcon = glyph;
            renderPickers();
        }, `icon-button${categoryIcon === glyph ? ' selected' : ''}`);
        node.setAttribute('aria-pressed', categoryIcon === glyph);
        $('#icon-picker').append(node);
    }
    const colors = {sage: '鼠尾草绿', orange: '焦糖', blue: '雾蓝', purple: '灰紫', rose: '烟粉', slate: '石灰'};
    for (const color of Object.keys(colors)) {
        const node = button(colors[color], null, () => {
            categoryColor = color;
            renderPickers();
        }, `icon-button ${color}${categoryColor === color ? ' selected' : ''}`);
        node.setAttribute('aria-pressed', categoryColor === color);
        $('#color-picker').append(node);
    }
}

async function showCategory(category = null) {
    hideMenu();
    await call('overlay', true);
    editingCategory = category?.id || null;
    const form = $('#category-form');
    form.reset();
    form.querySelector('.form-error').textContent = '';
    form.elements.name.value = category?.name || '';
    form.elements.description.value = category?.description || '';
    categoryColor = category?.color || 'sage';
    categoryIcon = category?.icon || 'link';
    renderPickers();
    $('#category-dialog-title').textContent = category ? '编辑分类' : '新建分类';
    $('#category-dialog').showModal();
}

async function showAction(options) {
    hideMenu();
    await call('overlay', true);
    $('#action-title').textContent = options.title;
    $('#action-description').textContent = options.description;
    $('#action-dialog .form-error').textContent = '';
    $('#target-label').hidden = !!options.hideTarget;
    categoryOptions($('#target-category'), options.selected, options.exclude);
    $('#action-confirm').textContent = options.confirm;
    $('#action-confirm').className = options.danger ? 'primary danger' : 'primary';
    actionCallback = options.action;
    $('#action-dialog').showModal();
}

document.querySelectorAll('dialog').forEach(dialog => {
    dialog.querySelectorAll('.dialog-close,.cancel-dialog').forEach(node => {
        node.onclick = () => dialog.close();
    });
    dialog.addEventListener('close', () => {
        void call('overlay', !!document.querySelector('dialog[open]'));
    });
});
$('#entry-form').onsubmit = async event => {
    event.preventDefault();
    const submit = event.currentTarget.querySelector('[type=submit]');
    submit.disabled = true;
    try {
        const data = Object.fromEntries(new FormData(event.currentTarget));
        data.favorite = event.currentTarget.elements.favorite.checked;
        data.clearPassword = event.currentTarget.elements.clearPassword.checked;
        if (editing) data.id = editing;
        await call('save', data);
        $('#entry-dialog').close();
        await refresh();
        toast('收藏已保存');
    } catch (error) {
        $('#entry-form .form-error').textContent = error.message;
    } finally {
        submit.disabled = false;
    }
};
$('#category-form').onsubmit = async event => {
    event.preventDefault();
    const submit = event.currentTarget.querySelector('[type=submit]');
    submit.disabled = true;
    try {
        const data = {
            ...Object.fromEntries(new FormData(event.currentTarget)),
            color: categoryColor,
            icon: categoryIcon
        };
        if (editingCategory) data.id = editingCategory;
        const category = await call('category-save', data);
        $('#category-dialog').close();
        filter = 'category';
        categoryId = category.id;
        await refresh();
        await call('home');
        toast('分类已保存');
    } catch (error) {
        $('#category-form .form-error').textContent = error.message;
    } finally {
        submit.disabled = false;
    }
};
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
document.querySelectorAll('[data-filter]').forEach(node => {
    node.onclick = () => selectFilter(node.dataset.filter);
});
$('#add-button').onclick = $('#empty-add').onclick = task(() => showEditor());
$('#new-category').onclick = task(() => showCategory());
$('#category-menu-button').onclick = event => categoryMenu(event.currentTarget, getCategory(categoryId));
$('#search').oninput = render;
$('#sort').onchange = render;
$('#clear-search').onclick = () => {
    $('#search').value = '';
    render();
    $('#search').focus();
};
for (const name of ['grid', 'list']) $(`#${name}-view`).onclick = () => {
    view = name;
    localStorage.setItem('bookmark-view', name);
    render();
};

document.addEventListener('pointerdown', event => {
    if (!event.target.closest('#popup-menu')) hideMenu();
});
document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (!document.querySelector('dialog[open]')) {
            void selectFilter('all').then(() => $('#search').focus());
        }
    }
    if (event.key === 'Escape') hideMenu();
    if (!$('#popup-menu').hidden && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault();
        const buttons = [...$('#popup-menu').querySelectorAll('button')];
        const index = buttons.indexOf(document.activeElement);
        buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus();
    }
});
window.addEventListener('resize', hideMenu);
document.addEventListener('scroll', hideMenu, true);
$('#return-tabs').onclick = task(() => call('activate', tabsState.active));

function renderTabs(next) {
    tabsState = next;
    updateViews();
    $('#tab-count').hidden = !next.tabs.length;
    $('#tab-count').textContent = `${next.tabs.length} 个网页`;
    $('#return-tabs').hidden = !next.dashboard || !next.tabs.length;
    $('#tabs').replaceChildren();
    for (const tab of next.tabs) {
        const node = el('div', `tab${next.active === tab.id ? ' active' : ''}`);
        node.tabIndex = 0;
        node.setAttribute('role', 'tab');
        node.setAttribute('aria-selected', next.active === tab.id);
        const title = el('span', '', `${tab.loading ? '◌ ' : ''}${tab.name}`);
        title.title = `${tab.title}\n${tab.url}`;
        node.append(title, button('关闭网页', 'close', event => {
            event.stopPropagation();
            return call('close', tab.id);
        }, 'icon-button'));
        node.onclick = task(() => call('activate', tab.id));
        node.onkeydown = task(event => {
            if (event.key === 'Enter') return call('activate', tab.id);
        });
        $('#tabs').append(node);
    }
    const tab = next.tabs.find(t => t.id === next.active);
    if (tab) {
        $('#login-card-button').hidden = !tab.hasCredentials;
        $('#environment-badge').textContent = tab.environment || tab.name;
        $('#environment-badge').className = `badge ${tab.color}`;
        $('#current-url').textContent = tab.url;
        $('#current-url').title = tab.url;
        $('#back').disabled = !tab.back;
        $('#forward').disabled = !tab.forward;
        $('#page-state').hidden = !tab.error && !tab.loading;
        $('#page-state-title').textContent = tab.error ? '这个地址暂时无法打开' : '正在打开网页';
        $('#page-state-message').textContent = tab.error || tab.url;
        $('#retry').hidden = !tab.error;
    }
    $('#return-tabs').hidden = !next.dashboard || !next.tabs.length;
}

for (const name of ['back', 'forward', 'reload']) $(`#${name}`).onclick = task(() => call('navigation', name));
$('#retry').onclick = task(() => call('navigation', 'reload'));
$('#external').onclick = task(() => call('external', tabsState.active));
api.onSearch(() => {
    currentSection = 'bookmarks';
    filter = 'all';
    categoryId = '';
    $('#search').value = '';
    render();
    updateViews();
    $('#search').focus();
});

async function showCredentials(entry) {
    hideMenu();
    await call('overlay', true);
    credentialEntry = entry;
    $('#credential-name').textContent = entry.name;
    $('#credential-username').value = entry.username || '';
    $('#credential-password').type = 'text';
    $('#credential-password').value = entry.password || (entry.hasPassword ? await call('password', entry.id) : '');
    $('#credential-password').placeholder = '未保存密码';
    $('#reveal-password').textContent = '隐藏密码';
    $('#credential-dialog').showModal();
}

$('#credential-dialog').addEventListener('close', () => {
    $('#credential-password').value = '';
    credentialEntry = null;
});
$('#copy-username').onclick = task(async () => {
    await call('copy-credential', {id: credentialEntry.id, field: 'username'});
    toast('账号已复制');
});
$('#copy-password').onclick = task(async () => {
    await call('copy-credential', {id: credentialEntry.id, field: 'password'});
    toast('密码已复制');
});
$('#reveal-password').onclick = task(async () => {
    if ($('#credential-password').type === 'password') {
        $('#credential-password').value = await call('password', credentialEntry.id);
        $('#credential-password').type = 'text';
        $('#reveal-password').textContent = '隐藏密码';
    } else {
        $('#credential-password').type = 'password';
        $('#reveal-password').textContent = '显示密码';
    }
});
api.onEvent('data-changed', () => {
    void refresh();
});
api.onEvent('reminder-error', message => {
    $('#notification-status').textContent = message;
});
api.onEvent('reminder', data => {
    toast(`到时间了：${data.title}`);
    void refresh();
});
api.onEvent('open-section', section => {
    currentSection = section;
    updateViews();
});
api.onTabs(renderTabs);
void refresh().catch(error => toast(error.message));
$('#login-card-button').onclick = task(() => call('login-card'));
$('#editor-copy-password').onclick = task(async () => {
    const input = $('#entry-form').elements.password;
    await call('copy-text', input.value);
    toast('密码已复制');
});
