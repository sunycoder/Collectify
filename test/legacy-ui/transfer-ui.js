let transferMode = 'export',
    transferDraft = null;
const transferLabels = {
    bookmarks: '收藏与分类',
    tasks: '待办与日历',
    notes: '便签',
    settings: '偏好设置',
    plugins: '插件数据'
};
document.querySelector('.transfer-options input[value=bookmarks]').addEventListener('change', (event) => {
    $('#transfer-credentials').hidden = transferMode !== 'export' || !event.target.checked;
});

async function openTransfer(mode) {
    hideMenu();
    transferMode = mode;
    transferDraft = null;
    $('#settings-dialog').close();
    await call('overlay', true);
    $('#transfer-error').textContent = '';
    if (mode === 'import') {
        try {
            transferDraft = await call('import-preview');
        } catch (error) {
            await call('overlay', false);
            toast(error.message);
            return;
        }
        if (!transferDraft) {
            await call('overlay', false);
            return;
        }
    }
    const available = transferDraft?.sections || Object.keys(transferLabels),
        counts = transferDraft?.counts || {
            bookmarks: state.entries.length,
            tasks: state.tasks.length,
            notes: state.notes.length,
            plugins: pluginCatalog.length
        };
    document.querySelectorAll('.transfer-options input').forEach((input) => {
        input.disabled = !available.includes(input.value);
        input.checked = !input.disabled;
        input.closest('label').classList.toggle('unavailable', input.disabled);
    });
    document
        .querySelectorAll('[data-count]')
        .forEach(
            (node) =>
                (node.textContent = available.includes(node.dataset.count)
                    ? `${counts[node.dataset.count] || 0} 项`
                    : '文件未包含')
        );
    $('#transfer-title').textContent = mode === 'export' ? '导出数据' : '导入数据';
    $('#transfer-confirm').textContent = mode === 'export' ? '选择保存位置' : '确认导入';
    $('#transfer-credentials').hidden = mode !== 'export';
    $('#transfer-import-options').hidden = mode !== 'import';
    $('#transfer-mode').value = 'merge';
    $('#transfer-file-summary').hidden = mode !== 'import';
    $('#transfer-file-summary').textContent = transferDraft
        ? `文件：${transferDraft.name} · 包含 ${available.map((key) => transferLabels[key]).join('、')}`
        : '';
    $('#transfer-dialog').showModal();
    window.OfficeUI.refresh();
}

$('#settings-export').onclick = task(() => openTransfer('export'));
$('#settings-import').onclick = task(() => openTransfer('import'));
$('#import-main').onclick = task(() => openSettings('data'));
$('#data-menu-button').onclick = (event) =>
    menu(event.currentTarget, [
        { label: '导出数据', icon: 'upload', run: () => openTransfer('export') },
        { label: '导入数据', icon: 'download', run: () => openTransfer('import') }
    ]);
$('#transfer-confirm').onclick = async () => {
    const sections = [...document.querySelectorAll('.transfer-options input:checked:not(:disabled)')].map(
            (input) => input.value
        ),
        button = $('#transfer-confirm');
    if (!sections.length) {
        $('#transfer-error').textContent = '请至少选择一种数据类型';
        return;
    }
    button.disabled = true;
    try {
        const result =
            transferMode === 'export'
                ? await call('export', { sections, includeCredentials: $('#transfer-credentials input').checked })
                : await call('import', { token: transferDraft.token, sections, mode: $('#transfer-mode').value });
        if (result !== null) {
            $('#transfer-dialog').close();
            await refresh();
            toast(transferMode === 'export' ? '所选数据已导出' : '所选数据已导入，未勾选的内容保留');
        }
    } catch (error) {
        $('#transfer-error').textContent = error.message;
    } finally {
        button.disabled = false;
    }
};
$('#transfer-dialog').addEventListener('close', () => {
    if (transferDraft) {
        void call('import-cancel', transferDraft.token);
        transferDraft = null;
    }
});
