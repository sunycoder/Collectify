window.DiffFolders = class {
    constructor(app) {
        this.app = app;
        this.snapshot = null;
        this.directories = ['', ''];
        this.expanded = [new Set(), new Set()];
        this.selected = ['', ''];
        this.generation = 0;
        this.linked = true;
        this.query = '';
        document.querySelector('#folder-search').oninput = (e) => {
            this.query = e.target.value.trim().toLocaleLowerCase();
            this.render();
        };
        document.querySelector('#folder-link').onclick = () => {
            this.linked = !this.linked;
            document.querySelector('#folder-link').setAttribute('aria-pressed', String(this.linked));
            if (this.linked) {
                this.directories[1] = this.directories[0];
                this.expanded[1] = new Set(this.expanded[0]);
            }
            this.render();
        };
        this.render();
        document.querySelector('#only-diff').onchange = () => this.render();
        document.querySelector('#refresh-folder').onclick = () => app.safe(() => this.scan());
        document.querySelector('#rehash').onclick = () => app.safe(() => this.scan(true));
        document
            .querySelectorAll('[data-choose-folder]')
            .forEach((button) => (button.onclick = () => app.choose(Number(button.dataset.chooseFolder), true)));
        for (let side = 0; side < 2; side++) {
            const tree = document.querySelector(`[data-tree="${side}"]`);
            tree.onscroll = () => this.renderTree(side);
            tree.addEventListener('scroll', () => {
                if (!this.linked || this.syncing) return;
                this.syncing = true;
                document.querySelector(`[data-tree="${1 - side}"]`).scrollTop = tree.scrollTop;
                this.renderTree(1 - side);
                this.syncing = false;
            });
            document.querySelector(side ? '#pair-right' : '#pair-left').onchange = (e) => {
                this.selected[side] = e.target.value;
                app.safe(() => this.openPair());
            };
        }
    }
    invalidate() {
        this.generation++;
        this.snapshot = null;
        this.selected = ['', ''];
        this.directories = ['', ''];
        this.expanded = [new Set(), new Set()];
        this.render();
        document.querySelector('#folder-summary').textContent = '选择两侧目录开始对比';
        document.querySelector('#scan-progress').textContent = '';
    }
    async scan(force = false) {
        if (!this.app.roots.every(Boolean)) {
            this.app.status('请选择左右两侧目录后再扫描');
            return;
        }
        const generation = ++this.generation;
        this.app.status('正在扫描目录并计算内容指纹…');
        const snapshot = await this.app.api.invoke('scan', { force });
        if (generation !== this.generation) return;
        this.snapshot = snapshot;
        this.app.roots = snapshot.roots.map((file) => ({
            kind: 'folder',
            path: file,
            name: file.split(/[\\/]/).pop()
        }));
        if (this.app.mode !== 'folder') {
            this.app.sessions.folder = { items: [null, null], sources: ['', ''], content: 'empty' };
            this.selected = ['', ''];
            this.render();
            return;
        }
        this.selected = ['', ''];
        this.app.items = [null, null];
        this.app.sources = ['', ''];
        this.app.display('empty');
        this.directories = ['', ''];
        this.expanded = [new Set(), new Set()];
        this.render();
        this.app.status(
            snapshot.warnings.length ? `扫描完成，${snapshot.warnings.length} 项不可读或已跳过` : '扫描完成'
        );
        this.app.summary(`${snapshot.rows.length} 个路径 · ${snapshot.differences} 个差异文件`);
        document.querySelector('#folder-summary').textContent =
            `${snapshot.rows.length.toLocaleString()} 个路径 · ${snapshot.differences.toLocaleString()} 个差异文件`;
        if (snapshot.warnings.length) this.app.error(snapshot.warnings.slice(0, 3).join('；'));
    }
    render() {
        this.searchMatches = new Set();
        if (this.query)
            for (const row of this.snapshot?.rows || []) {
                if (!row.relative.toLocaleLowerCase().includes(this.query)) continue;
                let parts = row.relative.split('/');
                while (parts.length) {
                    this.searchMatches.add(parts.join('/'));
                    parts.pop();
                }
            }
        if (this.snapshot) {
            const counts = { left: 0, right: 0, changed: 0, same: 0, type: 0, error: 0 };
            for (const r of this.snapshot.rows) {
                if (r.left?.directory && r.right?.directory) continue;
                counts[r.state === 'metadata' ? 'changed' : r.state] =
                    (counts[r.state === 'metadata' ? 'changed' : r.state] || 0) + 1;
            }
            document.querySelector('#folder-counts').replaceChildren();
            for (const [state, label] of [
                ['left', '仅左'],
                ['right', '仅右'],
                ['changed', '已修改'],
                ['type', '类型冲突'],
                ['same', '未更改'],
                ['error', '不可读']
            ]) {
                if (!counts[state] && state === 'error') continue;
                const span = document.createElement('span');
                span.className = state;
                span.textContent = `${counts[state]} ${label}`;
                document.querySelector('#folder-counts').append(span);
            }
        } else document.querySelector('#folder-counts').textContent = '';
        const navigation = document.querySelector('#folder-navigation');
        navigation.replaceChildren();
        for (const row of (this.snapshot?.rows || [])
            .filter(
                (r) =>
                    !r.left?.directory &&
                    !r.right?.directory &&
                    (!this.query || r.relative.toLocaleLowerCase().includes(this.query))
            )
            .slice(0, 150)) {
            const b = document.createElement('button');
            b.className = row.state;
            b.textContent = row.relative;
            b.title = row.relative;
            b.onclick = () => {
                this.selected = [row.left ? row.relative : '', row.right ? row.relative : ''];
                this.render();
                this.app.safe(() => this.openPair());
            };
            navigation.append(b);
        }
        for (let side = 0; side < 2; side++) {
            const select = document.querySelector(side ? '#pair-right' : '#pair-left');
            select.replaceChildren(
                new Option(
                    this.snapshot
                        ? '选择文件 / 子目录'
                        : this.app.roots?.[side]
                          ? '等待另一侧目录'
                          : '请先选择' + (side ? '右' : '左') + '侧目录',
                    ''
                )
            );
            select.disabled = !this.snapshot?.rows.some((row) => !!(side ? row.right : row.left));
            select.tomselect?.clear(true);
            for (const row of this.snapshot?.rows || []) {
                const item = side ? row.right : row.left;
                if (item && !item.error)
                    select.add(new Option((item.directory ? '▱ ' : '') + row.relative, row.relative));
            }
            select.value = this.selected[side];
            this.renderTree(side);
        }
        this.app.refreshControls?.();
    }
    renderTree(side) {
        const tree = document.querySelector(`[data-tree="${side}"]`),
            crumbs = document.querySelector(`[data-breadcrumb="${side}"]`),
            prefix = this.directories[side],
            parts = prefix.split('/').filter(Boolean);
        crumbs.replaceChildren();
        const crumb = (label, value) => {
            const b = document.createElement('button');
            b.textContent = label;
            b.onclick = () => {
                this.directories[side] = value;
                if (this.linked) this.directories[1 - side] = value;
                tree.scrollTop = 0;
                this.render();
            };
            crumbs.append(b);
        };
        const root = this.snapshot?.roots[side] || this.app.roots?.[side]?.path;
        document.querySelector(`[data-choose-folder="${side}"]`).textContent = root
            ? root.split(/[\\/]/).pop()
            : '选择' + (side ? '右' : '左') + '侧文件夹';
        document.querySelector(`[data-choose-folder="${side}"]`).title = root || '';
        if (root) crumb(root.split(/[\\/]/).pop() || '根目录', '');
        parts.forEach((p, i) => crumb(p, parts.slice(0, i + 1).join('/')));
        if (!this.snapshot) {
            tree.textContent = root
                ? '已选择此目录，等待另一侧后自动扫描'
                : '拖入' + (side ? '右' : '左') + '侧文件夹，或点击上方选择';
            tree.classList.add('tree-empty');
            return;
        }
        tree.classList.remove('tree-empty');
        const rows = this.snapshot.rows.filter((row) => {
            const item = side ? row.right : row.left;
            if (!item && !this.linked) return false;
            if (this.query && !this.searchMatches.has(row.relative)) return false;
            if (document.querySelector('#only-diff').checked && row.state === 'same' && !row.differences) return false;
            const relative = prefix
                ? row.relative.startsWith(prefix + '/')
                    ? row.relative.slice(prefix.length + 1)
                    : null
                : row.relative;
            if (!relative) return false;
            const segments = relative.split('/');
            return segments
                .slice(0, -1)
                .every((_, i) =>
                    this.expanded[side].has((prefix ? prefix + '/' : '') + segments.slice(0, i + 1).join('/'))
                );
        });
        rows.sort((a, b) => a.relative.localeCompare(b.relative, undefined, { numeric: true }));
        const start = Math.max(0, Math.floor(tree.scrollTop / 29) - 3),
            end = Math.min(rows.length, start + Math.ceil(tree.clientHeight / 29) + 8),
            space = document.createElement('div');
        space.style.height = rows.length * 29 + 'px';
        space.style.position = 'relative';
        for (const row of rows.slice(start, end)) {
            const item = side ? row.right : row.left,
                node = document.createElement('div');
            node.dataset.relative = row.relative;
            node.className =
                'tree-row ' +
                (row.differences && row.state === 'same' ? 'changed' : row.state) +
                (this.selected[side] === row.relative ? ' selected' : '');
            node.style.cssText = `position:absolute;top:${rows.indexOf(row) * 29}px;height:29px;left:0;right:0;padding-left:${(row.relative.slice(prefix.length + (prefix ? 1 : 0)).split('/').length - 1) * 14 + 6}px`;
            if (!item) {
                node.className = 'tree-row missing';
                node.textContent = '—';
                node.title = '此侧缺少 ' + row.relative;
                space.append(node);
                continue;
            }
            const arrow = document.createElement('button');
            arrow.textContent = item.directory ? (this.expanded[side].has(row.relative) ? '▾' : '▸') : '·';
            arrow.setAttribute('aria-label', item.directory ? '展开或收起 ' + item.name : item.name);
            arrow.onclick = (e) => {
                e.stopPropagation();
                if (!item.directory) return;
                const set = this.expanded[side];
                if (set.has(row.relative)) set.delete(row.relative);
                else set.add(row.relative);
                if (this.linked) this.expanded[1 - side] = new Set(set);
                this.renderTree(side);
                if (this.linked) this.renderTree(1 - side);
            };
            const name = document.createElement('span');
            name.className = 'entry-name';
            name.textContent = (item.directory ? '▱ ' : '') + item.name;
            name.title = row.relative + (item.error ? '：' + item.error : '');
            const meta = document.createElement('span');
            meta.className = item.directory ? 'difference-count' : 'entry-size';
            meta.textContent = item.directory ? row.differences || '' : Math.ceil(item.size / 1024) + ' KB';
            node.append(arrow, name, meta);
            node.onclick = (e) => {
                if (item.directory || item.error) return;
                this.selected[side] = row.relative;
                if (!e.ctrlKey && !e.metaKey)
                    this.selected[1 - side] =
                        (side ? row.left : row.right) && !(side ? row.left : row.right).directory ? row.relative : '';
                this.render();
                this.app.safe(() => this.openPair());
            };
            node.ondblclick = () => {
                if (item.directory) {
                    this.directories[side] = row.relative;
                    if (this.linked) this.directories[1 - side] = row.relative;
                    tree.scrollTop = 0;
                    this.render();
                }
            };
            space.append(node);
        }
        tree.replaceChildren(space);
    }
    async openPair() {
        const request = (this.pairRequest || 0) + 1;
        this.pairRequest = request;
        const pending = (this.pairQueue || Promise.resolve())
            .catch(() => {})
            .then(() => {
                if (request !== this.pairRequest) return;
                return this.performOpenPair(request);
            });
        this.pairQueue = pending;
        return pending;
    }
    async performOpenPair(request) {
        if (!this.snapshot) return;
        if (!this.selected.some(Boolean)) {
            this.app.items = [null, null];
            this.app.sources = ['', ''];
            this.app.display('empty');
            return;
        }
        const generation = ++this.generation;
        const selectedItems = this.selected.map((relative, side) => {
            const row = this.snapshot?.rows.find((r) => r.relative === relative);
            return side ? row?.right : row?.left;
        });
        if (selectedItems.some((i) => i?.directory) && !selectedItems.every((i) => i?.directory)) {
            this.app.display('empty');
            this.app.status('请在两侧选择子目录进行目录对比，或选择文件进行内容对比');
            return;
        }
        if (selectedItems.every((i) => i?.directory)) {
            const result = await this.app.api.invoke('compare-folders', { relative: [...this.selected] });
            if (generation !== this.generation || request !== this.pairRequest) return;
            if (this.app.mode !== 'folder') return;
            this.render();
            this.app.display('subfolder');
            const target = document.querySelector('#subfolder-panel');
            target.replaceChildren();
            const heading = document.createElement('p');
            heading.textContent = `子文件夹：${this.selected[0]} ⇄ ${this.selected[1]} · ${result.differences} 个差异文件`;
            target.append(heading);
            const table = document.createElement('table');
            table.className = 'subfolder-table';
            for (const row of result.rows) {
                const tr = document.createElement('tr');
                tr.className = row.state;
                for (const value of [
                    row.relative,
                    {
                        same: '相同',
                        changed: '内容不同',
                        metadata: '修改时间不同',
                        left: '仅左',
                        right: '仅右',
                        type: '类型不同',
                        error: '不可读取'
                    }[row.state],
                    row.left ? (row.left.directory ? '目录' : row.left.size + ' B') : '—',
                    row.right ? (row.right.directory ? '目录' : row.right.size + ' B') : '—'
                ]) {
                    const td = document.createElement('td');
                    td.textContent = value;
                    tr.append(td);
                }
                if (!row.left?.directory && !row.right?.directory)
                    tr.onclick = () =>
                        this.app.safe(async () => {
                            const items = await Promise.all(
                                [0, 1].map((side) =>
                                    (side ? row.right : row.left)
                                        ? this.app.api.invoke('file', {
                                              side,
                                              relative: this.selected[side] + '/' + row.relative
                                          })
                                        : null
                                )
                            );
                            this.app.items = items;
                            this.app.refreshNames();
                            await this.app.showContent();
                        });
                table.append(tr);
            }
            target.append(table);
            this.app.summary(`子文件夹 ${result.rows.length} 个路径 · ${result.differences} 个差异文件`);
            return;
        }
        const items = await Promise.all(
            this.selected.map((relative, side) => (relative ? this.app.api.invoke('file', { relative, side }) : null))
        );
        if (generation !== this.generation || request !== this.pairRequest) return;
        if (this.app.mode !== 'folder') return;
        this.render();
        this.app.items = items;
        this.app.refreshNames();
        await this.app.showContent();
    }
};
