const $ = (selector) => document.querySelector(selector);
const jsonEditors = [];
function syncEditors() {
    for (const update of jsonEditors) update();
}
for (const id of ['input', 'output']) {
    const area = $('#' + id),
        label = area.parentElement,
        editor = document.createElement('div'),
        gutter = document.createElement('div'),
        numbers = document.createElement('pre'),
        enlarge = document.createElement('button');
    editor.className = 'json-editor';
    gutter.className = 'json-gutter';
    gutter.setAttribute('aria-hidden', 'true');
    enlarge.type = 'button';
    enlarge.className = 'json-enlarge';
    enlarge.textContent = '放大';
    enlarge.onclick = () => {
        if (document.body.dataset.editorFocus === id) delete document.body.dataset.editorFocus;
        else document.body.dataset.editorFocus = id;
        document
            .querySelectorAll('.json-enlarge')
            .forEach(
                (button) => (button.textContent = document.body.hasAttribute('data-editor-focus') ? '恢复双栏' : '放大')
            );
        syncEditors();
    };
    label.insertBefore(enlarge, area);
    label.append(editor);
    gutter.append(numbers);
    editor.append(gutter, area);
    area.wrap = 'off';
    const update = () => {
        const count = (area.value.match(/\n/g) || []).length + 1,
            first = Math.floor(area.scrollTop / 20),
            visible = Math.ceil(area.clientHeight / 20) + 1;
        numbers.textContent = Array.from({ length: Math.max(0, Math.min(visible, count - first)) }, (_, i) =>
            String(first + i + 1)
        ).join('\n');
        numbers.style.transform = `translateY(-${area.scrollTop % 20}px)`;
    };
    area.addEventListener('input', update);
    area.addEventListener('scroll', update);
    new ResizeObserver(update).observe(editor);
    jsonEditors.push(update);
}
for (const mode of ['format', 'compact', 'validate'])
    $(`#${mode}`).onclick = () =>
        ToolUI.run(() => {
            void collectify.selectNavigation(mode);
            $('#output').value = '';
            let result;
            $('#jump-error').hidden = true;
            try {
                result = JsonTool.transform($('#input').value, mode, $('#indent').value);
            } catch (error) {
                const match = /第 (\d+) 行，第 (\d+) 列/.exec(error.message);
                if (match) {
                    const lines = $('#input').value.split('\n'),
                        line = Number(match[1]) - 1;
                    const offset =
                        lines.slice(0, line).reduce((n, text) => n + text.length + 1, 0) + Number(match[2]) - 1;
                    $('#jump-error').hidden = false;
                    $('#jump-error').onclick = () => {
                        $('#input').focus();
                        $('#input').setSelectionRange(offset, Math.min(offset + 1, $('#input').value.length));
                        $('#input').scrollTop = line * (parseFloat(getComputedStyle($('#input')).lineHeight) || 20);
                    };
                } else {
                    $('#jump-error').hidden = false;
                    $('#jump-error').title = '解析器未提供精确位置，返回输入开头';
                    $('#jump-error').onclick = () => {
                        $('#input').focus();
                        $('#input').setSelectionRange(0, 0);
                        $('#input').scrollTop = 0;
                    };
                }
                throw error;
            }
            $('#output').value = result.text;
            syncEditors();
            ToolUI.message(result.message);
        });
$('#input').oninput = () => {
    $('#jump-error').hidden = true;
    $('#output').value = '';
    syncEditors();
    ToolUI.message('');
};
$('#copy').onclick = () =>
    ToolUI.run(async () => {
        if (!$('#output').value) throw Error('请先格式化或压缩 JSON');
        await collectify.clipboard.writeText($('#output').value);
        ToolUI.message('结果已复制');
    });
$('#clear').onclick = () => {
    const previous = { input: $('#input').value, output: $('#output').value };
    $('#input').value = '';
    $('#output').value = '';
    ToolUI.message('');
    $('#input').focus();
    if (previous.input || previous.output) {
        syncEditors();
        $('#undo-clear').hidden = false;
        $('#undo-clear').onclick = () => {
            if ($('#input').value || $('#output').value) {
                ToolUI.message('当前已有新内容，请先复制保留后再撤销清空', true);
                return;
            }
            $('#input').value = previous.input;
            $('#output').value = previous.output;
            $('#undo-clear').hidden = true;
            syncEditors();
            $('#input').focus();
        };
    }
};
collectify.onCommand(() => $('#input').focus());
collectify.onNavigate(({ route }) => {
    if (!['format', 'compact', 'validate'].includes(route)) return;
    for (const mode of ['format', 'compact', 'validate']) $(`#${mode}`).classList.toggle('primary', mode === route);
    $('#input').focus();
    if ($('#input').value.trim()) $(`#${route}`).click();
});
ToolUI.run(async () => {
    const preferences = await collectify.storage.get('preferences');
    if (['2', '4', 'tab'].includes(preferences?.indent)) $('#indent').value = preferences.indent;
    $('#indent').onchange = () =>
        ToolUI.run(() => collectify.storage.set('preferences', { indent: $('#indent').value }));
});
