// 自有插件共享的轻量 UI 辅助层，业务算法仍由各插件独立维护。
window.ToolUI = {
    applyContext(context) {
        for (const [key, value] of Object.entries(context.tokens))
            document.documentElement.style.setProperty(key, value);
        document.documentElement.dataset.density = context.theme.density;
    },
    message(text, error = false) {
        const node = document.querySelector('#message');
        node.textContent = text;
        node.classList.toggle('error', error);
    },
    async run(action) {
        try {
            await action();
        } catch (error) {
            window.ToolUI.message(error.message, true);
        }
    }
};
window.collectify.onContextChanged(window.ToolUI.applyContext);
window.collectify
    .context()
    .then(window.ToolUI.applyContext)
    .catch((error) => window.ToolUI.message(error.message, true));

// 轻量插件与宿主共用选择器实现，避免插件退回平台原生下拉菜单。
window.ToolUI.ready = (async () => {
    if (!document.querySelector('select')) return;
    for (const resource of ['vendor/flatpickr.css', 'select.css']) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = `collectify-plugin://collectify.sdk/${resource}`;
        document.head.append(link);
    }
    for (const resource of [
        'vendor/tom-select.js',
        'vendor/floating-ui.js',
        'vendor/flatpickr.js',
        'vendor/flatpickr-zh.js',
        'overlay.js',
        'ui-components.js'
    ]) {
        await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = `collectify-plugin://collectify.sdk/${resource}`;
            script.onload = resolve;
            script.onerror = () => reject(Error('公共控件加载失败'));
            document.head.append(script);
        });
    }
})();
window.ToolUI.ready.catch((error) => window.ToolUI.message(error.message, true));
