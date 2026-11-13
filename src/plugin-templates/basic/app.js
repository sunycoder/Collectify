const input = document.querySelector('#input');
ToolUI.run(async () => {
    const context = await collectify.context();
    document.querySelector('#title').textContent = context.plugin.name;
    input.value = (await collectify.storage.get('content')) || '';
});
document.querySelector('#copy').onclick = () =>
    ToolUI.run(async () => {
        await collectify.clipboard.writeText(input.value);
        ToolUI.message('已复制');
    });
document.querySelector('#save').onclick = () =>
    ToolUI.run(async () => {
        await collectify.storage.set('content', input.value);
        ToolUI.message('已保存');
    });
collectify.onNavigate(() => input.focus());
