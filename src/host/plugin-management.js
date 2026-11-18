const fs = require('node:fs'),
    path = require('node:path');
const { dialog } = require('electron');
const { ARCHIVE_LIMIT } = require('../plugin-system/package');
const { readManifest } = require('../plugin-system/manifest');
const { compareVersion } = require('../plugin-system/catalog');
exports.createPluginManagement = ({
    registry,
    runtime,
    services,
    pluginCatalog,
    packages,
    getWindow,
    pick,
    pluginEnabled,
    revealInstalledPlugin,
    confirmPluginClose,
    updateTray,
    publish,
    layout,
    protectedTarget,
    sendPluginTransfer,
    setTransfer
}) => {
    let operation = false;
    async function installPrepared(prepared, sourceLabel, signal) {
        const { manifest } = prepared,
            previous = registry.plugins.get(manifest.id),
            previousVersion = previous?.version;
        const { sha256, encodeZip, collectFiles } = require('../plugin-system/package'),
            previousDigest = previous
                ? sha256(encodeZip(collectFiles(previous.directory), { native: previous.runtime === 'native' }))
                : null;
        if (previous?.builtin || registry.defaults().some((p) => p.id === manifest.id))
            throw Error('默认插件请通过恢复或更新 Collectify 安装');
        if (previous && compareVersion(manifest.version, previous.version) < 0)
            throw Error('不能安装低于当前版本的插件');
        const added = manifest.permissions.filter((p) => !previous?.permissions.includes(p));
        const answer = await dialog.showMessageBox(getWindow(), {
            type: 'question',
            message: `${previous ? '更新' : '安装'} ${manifest.name} ${manifest.version}？`,
            detail: `来源：${sourceLabel}\n插件 ID：${manifest.id}${previous ? '\n当前版本：' + previous.version : ''}\n权限：${manifest.permissions.join('、') || '无'}${previous && added.length ? '\n新增权限：' + added.join('、') : ''}${manifest.runtime === 'native' ? '\n已校验发布者签名：' + manifest.publisher + '\n该插件含本机程序，可读取本机文件并运行原生后台；仅在信任发布者时安装。' : ''}\n插件数据保存在独立目录中，更新会保留数据。`,
            buttons: ['取消', previous ? '更新' : '安装'],
            defaultId: 0,
            cancelId: 0
        });
        if (answer.response !== 1) return null;
        signal?.throwIfAborted();
        if (registry.plugins.get(manifest.id)?.version !== previousVersion)
            throw Error('确认期间插件状态已改变，请重新安装');
        if (
            previous &&
            sha256(
                encodeZip(collectFiles(registry.get(manifest.id).directory), { native: previous.runtime === 'native' })
            ) !== previousDigest
        )
            throw Error('确认期间插件程序已改变，请重新安装');
        if (previous && !(await confirmPluginClose([manifest.id], 'update'))) return null;
        await runtime.close(manifest.id);
        if (previous?.backend) await services.unload(manifest.id);
        let id;
        try {
            id = registry.install(prepared.directory, manifest);
        } finally {
            await services.load({ activate: false });
            if (registry.plugins.get(manifest.id)?.enabled) await services.enable(manifest.id);
        }
        if (registry.get(id).enabled) await runtime.startBackground(id);
        updateTray();
        publish();
        return id;
    }
    async function pluginManagement(action, payload) {
        if (action === 'plugin-catalog-status') return pluginCatalog.status();
        if (operation) throw Error('插件操作正在进行，请稍候');
        operation = true;
        try {
            switch (action) {
                case 'plugin-catalog-configure':
                    return pluginCatalog.configure(payload);
                case 'plugin-catalog-refresh':
                    return await pluginCatalog.refresh();
                case 'plugin-catalog-install': {
                    const controller = new AbortController(),
                        meter = require('../distribution/transfer').transferMeter({
                            total: pluginCatalog.items.find((item) => item.id === payload)?.size || 0
                        });
                    const transfer = {
                        controller,
                        status: {
                            ...meter(0, 0, 'connecting'),
                            label: pluginCatalog.items.find((item) => item.id === payload)?.name || payload
                        }
                    };
                    setTransfer(transfer);
                    const update = (received, total, phase = 'downloading') => {
                        transfer.status = { ...meter(received, total, phase), label: transfer.status.label };
                        sendPluginTransfer(transfer.status);
                    };
                    let prepared, heartbeat;
                    try {
                        sendPluginTransfer(transfer.status);
                        heartbeat = setInterval(
                            () => update(transfer.status.received, transfer.status.total, transfer.status.phase),
                            500
                        );
                        const { data, item } = await pluginCatalog.package(
                            payload,
                            controller.signal,
                            (received, total) => update(received, total)
                        );
                        controller.signal.throwIfAborted();
                        clearInterval(heartbeat);
                        update(data.length, data.length, 'verifying');
                        await new Promise((resolve) => setImmediate(resolve));
                        prepared = packages.prepare(data, item);
                        update(data.length, data.length, 'confirming');
                        const result = await installPrepared(
                            prepared,
                            new URL(pluginCatalog.source).host,
                            controller.signal
                        );
                        update(data.length, data.length, result ? 'complete' : 'cancelled');
                        return result;
                    } catch (error) {
                        transfer.status = {
                            ...transfer.status,
                            phase: controller.signal.aborted ? 'cancelled' : 'error',
                            error: controller.signal.aborted ? '已取消下载' : error.message
                        };
                        sendPluginTransfer(transfer.status);
                        throw Error(transfer.status.error);
                    } finally {
                        clearInterval(heartbeat);
                        if (prepared) packages.cleanup(prepared);
                    }
                }
                case 'plugin-package-install': {
                    const result = await dialog.showOpenDialog(getWindow(), {
                        title: '安装插件包',
                        properties: ['openFile'],
                        filters: [{ name: 'Collectify 插件', extensions: ['collectify-plugin'] }]
                    });
                    if (result.canceled) return null;
                    const file = result.filePaths[0];
                    if (fs.statSync(file).size > ARCHIVE_LIMIT) throw Error('插件安装包不能超过 64 MB');
                    const prepared = packages.prepare(fs.readFileSync(file));
                    try {
                        return await installPrepared(prepared, path.basename(file));
                    } finally {
                        packages.cleanup(prepared);
                    }
                }
                case 'plugin-install': {
                    const source = await pick('folder');
                    if (!source) return null;
                    const builtin = require('../plugin-system/source-install').builtinSource(source, registry);
                    if (builtin) {
                        if (!registry.plugins.has(builtin.id)) registry.restore(builtin.id);
                        await services.load({ activate: false });
                        await pluginEnabled(builtin.id, true);
                        await revealInstalledPlugin(builtin.id);
                        return { id: builtin.id, builtin: true, enabled: true };
                    }
                    const { collectFiles, encodeZip } = require('../plugin-system/package'),
                        prepared = packages.prepare(
                            encodeZip(collectFiles(source), { native: readManifest(source).runtime === 'native' })
                        );
                    try {
                        return await installPrepared(prepared, '本地目录');
                    } finally {
                        packages.cleanup(prepared);
                    }
                }
                case 'plugin-package-export': {
                    const p = registry.get(payload),
                        data = packages.export(payload),
                        result = await dialog.showSaveDialog(getWindow(), {
                            title: '导出插件程序',
                            defaultPath: `${p.id}-${p.version}.collectify-plugin`,
                            filters: [{ name: 'Collectify 插件', extensions: ['collectify-plugin'] }]
                        });
                    if (result.canceled) return null;
                    if (protectedTarget(result.filePath)) throw Error('不能覆盖工作台内部数据');
                    fs.writeFileSync(result.filePath, data);
                    return result.filePath;
                }
                case 'plugin-uninstall': {
                    const p = registry.get(payload),
                        answer = await dialog.showMessageBox(getWindow(), {
                            type: 'question',
                            message: `卸载 ${p.name}？`,
                            detail: p.builtin
                                ? '默认插件可随时恢复。卸载后不会因重启或更新 Collectify 而自动恢复。'
                                : '移除插件程序，重新安装后可继续使用保留的数据。',
                            checkboxLabel: '同时删除该插件的全部本机数据（不可恢复）',
                            checkboxChecked: false,
                            buttons: ['取消', '卸载'],
                            defaultId: 0,
                            cancelId: 0
                        });
                    if (answer.response !== 1) return false;
                    if (!(await confirmPluginClose([payload], 'uninstall'))) return false;
                    await runtime.close(payload);
                    await services.unload(payload);
                    try {
                        registry.uninstall(payload, { deleteData: answer.checkboxChecked });
                    } finally {
                        await services.load({ activate: false });
                        if (registry.plugins.has(payload) && registry.get(payload).enabled)
                            await services.enable(payload);
                    }
                    updateTray();
                    layout();
                    publish();
                    return true;
                }
                case 'plugin-restore': {
                    const id = registry.restore(payload);
                    await services.load({ activate: false });
                    await services.enable(id);
                    updateTray();
                    publish();
                    return id;
                }
                default:
                    throw Error('未知的插件管理操作');
            }
        } finally {
            operation = false;
        }
    }

    return {
        manage: pluginManagement,
        install: installPrepared,
        get busy() {
            return operation;
        }
    };
};
