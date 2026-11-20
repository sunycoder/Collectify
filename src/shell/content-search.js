document.addEventListener('DOMContentLoaded', () => {
    const dialog = $('#content-search-dialog'),
        input = $('#content-search-query'),
        results = $('#content-search-results');
    let timer,
        revision = 0,
        scope = 'all';
    async function search() {
        const token = ++revision,
            query = input.value.trim().toLocaleLowerCase();
        results.replaceChildren();
        if (!query) {
            $('#content-search-status').textContent = '输入关键词查找插件与已保存的内容';
            return;
        }
        $('#content-search-status').textContent = '正在搜索…';
        try {
            const plugins =
                scope === 'content'
                    ? []
                    : state.plugins.filter(
                          (p) =>
                              p.enabled && [p.name, p.description].some((s) => s?.toLocaleLowerCase().includes(query))
                      );
            const content = scope === 'plugins' ? [] : await call('content-search', query);
            if (token !== revision || !dialog.open) return;
            const append = (label, rows, create) => {
                if (!rows.length) return;
                results.append(el('h3', 'search-group-title', label));
                rows.forEach((row) => results.append(create(row)));
            };
            const resultButton = (title, detail, id, route, data, kind) => {
                const entry = button(
                    '',
                    null,
                    async () => {
                        closeDialogsForPlugin();
                        await call('plugin-open', { id, route, data });
                    },
                    'content-search-result'
                );
                const body = el('span', 'search-result-copy');
                body.append(el('strong', '', title), el('small', '', detail));
                entry.append(el('span', 'search-result-kind', kind), body, el('span', 'search-result-arrow', '↗'));
                return entry;
            };
            append('插件', plugins, (p) => resultButton(p.name, p.description, p.id, undefined, undefined, '插件'));
            append('已保存内容', content, (r) =>
                resultButton(r.title, r.pluginName + ' · ' + r.snippet, r.pluginId, r.route, r.payload, '内容')
            );
            const count = plugins.length + content.length;
            $('#content-search-status').textContent = count
                ? `${count} 项结果 · ↑↓ 选择，Enter 打开`
                : '没有找到结果，试试其他关键词';
        } catch (error) {
            if (token === revision) $('#content-search-status').textContent = error.message;
        }
    }
    $('#workbench-search').onclick = task(async () => {
        await call('overlay', true);
        if (!dialog.open) dialog.showModal();
        input.focus();
        input.select();
        await search();
    });
    input.oninput = () => {
        clearTimeout(timer);
        revision++;
        timer = setTimeout(search, 160);
    };
    document.querySelectorAll('[data-search-scope]').forEach(
        (b) =>
            (b.onclick = () => {
                scope = b.dataset.searchScope;
                document.querySelectorAll('[data-search-scope]').forEach((n) => {
                    n.classList.toggle('selected', n === b);
                    n.setAttribute('aria-pressed', String(n === b));
                });
                void search();
            })
    );
    dialog.addEventListener('keydown', (e) => {
        if (!['ArrowDown', 'ArrowUp', 'Enter'].includes(e.key)) return;
        const buttons = [...results.querySelectorAll('button')];
        if (!buttons.length) return;
        const current = buttons.indexOf(document.activeElement);
        if (e.key === 'Enter' && current >= 0) return;
        e.preventDefault();
        if (e.key === 'Enter') buttons[0].click();
        else buttons[(current + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus();
    });
    dialog.addEventListener('close', () => {
        clearTimeout(timer);
        revision++;
    });
});
