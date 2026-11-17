const api = window.collectify,
    $ = (selector) => document.querySelector(selector),
    M = CalcModel;
let index,
    sheet,
    currentRow,
    results = [],
    fontSize = 22,
    initialized = false,
    operation = false,
    compose = false;
let latestSave;
const applyTheme = (context) => {
    for (const [key, value] of Object.entries(context.tokens)) document.documentElement.style.setProperty(key, value);
    document.documentElement.dataset.scheme = context.tokens['color-scheme'];
};
api.onContextChanged(applyTheme);
const message = (text) => {
    $('#message').textContent = text;
};
const saver = M.createSaver(api.storage, (status, detail) => {
    $('#save-status').dataset.state = status;
    $('#save-status').textContent =
        status === 'saving' ? '正在保存…' : status === 'saved' ? '已自动保存' : '保存失败：' + detail;
    $('#retry-save').hidden = status !== 'error';
});
function persist() {
    try {
        M.validate(sheet);
        const metadata = M.indexItem(sheet),
            position = index.sheets.findIndex((s) => s.id === sheet.id);
        if (position < 0) index.sheets.unshift(metadata);
        else index.sheets[position] = metadata;
        index.active = sheet.id;
        latestSave = saver.save({ set: { index, ['sheet:' + sheet.id]: sheet } });
        latestSave.catch(() => {});
        return latestSave;
    } catch (error) {
        message(error.message);
        $('#save-status').dataset.state = 'error';
        $('#save-status').textContent = '未保存：' + error.message;
        $('#retry-save').hidden = false;
        latestSave = Promise.reject(error);
        latestSave.catch(() => {});
        return latestSave;
    }
}
async function flushChanges() {
    await latestSave;
    await saver.flush();
}
function changed() {
    sheet.updatedAt = new Date().toISOString();
    void persist().catch(() => {});
    renderSheets();
}
async function run(action) {
    if (!initialized || operation) return;
    operation = true;
    $('.workspace').inert = true;
    $('.toolbar').inert = true;
    try {
        await action();
    } catch (error) {
        message(error.message);
    } finally {
        operation = false;
        $('.workspace').inert = false;
        $('.toolbar').inert = false;
    }
}
function resize(input) {
    input.style.height = 'auto';
    input.style.height = input.scrollHeight + 'px';
}
function recalculate() {
    results = PaperCalc.calculate(sheet.rows);
    $('#rows')
        .querySelectorAll('.calc-row')
        .forEach((node, i) => {
            const value = results[i],
                output = node.querySelector('.result-button'),
                error = node.querySelector('.row-error');
            node.querySelector('.result-line').hidden = !value.value;
            error.hidden = !value.error;
            error.textContent = value.error || '';
            output.textContent = value.text || '';
            output.title = value.approximate ? '近似结果（最多显示 12 位小数）；点击复制' : '点击复制结果';
            node.querySelector('.equals').textContent = value.approximate ? '≈' : '=';
        });
}
function renderRows(focusId) {
    $('#rows').replaceChildren();
    sheet.rows.forEach((row, i) => {
        const node = document.createElement('section');
        node.className = 'calc-row';
        node.dataset.rowId = row.id;
        const line = document.createElement('div');
        line.className = 'expression-line';
        const number = document.createElement('span');
        number.className = 'row-number';
        number.textContent = i + 1;
        const input = document.createElement('textarea');
        input.className = 'expression';
        input.rows = 1;
        input.spellcheck = false;
        input.value = row.expression;
        input.maxLength = 1000;
        input.placeholder = '输入计算公式，例如 55 + 88';
        input.setAttribute('aria-label', `第 ${i + 1} 行公式`);
        input.readOnly = sheet.locked;
        input.onfocus = () => (currentRow = row.id);
        input.oncompositionstart = () => (compose = true);
        input.oncompositionend = () => {
            compose = false;
            update();
        };
        const update = () => {
            row.expression = input.value;
            resize(input);
            recalculate();
            changed();
        };
        input.oninput = update;
        input.onkeydown = (event) => {
            if (event.isComposing || compose) return;
            if (event.key === 'Enter' && !event.shiftKey && !sheet.locked) {
                event.preventDefault();
                const next = sheet.rows[i + 1];
                if (next) focusRow(next.id);
                else addRow();
            }
            if (event.key === 'ArrowUp' && input.selectionStart === 0 && i) {
                event.preventDefault();
                focusRow(sheet.rows[i - 1].id);
            }
            if (event.key === 'ArrowDown' && input.selectionEnd === input.value.length && i < sheet.rows.length - 1) {
                event.preventDefault();
                focusRow(sheet.rows[i + 1].id);
            }
        };
        line.append(number, input);
        const resultLine = document.createElement('div');
        resultLine.className = 'result-line';
        const equal = document.createElement('span');
        equal.className = 'equals';
        const output = document.createElement('button');
        output.className = 'result-button';
        output.type = 'button';
        output.setAttribute('aria-label', `复制第 ${i + 1} 行结果`);
        output.onclick = () => {
            if (results[i].value)
                api.clipboard
                    .writeText(PaperCalc.format(results[i].value, false).text)
                    .then(() => message('结果已复制'))
                    .catch((e) => message(e.message));
        };
        resultLine.append(equal, output);
        const error = document.createElement('div');
        error.className = 'row-error';
        const tools = document.createElement('div');
        tools.className = 'row-tools';
        const note = document.createElement('input');
        note.className = 'note';
        note.value = row.note;
        note.placeholder = '添加备注…';
        note.maxLength = 200;
        note.readOnly = sheet.locked;
        note.setAttribute('aria-label', `第 ${i + 1} 行备注`);
        note.oninput = () => {
            row.note = note.value;
            changed();
        };
        const remove = document.createElement('button');
        remove.className = 'row-delete';
        remove.textContent = '×';
        remove.title = '删除本行（后面的行引用会重新计算）';
        remove.setAttribute('aria-label', `删除第 ${i + 1} 行`);
        remove.disabled = sheet.locked;
        remove.onclick = () => {
            if (sheet.locked) return;
            sheet.rows.splice(i, 1);
            if (!sheet.rows.length) sheet.rows.push({ id: M.uid(), expression: '', note: '' });
            currentRow = sheet.rows[Math.min(i, sheet.rows.length - 1)].id;
            changed();
            renderRows(currentRow);
        };
        tools.append(note, remove);
        node.append(line, resultLine, error, tools);
        $('#rows').append(node);
        resize(input);
    });
    recalculate();
    if (focusId) focusRow(focusId);
}
function focusRow(id) {
    currentRow = id;
    const input = [...$('#rows').children].find((n) => n.dataset.rowId === id)?.querySelector('textarea');
    input?.focus();
}
function addRow() {
    if (!initialized || sheet.locked) return;
    if (sheet.rows.length >= M.MAX_ROWS) {
        message('每张稿纸最多 200 行，请新建稿纸');
        return;
    }
    const row = { id: M.uid(), expression: '', note: '' };
    sheet.rows.push(row);
    changed();
    renderRows(row.id);
}
function title(item) {
    return item.title.trim() || '未命名稿纸';
}
function renderSheets() {
    $('#sheet-count').textContent = `${index.sheets.length} / ${M.MAX_SHEETS}`;
    $('#sheets').replaceChildren();
    for (const item of index.sheets) {
        const row = document.createElement('div');
        row.className = 'sheet-item' + (item.id === sheet.id ? ' selected' : '');
        const open = document.createElement('button');
        open.className = 'sheet-open';
        open.dataset.sheetId = item.id;
        const name = document.createElement('strong');
        name.textContent = (item.locked ? '🔒 ' : '') + title(item);
        const date = document.createElement('small');
        date.textContent = new Date(item.updatedAt).toLocaleString(undefined, {
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit'
        });
        open.append(name, date);
        open.onclick = () =>
            void run(async () => {
                if (item.id === sheet.id) return;
                await flushChanges();
                const next = M.validate(await api.storage.get('sheet:' + item.id));
                sheet = next;
                index.active = item.id;
                currentRow = sheet.rows.at(-1).id;
                renderPaper();
                await persist();
            });
        const remove = document.createElement('button');
        remove.className = 'sheet-delete';
        remove.textContent = '×';
        remove.title = '删除稿纸';
        remove.setAttribute('aria-label', '删除稿纸 ' + title(item));
        remove.onclick = () => void run(() => deleteSheet(item));
        row.append(open, remove);
        $('#sheets').append(row);
    }
}
function renderPaper() {
    $('#paper-title').value = sheet.title;
    $('#paper-title').readOnly = sheet.locked;
    $('#paper-date').textContent = '创建于 ' + new Date(sheet.createdAt).toLocaleString();
    $('#lock-paper').textContent = sheet.locked ? '解锁稿纸' : '锁定稿纸';
    $('#lock-paper').setAttribute('aria-pressed', String(sheet.locked));
    $('#locked-notice').hidden = !sheet.locked;
    $('#add-row').disabled = sheet.locked;
    $('#clear-paper').disabled = sheet.locked;
    renderRows();
    renderSheets();
}
function confirmAction(title, description) {
    const dialog = $('#confirm-dialog');
    $('#confirm-title').textContent = title;
    $('#confirm-description').textContent = description;
    dialog.returnValue = 'cancel';
    dialog.showModal();
    return new Promise((resolve) =>
        dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true })
    );
}
async function deleteSheet(item) {
    if (item.locked) {
        message('这张稿纸已锁定，请先打开并解锁');
        return;
    }
    if (!(await confirmAction('删除这张稿纸？', '将删除“' + title(item) + '”的公式和备注，此操作不可撤销。'))) return;
    await flushChanges();
    const nextIndex = { ...index, sheets: index.sheets.filter((s) => s.id !== item.id) };
    let nextSheet = sheet;
    if (sheet.id === item.id)
        nextSheet = nextIndex.sheets.length
            ? M.validate(await api.storage.get('sheet:' + nextIndex.sheets[0].id))
            : M.createSheet();
    if (!nextIndex.sheets.length) nextIndex.sheets = [M.indexItem(nextSheet)];
    nextIndex.active = nextSheet.id;
    await saver.save({ set: { index: nextIndex, ['sheet:' + nextSheet.id]: nextSheet }, delete: ['sheet:' + item.id] });
    index = nextIndex;
    sheet = nextSheet;
    currentRow = sheet.rows.at(-1).id;
    renderPaper();
}
$('#new-paper').onclick = () =>
    void run(async () => {
        await flushChanges();
        if (index.sheets.length >= M.MAX_SHEETS) throw Error('最多保留 60 张稿纸，请先删除不需要的稿纸');
        const nextSheet = M.createSheet();
        const nextIndex = { ...index, active: nextSheet.id, sheets: [M.indexItem(nextSheet), ...index.sheets] };
        // 新建落库成功后才替换当前编辑对象，失败时原稿纸及其输入绑定仍然有效。
        await saver.save({ set: { index: nextIndex, ['sheet:' + nextSheet.id]: nextSheet } });
        sheet = nextSheet;
        index = nextIndex;
        currentRow = sheet.rows[0].id;
        renderPaper();
        focusRow(currentRow);
    });
