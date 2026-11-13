const $ = (selector) => document.querySelector(selector),
    api = window.collectify;
let settings,
    filter = 'all',
    items = [],
    selected = null,
    total = 0,
    searchRevision = 0,
    previewRevision = 0,
    loading = false,
    dragIndex = -1,
    draft = null,
    pdfTask = null;
const make = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
};
const call = (action, data) => api.invoke(action, data);
const message = (text, error = false) => {
    ToolUI.message(text, error);
};
const run =
    (action) =>
    async (...args) => {
        try {
            await action(...args);
        } catch (error) {
            message(error.message, true);
        }
    };
function bytes(value) {
    if (value < 1024) return value + ' B';
    if (value < 1024 * 1024) return (value / 1024).toFixed(1) + ' KB';
    return (value / 1024 / 1024).toFixed(1) + ' MB';
}
function button(label, action, cls = '') {
    const node = make('button', cls, label);
    node.type = 'button';
    node.onclick = run(action);
    return node;
}
function highlight(text) {
    const fragment = document.createDocumentFragment(),
        terms = $('#query').value.trim().split(/\s+/).filter(Boolean);
    if (!terms.length) {
        fragment.append(text);
        return fragment;
    }
    const pattern = new RegExp(
        '(' + terms.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')',
        'ig'
    );
    let last = 0;
    for (const match of text.matchAll(pattern)) {
        fragment.append(text.slice(last, match.index), make('mark', '', match[0]));
        last = match.index + match[0].length;
    }
    fragment.append(text.slice(last));
    return fragment;
}
function fileIcon(item) {
    if (item.directory) return 'folder';
    const extension = item.name.split('.').at(-1).toLowerCase();
    return (
        {
            png: 'image',
            jpg: 'image',
            jpeg: 'image',
            webp: 'image',
            svg: 'image',
            gif: 'image',
            psd: 'image',
            xls: 'table',
            xlsx: 'table',
            csv: 'table',
            mp4: 'video',
            webm: 'video',
            mp3: 'music',
            wav: 'music',
            flac: 'music',
            zip: 'archive',
            gz: 'archive',
            rar: 'archive',
            '7z': 'archive',
            js: 'code',
            ts: 'code',
            go: 'code',
            java: 'code'
        }[extension] || 'file-text'
    );
}
function renderResults(append = false) {
    const list = $('#results');
    if (!append) list.replaceChildren();
    const existing = new Set([...list.children].map((node) => node.dataset.id));
    for (const item of items) {
        if (existing.has(item.id)) continue;
        const row = make('div', 'result-row' + (item.id === selected ? ' selected' : ''));
        row.dataset.id = item.id;
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', String(item.id === selected));
        row.title = item.path;
        const glyph = make('span', 'file-glyph' + (item.directory ? ' folder' : ''));
        glyph.append(searchIcon(fileIcon(item)));
        const content = make('div', 'result-copy'),
            name = make('div', 'result-name');
        name.append(highlight(item.name));
        content.append(name, make('div', 'result-parent', item.parent));
        row.append(glyph, content, make('span', 'result-meta', item.directory ? '文件夹' : bytes(item.size)));
        row.onclick = () => select(item.id);
        row.ondblclick = run(() => call('open', { id: item.id }));
        row.oncontextmenu = (event) => {
            event.preventDefault();
            select(item.id);
            const menu = $('#result-menu');
            menu.showPopover();
            menu.style.left = Math.max(8, Math.min(event.clientX, innerWidth - 185)) + 'px';
            menu.style.top = Math.max(8, Math.min(event.clientY, innerHeight - 125)) + 'px';
        };
        list.append(row);
    }
    $('#empty').hidden = !!items.length;
    $('#load-more').hidden = items.length >= total;
    $('#result-count').textContent = total ? total.toLocaleString() : '';
    $('#footer-count').textContent = `共 ${total.toLocaleString()} 条结果`;
}
async function search(append = false) {
    const revision = ++searchRevision;
    loading = true;
    $('#load-more').disabled = true;
    $('#results').classList.add('busy');
    if (!append) {
        items = [];
        selected = null;
        previewRevision++;
        $('#preview').replaceChildren(make('div', 'preview-empty', '选择一个结果查看预览'));
        renderResults();
    }
    try {
        const result = await call('search', {
            query: $('#query').value,
            filter,
            sort: $('#sort').value,
            offset: append ? items.length : 0
        });
        if (revision !== searchRevision) return;
        items = append ? [...items, ...result.items] : result.items;
        total = result.total;
        renderResults(append);
        message(
            result.limited
                ? `文件夹搜索达到范围或时间上限，当前为 ${result.visited.toLocaleString()} 个已检查项目中的结果。`
                : `${result.engine === 'everything' ? 'Everything' : '文件夹搜索'} · ${total.toLocaleString()} 条结果`
        );
        if (!items.length) {
            $('#empty').querySelector('h2').textContent = '没有找到匹配文件';
            $('#empty').querySelector('p').textContent = '试试更短的关键词、其他分类，或检查搜索范围。';
        }
    } catch (error) {
        if (revision === searchRevision) {
            total = 0;
            renderResults();
            message(error.message, true);
            $('#empty').querySelector('h2').textContent = '搜索尚未准备好';
            $('#empty').querySelector('p').textContent = error.message;
        }
    } finally {
        if (revision === searchRevision) {
            loading = false;
            $('#load-more').disabled = false;
            $('#results').classList.remove('busy');
        }
    }
}
function clearPreview() {
    if (pdfTask) {
        void pdfTask.destroy();
        pdfTask = null;
    }
    $('#preview')
        .querySelectorAll('audio,video')
        .forEach((media) => {
            media.pause();
            media.removeAttribute('src');
            media.load();
        });
}
async function select(id, sheetIndex = 0) {
    selected = id;
    const revision = ++previewRevision;
    document.querySelectorAll('.result-row').forEach((row) => {
        const active = row.dataset.id === id;
        row.classList.toggle('selected', active);
        row.setAttribute('aria-selected', String(active));
    });
    if (!settings.preview) return;
    clearPreview();
    $('#preview').replaceChildren(make('div', 'preview-empty', '正在读取文件…'));
    try {
        const result = await call('preview', { id, sheetIndex });
        if (revision !== previewRevision) return;
        renderPreview(result, revision);
    } catch (error) {
        if (revision === previewRevision) $('#preview').replaceChildren(make('div', 'metadata-message', error.message));
    }
}
function renderPreview(result, revision) {
    const panel = $('#preview'),
        header = make('div', 'preview-heading');
    header.append(
        make('h2', '', result.name),
        make('p', '', result.path),
        make(
            'p',
            '',
            `${result.directory ? '文件夹' : bytes(result.size)} · 修改于 ${new Date(result.modified).toLocaleString()}`
        )
    );
    const actions = make('div', 'preview-actions');
    actions.append(
        button('打开', () => call('open', { id: selected })),
        button('显示位置', () => call('reveal', { id: selected })),
        button('复制路径', async () => {
            await api.clipboard.writeText(await call('path', { id: selected }));
            message('已复制完整路径');
        })
    );
    header.append(actions);
    const content = make('div', 'preview-content');
    panel.replaceChildren(header, content);
    if (result.kind === 'image') {
        content.classList.add('media');
        const image = make('img');
        image.alt = result.name;
        image.src = result.url;
        image.onload = () => {
            if (revision === previewRevision) image.title = `${image.naturalWidth} × ${image.naturalHeight}`;
        };
        image.onerror = () => {
            content.replaceChildren(make('div', 'metadata-message', '图像解码失败，请使用外部程序打开。'));
        };
        content.append(image);
    } else if (['audio', 'video'].includes(result.kind)) {
        content.classList.add('media');
        const media = make(result.kind);
        media.controls = true;
        media.preload = 'metadata';
        media.src = result.url;
        media.onerror = () => {
            content.replaceChildren(
                make('div', 'metadata-message', '当前内核无法解码此媒体格式，或文件已移动。可使用外部程序打开。')
            );
        };
        content.append(media);
    } else if (result.kind === 'text') {
        content.append(make('pre', '', result.text));
        if (result.truncated) panel.append(make('div', 'preview-notice', '预览已截断，打开原文件可查看完整内容。'));
        if (result.encoding) panel.append(make('div', 'preview-notice', `文本编码：${result.encoding}`));
    } else if (result.kind === 'table') {
        content.classList.add('table');
        const tabs = make('div', 'table-tabs');
        result.sheets.forEach((name, index) =>
            tabs.append(button(name, () => select(selected, index), index === result.selected ? 'active' : ''))
        );
        content.append(tabs);
        const table = make('table'),
            thead = make('thead'),
            tr = make('tr');
        tr.append(make('th', '', '#'));
        const columns = Math.max(0, ...result.rows.map((row) => row.length));
        for (let i = 0; i < columns; i++) tr.append(make('th', '', String(i + 1)));
        thead.append(tr);
        table.append(thead);
        result.rows.forEach((cells, index) => {
            const row = make('tr');
            row.append(make('td', 'index', index + 1));
            for (let c = 0; c < columns; c++) row.append(make('td', '', cells[c] || ''));
            table.append(row);
        });
        content.append(table);
        panel.append(
            make('div', 'preview-notice', '表格只读预览 · 最多 200 行、40 列；公式仅显示文件内已有的缓存结果。')
        );
    } else if (result.kind === 'archive') {
        const table = make('table');
        for (const file of result.rows) {
            const row = make('tr');
            row.append(
                make('td', '', (file.directory ? '▣ ' : '') + file.name),
                make('td', '', file.directory ? '文件夹' : bytes(Number(file.size) || 0))
            );
            table.append(row);
        }
        content.append(table);
        if (!result.rows.length) content.append(make('p', 'metadata-message', '压缩包中没有可列出的文件。'));
        if (result.truncated) panel.append(make('div', 'preview-notice', '仅展示前 1000 个条目。'));
    } else if (result.kind === 'pdf') {
        void pdfPreview(result.url, content, revision);
    } else
        content.append(
            make('p', 'metadata-message', result.message || '此格式暂不支持内容预览，可以使用外部程序打开。')
        );
}
async function pdfPreview(url, content, revision) {
    try {
        pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('vendor/pdf.worker.js', location.href).href;
        const response = await fetch(url);
        if (!response.ok) throw Error('预览资源已过期');
        const length = Number(response.headers.get('Content-Length'));
        if (length > 32 * 1024 * 1024) throw Error('PDF 超过 32 MB，请用外部程序打开');
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (revision !== previewRevision) return;
        const loadingTask = pdfjsLib.getDocument({
            data: bytes,
            disableFontFace: true,
            useSystemFonts: true,
            isEvalSupported: false
        });
        pdfTask = loadingTask;
        const pdf = await loadingTask.promise;
        if (revision !== previewRevision) {
            await loadingTask.destroy();
            return;
        }
        let page = 1,
            rendering = false;
        const toolbar = make('div', 'pdf-toolbar'),
            label = make('span'),
            canvas = make('canvas', 'pdf-canvas');
        const draw = async () => {
            if (rendering) return;
            rendering = true;
            try {
                const doc = await pdf.getPage(page);
                if (revision !== previewRevision) return;
                const original = doc.getViewport({ scale: 1 }),
                    viewport = doc.getViewport({ scale: Math.min(1.5, (content.clientWidth - 35) / original.width) });
                canvas.width = viewport.width;
                canvas.height = viewport.height;
                await doc.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
                label.textContent = `${page} / ${pdf.numPages}`;
            } finally {
                rendering = false;
            }
        };
        toolbar.append(
            button('上一页', async () => {
                if (page > 1 && !rendering) {
                    page--;
                    await draw();
                }
            }),
            label,
            button('下一页', async () => {
                if (page < pdf.numPages && !rendering) {
                    page++;
                    await draw();
                }
            })
        );
        content.replaceChildren(toolbar, canvas);
        await draw();
    } catch (error) {
        if (revision === previewRevision)
            content.replaceChildren(make('div', 'pdf-error', 'PDF 预览失败：' + error.message));
    }
}
function updateState(state) {
    settings = state.settings;
    $('#sort').value = settings.sort;
    $('#preview-toggle').checked = settings.preview;
    $('.search-layout').classList.toggle('preview-off', !settings.preview);
    $('#engine-status').textContent = state.source;
    $('#engine-status').classList.toggle('ready', state.connected || state.roots.length > 0);
    $('#scope').textContent = state.roots.join('；');
    $('#scope').title = state.roots.join('\n');
    $('#connect').hidden = state.platform !== 'win32';
    $('#engine-window').hidden = state.platform !== 'win32';
}
$('#connect').onclick = run(async () => {
    const node = $('#connect');
    node.disabled = true;
    message('正在连接 Everything…');
    try {
        await call('connect');
        updateState(await call('state'));
        await search();
    } finally {
        node.disabled = false;
    }
});
$('#engine-window').onclick = run(() => call('engine-window'));
$('#choose-folder').onclick = run(async () => {
    await call('choose-folder');
    updateState(await call('state'));
    if ($('#scope').textContent) await search();
});
let timer;
$('#query').oninput = () => {
    clearTimeout(timer);
    timer = setTimeout(() => search(), 250);
};
$('#query').onkeydown = (event) => {
    if (event.key === 'Enter') {
        clearTimeout(timer);
        void search();
    }
    if (event.key === 'ArrowDown') {
        event.preventDefault();
        if (items.length) {
            void select(items[0].id);
            $('#results').focus();
        }
    }
};
$('#clear-query').onclick = () => {
    $('#query').value = '';
    void search();
    $('#query').focus();
};
$('#sort').onchange = run(async () => {
    settings = await call('settings', { ...settings, sort: $('#sort').value });
    await search();
});
$('#preview-toggle').onchange = run(async () => {
    settings = await call('settings', { ...settings, preview: $('#preview-toggle').checked });
    $('.search-layout').classList.toggle('preview-off', !settings.preview);
    if (settings.preview && selected) await select(selected);
    else clearPreview();
});
$('#load-more').onclick = () => search(true);
$('#results').onkeydown = (event) => {
    const index = items.findIndex((item) => item.id === selected);
    if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault();
        const next = items[Math.max(0, Math.min(items.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))];
        if (next) {
            void select(next.id);
            document.querySelector(`.result-row[data-id="${next.id}"]`)?.scrollIntoView({ block: 'nearest' });
        }
    }
    if (event.key === 'Enter' && selected) run(() => call('open', { id: selected }))();
};
document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        $('#query').focus();
        $('#query').select();
    }
});
$('#result-menu').onclick = run(async (event) => {
    const action = event.target.closest('button')?.dataset.action;
    if (!action || !selected) return;
    $('#result-menu').hidePopover();
    if (action === 'copy') {
        await api.clipboard.writeText(await call('path', { id: selected }));
        message('已复制完整路径');
    } else await call(action, { id: selected });
});
function filterSettings() {
    $('#filter-settings').replaceChildren();
    draft.filters.forEach((entry, index) => {
        const row = make('div');
        row.draggable = entry.id !== 'all';
        row.append(make('span', 'drag-handle', '≡'), make('span', 'filter-label', entry.label));
        const up = button('↑', () => {
                if (index > 1) {
                    [draft.filters[index - 1], draft.filters[index]] = [draft.filters[index], draft.filters[index - 1]];
                    filterSettings();
                }
            }),
            down = button('↓', () => {
                if (index > 0 && index < draft.filters.length - 1) {
                    [draft.filters[index], draft.filters[index + 1]] = [draft.filters[index + 1], draft.filters[index]];
                    filterSettings();
                }
            });
        up.setAttribute('aria-label', '上移 ' + entry.label);
        down.setAttribute('aria-label', '下移 ' + entry.label);
        if (entry.id !== 'all') row.append(up, down);
        const label = make('label', 'toggle'),
            toggle = make('input');
        toggle.type = 'checkbox';
        toggle.checked = entry.enabled;
        toggle.disabled = entry.id === 'all';
        toggle.setAttribute('aria-label', '显示 ' + entry.label);
        toggle.onchange = () => {
            entry.enabled = toggle.checked;
        };
        label.append(toggle, make('span'));
        row.append(label);
        if (entry.id.startsWith('custom-'))
            row.append(
                button('×', () => {
                    draft.filters.splice(index, 1);
                    filterSettings();
                })
            );
        row.ondragstart = () => {
            dragIndex = index;
        };
        row.ondragover = (event) => event.preventDefault();
        row.ondrop = (event) => {
            event.preventDefault();
            if (index > 0 && dragIndex > 0) {
                draft.filters.splice(index, 0, draft.filters.splice(dragIndex, 1)[0]);
                filterSettings();
            }
        };
        $('#filter-settings').append(row);
    });
}
$('#settings-open').onclick = () => {
    draft = structuredClone(settings);
    filterSettings();
    $('#settings').showModal();
};
$('#custom-filter').onsubmit = run(async (event) => {
    event.preventDefault();
    const extensions = $('#filter-extensions')
        .value.toLowerCase()
        .split(/[,;\s]+/)
        .filter(Boolean)
        .map((value) => value.replace(/^\./, ''));
    if (!extensions.length || extensions.length > 40 || extensions.some((value) => !/^\w{1,15}$/.test(value)))
        throw Error('扩展名请用逗号分隔，仅填写字母和数字');
    if (draft.filters.length >= 30) throw Error('最多添加 30 个分类');
    draft.filters.push({
        id: 'custom-' + crypto.randomUUID().slice(0, 8),
        label: $('#filter-label').value.trim(),
        extensions,
        enabled: true
    });
    filterSettings();
    $('#custom-filter').reset();
});
$('#reset-filters').onclick = run(async () => {
    const defaults = await call('default-settings');
    draft.filters = defaults.filters;
    filterSettings();
});
$('#settings-save').onclick = run(async () => {
    settings = await call('settings', draft);
    if (!settings.filters.some((entry) => entry.id === filter && entry.enabled)) filter = 'all';
    await api.selectNavigation(filter);
    if (items.length) await search();
    $('#settings').close();
    message('搜索分类已保存');
});
let outside = false;
$('#settings').addEventListener('pointerdown', (event) => {
    outside = event.target === $('#settings');
});
$('#settings').addEventListener('pointerup', (event) => {
    if (outside && event.target === $('#settings')) {
        const r = $('#settings').getBoundingClientRect();
        if (event.clientX < r.x || event.clientX > r.right || event.clientY < r.y || event.clientY > r.bottom)
            $('#settings').close();
    }
    outside = false;
});
api.onNavigate(
    run(async ({ route }) => {
        if (!settings) updateState(await call('state'));
        const next = settings.filters.find((item) => item.enabled && item.id === route)?.id || 'all';
        const changed = filter !== next;
        filter = next;
        if (changed || !items.length) await search();
        $('#query').focus();
    })
);
run(async () => {
    updateState(await call('state'));
    message('搜索文件需要先连接 Everything 或选择文件夹。');
})();
