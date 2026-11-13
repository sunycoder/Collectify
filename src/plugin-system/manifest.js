const fs = require('node:fs');
const path = require('node:path');
const { compatibility, validateCompatibility } = require('./compatibility');
const API_VERSION = 1;
const PERMISSIONS = [
    'storage',
    'clipboard.read',
    'clipboard.write',
    'background',
    'clipboard.background',
    'window',
    'desktop.paste',
    'native'
];
const ID = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;

function pluginId(value) {
    if (typeof value !== 'string' || value.length > 100 || !ID.test(value))
        throw Error('插件 ID 应使用反向域名格式，如 collectify.timestamp');
    return value;
}
function pluginUrl(plugin) {
    return `collectify-plugin://${pluginId(plugin.id)}/${plugin.entry.split('/').map(encodeURIComponent).join('/')}`;
}

// 清单中的路径、请求 URL 与安装文件都经过相同的边界检查；拒绝符号链接穿透。
function assetPath(root, relative) {
    if (
        typeof relative !== 'string' ||
        !relative ||
        relative.includes('\\') ||
        relative.includes('\0') ||
        relative.split('/').some((p) => !p || p === '.' || p === '..') ||
        path.isAbsolute(relative)
    )
        throw Error('插件资源路径不合法');
    const base = fs.realpathSync(root);
    const target = path.resolve(base, relative);
    if (!target.startsWith(base + path.sep)) throw Error('插件资源越界');
    let current = base;
    for (const part of relative.split('/')) {
        current = path.join(current, part);
        if (fs.lstatSync(current).isSymbolicLink()) throw Error('插件不允许使用符号链接');
    }
    if (!fs.statSync(target).isFile()) throw Error('插件资源不是文件');
    return target;
}

function readManifest(root, { builtin = false } = {}) {
    const file = assetPath(root, 'manifest.json');
    if (fs.statSync(file).size > 32000) throw Error('插件清单过大');
    const input = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    const requirements = validateCompatibility(input),
        support = compatibility(requirements);
    if (!support.compatible) throw Error(support.compatibilityReason);
    pluginId(input.id);
    if (input.id === 'collectify.sdk') throw Error('该插件 ID 为宿主保留');
    for (const field of ['name', 'description', 'version'])
        if (typeof input[field] !== 'string' || !input[field].trim() || input[field].length > 300)
            throw Error(`插件 ${field} 不正确`);
    if (!/^\d+\.\d+\.\d+$/.test(input.version)) throw Error('插件版本必须为 x.y.z');
    if (input.apiVersion !== API_VERSION) throw Error(`插件需要不支持的 API 版本：${input.apiVersion}`);
    if (
        !Array.isArray(input.permissions) ||
        new Set(input.permissions).size !== input.permissions.length ||
        input.permissions.some((p) => !PERMISSIONS.includes(p))
    )
        throw Error('插件请求了不支持的权限');
    if (!input.entry?.endsWith('.html')) throw Error('插件入口必须为 HTML 页面');
    assetPath(root, input.entry);
    if (input.shortcut !== undefined) {
        if (
            typeof input.shortcut !== 'string' ||
            !input.shortcut.endsWith('.html') ||
            !input.permissions.includes('window')
        )
            throw Error('桌面快捷按钮需声明 window 权限和 HTML 入口');
        assetPath(root, input.shortcut);
    }
    if (!Array.isArray(input.commands) || !input.commands.length || input.commands.length > 20)
        throw Error('插件必须声明至少一个打开命令');
    const ids = new Set();
    const commands = input.commands.map((c) => {
        if (
            !c ||
            typeof c.id !== 'string' ||
            !/^[a-z][a-z0-9-]{0,60}$/.test(c.id) ||
            ids.has(c.id) ||
            typeof c.title !== 'string' ||
            !c.title.trim() ||
            c.title.length > 100
        )
            throw Error('插件命令不合法或重复');
        ids.add(c.id);
        // API v1 命令均打开插件页面；暂不执行任意后台 Node.js 入口。
        return { id: c.id, title: c.title };
    });
    let publisher;
    if (input.backend && !builtin) {
        if (input.runtime !== 'native' || !input.permissions.includes('native'))
            throw Error('本地页面插件不能声明原生后台入口');
        publisher = require('./native-signature').verifyDirectory(root);
    }
    if (input.runtime === 'native' && (!input.backend || !input.permissions.includes('native')))
        throw Error('原生插件必须声明后台入口和 native 权限');
    if (input.permissions.includes('native') && input.runtime !== 'native')
        throw Error('native 权限必须配合原生运行方式');
    if (input.backend) assetPath(root, input.backend);
    if (input.background) {
        if (
            typeof input.background !== 'string' ||
            !input.background.endsWith('.html') ||
            !input.permissions.includes('background')
        )
            throw Error('后台页面需声明 background 权限并使用 HTML 入口');
        assetPath(root, input.background);
    }
    if (
        input.iconAsset !== undefined &&
        (typeof input.iconAsset !== 'string' ||
            !/^[\p{L}\p{N} _-]+\.svg$/u.test(input.iconAsset) ||
            !fs.existsSync(path.join(__dirname, '..', '..', 'assets', input.iconAsset)))
    )
        throw Error('插件图标必须引用 assets 中已有的 SVG');
    const navigation = input.navigation || [{ id: 'home', label: input.name }];
    if (
        !Array.isArray(navigation) ||
        navigation.length > 50 ||
        navigation.some(
            (n) =>
                !n ||
                typeof n.id !== 'string' ||
                n.id.length > 150 ||
                typeof n.label !== 'string' ||
                n.label.length > 100
        )
    )
        throw Error('插件导航不正确');
    return {
        ...requirements,
        ...(input.shortcut ? { shortcut: input.shortcut } : {}),
        ...(input.runtime === 'native' ? { runtime: 'native', publisher } : {}),
        ...(input.background ? { background: input.background } : {}),
        ...(input.iconAsset ? { iconAsset: input.iconAsset } : {}),
        id: input.id,
        name: input.name.trim(),
        description: input.description.trim(),
        version: input.version,
        apiVersion: API_VERSION,
        entry: input.entry,
        permissions: [...input.permissions],
        commands,
        navigation,
        order: Number.isFinite(input.order) ? input.order : 100,
        glyph: typeof input.glyph === 'string' ? input.glyph.slice(0, 4) : input.name.slice(0, 1),
        ...(input.backend && (builtin || publisher) ? { backend: input.backend } : {})
    };
}

module.exports = { API_VERSION, PERMISSIONS, pluginId, pluginUrl, assetPath, readManifest };
