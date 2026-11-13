async function readPluginClipboard({ allowed, readText }) {
    if (!allowed()) throw Error('当前插件未显示，已暂停读取剪贴板');
    const text = await readText();
    // 原生读取可能异步完成；插件在等待期间隐藏、停用或关闭时，不再交付文本。
    if (!allowed()) throw Error('当前插件未显示，已暂停读取剪贴板');
    if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 64 * 1024)
        throw Error('剪贴板文本超过 64 KB 或格式不正确，未交付到插件');
    return text;
}
module.exports = { readPluginClipboard };
