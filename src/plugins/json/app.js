const $ = (selector) => document.querySelector(selector);
for (const mode of ['format', 'compact', 'validate'])
    $(`#${mode}`).onclick = () =>
        ToolUI.run(() => {
            void collectify.selectNavigation(mode);
            $('#output').value = '';
            const result = JsonTool.transform($('#input').value, mode, $('#indent').value);
            $('#output').value = result.text;
            ToolUI.message(result.message);
        });
$('#input').oninput = () => {
    $('#output').value = '';
    ToolUI.message('');
};
$('#copy').onclick = () =>
    ToolUI.run(async () => {
        if (!$('#output').value) throw Error('请先格式化或压缩 JSON');
        await collectify.clipboard.writeText($('#output').value);
        ToolUI.message('结果已复制');
    });
$('#clear').onclick = () => {
    $('#input').value = '';
    $('#output').value = '';
    ToolUI.message('');
    $('#input').focus();
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
