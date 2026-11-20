// 每组保留内存副本和查看位置；路径组合只有用户点击保存时才写入插件数据目录。
function installWorkspaces(app, api) {
    const $ = (s) => document.querySelector(s);
    let groups = [{ id: crypto.randomUUID(), name: '对比 1' }],
        active = groups[0].id,
        saved = [],
        switching = false;
    const bar = document.createElement('div');
    bar.className = 'comparison-workspaces';
    $('.topbar .brand').after(bar);
    const make = (text, run) => {
        const b = document.createElement('button');
        b.textContent = text;
        b.onclick = () =>
            app.safe(async () => {
                const result = await run();
                if (result !== false) {
                    const opened = bar.querySelector('.workspace-actions[open]');
                    if (opened) opened.open = false;
                }
            });
        return b;
    };
    function capture() {
        app.cacheSession();
        return {
            sessions: app.sessions,
            mode: app.mode,
            roots: app.roots,
            settings: { ...app.settings },
            folder: {
                snapshot: app.folders.snapshot,
                directories: [...app.folders.directories],
                expanded: app.folders.expanded.map((s) => new Set(s)),
                selected: [...app.folders.selected]
            },
            sheet: {
                options: { ...app.documents.sheetUI.options },
                view: app.documents.sheetUI.view,
                page: app.documents.sheetUI.page,
                columnPage: app.documents.sheetUI.columnPage,
                filters: ['sheet-result-query', 'sheet-result-column', 'sheet-result-kind'].map(
                    (id) => $('#' + id).value
                )
            },
            image: {
                mode: app.images.mode,
                rotation: app.images.rotation,
                flip: app.images.flip,
                offset: { ...app.images.offset },
                manual: app.images.manual.map((r) => ({ ...r }))
            },
            blend: $('#blend').value,
            threshold: $('#threshold').value,
            zoom: app.images.zoom,
            scroll: [app.images.viewport.scrollLeft, app.images.viewport.scrollTop]
        };
    }
    async function switchGroup(id) {
        if (id === active) return;
        if (app.operation || switching) throw Error('内容正在读取，请稍后切换');
        switching = true;
        try {
            groups.find((g) => g.id === active).state = capture();
            active = id;
            const state = groups.find((g) => g.id === id).state;
            app.inputEpoch = (app.inputEpoch || 0) + 1;
            app.images.cancel();
            await app.documents.dispose();
            app.sessions = state?.sessions || {};
            app.items = [null, null];
            app.sources = ['', ''];
            app.mode = '';
            app.roots = state?.roots || [null, null];
            app.dirtySides = [false, false];
            await api.invoke('workspace-roots', { paths: app.roots.map((r) => r?.path || r || null) });
            if (state) Object.assign(app.folders, state.folder);
            else app.folders.invalidate();
            if (state) {
                app.settings = { ...state.settings };
                app.applySettings();
            }
            await app.setMode(state?.mode || 'text');
            {
                const sheet = state?.sheet || {
                    options: { ...DiffSheetModel.defaults },
                    view: 'split',
                    page: 0,
                    columnPage: 0,
                    filters: ['', '', '']
                };
                Object.assign(app.documents.sheetUI, sheet);
                ['sheet-result-query', 'sheet-result-column', 'sheet-result-kind'].forEach((id, i) => {
                    $('#' + id).value = sheet.filters[i];
                });
                app.documents.sheetUI.render();
            }
            Object.assign(
                app.images,
                state?.image || { mode: 'split', rotation: 0, flip: false, offset: { x: 0, y: 0 }, manual: [] }
            );
            $('#blend').value = $('#image-tool-blend').value = state?.blend || '50';
            $('#threshold').value = $('#image-tool-threshold').value = state?.threshold || '16';
            $('#image-rotate').value = String(app.images.rotation);
            $('#image-flip').checked = app.images.flip;
            $('#image-offset-x').value = String(app.images.offset.x);
            $('#image-offset-y').value = String(app.images.offset.y);
            if (app.content === 'image') await app.images.setMode(app.images.mode);
            if (state) {
                app.images.setZoom(state.zoom);
                app.images.viewport.scrollLeft = state.scroll[0];
                app.images.viewport.scrollTop = state.scroll[1];
            }
            app.scheduleWorkspace();
            app.refreshControls();
            render();
        } finally {
            switching = false;
        }
    }
    function render() {
        bar.replaceChildren();
        const actions = document.createElement('details');
        actions.className = 'workspace-actions';
        const summary = document.createElement('summary');
        summary.textContent = '对比组合';
        actions.append(summary);
        for (const group of groups) {
            const button = make(group.name, () => switchGroup(group.id));
            button.classList.toggle('selected', group.id === active);
            bar.append(button);
        }
        bar.append(
            make('＋ 新对比', async () => {
                if (groups.length >= 6) throw Error('最多同时保留 6 组对比');
                const group = { id: crypto.randomUUID(), name: '对比 ' + (groups.length + 1) };
                if (app.operation || switching) throw Error('内容正在读取，请稍后新建');
                groups.push(group);
                await switchGroup(group.id);
            })
        );
        actions.append(
            make('关闭当前组', async () => {
                if (groups.length === 1) throw Error('请至少保留一组对比');
                app.cacheSession();
                if (
                    Object.values(app.sessions).some(
                        (s) => s.dirtySides?.some(Boolean) || s.items?.some((i) => i?.dirty)
                    )
                ) {
                    const answer = await api.confirmUnsaved();
                    if (answer !== 1) return;
                }
                const id = active;
                await switchGroup(groups.find((g) => g.id !== id).id);
                groups = groups.filter((g) => g.id !== id);
                render();
            })
        );
        actions.append(
            make('保存对比组合', async () => {
                const paths =
                    app.mode === 'folder' ? app.roots.map((r) => r?.path || r) : app.items.map((i) => i?.path);
                if (!paths.every(Boolean)) throw Error('请先选择两个本地文件或目录；剪贴板和纯文本不能保存路径组合');
                const name = $('#comparison-name').value.trim() || paths.map((p) => p.split(/[\\/]/).pop()).join(' ⇄ ');
                saved = await api.invoke('pair-save', { name, paths, settings: app.settings });
                renderSaved();
                app.status('对比组合已保存，可随时重新读取');
            })
        );
        const name = document.createElement('input');
        name.id = 'comparison-name';
        name.maxLength = 100;
        name.placeholder = '组合名称（选填）';
        name.setAttribute('aria-label', '对比组合名称');
        actions.append(name, savedBar);
        bar.append(actions);
    }
    const savedBar = document.createElement('div');
    savedBar.className = 'saved-comparisons';
    const savedSearch = document.createElement('input'),
        savedList = document.createElement('div');
    savedSearch.type = 'search';
    savedSearch.placeholder = '搜索已保存组合';
    savedSearch.setAttribute('aria-label', '搜索已保存组合');
    savedSearch.oninput = renderSaved;
    savedList.className = 'saved-comparison-list';
    savedBar.append(savedSearch, savedList);
    document.addEventListener('pointerdown', (event) => {
        const opened = bar.querySelector('.workspace-actions[open]');
        if (opened && !opened.contains(event.target)) opened.open = false;
    });
    document.addEventListener('keydown', (event) => {
        const opened = bar.querySelector('.workspace-actions[open]');
        if (opened && event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            opened.open = false;
            opened.querySelector('summary').focus();
        }
    });
    function renderSaved() {
        savedList.replaceChildren();
        const query = savedSearch.value.trim().toLocaleLowerCase();
        const matches = saved.filter((p) => [p.name, ...p.paths].some((s) => s.toLocaleLowerCase().includes(query)));
        for (const pair of matches) {
            const row = document.createElement('div');
            row.className = 'saved-comparison-row';
            row.append(
                make(pair.name, async () => {
                    await app.saveSettings(pair.settings);
                    await app.importPaths(pair.paths);
                }),
                make('重新定位 ' + pair.name, async () => {
                    const paths = [];
                    for (let side = 0; side < 2; side++) {
                        const result = await api.invoke('pair-choose', { side, directory: pair.directory === true });
                        if (!result) return false;
                        paths.push(result);
                    }
                    saved = await api.invoke('pair-save', { ...pair, paths });
                    renderSaved();
                }),
                make('删除组合 ' + pair.name, async () => {
                    saved = await api.invoke('pair-delete', { id: pair.id });
                    renderSaved();
                })
            );
            row.firstChild.title = pair.paths.join('\n');
            row.children[1].textContent = '重新定位';
            row.children[2].textContent = '删除';
            savedList.append(row);
        }
        if (!matches.length) {
            const empty = document.createElement('p');
            empty.className = 'saved-comparison-empty';
            empty.textContent = saved.length ? '没有匹配的组合' : '还没有保存组合，选择两侧文件后即可保存';
            savedList.append(empty);
        }
    }
    app.comparisonStates = () =>
        groups.filter((g) => g.id !== active && g.state).flatMap((g) => Object.values(g.state.sessions));
    app.workspaces = {
        switchGroup,
        get groups() {
            return groups;
        },
        get active() {
            return active;
        }
    };
    render();
    api.invoke('pair-list')
        .then((value) => {
            saved = value;
            renderSaved();
        })
        .catch((e) => app.error(e.message));
}
