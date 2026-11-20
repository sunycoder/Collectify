document.addEventListener('DOMContentLoaded', () => {
    let candidates = [];
    const status = $('#local-plugin-status'),
        list = $('#local-plugin-list'),
        load = $('#install-local-plugins');
    async function scan(refresh = false) {
        status.textContent = '正在扫描开发目录…';
        const result = await call('plugin-local-discover', { refresh });
        if (!result) {
            status.textContent = '';
            return;
        }
        candidates = result.candidates;
        list.replaceChildren();
        const all = el('input');
        all.type = 'checkbox';
        all.checked = true;
        const heading = el('label', 'local-plugin-option');
        heading.append(all, document.createTextNode('全选可加载插件'));
        all.onchange = () =>
            list.querySelectorAll('input[data-local-id]').forEach((n) => {
                n.checked = all.checked;
            });
        list.append(heading);
        for (const p of candidates) {
            const row = el('label', 'local-plugin-option'),
                check = el('input'),
                text = el('span');
            check.type = 'checkbox';
            check.checked = !p.error;
            check.disabled = !!p.error;
            if (!p.error) check.dataset.localId = p.id;
            text.append(
                el('strong', '', p.name + (p.version ? ' · v' + p.version : '')),
                el('small', '', p.error || p.path)
            );
            row.append(check, text);
            list.append(row);
        }
        load.hidden = !candidates.some((p) => !p.error);
        $('#reload-local-plugins').hidden = false;
        status.textContent = `${result.root} · 发现 ${candidates.filter((p) => !p.error).length} 个可加载插件`;
    }
    $('#discover-local-plugins').onclick = task(() => scan());
    $('#reload-local-plugins').onclick = task(() => scan(true));
    load.onclick = task(async () => {
        const ids = [...list.querySelectorAll('input[data-local-id]:checked')].map((n) => n.dataset.localId);
        if (!ids.length) {
            status.textContent = '请先选择插件';
            return;
        }
        load.disabled = true;
        status.textContent = '正在逐个加载所选插件…';
        try {
            const report = await call('plugin-local-load', { ids });
            await refresh();
            status.textContent = report
                ? report.map((r) => `${r.name}：${r.status}${r.error ? '，' + r.error : ''}`).join('；')
                : '已取消';
        } finally {
            load.disabled = false;
        }
    });
});
