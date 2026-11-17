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
let latestSave, deletedRow, undoTimer;
const editHistory = new Map();
function historyKey(row) {
    return sheet.id + ':' + row.id;
}
function trackEdit(row, input) {
    const key = historyKey(row),
        history = editHistory.get(key) || { undo: [], redo: [] };
    if (row.expression !== input.value) {
        history.undo.push({
            text: row.expression,
            start: input.editSelection?.start ?? input.selectionStart,
            end: input.editSelection?.end ?? input.selectionEnd
        });
        if (history.undo.length > 40) history.undo.shift();
        history.redo = [];
    }
    editHistory.delete(key);
    editHistory.set(key, history);
    if (editHistory.size > 80) editHistory.delete(editHistory.keys().next().value);
}
function undoFormula(redo = false) {
    if (keyboardOnly) {
        sendKeyboard(redo ? 'redo' : 'undo');
        return;
    }
    if (!initialized || sheet.locked || operation || compose) return;
    const row = sheet.rows.find((row) => row.id === currentRow),
        history = row && editHistory.get(historyKey(row));
    const input = [...$('#rows').children].find((n) => n.dataset.rowId === currentRow)?.querySelector('.expression');
    const from = history?.[redo ? 'redo' : 'undo'],
        to = history?.[redo ? 'undo' : 'redo'];
    if (!input || !from?.length) return;
    to.push({ text: row.expression, start: input.selectionStart, end: input.selectionEnd });
    const previous = from.pop();
    row.expression = previous.text;
    input.value = previous.text;
    input.setSelectionRange(Math.min(previous.start, input.value.length), Math.min(previous.end, input.value.length));
    resize(input);
    recalculate();
    changed();
    refreshKeyboard();
}
let keyboardOnly = false,
    keyboardOpen = false,
    keyboardOwner = null,
    keyboardTarget = null;
