let draftTheme, savedTheme, themeSaved = false;
const Theme = window.ShiyueTheme;

function syncThemeControls() {
    for (const field of ['accent', 'background', 'surface', 'sidebar', 'radius', 'density','widgetMaterial','glassOpacity']) $(`#theme-${field}`).value = draftTheme[field];
    $('#theme-motion').checked = draftTheme.motion;
    renderAppearance();
}

function renderAppearance() {
    Theme.apply(draftTheme);
    $('#radius-value').textContent = `${draftTheme.radius}px`;
    $('#glass-opacity-value').textContent=`${draftTheme.glassOpacity}%`;
    $('#theme-glassOpacity').disabled=draftTheme.widgetMaterial!=='glass';
    $('#theme-presets').replaceChildren();
    for (const preset of Theme.PRESETS) {
        const node = button(preset.name, null, () => {
            draftTheme = Theme.validate({
                ...preset,
                preset: preset.id,
                radius: draftTheme.radius,
                density: draftTheme.density,
                motion: draftTheme.motion,
                widgetMaterial:draftTheme.widgetMaterial,
                glassOpacity:draftTheme.glassOpacity
            });
            syncThemeControls();
        }, `theme-preset${draftTheme.preset === preset.id ? ' active' : ''}`);
        const colors = el('span', 'preset-colors');
        for (const color of [preset.sidebar, preset.background, preset.accent]) {
            const dot = el('i');
            dot.style.backgroundColor = color;
            colors.append(dot);
        }
        node.replaceChildren(colors, el('strong', '', preset.name), el('small', '', preset.caption));
        $('#theme-presets').append(node);
    }
}

$('#theme-button').onclick = task(async () => {
    hideMenu();
    $('#settings-dialog').close();
    await call('overlay', true);
    savedTheme = Theme.validate(state.settings?.theme);
    draftTheme = {...savedTheme};
    themeSaved = false;
    $('#theme-error').textContent = '';
    syncThemeControls();
    $('#theme-dialog').showModal();
});
for (const field of ['accent', 'background', 'surface', 'sidebar', 'radius', 'density', 'motion','widgetMaterial','glassOpacity']) {
    $(`#theme-${field}`).addEventListener('input', () => {
        draftTheme[field] = field === 'motion' ? $('#theme-motion').checked : ['radius','glassOpacity'].includes(field) ? Number($(`#theme-${field}`).value) : $(`#theme-${field}`).value;
        renderAppearance();
    });
}
$('#theme-dialog').addEventListener('close', () => {
    if (!themeSaved && savedTheme) Theme.apply(savedTheme);
});
$('#appearance-back').onclick=task(async()=>{$('#theme-dialog').close();await openSettings();});
$('#save-theme').onclick = task(async () => {
    await call('theme-save', draftTheme);
    themeSaved = true;
    $('#theme-dialog').close();
    await refresh();
    toast('外观已保存，桌面待办同步更新');
});
$('#reset-theme').onclick = () => {
    draftTheme = Theme.validate();
    syncThemeControls();
};
$('#import-theme').onclick = async () => {
    try {
        const value = await call('theme-import');
        if (value) {
            draftTheme = value;
            syncThemeControls();
        }
    } catch (error) {
        $('#theme-error').textContent = error.message;
    }
};
$('#export-theme').onclick = task(async () => {
    if (await call('theme-export')) toast('已保存的主题已导出');
});