$('#add-row').onclick = addRow;
$('#paper-title').oninput = () => {
    if (sheet.locked) return;
    sheet.title = $('#paper-title').value;
    changed();
};
$('#lock-paper').onclick = () =>
    void run(async () => {
        sheet.locked = !sheet.locked;
        changed();
        renderPaper();
        await latestSave;
    });
async function clearPaper() {
    if (sheet.locked) return;
    if (!(await confirmAction('清空当前稿纸？', '只清空这张稿纸的公式和备注，其他稿纸保持不变。'))) return;
    sheet.rows = [{ id: M.uid(), expression: '', note: '' }];
    currentRow = sheet.rows[0].id;
    changed();
    renderRows(currentRow);
}
$('#clear-paper').onclick = () => void run(clearPaper);
$('#copy-paper').onclick = () =>
    void run(async () => {
        const lines = sheet.rows.map(
            (row, i) =>
                row.expression +
                (results[i].value
                    ? '\n' + (results[i].approximate ? '≈ ' : '= ') + PaperCalc.format(results[i].value, false).text
                    : results[i].error
                      ? '\n错误：' + results[i].error
                      : '') +
                (row.note ? '\n备注：' + row.note : '')
        );
        await api.clipboard.writeText([title(sheet), ...lines].join('\n\n'));
        message('稿纸已复制');
    });