const keyboardSession = crypto.randomUUID(),
    keyboardChannel = new BroadcastChannel('collectify-calculator-keyboard');
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
    $('#math-keyboard').inert = true;
    try {
        await action();
    } catch (error) {
        message(error.message);
    } finally {
        operation = false;
        $('.workspace').inert = false;
        $('.toolbar').inert = false;
        $('#math-keyboard').inert = false;
        refreshKeyboard();
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
            const pending = /公式未完成|缺少右括号|函数缺少右括号/.test(value.error || '');
            error.classList.toggle('pending', pending);
            error.textContent = pending ? '继续输入…' : value.error || '';
            const formatted = value.value ? PaperCalc.format(value.value, true, index.resultDigits) : null;
            output.textContent = formatted?.text || '';
            output.title = '点击复制当前显示精度的结果；行引用始终使用内部精度';
            node.querySelector('.equals').textContent = formatted?.approximate ? '≈' : '=';
            node.classList.toggle('empty-row', !rowExpression(i));
        });
}
function rowExpression(i) {
    return sheet.rows[i]?.expression.trim();
}
function markActiveRow() {
    $('#rows')
        .querySelectorAll('.calc-row')
        .forEach((node) => node.classList.toggle('active-row', node.dataset.rowId === currentRow));
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
        input.onfocus = () => {
            currentRow = row.id;
            refreshKeyboard();
            markActiveRow();
        };
        input.oncompositionstart = () => (compose = true);
        input.oncompositionend = () => {
            compose = false;
            update();
        };
        const update = () => {
            trackEdit(row, input);
            row.expression = input.value;
            resize(input);
            recalculate();
            changed();
            refreshKeyboard();
        };
        input.onbeforeinput = () => {
            input.editSelection = { start: input.selectionStart, end: input.selectionEnd };
        };
        input.oninput = (event) => {
            if (!event.isComposing && !compose) update();
        };
        input.onkeydown = (event) => {
            if (event.isComposing || compose) return;
            if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
                event.preventDefault();
                undoFormula(event.key.toLowerCase() === 'y' || event.shiftKey);
                return;
            }
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
                    .writeText(PaperCalc.format(results[i].value, false, index.resultDigits).text)
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
        note.hidden = !row.note;
        const addNote = document.createElement('button');
        addNote.className = 'add-note';
        addNote.textContent = '添加备注';
        addNote.hidden = !!row.note;
        addNote.disabled = sheet.locked;
        addNote.onclick = () => {
            note.hidden = false;
            addNote.hidden = true;
            note.focus();
        };
        note.onblur = () => {
            if (!note.value) {
                note.hidden = true;
                addNote.hidden = false;
            }
        };
        note.setAttribute('aria-label', `第 ${i + 1} 行备注`);
        note.oninput = () => {
            row.note = note.value;
            if (row.note) {
                note.hidden = false;
                addNote.hidden = true;
            }
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
            deletedRow = { sheetId: sheet.id, row: { ...row }, position: i, placeholderId: null };
            sheet.rows.splice(i, 1);
            if (!sheet.rows.length) {
                sheet.rows.push({ id: M.uid(), expression: '', note: '' });
                deletedRow.placeholderId = sheet.rows[0].id;
            }
            clearTimeout(undoTimer);
            $('#undo-row').hidden = false;
            undoTimer = setTimeout(() => {
                deletedRow = null;
                $('#undo-row').hidden = true;
            }, 10000);
            currentRow = sheet.rows[Math.min(i, sheet.rows.length - 1)].id;
            changed();
            renderRows(currentRow);
        };
        tools.append(addNote, note, remove);
        node.append(line, resultLine, error, tools);
        $('#rows').append(node);
        resize(input);
    });
    recalculate();
    markActiveRow();
    if (focusId) focusRow(focusId);
}
function focusRow(id) {
    currentRow = id;
    const input = [...$('#rows').children].find((n) => n.dataset.rowId === id)?.querySelector('textarea');
    input?.focus();
    if (input) {
        input.scrollIntoView({ block: 'nearest' });
        const r = input.getBoundingClientRect(),
            k = $('#math-keyboard').getBoundingClientRect();
        if (
            !$('#math-keyboard').hidden &&
            r.bottom > k.top &&
            r.top < k.bottom &&
            r.right > k.left &&
            r.left < k.right
        ) {
            const offset = r.top - k.bottom - 16;
            window.scrollBy(0, offset);
        }
    }
}
function addRow() {
    if (!initialized || sheet.locked) return;
    const current = sheet.rows.find((row) => row.id === currentRow);
    if (current && !current.expression.trim()) {
        focusRow(current.id);
        return;
    }
    const last = sheet.rows.at(-1);
    if (!last.expression.trim()) {
        focusRow(last.id);
        return;
    }
    if (sheet.rows.length >= M.MAX_ROWS) {
        message('每张稿纸最多 200 行，请新建稿纸');
        return;
    }
    const row = { id: M.uid(), expression: '', note: '' };
    sheet.rows.push(row);
    changed();
    renderRows(row.id);
}
$('#undo-row').onclick = () => {
    if (!deletedRow || deletedRow.sheetId !== sheet.id || sheet.locked) {
        message('请切回原稿纸并解锁后撤销');
        return;
    }
    if (sheet.rows.length >= M.MAX_ROWS) {
        message('稿纸已满，无法恢复');
        return;
    }
    const saved = deletedRow;
    if (
        saved.placeholderId &&
        sheet.rows.length === 1 &&
        sheet.rows[0].id === saved.placeholderId &&
        !sheet.rows[0].expression &&
        !sheet.rows[0].note
    )
        sheet.rows = [];
    sheet.rows.splice(Math.min(saved.position, sheet.rows.length), 0, saved.row);
    currentRow = saved.row.id;
    deletedRow = null;
    clearTimeout(undoTimer);
    $('#undo-row').hidden = true;
    changed();
    renderRows(currentRow);
    message('已恢复公式与备注，行引用已重新计算');
};
$('#result-digits').onchange = () => {
    index.resultDigits = Number($('#result-digits').value);
    recalculate();
    void persist().catch(() => {});
};
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
    const digits = [2, 4].includes(index.resultDigits) ? String(index.resultDigits) : '12';
    $('#result-digits').value = digits;
    $('#result-digits').tomselect?.setValue(digits, true);
    $('#paper-title').value = sheet.title;
    $('#paper-title').readOnly = sheet.locked;
    $('#paper-date').textContent = '创建于 ' + new Date(sheet.createdAt).toLocaleString();
    $('#lock-paper').textContent = sheet.locked ? '解锁稿纸' : '锁定稿纸';
    $('#lock-paper').setAttribute('aria-pressed', String(sheet.locked));
    $('#locked-notice').hidden = !sheet.locked;
    $('#add-row').disabled = sheet.locked;
    $('#clear-paper').disabled = sheet.locked;
    refreshKeyboard();
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
    refreshKeyboard();
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
function refreshKeyboard() {
    if (!initialized || keyboardOnly) return;
    const rowIndex = sheet.rows.findIndex((r) => r.id === currentRow);
    $('#keyboard-target').textContent = sheet.locked ? '稿纸已锁定' : `输入到第 ${rowIndex + 1} 行`;
    $('#math-keyboard')
        .querySelectorAll('.keyboard-layout button')
        .forEach((b) => (b.disabled = sheet.locked));
    const history = rowIndex < 0 ? null : editHistory.get(historyKey(sheet.rows[rowIndex]));
    $('#formula-undo').disabled = sheet.locked || !history?.undo.length;
    $('#formula-redo').disabled = sheet.locked || !history?.redo.length;
    keyboardChannel.postMessage({
        type: 'state',
        owner: keyboardSession,
        rowId: currentRow,
        row: rowIndex + 1,
        title: title(sheet),
        formula: sheet.rows[rowIndex]?.expression || '',
        canUndo: !!history?.undo.length,
        canRedo: !!history?.redo.length,
        locked: sheet.locked || operation
    });
}
async function setKeyboard(open) {
    if (keyboardOnly) {
        if (!open) window.close();
        return;
    }
    if (open) {
        try {
            await api.windows.open({
                title: '数学键盘',
                width: 720,
                height: 460,
                minWidth: 360,
                minHeight: 280,
                followActivePlugin: true
            });
        } catch (error) {
            message(error.message);
            return;
        }
    } else keyboardChannel.postMessage({ type: 'close', owner: keyboardSession });
    keyboardOpen = open;
    if (initialized && index.keyboardOpen !== open) {
        index.keyboardOpen = open;
        void persist().catch(() => {});
    }
    $('#keyboard-toggle').setAttribute('aria-expanded', String(open));
    refreshKeyboard();
}
function keyboardInput(key) {
    if (keyboardOnly) {
        sendKeyboard('input', key[1] ?? key[0]);
        return;
    }
    if (!initialized || operation || sheet.locked || compose) return;
    const node = [...$('#rows').children].find((n) => n.dataset.rowId === currentRow),
        input = node?.querySelector('.expression');
    if (!input) return;
    try {
        const next = CalcKeyboard.edit(input.value, input.selectionStart, input.selectionEnd, key);
        input.editSelection = { start: input.selectionStart, end: input.selectionEnd };
        input.focus({ preventScroll: true });
        input.setRangeText(next.text, 0, input.value.length, 'end');
        input.setSelectionRange(next.caret, next.caret);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.scrollIntoView({ block: 'nearest' });
    } catch (error) {
        message(error.message);
    }
}
function keyboardGroup(group) {
    $('#keyboard-keys').replaceChildren();
    $('#keyboard-tabs')
        .querySelectorAll('button')
        .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.group === group.id)));
    for (const key of group.keys) {
        const button = document.createElement('button');
        button.textContent = key[0];
        button.title = key[2] || key[0];
        button.setAttribute('aria-label', button.title);
        button.dataset.key = key[1] ?? key[0];
        button.onclick = () => keyboardInput(key);
        $('#keyboard-keys').append(button);
    }
    refreshKeyboard();
}
for (const group of CalcKeyboard.groups) {
    const button = document.createElement('button');
    button.textContent = group.name;
    button.dataset.group = group.id;
    button.onclick = () => keyboardGroup(group);
    $('#keyboard-tabs').append(button);
}
keyboardGroup(CalcKeyboard.groups[0]);
function sendKeyboard(action, key) {
    if (keyboardOwner && keyboardTarget)
        keyboardChannel.postMessage({ type: 'command', owner: keyboardOwner, rowId: keyboardTarget, action, key });
}
keyboardChannel.onmessage = (event) => {
    const data = event.data;
    if (!data || typeof data !== 'object') return;
    if (keyboardOnly) {
        if (data.type === 'state') {
            keyboardOwner = data.owner;
            keyboardTarget = data.rowId;
            $('#keyboard-target').textContent = data.locked ? '稿纸已锁定' : `输入到第 ${data.row} 行`;
            $('#keyboard-target').textContent =
                `${data.title || '未命名稿纸'} · 第 ${data.row} 行${data.locked ? ' · 已锁定' : ''}`;
            $('#keyboard-target').title = $('#keyboard-target').textContent;
            $('#keyboard-formula').textContent = data.formula || '当前行为空，点击按键开始输入';
            $('#keyboard-formula').title = data.formula || '';
            $('#math-keyboard')
                .querySelectorAll('.keyboard-layout button')
                .forEach((b) => (b.disabled = !!data.locked));
            $('#keyboard-undo').disabled = !!data.locked || !data.canUndo;
            $('#keyboard-redo').disabled = !!data.locked || !data.canRedo;
        } else if (data.type === 'close' && data.owner === keyboardOwner) window.close();
        return;
    }
    if (!initialized) return;
    if (data.type === 'ready') {
        refreshKeyboard();
        return;
    }
    if (data.owner !== keyboardSession) return;
    if (data.type === 'closed') {
        keyboardOpen = false;
        index.keyboardOpen = false;
        $('#keyboard-toggle').setAttribute('aria-expanded', 'false');
        void persist().catch(() => {});
        return;
    }
    if (data.type !== 'command' || data.rowId !== currentRow || sheet.locked || operation) {
        refreshKeyboard();
        return;
    }
    if (data.action === 'input') {
        const key = CalcKeyboard.groups.flatMap((g) => g.keys).find((key) => (key[1] ?? key[0]) === data.key);
        if (key) keyboardInput(key);
    } else if (data.action === 'backspace') keyboardInput(['', '', '', 'delete']);
    else if (data.action === 'clear') keyboardInput(['', '', '', 'clear']);
    else if (data.action === 'undo' || data.action === 'redo') undoFormula(data.action === 'redo');
    else if (data.action === 'next') $('#keyboard-next').click();
};
window.addEventListener('beforeunload', () => {
    keyboardChannel.postMessage({
        type: keyboardOnly ? 'closed' : 'close',
        owner: keyboardOnly ? keyboardOwner : keyboardSession
    });
    keyboardChannel.close();
});
$('#math-keyboard').onpointerdown = (event) => {
    if (event.button === 0 && event.target.closest('button')) event.preventDefault();
};
$('#keyboard-toggle').onclick = () => void setKeyboard(!keyboardOpen);
$('#keyboard-close').onclick = () => setKeyboard(false);
$('#keyboard-reset').hidden = true;
$('#keyboard-pin').onclick = async () => {
    try {
        const enabled = $('#keyboard-pin').getAttribute('aria-pressed') !== 'true';
        await api.windows.setAlwaysOnTop(enabled);
        $('#keyboard-pin').setAttribute('aria-pressed', String(enabled));
        $('#keyboard-pin').textContent = enabled ? '置顶' : '不置顶';
    } catch (error) {
        message(error.message);
    }
};
$('#keyboard-undo').onclick = () => undoFormula();
$('#keyboard-redo').onclick = () => undoFormula(true);
$('#formula-undo').onclick = () => undoFormula();
$('#formula-redo').onclick = () => undoFormula(true);
$('#keyboard-backspace').onclick = () =>
    keyboardOnly ? sendKeyboard('backspace') : keyboardInput(['', '', '', 'delete']);
