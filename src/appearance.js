let draftTheme, savedTheme, themeSaved = false, appearanceParent = null, appearancePreview='main';
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
    $('.theme-preview').dataset.preview=appearancePreview;
    $('#preview-main').setAttribute('aria-selected',String(appearancePreview==='main'));
    $('#preview-widget').setAttribute('aria-selected',String(appearancePreview==='widget'));
    $('#appearance-preview-caption').textContent=appearancePreview==='main'?'主界面预览：配色、圆角和信息密度。':'桌面待办预览：底图透过玻璃并被模糊，文字保持清晰。';
    $('#theme-presets').replaceChildren();
    for (const preset of Theme.PRESETS) {
        const node = button(preset.name, null, () => {
            appearancePreview='main';
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
    appearanceParent=$('#settings-dialog').open?$('.settings-navigation .selected')?.dataset.settingsPanel||'general':null;
    $('#settings-dialog').close();
    await call('overlay', true);
    savedTheme = Theme.validate(state.settings?.theme);
    draftTheme = {...savedTheme};
    themeSaved = false;
    appearancePreview='main';
    $('#theme-error').textContent = '';
    syncThemeControls();
    $('#theme-dialog').showModal();
});
for (const field of ['accent', 'background', 'surface', 'sidebar', 'radius', 'density', 'motion','widgetMaterial','glassOpacity']) {
    $(`#theme-${field}`).addEventListener('input', () => {
        appearancePreview=['widgetMaterial','glassOpacity'].includes(field)?'widget':'main';
        draftTheme[field] = field === 'motion' ? $('#theme-motion').checked : ['radius','glassOpacity'].includes(field) ? Number($(`#theme-${field}`).value) : $(`#theme-${field}`).value;
        renderAppearance();
    });
}
$('#theme-dialog').addEventListener('close', () => {
    if (!themeSaved && savedTheme) Theme.apply(savedTheme);
    const parent=appearanceParent;appearanceParent=null;
    if(parent)queueMicrotask(()=>void openSettings(parent));
});
$('#appearance-back').onclick=()=>{if(!appearanceParent)appearanceParent='general';$('#theme-dialog').close();};
$('#preview-main').onclick=()=>{appearancePreview='main';renderAppearance();};
$('#preview-widget').onclick=()=>{appearancePreview='widget';renderAppearance();};
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