$('#retry-save').onclick = () => void run(() => persist());
function setFont(value) {
    fontSize = Math.max(16, Math.min(32, value));
    document.documentElement.style.setProperty('--calc-size', fontSize + 'px');
    $('#font-size').textContent = fontSize;
    $('#font-down').disabled = fontSize <= 16;
    $('#font-up').disabled = fontSize >= 32;
    $('#rows').querySelectorAll('textarea').forEach(resize);
}
for (const [id, delta] of [
    ['font-down', -2],
    ['font-up', 2]
])
    $('#' + id).onclick = () => {
        setFont(fontSize + delta);
        index.fontSize = fontSize;
        void persist().catch(() => {});
    };
$('#examples-toggle').onclick = () => {
    const open = $('#examples').hidden;
    $('#examples').hidden = !open;
    $('#examples-toggle').setAttribute('aria-expanded', String(open));
};
for (const group of CalcExamples) {
    const section = document.createElement('div');
    section.className = 'example-group';
    const heading = document.createElement('h3');
    heading.textContent = group.name;
    section.append(heading);
    for (const [formula, description] of group.items) {
        const b = document.createElement('button');
        b.className = 'example';
        b.dataset.formula = formula;
        const code = document.createElement('code');
        code.textContent = formula;
        const text = document.createElement('span');
        text.textContent = description;
        b.append(code, text);
        b.onclick = () => {
            if (!initialized || sheet.locked) {
                message('请先解锁稿纸再插入公式');
                return;
            }
            const row = sheet.rows.find((r) => r.id === currentRow) || sheet.rows.at(-1);
            if (row.expression.trim()) {
                if (sheet.rows.length >= M.MAX_ROWS) {
                    message('每张稿纸最多 200 行，请新建稿纸');
                    return;
                }
                addRow();
            }
            const target = sheet.rows.find((r) => r.id === currentRow) || sheet.rows.at(-1);
            target.expression = formula;
            changed();
            renderRows(target.id);
        };
        section.append(b);
    }
    $('#examples-grid').append(section);
}
document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l' && !$('#confirm-dialog').open) {
        event.preventDefault();
        void run(clearPaper);
    }
});
const dialog = $('#confirm-dialog');
let outside = false;
const isOutside = (e) => {
    const r = dialog.getBoundingClientRect();
    return (
        e.target === dialog && (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
    );
};
dialog.onpointerdown = (e) => (outside = isOutside(e));
dialog.onpointerup = (e) => {
    if (outside && isOutside(e)) dialog.close('cancel');
    outside = false;
};
api.onNavigate(() => {
    if (initialized) focusRow(currentRow);
});
$('.workspace').inert = true;
$('.toolbar').inert = true;
(async () => {
    try {
        applyTheme(await api.context());
        index = await api.storage.get('index');
        if (index === null) {
            sheet = M.createSheet();
            index = { schemaVersion: 1, active: sheet.id, fontSize: 22, sheets: [M.indexItem(sheet)] };
        } else {
            if (
                index.schemaVersion !== 1 ||
                !Array.isArray(index.sheets) ||
                !index.sheets.length ||
                index.sheets.length > M.MAX_SHEETS ||
                new Set(index.sheets.map((s) => s.id)).size !== index.sheets.length
            )
                throw Error('稿纸目录格式不受支持，已保留原始数据');
            sheet = M.validate(await api.storage.get('sheet:' + index.active));
        }
        currentRow = sheet.rows.at(-1).id;
        setFont(Number.isInteger(index.fontSize) ? index.fontSize : 22);
        initialized = true;
        renderPaper();
        await persist();
        $('.workspace').inert = false;
        $('.toolbar').inert = false;
    } catch (error) {
        message(error.message);
        $('#save-status').textContent = '读取失败，请重新打开插件';
        document.querySelectorAll('button,input,textarea').forEach((n) => (n.disabled = true));
    }
})();