$('#keyboard-clear').onclick = () => (keyboardOnly ? sendKeyboard('clear') : keyboardInput(['', '', '', 'clear']));
$('#keyboard-next').onclick = () => {
    if (keyboardOnly) {
        sendKeyboard('next');
        return;
    }
    if (!initialized || operation || sheet.locked || compose) return;
    const rowIndex = sheet.rows.findIndex((r) => r.id === currentRow);
    if (sheet.rows[rowIndex + 1]) focusRow(sheet.rows[rowIndex + 1].id);
    else addRow();
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
$('#math-keyboard').inert = true;
(async () => {
    try {
        const context = await api.context();
        applyTheme(context);
        if (context.windowMode === 'floating') {
            keyboardOnly = true;
            document.documentElement.classList.add('keyboard-only');
            $('#math-keyboard').hidden = false;
            $('#math-keyboard').inert = false;
            $('#math-keyboard')
                .querySelectorAll('.keyboard-layout button')
                .forEach((b) => (b.disabled = true));
            $('#keyboard-target').textContent = '正在连接当前稿纸…';
            keyboardChannel.postMessage({ type: 'ready' });
            return;
        }
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
        $('#result-digits').value = [2, 4].includes(index.resultDigits) ? String(index.resultDigits) : '12';
        // 仅稿纸主页面加载公共选择器；独立数学键盘不加载无关控件。
        for (const resource of ['vendor/tom-select.js', 'vendor/floating-ui.js', 'overlay.js', 'ui-components.js']) {
            await new Promise((resolve, reject) => {
                const script = document.createElement('script');
                script.src = `collectify-plugin://collectify.sdk/${resource}`;
                script.onload = resolve;
                script.onerror = () => reject(Error('小数位选择器加载失败，请重新打开插件'));
                document.head.append(script);
            });
        }
        setFont(Number.isInteger(index.fontSize) ? index.fontSize : 22);
        initialized = true;
        renderPaper();
        void setKeyboard(index.keyboardOpen !== false);
        await persist();
        $('.workspace').inert = false;
        $('.toolbar').inert = false;
        $('#math-keyboard').inert = false;
    } catch (error) {
        message(error.message);
        $('#save-status').textContent = '读取失败，请重新打开插件';
        document.querySelectorAll('button,input,textarea').forEach((n) => (n.disabled = true));
    }
})();
