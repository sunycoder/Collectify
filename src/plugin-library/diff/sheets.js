window.DiffSheets = class {
    constructor(app, documents) {
        this.app = app;
        this.documents = documents;
        this.options = { ...DiffSheetModel.defaults };
        this.view = 'split';
        this.changeIndex = -1;
        this.editable = false;
        this.page = 0;
        this.columnPage = 0;
        this.signature = '';
        this.revision = 0;
        this.keyControlsSignature = '';
        for (const id of ['sheet-result-query', 'sheet-result-column', 'sheet-result-kind'])
            document.querySelector('#' + id).oninput = () => {
                this.page = 0;
                this.render();
            };
        document.querySelector('#sheet-key-clear').onclick = () => {
            this.options.keyColumns = [];
            this.page = this.columnPage = 0;
            this.render();
        };
        for (const id of ['sheet-font-size', 'sheet-wrap', 'sheet-density'])
            document.querySelector('#' + id).onchange = () => this.appearance();
        const mapping = {
            'sheet-compare': 'mode',
            'sheet-precision': 'precision',
            'sheet-match-headers': 'matchHeaders',
            'sheet-ignore-space': 'ignoreSpace',
            'sheet-ignore-case': 'ignoreCase',
            'sheet-hide-rows': 'hideRows',
            'sheet-hide-cols': 'hideCols',
            'sheet-keep-format': 'keepFormat',
            'sheet-sort-row': 'sortRows',
            'sheet-sort-col': 'sortCols'
        };
        for (const [id, key] of Object.entries(mapping))
            document.querySelector('#' + id).onchange = (e) => {
                this.options[key] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
                if (key === 'matchHeaders') this.options.keyColumns = [];
                if (key === 'mode') document.querySelector('#sheet-mode').value = this.options.mode;
                this.page = this.columnPage = 0;
                this.render();
            };
        for (const region of ['US', 'EU'])
            document.querySelector('#sheet-date-' + region.toLowerCase()).onclick = () => {
                this.options.date = region;
                this.revision++;
                this.render();
                app.status('已按 ' + region + ' 规则规范化日期显示，原文件未改动');
            };
        document.querySelector('#sheet-reset').onclick = () => {
            this.options = { ...DiffSheetModel.defaults };
            for (const [id, key] of Object.entries(mapping)) {
                const element = document.querySelector('#' + id);
                if (element.type === 'checkbox') element.checked = this.options[key];
                else element.value = this.options[key];
            }
            document.querySelector('#sheet-mode').value = 'values';
            this.page = this.columnPage = 0;
            this.render();
            app.refreshControls();
        };
        document.querySelectorAll('[data-sheet-view]').forEach(
            (b) =>
                (b.onclick = () => {
                    this.view = b.dataset.sheetView;
                    this.render();
                })
        );
        document.querySelector('#sheet-edit').onclick = () => {
            this.editable = !this.editable;
            this.render();
            app.status(this.editable ? '双击单元格编辑内存副本，不修改原文件' : '表格已切回只读');
        };
        document.querySelector('#sheet-change-prev').onclick = () => this.next(-1);
        document.querySelector('#sheet-change-next').onclick = () => this.next(1);
        document.querySelector('#sheet-export-csv').onclick = () =>
            app.safe(async () => {
                if (!this.result) return;
                const side = this.view === 'original' ? 0 : 1,
                    data = this.result.rows.map((r) =>
                        this.result.cols.map((c) => DiffSheetModel.value(this.result.cell(side, r, c), this.options))
                    );
                await app.api.invoke('export', { format: 'csv', data: DiffSheetModel.csv(data) });
            });
    }
    load() {
        this.signature = '';
        this.page = this.columnPage = 0;
        this.changeIndex = -1;
        this.revision++;
        this.render();
    }
    getResult() {
        const name = document.querySelector('#sheet').value,
            pair = this.documents.items.map((i) => i?.sheets?.find((s) => s.name === name));
        const signature = JSON.stringify([name, this.options, this.revision]);
        if (signature !== this.signature) {
            this.result = DiffSheetModel.build(pair, this.options);
            this.signature = signature;
            this.changeIndex = Math.min(this.changeIndex, this.result.changes.length - 1);
        }
        return this.result;
    }
    resetKeys() {
        this.options.keyColumns = [];
        this.keyControlsSignature = '';
    }
    renderKeys(result) {
        const available = result.columns.filter((c) => c.left !== undefined && c.right !== undefined);
        const signature = JSON.stringify(available);
        if (signature !== this.keyControlsSignature) {
            const target = document.querySelector('#sheet-key-columns');
            target.replaceChildren();
            for (const c of available) {
                const label = document.createElement('label'),
                    input = document.createElement('input'),
                    text = document.createElement('span');
                input.type = 'checkbox';
                input.dataset.left = c.left;
                input.dataset.right = c.right;
                input.checked = this.options.keyColumns.some((key) => key.left === c.left && key.right === c.right);
                text.textContent = `${c.label}（${DiffSheetModel.column(c.left)} / ${DiffSheetModel.column(c.right)}）`;
                input.onchange = () => {
                    this.options.keyColumns = this.options.keyColumns.filter(
                        (key) => key.left !== c.left || key.right !== c.right
                    );
                    if (input.checked) this.options.keyColumns.push({ left: c.left, right: c.right });
                    this.page = this.columnPage = 0;
                    this.changeIndex = -1;
                    this.render();
                };
                label.append(text, input);
                target.append(label);
            }
            if (!available.length) target.textContent = '两侧载入工作表后选择业务键';
            this.keyControlsSignature = signature;
        }
        document.querySelectorAll('#sheet-key-columns input').forEach((input) => {
            input.checked = this.options.keyColumns.some(
                (key) => key.left === Number(input.dataset.left) && key.right === Number(input.dataset.right)
            );
        });
        const status = document.querySelector('#sheet-key-status');
        status.hidden = !this.options.keyColumns.length;
        const duplicates = result.keyIssues.filter((i) => i.kind === 'duplicate'),
            blanks = result.keyIssues.filter((i) => i.kind === 'blank');
        status.dataset.warning = String(result.keyIssues.length > 0);
        status.textContent = result.keyActive
            ? `已按 ${this.options.keyColumns.length} 列业务键配对：匹配 ${result.rowStats.matched} 行，修改 ${result.rowStats.changed} 行，仅左 ${result.rowStats.left} 行，仅右 ${result.rowStats.right} 行。` +
              (duplicates.length || blanks.length
                  ? ` 重复键涉及 ${duplicates.length} 行，空键 ${blanks.length} 行，均保留为独有行。请检查：${result.keyIssues
                        .slice(0, 8)
                        .map((i) => `${i.side ? '右' : '左'}第 ${i.row} 行`)
                        .join('、')}。`
                  : '')
            : '业务键在当前工作表不可用，已恢复按行比较，请重新选择。';
    }
    parts(target, before, after) {
        before = before.length > 2000 ? before.slice(0, 2000) + '…' : before;
        after = after.length > 2000 ? after.slice(0, 2000) + '…' : after;
        const mode = this.options.precision,
            method =
                mode === 'word' || (mode === 'smart' && before.length + after.length > 200)
                    ? DiffText.diffWordsWithSpace
                    : DiffText.diffChars;
        let parts;
        if (before.length + after.length < 4000) parts = method(before, after, { timeout: 15, maxEditLength: 2000 });
        if (!parts)
            parts = [
                { removed: true, value: before },
                { added: true, value: after }
            ];
        for (const part of parts) {
            const node = document.createElement(part.removed ? 'del' : part.added ? 'ins' : 'span');
            node.textContent = part.value;
            target.append(node);
        }
        if (!parts.some((p) => p.value)) target.textContent = '（空）';
    }
    render() {
        if (this.app.content !== 'document' || !this.documents.items.some((i) => i?.kind === 'sheet')) return;
        const original = this.getResult(),
            result = { ...original },
            single = document.querySelector('#sheet-single'),
            pair = document.querySelector('.document-pair'),
            rail = document.querySelector('#sheet-changes');
        this.renderKeys(result);
        const column = document.querySelector('#sheet-result-column'),
            choice = column.value;
        const signature = JSON.stringify(original.columns.map((c) => c.label));
        if (column.dataset.signature !== signature) {
            column.replaceChildren(
                new Option('全部列', ''),
                ...original.columns.map((c, i) => new Option(c.label || DiffSheetModel.column(i), String(i)))
            );
            column.value = choice;
            column.dataset.signature = signature;
        }
        const query = document.querySelector('#sheet-result-query').value.trim().toLocaleLowerCase(),
            kind = document.querySelector('#sheet-result-kind').value;
        result.cols = original.cols.filter((c) => column.value === '' || c === Number(column.value));
        const changes = original.changes.filter(
            (c) => (!kind || c.state === kind) && (column.value === '' || c.col === Number(column.value))
        );
        const changedRows = new Set(changes.map((c) => c.row));
        result.rows = original.rows.filter(
            (r) =>
                (!kind || changedRows.has(r)) &&
                (!query ||
                    original.cols.some((c) =>
                        [0, 1].some((side) =>
                            DiffSheetModel.value(original.cell(side, r, c), this.options)
                                .toLocaleLowerCase()
                                .includes(query)
                        )
                    ))
        );
        this.visibleChanges = changes.filter((c) => result.rows.includes(c.row));
        this.filteredResult = result;
        pair.hidden = this.view !== 'split';
        single.hidden = this.view === 'split';
        rail.hidden = false;
        document
            .querySelectorAll('[data-sheet-view]')
            .forEach((b) => b.classList.toggle('selected', b.dataset.sheetView === this.view));
        document.querySelector('#sheet-edit').classList.toggle('selected', this.editable);
        document.querySelector('#sheet-edit').textContent = this.editable ? '完成内存编辑' : '编辑内存副本';
        document.querySelector('#sheet-counts').textContent =
            `− ${result.counts.left}  ＋ ${result.counts.right}  ⇄ ${result.counts.changed}`;
        this.page = Math.max(0, Math.min(this.page, Math.ceil(result.rows.length / 100) - 1));
        this.columnPage = Math.max(0, Math.min(this.columnPage, Math.ceil(result.cols.length / 30) - 1));
        const rows = result.rows.slice(this.page * 100, this.page * 100 + 100),
            cols = result.cols.slice(this.columnPage * 30, this.columnPage * 30 + 30);
        if (this.view === 'split') {
            for (let side = 0; side < 2; side++) {
                const target = document.querySelector(side ? '#document-right' : '#document-left');
                target.replaceChildren(this.table(rows, cols, side, false));
            }
        } else if (this.view === 'details') {
            single.replaceChildren(this.details());
        } else if (this.view === 'rows') {
            const table = document.createElement('table');
            table.className = 'sheet-table sheet-row-table';
            for (const r of rows) {
                const tr = document.createElement('tr');
                const th = document.createElement('th');
                th.textContent = r + 1;
                tr.append(th);
                for (let side = 0; side < 2; side++) {
                    const td = document.createElement('td');
                    td.textContent = cols
                        .map((c) => DiffSheetModel.value(result.cell(side, r, c), this.options))
                        .join(' | ');
                    td.className = side ? 'right' : 'left';
                    tr.append(td);
                }
                table.append(tr);
            }
            single.replaceChildren(table);
        } else
            single.replaceChildren(this.table(rows, cols, this.view === 'original' ? 0 : 1, this.view === 'redline'));
        this.renderChanges();
        this.app.summary(
            `${document.querySelector('#sheet').value} · ${result.rowCount} 行 × ${result.columns.length} 列 · ${result.changes.length} 个不同单元格`
        );
        document.querySelector('#table-position').textContent =
            `${this.page + 1} / ${Math.max(1, Math.ceil(result.rows.length / 100))} 页 · 可见 ${result.rows.length} 行 / ${result.cols.length} 列${this.options.date ? ' · 日期 ' + this.options.date : ''}`;
        document.querySelector('#table-prev').disabled = this.page === 0;
        document.querySelector('#table-next').disabled = (this.page + 1) * 100 >= result.rows.length;
        document.querySelector('.table-pagination').hidden = this.view === 'details';
        this.app.refreshControls();
        this.focusCell();
        this.appearance();
    }
    appearance() {
        const host = document.querySelector('#document-panel');
        host.style.setProperty(
            '--sheet-font-size',
            Math.max(10, Math.min(18, Number(document.querySelector('#sheet-font-size').value) || 12)) + 'px'
        );
        host.dataset.cellWrap = String(document.querySelector('#sheet-wrap').checked);
        host.dataset.sheetDensity = document.querySelector('#sheet-density').value;
    }
    table(rows, cols, side, redline) {
        const table = document.createElement('table');
        table.className = 'sheet-table';
        table.style.minWidth = 44 + cols.length * 130 + 'px';
        const result = this.result,
            head = document.createElement('tr');
        head.append(document.createElement('th'));
        for (const c of cols) {
            const th = document.createElement('th');
            const mapping = result.columns[c],
                index = mapping[side ? 'right' : 'left'];
            th.textContent = index === undefined ? '—' : DiffSheetModel.column(index);
            th.title = this.options.matchHeaders ? mapping.label : '';
            head.append(th);
        }
        table.append(head);
        for (const r of rows) {
            const tr = document.createElement('tr'),
                th = document.createElement('th');
            th.textContent = result.sides[side][r] ? result.sides[side][r].index + 1 : '—';
            const copy = document.createElement('button');
            copy.textContent = '复制行';
            copy.className = 'sheet-copy-row';
            copy.title = '复制当前侧此行可见列';
            copy.onclick = () =>
                this.app.safe(async () => {
                    await this.app.api.clipboard.writeText(
                        cols.map((c) => DiffSheetModel.value(result.cell(side, r, c), this.options)).join('\t')
                    );
                    this.app.status('当前行已复制');
                });
            th.append(copy);
            tr.append(th);
            for (const c of cols) {
                const td = document.createElement('td'),
                    cell = result.cell(side, r, c),
                    change = result.byCell.get(r + ':' + c);
                td.dataset.row = r;
                td.dataset.col = c;
                td.dataset.side = side;
                td.tabIndex = 0;
                if (change) {
                    td.className = change.state;
                    if (redline) this.parts(td, change.before, change.after);
                    else td.textContent = DiffSheetModel.value(cell, this.options);
                } else td.textContent = DiffSheetModel.value(cell, this.options).slice(0, 2000);
                td.title =
                    (cell?.f ? '公式：' + cell.f + '\n' : '') +
                    (change
                        ? `左 ${change.leftAddress}：${change.before}\n右 ${change.rightAddress}：${change.after}`
                        : td.textContent);
                if (this.options.keepFormat && cell?.s) {
                    const style = cell.s;
                    if (/^[a-f\d]{6,8}$/i.test(style.fgColor?.rgb || ''))
                        td.style.backgroundColor = '#' + style.fgColor.rgb.slice(-6);
                    if (style.patternType === 'solid' && /^[a-f\d]{6,8}$/i.test(style.bgColor?.rgb || ''))
                        td.style.backgroundColor = '#' + style.bgColor.rgb.slice(-6);
                }
                td.onclick = () => {
                    const index = result.changes.indexOf(change);
                    if (index >= 0) {
                        this.changeIndex = index;
                        this.renderChanges();
                        this.focusCell();
                    }
                };
                td.ondblclick = () => {
                    if (this.editable) this.app.safe(() => this.edit(side, r, c));
                };
                tr.append(td);
            }
            table.append(tr);
        }
        if (!rows.length || !cols.length) {
            const tr = document.createElement('tr'),
                td = document.createElement('td');
            td.textContent = result.changes.length ? '当前筛选没有可显示单元格' : '没有符合条件的差异';
            tr.append(td);
            table.append(tr);
        }
        return table;
    }
    details() {
        const box = document.createElement('div');
        box.className = 'details-grid';
        this.documents.items.forEach((item, side) => {
            const section = document.createElement('section');
            const h = document.createElement('h3');
            h.textContent = (side ? '右侧' : '左侧') + ' · ' + (item?.name || '未选择');
            section.append(h);
            for (const [label, value] of [
                ['路径', item?.path || '—'],
                ['大小', item?.size === undefined ? '—' : item.size.toLocaleString() + ' B'],
                ['修改时间', item?.modified ? new Date(item.modified).toLocaleString() : '—'],
                ['工作表', item?.sheets?.map((s) => s.name).join('、') || '—']
            ]) {
                const p = document.createElement('p');
                p.textContent = label + '：' + value;
                section.append(p);
            }
            box.append(section);
        });
        return box;
    }
    renderChanges() {
        const result = this.result,
            target = document.querySelector('#sheet-change-list');
        target.replaceChildren();
        const visible = this.visibleChanges || result.changes;
        const position = visible.indexOf(result.changes[this.changeIndex]);
        const start = Math.max(0, position - 60);
        for (const change of visible.slice(start, start + 150)) {
            const index = result.changes.indexOf(change),
                button = document.createElement('button');
            button.className = 'change-card' + (index === this.changeIndex ? ' active' : '');
            const title = document.createElement('strong');
            title.textContent =
                { left: '已删除', right: '已添加', changed: '已修改' }[change.state] +
                ' · ' +
                (change.leftAddress === change.rightAddress
                    ? change.leftAddress
                    : change.leftAddress + ' → ' + change.rightAddress);
            const preview = document.createElement('div');
            this.parts(preview, change.before, change.after);
            button.append(title, preview);
            button.onclick = () => this.goto(index);
            target.append(button);
        }
        if (!visible.length) {
            const p = document.createElement('p');
            p.textContent = '当前筛选下没有差异';
            target.append(p);
        }
        document.querySelector('#sheet-change-position').textContent =
            `${position < 0 ? 0 : position + 1} / ${visible.length}`;
        document.querySelector('#sheet-change-prev').disabled = document.querySelector('#sheet-change-next').disabled =
            !visible.length;
    }
    goto(index) {
        const result = this.filteredResult || this.getResult();
        if (!result.changes.length) return;
        this.changeIndex = (index + result.changes.length) % result.changes.length;
        const change = result.changes[this.changeIndex];
        this.page = Math.max(0, Math.floor(result.rows.indexOf(change.row) / 100));
        this.columnPage = Math.max(0, Math.floor(result.cols.indexOf(change.col) / 30));
        if (this.view === 'details' || this.view === 'rows') this.view = 'redline';
        this.render();
    }
    next(direction) {
        const changes = this.visibleChanges || this.result.changes;
        if (!changes.length) return;
        const current = changes.indexOf(this.result.changes[this.changeIndex]);
        const index =
            current < 0
                ? direction > 0
                    ? 0
                    : changes.length - 1
                : (current + direction + changes.length) % changes.length;
        this.goto(this.result.changes.indexOf(changes[index]));
    }
    focusCell() {
        const change = this.result.changes[this.changeIndex];
        document.querySelectorAll('.sheet-table td.focused').forEach((e) => e.classList.remove('focused'));
        if (!change) return;
        document
            .querySelectorAll(`.sheet-table td[data-row="${change.row}"][data-col="${change.col}"]`)
            .forEach((td) => {
                td.classList.add('focused');
                td.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            });
    }
    async edit(side, r, c) {
        const result = this.result,
            index = result.columns[c][side ? 'right' : 'left'],
            row = result.sides[side][r],
            item = this.documents.items[side],
            name = document.querySelector('#sheet').value;
        if (index === undefined || !row || !item) return;
        const cell = result.cell(side, r, c);
        const dialog = document.createElement('dialog'),
            heading = document.createElement('h2'),
            input = document.createElement('textarea'),
            buttons = document.createElement('div'),
            cancel = document.createElement('button'),
            save = document.createElement('button');
        heading.textContent = `编辑 ${side ? '右侧' : '左侧'} ${DiffSheetModel.column(index)}${row.index + 1}（仅内存）`;
        input.value = DiffSheetModel.value(cell, this.options);
        input.rows = 5;
        input.style.width = '100%';
        input.setAttribute('aria-label', '单元格内容');
        cancel.textContent = '取消';
        save.textContent = '应用';
        save.className = 'primary';
        buttons.className = 'dialog-actions';
        buttons.append(cancel, save);
        dialog.append(heading, input, buttons);
        document.body.append(dialog);
        const value = await new Promise((resolve) => {
            const requestClose = WorkspaceDialogs.bind(dialog, async () => {
                if (input.value !== DiffSheetModel.value(cell, this.options)) {
                    const answer = await WorkspaceDialogs.confirmChanges('保存单元格修改？');
                    if (answer === 'cancel') return;
                    dialog.close(answer === 'save' ? 'save' : 'cancel');
                } else dialog.close('cancel');
            });
            cancel.onclick = requestClose;
            save.onclick = () => dialog.close('save');
            dialog.onclose = () => resolve(dialog.returnValue === 'save' ? input.value : null);
            dialog.showModal();
            input.focus();
            input.select();
        });
        dialog.remove();
        if (value === null) return;
        const sheet = item.sheets.find((s) => s.name === name);
        sheet.rows[row.index][index] = { ...(cell || {}), v: value, f: this.options.mode === 'formulas' ? value : '' };
        item.dirty = true;
        this.revision++;
        this.render();
        this.app.refreshNames();
    }
    report() {
        const output = [];
        const names = [...new Set(this.documents.items.flatMap((i) => i?.sheets?.map((s) => s.name) || []))];
        for (const name of names) {
            const result = DiffSheetModel.build(
                this.documents.items.map((i) => i?.sheets?.find((s) => s.name === name)),
                name === document.querySelector('#sheet').value ? this.options : { ...this.options, keyColumns: [] }
            );
            if (result.settings.keyColumns.length && (!result.keyActive || result.keyIssues.length))
                throw Error(`工作表 ${name} 的业务键存在空值、重复或不可用；请修正或取消业务键后导出`);
            for (const c of result.changes) {
                output.push({
                    position: name + '!' + c.leftAddress + ' → ' + c.rightAddress,
                    state: c.state,
                    before: c.before,
                    after: c.after
                });
                if (output.length > 20000) throw Error('报告超过 20000 个差异单元格，请缩小范围');
            }
        }
        return output;
    }
};
