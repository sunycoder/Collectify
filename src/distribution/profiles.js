const { cleanPath } = require('./config');
const { validateSnapshot } = require('../plugin-system/registry');
function validateProfiles(input) {
    if (
        input?.format !== 'collectify-team-profiles' ||
        input.version !== 1 ||
        !Array.isArray(input.profiles) ||
        input.profiles.length > 100
    )
        throw Error('团队配置索引格式不正确');
    const ids = new Set();
    return input.profiles.map((p) => {
        if (
            typeof p.id !== 'string' ||
            !/^[\w.-]{1,80}$/.test(p.id) ||
            ids.has(p.id) ||
            typeof p.name !== 'string' ||
            !p.name ||
            p.name.length > 100 ||
            typeof p.version !== 'string' ||
            !/^\d+\.\d+\.\d+$/.test(p.version) ||
            p.version.length > 60 ||
            !Array.isArray(p.groups) ||
            p.groups.length > 100 ||
            p.groups.some((g) => typeof g !== 'string' || !g || g.length > 500) ||
            !/^[a-f0-9]{64}$/.test(p.sha256) ||
            !Number.isSafeInteger(p.size) ||
            p.size < 1 ||
            p.size > 20 * 1024 * 1024
        )
            throw Error('团队配置条目信息不正确');
        ids.add(p.id);
        return {
            id: p.id,
            name: p.name,
            version: p.version,
            groups: [...p.groups],
            path: cleanPath(p.path, '配置路径'),
            ...(p.project ? { project: cleanPath(p.project, '配置项目') } : {}),
            ...(p.ref ? { ref: cleanPath(p.ref, '配置分支') } : {}),
            size: p.size,
            sha256: p.sha256
        };
    });
}
function sameItem(a, b) {
    return (
        a &&
        b &&
        typeof a === 'object' &&
        typeof b === 'object' &&
        ((a.id !== undefined && a.id === b.id) || (a.url && a.url === b.url))
    );
}
// 团队默认值是补充而非强制策略：已有值优先；已应用后被用户删除的内容不会再次补回。
function supplement(local, incoming, previous) {
    if (Array.isArray(incoming)) {
        const existing = Array.isArray(local) ? local : [];
        return [
            ...existing,
            ...incoming.filter(
                (item) =>
                    !existing.some((v) => sameItem(v, item) || JSON.stringify(v) === JSON.stringify(item)) &&
                    !(
                        Array.isArray(previous) &&
                        previous.some((v) => sameItem(v, item) || JSON.stringify(v) === JSON.stringify(item))
                    )
            )
        ];
    }
    if (incoming && typeof incoming === 'object') {
        const result = local && typeof local === 'object' && !Array.isArray(local) ? { ...local } : {};
        for (const [key, value] of Object.entries(incoming)) {
            if (['__proto__', 'constructor', 'prototype'].includes(key)) throw Error('配置包含不允许的键');
            result[key] = supplement(result[key], value, previous?.[key]);
        }
        return result;
    }
    return local !== undefined ? local : previous !== undefined ? undefined : incoming;
}
function defaultPlan(raw, local, previous = null) {
    if (raw?.format !== 'collectify-workspace' || raw.version !== 2)
        throw Error('团队配置需要 Collectify 工作台导出格式');
    validateSnapshot({ version: 1, plugins: raw.plugins });
    const plugins = raw.plugins.map((item) => {
        const current = local.plugins.find((p) => p.id === item.id),
            prior = previous?.plugins.find((p) => p.id === item.id);
        return {
            ...item,
            enabled: current?.enabled ?? false,
            values: supplement(current?.values, item.values, prior?.values),
            ...(item.data ? { data: supplement(current?.data, item.data, prior?.data) } : {})
        };
    });
    // 宿主个性化设置已存在时保留；不下发凭据、启停状态或可执行插件程序。
    return { format: 'collectify-workspace', version: 2, plugins };
}
module.exports = { validateProfiles, supplement, defaultPlan };
