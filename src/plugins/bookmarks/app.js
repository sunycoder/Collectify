let filter = 'all',
    categoryId = '',
    editing = null,
    editingCategory = null,
    categoryColor = 'sage',
    categoryIcon = 'link',
    dragData,
    credentialEntry = null;
let tabsState = { tabs: [], active: null, dashboard: true },
    collectionScroll = 0,
    lastOpenedEntryId = null,
    viewedResource = null,
    view = 'grid';
let lastNavigation;
function symbol(category, className = 'category-symbol') {
    const node = el('span', `${className} ${category.color}`);
    node.append(icon(category.icon));
    return node;
}

function getCategory(id) {
    return state.categories.find((c) => c.id === id);
}

async function refresh() {
    state = await call('state');
    if (filter === 'category' && !getCategory(categoryId)) filter = 'all';
    render();
    updateViews();
}

function updateViews() {
    $('#dashboard').hidden = !tabsState.dashboard;
    $('#workspace').hidden = tabsState.dashboard;
}

function selectFilter(next, id = '') {
    filter = next;
    categoryId = id;
    $('#search').value = '';
    hideMenu();
    render();
    return call('home').catch((error) => toast(error.message));
}

function filteredEntries() {
    const query = $('#search').value.trim().toLocaleLowerCase();
    let entries = state.entries.filter(
        (e) =>
            (filter !== 'category' || e.categoryId === categoryId) &&
            (filter !== 'favorite' || e.favorite) &&
            (filter !== 'recent' || e.lastOpened) &&
            [e.name, e.url, e.localPath, e.content, e.note, e.environment, getCategory(e.categoryId)?.name || ''].some(
                (s) => (s || '').toLocaleLowerCase().includes(query)
            )
    );
    const sort = filter === 'recent' ? 'recent' : $('#sort').value;
    if (sort === 'name') entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    if (sort === 'recent') entries.sort((a, b) => b.lastOpened - a.lastOpened);
    return entries;
}

function render() {
    const route = filter === 'category' ? `category:${categoryId}` : filter;
    if (lastNavigation !== route) {
        lastNavigation = route;
        void collectify.selectNavigation(route).catch(() => {});
    }
    $('#config-source').textContent =
        `${state.configSource === 'imported' ? '已导入 · ' + state.sourceName : state.configSource === 'default' ? '默认配置 · ' + state.sourceName : '本机收藏'} · 自动持久化`;
    const current = getCategory(categoryId);
    const title =
        filter === 'category'
            ? current.name
            : {
                  all: '全部收藏',
                  favorite: '已置顶',
                  recent: '最近打开'
              }[filter];
    $('#heading').textContent = title;
    $('#description').textContent =
        filter === 'category'
            ? current.description || `属于 ${current.name} 的工作地址，都在这里。`
            : {
                  all: '常用的工作地址，按你的习惯整理。',
                  favorite: '把最常用的地址留在手边。',
                  recent: '刚刚用过的地址，随时接着打开。'
              }[filter];
    $('#category-menu-button').hidden = filter !== 'category' || categoryId === 'inbox';
    const overview = $('#category-overview');
    overview.replaceChildren();
    overview.hidden = filter !== 'all' || !!$('#search').value.trim();
    const overviewCategories = state.categories.filter((c) => c.id !== 'inbox').slice(0, 3);
    for (const category of overviewCategories) {
        const node = button(category.name, null, () => selectFilter('category', category.id), 'category-summary');
        const info = el('div');
        info.append(el('span', 'summary-name', category.name), el('small', '', '浏览分类'));
        node.replaceChildren(
            symbol(category),
            info,
            el(
                'span',
                'summary-count',
                String(state.entries.filter((e) => e.categoryId === category.id).length).padStart(2, '0')
            )
        );
        overview.append(node);
    }
    if (overviewCategories.length < 3)
        overview.append(
            button('创建一个新分类', 'plus', () => showCategory(), 'category-summary category-summary-new')
        );
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
    $('#empty-title').textContent = $('#search').value
        ? '没有找到匹配的收藏'
        : filter === 'recent'
          ? '还没有打开过收藏'
          : filter === 'favorite'
            ? '把常用的收藏置顶到这里'
            : '给这个分类收下第一个地址';
    $('#empty-description').textContent = $('#search').value
        ? '换个关键词，或清空搜索再看看。'
        : filter === 'recent'
          ? '打开任意收藏后，会按时间排列在这里。'
          : filter === 'favorite'
            ? '点击收藏卡片上的图钉，就能快速找到它。'
            : '填上名称和网址，下次就能一键打开。';
    $('#empty-add').hidden = !!$('#search').value || ['recent', 'favorite'].includes(filter);
    if (filter === 'category' || filter === 'recent') {
        if (entries.length)
            $('#entries').append(section(entries, filter === 'category' ? current : null, filter === 'category'));
    } else
        for (const category of state.categories) {
            const items = entries.filter((e) => e.categoryId === category.id);
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
    const category = getCategory(entry.categoryId),
        node = el('article', `bookmark-card ${category.color}`);
    node.dataset.id = entry.id;
    node.tabIndex = 0;
    node.setAttribute('role', 'link');
    node.setAttribute('aria-label', `打开 ${entry.name}`);
    node.onclick = task((event) => {
        if (!event.target.closest('button') && !window.getSelection().toString()) return open(entry);
    });
    node.onkeydown = task((event) => {
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
    if (entry.environment)
        tags.append(
            el('span', `tag${/prod|生产|正式/i.test(entry.environment) ? ' production' : ''}`, entry.environment)
        );
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
    const resourceLabels = { web: '网页', file: '文件', folder: '文件夹', text: '文本片段', credential: '账号资料' };
    tags.prepend(el('span', 'resource-type-tag', resourceLabels[entry.type || 'web']));
    const address = el('div', 'card-address');
    address.title = entry.url || entry.localPath || '';
    let displayText =
        entry.localPath ||
        entry.username ||
        (entry.type === 'text' ? entry.content.replace(/\s+/g, ' ').slice(0, 70) : '');
    if (entry.url) {
        const display = new URL(entry.url);
        displayText = display.host + (display.pathname === '/' ? '' : display.pathname) + display.search + display.hash;
    }
    address.append(
        icon(
            {
                file: 'book',
                folder: 'folder',
                text: 'edit',
                credential: 'lock'
            }[entry.type] || 'globe'
        ),
        el('span', '', displayText)
    );
    const bottom = el('div', 'card-bottom');
    const label = el(
        'span',
        'card-open',
        entry.type === 'text'
            ? '查看文本'
            : entry.type === 'credential'
              ? '查看资料'
              : ['file', 'folder'].includes(entry.type)
                ? '打开本地资源'
                : state.settings.browserOpenMode === 'external'
                  ? '浏览器打开'
                  : '打开网页'
    );
    label.append(icon('arrow'));
    bottom.append(
        label,
        button(
            entry.favorite ? '取消置顶' : '置顶收藏',
            'pin',
            async () => {
                await call('save', { ...entry, favorite: !entry.favorite });
                await refresh();
            },
            `icon-button${entry.favorite ? ' pinned' : ''}`
        ),
        button(
            entry.type === 'text' ? '复制内容' : ['file', 'folder'].includes(entry.type) ? '复制路径' : '复制网址',
            'copy',
            async () => {
                await call('copy', entry.id);
                toast('已复制');
            },
            'icon-button'
        ),
        button('更多操作', 'more', (event) => entryMenu(event.currentTarget, entry), 'icon-button')
    );
    node.append(top, name, note, address, bottom);
    node.draggable = $('#sort').value === 'manual' && filter !== 'recent';
    node.ondragstart = (event) => {
        dragData = { kind: 'entry', id: entry.id };
        node.classList.add('dragging');
        event.dataTransfer.setData('text/plain', entry.name);
        event.dataTransfer.setData(
            'application/collectify-plugin',
            JSON.stringify({ pluginId: 'collectify.bookmarks', data: dragData })
        );
        event.dataTransfer.effectAllowed = 'move';
    };
    node.ondragend = clearDrag;
    node.ondragover = (event) => {
        if (dragData?.kind === 'entry' && dragData.id !== entry.id && node.draggable) {
            event.preventDefault();
            node.classList.add('drop-target');
        }
    };
    node.ondragleave = () => node.classList.remove('drop-target');
    node.ondrop = task(async (event) => {
        event.preventDefault();
        node.classList.remove('drop-target');
        if (dragData?.kind === 'entry' && node.draggable) await reorder('entries', dragData.id, entry.id);
    });
    return node;
}

function clearDrag() {
    dragData = null;
    document.querySelectorAll('.drop-target,.dragging').forEach((n) => n.classList.remove('drop-target', 'dragging'));
}

async function reorder(kind, source, target) {
    const ids = state[kind].map((item) => item.id),
        from = ids.indexOf(source),
        to = ids.indexOf(target);
    if (from < 0 || to < 0 || from === to) return;
    ids.splice(from, 1);
    ids.splice(to, 0, source);
    await call('reorder', { kind, ids });
    await refresh();
}

async function moveEntry(entry, target) {
    if (entry.categoryId === target) return;
    await call('save', { ...entry, categoryId: target });
    await refresh();
    toast(`已移至 ${getCategory(target).name}`, async () => {
        const latest = state.entries.find((e) => e.id === entry.id);
        if (latest && getCategory(entry.categoryId)) {
            await call('save', { ...latest, categoryId: entry.categoryId });
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
    await call('open', { id: entry.id, mode });
    await refresh();
    if (!tabsState.dashboard) window.scrollTo(0, 0);
}

async function returnToCollection() {
    await call('home');
    updateViews();
    requestAnimationFrame(() => {
        window.scrollTo(0, collectionScroll);
        if (lastOpenedEntryId)
            document.querySelector(`.bookmark-card[data-id="${lastOpenedEntryId}"]`)?.focus({ preventScroll: true });
    });
}

$('#back-to-library').onclick = task(returnToCollection);
$('#copy-resource').onclick = task(async () => {
    await call('copy', viewedResource.id);
    toast('文本已复制');
});

function entryMenu(anchor, entry) {
    const siblings = state.entries.filter((e) => e.categoryId === entry.categoryId),
        index = siblings.findIndex((e) => e.id === entry.id);
    const items = [
        { label: '编辑收藏', icon: 'edit', run: () => showEditor(entry) },
        { label: '创建关联待办', icon: 'list', run: () => showTask(null, { bookmarkId: entry.id, title: entry.name }) },
        {
            label: '移动到分类…',
            icon: 'folder',
            run: () =>
                showAction({
                    title: '移动收藏',
                    description: entry.name,
                    selected: entry.categoryId,
                    confirm: '移动',
                    action: (target) => moveEntry(entry, target)
                })
        }
    ];
    if (entry.type === 'web' || entry.type === 'credential')
        items.splice(1, 0, {
            label: '查看登录资料',
            icon: 'lock',
            run: () => showCredentials(entry)
        });
    if (entry.type === 'web' || !entry.type)
        items.push({
            label: state.settings.browserOpenMode === 'external' ? '在客户端内打开' : '在浏览器打开',
            icon: 'external',
            run: () => open(entry, state.settings.browserOpenMode === 'external' ? 'internal' : 'external')
        });
    if (['file', 'folder'].includes(entry.type))
        items.push({
            label: '在文件管理器中定位',
            icon: 'folder',
            run: () => call('reveal-resource', entry.id)
        });
    if (index > 0)
        items.push({
            label: '向前移动',
            icon: 'up',
            run: () => reorder('entries', entry.id, siblings[index - 1].id)
        });
    if (index < siblings.length - 1)
        items.push({
            label: '向后移动',
            icon: 'down',
            run: () => reorder('entries', entry.id, siblings[index + 1].id)
        });
    items.push(null, {
        label: '删除收藏',
        icon: 'trash',
        danger: true,
        run: () =>
            showAction({
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
    const categories = state.categories.filter((c) => c.id !== 'inbox'),
        index = categories.findIndex((c) => c.id === category.id);
    const items = [{ label: '编辑分类', icon: 'edit', run: () => showCategory(category) }];
    if (index > 0)
        items.push({
            label: '上移分类',
            icon: 'up',
            run: () => reorder('categories', category.id, categories[index - 1].id)
        });
    if (index < categories.length - 1)
        items.push({
            label: '下移分类',
            icon: 'down',
            run: () => reorder('categories', category.id, categories[index + 1].id)
        });
    items.push(null, {
        label: '删除分类',
        icon: 'trash',
        danger: true,
        run: () => {
            const count = state.entries.filter((e) => e.categoryId === category.id).length;
            return showAction({
                title: `删除“${category.name}”？`,
                description: `其中的 ${count} 条收藏会转移至下方分类，收藏不会被删除。`,
                exclude: category.id,
                confirm: '转移并删除分类',
                danger: true,
                action: async (targetId) => {
                    await call('category-delete', { id: category.id, targetId });
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
    for (const category of state.categories)
        if (category.id !== exclude) {
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
    categoryOptions(
        form.elements.categoryId,
        entry?.categoryId ||
            target ||
            (filter === 'category' ? categoryId : state.categories.find((c) => c.id !== 'inbox')?.id)
    );
    for (const field of ['url', 'name', 'environment', 'note', 'username', 'authMode', 'type', 'localPath', 'content'])
        form.elements[field].value =
            entry?.[field] ||
            {
                mode: 'internal',
                authMode: 'manual',
                type: 'web'
            }[field] ||
            '';
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
    const form = $('#entry-form'),
        type = form.elements.type.value,
        web = type === 'web',
        account = type === 'credential',
        local = ['file', 'folder'].includes(type);
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
    const names = { game: '游戏', build: '构建', link: '链接', chart: '报表', server: '服务器', book: '文档' };
    for (const glyph of Object.keys(names)) {
        const node = button(
            names[glyph],
            glyph,
            () => {
                categoryIcon = glyph;
                renderPickers();
            },
            `icon-button${categoryIcon === glyph ? ' selected' : ''}`
        );
        node.setAttribute('aria-pressed', categoryIcon === glyph);
        $('#icon-picker').append(node);
    }
    const colors = { sage: '鼠尾草绿', orange: '焦糖', blue: '雾蓝', purple: '灰紫', rose: '烟粉', slate: '石灰' };
    for (const color of Object.keys(colors)) {
        const node = button(
            colors[color],
            null,
            () => {
                categoryColor = color;
                renderPickers();
            },
            `icon-button ${color}${categoryColor === color ? ' selected' : ''}`
        );
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

$('#entry-form').onsubmit = async (event) => {
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
$('#category-form').onsubmit = async (event) => {
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
document.querySelectorAll('[data-filter]').forEach((node) => {
    node.onclick = () => selectFilter(node.dataset.filter);
});
$('#add-button').onclick = $('#empty-add').onclick = task(() => showEditor());
$('#new-category').onclick = task(() => showCategory());
$('#category-menu-button').onclick = (event) => categoryMenu(event.currentTarget, getCategory(categoryId));
$('#search').oninput = render;
$('#sort').onchange = render;
$('#clear-search').onclick = () => {
    $('#search').value = '';
    render();
    $('#search').focus();
};
for (const name of ['grid', 'list'])
    $(`#${name}-view`).onclick = () => {
        view = name;
        void collectify.storage.set('view', name);
        render();
    };

document.addEventListener('pointerdown', (event) => {
    if (!event.target.closest('#popup-menu')) hideMenu();
});
document.addEventListener('keydown', (event) => {
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
        node.append(
            title,
            button(
                '关闭网页',
                'close',
                (event) => {
                    event.stopPropagation();
                    return call('close', tab.id);
                },
                'icon-button'
            )
        );
        node.onclick = task(() => call('activate', tab.id));
        node.onkeydown = task((event) => {
            if (event.key === 'Enter') return call('activate', tab.id);
        });
        $('#tabs').append(node);
    }
    const tab = next.tabs.find((t) => t.id === next.active);
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
    await call('copy-credential', { id: credentialEntry.id, field: 'username' });
    toast('账号已复制');
});
$('#copy-password').onclick = task(async () => {
    await call('copy-credential', { id: credentialEntry.id, field: 'password' });
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
api.onTabs(renderTabs);
// 后续的待办、日历和设置脚本全部就绪后再做首次刷新，避免 IPC 提前返回时漏掉界面初始化。
document.addEventListener(
    'DOMContentLoaded',
    () => {
        void refresh().catch((error) => toast(error.message));
    },
    { once: true }
);
$('#login-card-button').onclick = task(() => call('login-card'));
$('#editor-copy-password').onclick = task(async () => {
    const input = $('#entry-form').elements.password;
    await call('copy-text', input.value);
    toast('密码已复制');
});

collectify.onNavigate(({ route, payload }) => {
    if (route === 'new-category') return showCategory();
    if (route?.startsWith('category:')) {
        const id = route.slice(9);
        if (payload?.drag?.kind === 'entry') {
            const entry = state.entries.find((e) => e.id === payload.drag.id);
            if (entry) return moveEntry(entry, id);
        }
        if (payload?.drag?.kind === 'category' && id !== 'inbox') return reorder('categories', payload.drag.id, id);
        return selectFilter('category', id);
    }
    if (['all', 'favorite', 'recent'].includes(route)) return selectFilter(route);
});
window.addEventListener('resize', reportBrowserBounds);
function reportBrowserBounds() {
    if (!tabsState.dashboard)
        void call('browser-bounds', { top: document.querySelector('.browser-toolbar').getBoundingClientRect().bottom });
}
api.onTabs(() => requestAnimationFrame(reportBrowserBounds));
collectify.storage.get('view').then((value) => {
    if (['grid', 'list'].includes(value)) {
        view = value;
        if (state.entries.length) render();
    }
});
