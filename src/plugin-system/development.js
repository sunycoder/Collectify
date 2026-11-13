const fs = require('node:fs'),
    path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { pluginId, readManifest } = require('./manifest');
const { SDK_FILES, SHARED_FILES, reference } = require('./contract');
const { validateScripts } = require('./script-validation');
const TEXT = /\.(html|js|mjs|css|json|svg|md|txt)$/i;
const ASSET = /\.(html|js|mjs|css|json|svg|png|jpe?g|webp|woff2|md|txt)$/i;
function relativeFile(value) {
    if (
        typeof value !== 'string' ||
        !value ||
        value.length > 180 ||
        value.includes('\\') ||
        /[\x00-\x1f:<>"|?*]/.test(value) ||
        path.isAbsolute(value)
    )
        throw Error('草稿文件路径不合法');
    if (
        value
            .split('/')
            .some(
                (p) =>
                    !p ||
                    p === '.' ||
                    p === '..' ||
                    p.startsWith('.') ||
                    /[. ]$/.test(p) ||
                    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)
            )
    )
        throw Error('草稿路径包含保留名称或越界片段');
    if (!ASSET.test(value) && path.basename(value) !== 'LICENSE') throw Error('草稿只允许静态插件文件');
    return value;
}
function directory(folder) {
    if (!fs.lstatSync(folder).isDirectory() || fs.lstatSync(folder).isSymbolicLink()) throw Error('草稿目录不能是链接');
}
function filesIn(root) {
    directory(root);
    let size = 0,
        count = 0,
        entries = 0;
    const files = [],
        names = new Set();
    function visit(folder, prefix = '', depth = 0) {
        if (depth > 20) throw Error('草稿目录嵌套过深');
        for (const item of fs.readdirSync(folder, { withFileTypes: true })) {
            if (++entries > 500) throw Error('草稿目录项过多');
            if (item.isSymbolicLink()) throw Error('草稿不允许符号链接');
            const relative = prefix + item.name,
                file = path.join(folder, item.name);
            if (item.isDirectory()) {
                if (item.name === 'node_modules' || item.name.startsWith('.'))
                    throw Error('草稿不允许依赖目录或隐藏目录');
                visit(file, relative + '/', depth + 1);
            } else if (item.isFile()) {
                relativeFile(relative);
                if (names.has(relative.toLowerCase())) throw Error('草稿存在大小写冲突的文件');
                names.add(relative.toLowerCase());
                const content = fs.readFileSync(file);
                size += content.length;
                if (++count > 300 || size > 10 * 1024 * 1024) throw Error('草稿超过 300 个文件或 10 MB');
                files.push({ path: relative, content });
            } else throw Error('草稿包含特殊文件');
        }
    }
    visit(root);
    return files.sort((a, b) => a.path.localeCompare(b.path));
}
function digest(files) {
    const hash = createHash('sha256');
    for (const file of files)
        hash.update(file.path).update('\0').update(String(file.content.length)).update('\0').update(file.content);
    return hash.digest('hex');
}
function atomicJson(file, data) {
    const temporary = file + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(temporary, file);
}
function decode(file) {
    return new TextDecoder('utf-8', { fatal: true }).decode(file.content);
}

class PluginDevelopment {
    constructor({ registry, root, templatesRoot, installed, setEnabled, runtimeStatus }) {
        Object.assign(this, {
            registry,
            root: path.resolve(root),
            templatesRoot,
            installed,
            setEnabled,
            runtimeStatus
        });
        fs.mkdirSync(this.root, { recursive: true });
        directory(this.root);
    }
    owned(folder) {
        const relative = path.relative(this.root, path.resolve(folder));
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('草稿操作路径越界');
        return folder;
    }
    remove(folder) {
        this.owned(folder);
        if (fs.existsSync(folder)) {
            directory(folder);
            fs.rmSync(folder, { recursive: true, force: true });
        }
    }
    paths(id) {
        if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw Error('草稿 ID 不正确');
        const folder = this.owned(path.join(this.root, id));
        directory(folder);
        return {
            folder,
            pkg: path.join(folder, 'package'),
            previous: path.join(folder, 'package.previous'),
            metaFile: path.join(folder, 'draft.json')
        };
    }
    read(id) {
        const p = this.paths(id);
        if (fs.lstatSync(p.metaFile).isSymbolicLink()) throw Error('草稿元数据不能是链接');
        const meta = JSON.parse(fs.readFileSync(p.metaFile, 'utf8'));
        if (meta.draftId !== id || !Number.isSafeInteger(meta.revision) || meta.revision < 1)
            throw Error('草稿元数据损坏');
        pluginId(meta.pluginId);
        // 中断写入时，根据已提交元数据的摘要选择旧包或新包，不留下半批文件。
        if (fs.existsSync(p.previous)) {
            directory(p.previous);
            if (fs.existsSync(p.pkg) && digest(filesIn(p.pkg)) === meta.contentDigest) {
                try {
                    this.remove(p.previous);
                } catch {
                    /* 已提交的新包可继续读取，下次访问时再清理旧暂存目录。 */
                }
            } else {
                if (fs.existsSync(p.pkg)) this.remove(p.pkg);
                fs.renameSync(p.previous, p.pkg);
            }
        }
        directory(p.pkg);
        return { ...p, meta };
    }
    templates() {
        return fs
            .readdirSync(this.templatesRoot, { withFileTypes: true })
            .filter((p) => p.isDirectory() && !p.isSymbolicLink())
            .map((p) => {
                const manifest = readManifest(path.join(this.templatesRoot, p.name));
                return {
                    id: p.name,
                    name: manifest.name,
                    description: manifest.description,
                    permissions: manifest.permissions
                };
            });
    }
    sdk() {
        return reference(this.templates());
    }
    get(id) {
        if (!id)
            return {
                drafts: fs
                    .readdirSync(this.root, { withFileTypes: true })
                    .filter((p) => p.isDirectory() && /^[a-f0-9-]{36}$/.test(p.name))
                    .map((p) => {
                        try {
                            const { meta } = this.read(p.name);
                            return {
                                draftId: meta.draftId,
                                pluginId: meta.pluginId,
                                name: meta.name,
                                revision: meta.revision,
                                updatedAt: meta.updatedAt,
                                installedRevision: meta.installedRevision || null
                            };
                        } catch {
                            return { draftId: p.name, error: '草稿需要修复' };
                        }
                    })
            };
        const draft = this.read(id),
            files = filesIn(draft.pkg);
        let manifest;
        try {
            manifest = readManifest(draft.pkg);
        } catch (error) {
            manifest = { error: error.message };
        }
        return {
            draftId: id,
            pluginId: draft.meta.pluginId,
            revision: draft.meta.revision,
            manifest,
            files: files.map((f) => ({
                path: f.path,
                bytes: f.content.length,
                text: TEXT.test(f.path) || f.path === 'LICENSE'
            })),
            validatedRevision: draft.meta.validation?.revision || null,
            installedRevision: draft.meta.installedRevision || null
        };
    }
    create(input) {
        const id = pluginId(input.pluginId),
            existing = this.registry.plugins.get(id);
        if (existing?.builtin) throw Error('默认插件不能通过 AI 草稿覆盖，请使用新的插件 ID');
        if (this.get().drafts.length >= 50) throw Error('草稿已达到 50 个，请先删除不需要的草稿');
        const sourceId = input.sourcePluginId || (existing ? id : null);
        let source;
        if (sourceId) {
            const plugin = this.registry.get(sourceId);
            if (plugin.backend) throw Error('原生后台插件不能克隆为页面草稿');
            source = plugin.directory;
        } else {
            const template = input.template || 'basic';
            if (!/^[a-z][a-z0-9-]{0,60}$/.test(template)) throw Error('模板 ID 不正确');
            source = path.join(this.templatesRoot, template);
            if (!fs.existsSync(source)) throw Error('插件模板不存在');
        }
        const sourceFiles = filesIn(source),
            original = readManifest(source),
            baseDigest = existing ? digest(filesIn(existing.directory)) : null;
        const version =
            input.version ||
            (existing ? existing.version.replace(/\d+$/, (n) => (BigInt(n) + 1n).toString()) : '1.0.0');
        const manifest = {
            ...original,
            id,
            name: input.name,
            description: input.description,
            version,
            permissions: input.permissions || original.permissions
        };
        const draftId = randomUUID(),
            folder = this.owned(path.join(this.root, draftId)),
            pkg = path.join(folder, 'package');
        fs.mkdirSync(pkg, { recursive: true });
        try {
            for (const file of sourceFiles) {
                const target = path.join(pkg, file.path);
                fs.mkdirSync(path.dirname(target), { recursive: true });
                fs.writeFileSync(target, file.content);
            }
            fs.writeFileSync(path.join(pkg, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
            readManifest(pkg);
            const meta = {
                draftId,
                pluginId: id,
                name: input.name,
                revision: 1,
                baseDigest,
                contentDigest: digest(filesIn(pkg)),
                updatedAt: new Date().toISOString()
            };
            atomicJson(path.join(folder, 'draft.json'), meta);
            return this.get(draftId);
        } catch (error) {
            this.remove(folder);
            throw error;
        }
    }
    readFile(id, file, offset = 0, limit = 16000) {
        relativeFile(file);
        if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 16000)
            throw Error('读取范围不正确');
        const draft = this.read(id),
            item = filesIn(draft.pkg).find((item) => item.path === file);
        if (!item) throw Error('草稿文件不存在');
        if (!TEXT.test(file) && file !== 'LICENSE') throw Error('二进制资源不作为文本返回');
        const content = decode(item);
        return {
            draftId: id,
            revision: draft.meta.revision,
            path: file,
            content: content.slice(offset, offset + limit),
            nextOffset: offset + limit < content.length ? offset + limit : null
        };
    }
    write({ draftId, expectedRevision, files, deletePaths = [] }) {
        const draft = this.read(draftId);
        if (draft.meta.revision !== expectedRevision) throw Error('草稿已被修改，请读取最新 revision 后再写入');
        if (fs.existsSync(draft.previous)) throw Error('上次写入的暂存目录仍被占用，请稍后重试');
        filesIn(draft.pkg);
        if (
            !Array.isArray(files) ||
            files.length > 20 ||
            !Array.isArray(deletePaths) ||
            deletePaths.length > 20 ||
            (!files.length && !deletePaths.length)
        )
            throw Error('请提供本批文件或删除列表');
        const seen = new Set();
        let bytes = 0;
        for (const file of files) {
            relativeFile(file.path);
            if (!TEXT.test(file.path) && file.path !== 'LICENSE') throw Error('AI 文件写入仅支持 UTF-8 文本资源');
            if (typeof file.content !== 'string') throw Error('文件内容必须为文本');
            bytes += Buffer.byteLength(file.content, 'utf8');
            const key = file.path.toLowerCase();
            if (seen.has(key)) throw Error('同批路径重复');
            seen.add(key);
        }
        for (const file of deletePaths) {
            relativeFile(file);
            if (seen.has(file.toLowerCase())) throw Error('同批路径重复');
            seen.add(file.toLowerCase());
        }
        if (bytes > 65536) throw Error('单批文件内容超过 64 KB，请拆分写入');
        const stage = path.join(draft.folder, 'package.next');
        if (fs.existsSync(stage)) this.remove(stage);
        fs.cpSync(draft.pkg, stage, { recursive: true, dereference: false });
        let committed = false;
        try {
            for (const file of files) {
                const target = path.join(stage, file.path);
                fs.mkdirSync(path.dirname(target), { recursive: true });
                fs.writeFileSync(target, file.content, 'utf8');
            }
            for (const file of deletePaths) {
                const target = path.join(stage, file);
                if (fs.existsSync(target)) {
                    if (!fs.lstatSync(target).isFile() || fs.lstatSync(target).isSymbolicLink())
                        throw Error('只能删除草稿内的普通文件');
                    fs.unlinkSync(target);
                }
            }
            const contentDigest = digest(filesIn(stage)),
                meta = {
                    ...draft.meta,
                    revision: expectedRevision + 1,
                    contentDigest,
                    validation: null,
                    updatedAt: new Date().toISOString()
                };
            fs.renameSync(draft.pkg, draft.previous);
            fs.renameSync(stage, draft.pkg);
            atomicJson(draft.metaFile, meta);
            committed = true;
            try {
                this.remove(draft.previous);
            } catch {}
            return this.get(draftId);
        } catch (error) {
            if (!committed && fs.existsSync(draft.previous)) {
                if (fs.existsSync(draft.pkg)) this.remove(draft.pkg);
                fs.renameSync(draft.previous, draft.pkg);
            }
            throw error;
        } finally {
            if (fs.existsSync(stage)) this.remove(stage);
        }
    }
    async validate(id, expectedRevision) {
        const draft = this.read(id);
        if (draft.meta.revision !== expectedRevision) throw Error('草稿 revision 已过期');
        const files = filesIn(draft.pkg),
            contentDigest = digest(files),
            issues = [];
        let manifest;
        try {
            manifest = readManifest(draft.pkg);
            if (manifest.id !== draft.meta.pluginId)
                issues.push({ file: 'manifest.json', message: '清单 ID 与草稿身份不一致' });
        } catch (error) {
            issues.push({ file: 'manifest.json', message: error.message });
        }
        const known = new Set(files.map((file) => file.path));
        const reference = (file, value) => {
            if (!value || value.startsWith('#') || value.startsWith('data:image/')) return;
            try {
                const url = new URL(value, `collectify-plugin://${draft.meta.pluginId}/${file.path}`);
                if (url.protocol !== 'collectify-plugin:') throw Error('外部资源不支持');
                const relative = decodeURIComponent(url.pathname.slice(1));
                if (url.hostname === 'collectify.sdk') {
                    if (!SDK_FILES.has(relative) && !SHARED_FILES.has(relative)) throw Error('SDK 资源不存在');
                } else if (url.hostname !== draft.meta.pluginId || !known.has(relative))
                    throw Error('引用的包内资源不存在');
            } catch (error) {
                issues.push({ file: file.path, message: `${value}：${error.message}` });
            }
        };
        for (const file of files) {
            if (/\.html$/i.test(file.path)) {
                const html = decode(file);
                if (/<script\b[^>]*type\s*=\s*["']module["']/i.test(html))
                    issues.push({ file: file.path, message: '请使用经典脚本文件，当前草稿不校验模块脚本' });
                if (/\son[a-z]+\s*=/i.test(html) || /<script\b(?![^>]*\bsrc\s*=)[^>]*>\s*\S/i.test(html))
                    issues.push({ file: file.path, message: 'CSP 不允许内联脚本和事件属性，请写入独立 JS' });
                for (const match of html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) reference(file, match[1]);
            }
            if (/\.css$/i.test(file.path))
                for (const match of decode(file).matchAll(/url\(\s*["']?([^'"\)]+)["']?\s*\)/gi))
                    reference(file, match[1].trim());
        }
        issues.push(
            ...(await validateScripts(
                files
                    .filter((file) => /\.(js|mjs)$/i.test(file.path))
                    .map((file) => ({ path: file.path, content: decode(file) }))
            ))
        );
        const latest = this.read(id);
        if (latest.meta.revision !== expectedRevision || digest(filesIn(latest.pkg)) !== contentDigest)
            throw Error('校验期间草稿已改变，请重新校验');
        const token = issues.length ? null : randomUUID();
        atomicJson(latest.metaFile, {
            ...latest.meta,
            validation: token ? { token, revision: expectedRevision, digest: contentDigest } : null
        });
        return {
            draftId: id,
            revision: expectedRevision,
            valid: issues.length === 0,
            issues,
            manifest,
            validationToken: token,
            notice: '静态校验不执行插件，也不等于功能测试通过'
        };
    }
    async install({ draftId, expectedRevision, validationToken, enable, open = true }) {
        const draft = this.read(draftId),
            validation = draft.meta.validation;
        if (
            draft.meta.revision !== expectedRevision ||
            !validation ||
            validation.token !== validationToken ||
            validation.revision !== expectedRevision ||
            validation.digest !== digest(filesIn(draft.pkg))
        )
            throw Error('请先校验同一 revision 的原样草稿');
        const previous = this.registry.plugins.get(draft.meta.pluginId);
        if (previous?.builtin) throw Error('不能覆盖默认插件');
        const currentDigest = previous ? digest(filesIn(previous.directory)) : null;
        if (currentDigest !== draft.meta.baseDigest)
            throw Error('已安装版本在草稿创建后发生变化，请基于最新插件重新创建草稿');
        const manifest = readManifest(draft.pkg);
        if (previous && currentDigest !== validation.digest) {
            const next = manifest.version.split('.').map(BigInt),
                prior = previous.version.split('.').map(BigInt);
            let newer = false;
            for (let i = 0; i < 3; i++) {
                if (next[i] !== prior[i]) {
                    newer = next[i] > prior[i];
                    break;
                }
            }
            if (!newer) throw Error('更新程序需要提高 manifest.version，请修改版本后重新校验');
        }
        const id = this.registry.install(draft.pkg, manifest);
        const desired = typeof enable === 'boolean' ? enable : (previous?.enabled ?? true);
        this.registry.setEnabled(id, desired);
        atomicJson(draft.metaFile, {
            ...draft.meta,
            baseDigest: digest(filesIn(this.registry.get(id).directory)),
            installedRevision: expectedRevision
        });
        const result = await this.installed(id, { open: open && desired });
        return { pluginId: id, version: manifest.version, revision: expectedRevision, enabled: desired, ...result };
    }
    discard(id, expectedRevision) {
        const draft = this.read(id);
        if (draft.meta.revision !== expectedRevision) throw Error('草稿 revision 已过期');
        this.remove(draft.folder);
        return { discarded: true, draftId: id };
    }
    tools(z) {
        const tool = (name, description, inputSchema, handler, write = false) => ({
            name,
            description,
            inputSchema,
            handler,
            write
        });
        const draftId = z.string().uuid(),
            revision = z.number().int().min(1);
        return [
            tool('get_plugin_sdk', '读取当前插件 SDK 合同、支持能力、模板及 AI 开发流程。创建插件前先调用。', {}, () =>
                this.sdk()
            ),
            tool('list_plugins', '列出已安装插件、权限、版本、启停和导航；不返回插件数据库或剪贴板内容。', {}, () =>
                this.registry.list()
            ),
            tool(
                'create_plugin_draft',
                '仅按用户明确的新建/更新要求创建隔离草稿。可基于模板或现有页面插件；不修改源码、不安装。',
                {
                    pluginId: z.string(),
                    name: z.string().min(1).max(100),
                    description: z.string().min(1).max(300),
                    template: z.string().optional(),
                    sourcePluginId: z.string().optional(),
                    version: z.string().optional(),
                    permissions: z.array(z.string()).optional()
                },
                (input) => this.create(input),
                true
            ),
            tool(
                'get_plugin_draft',
                '读取指定草稿的 revision、清单和文件列表；不传 draftId 则列出草稿。',
                { draftId: draftId.optional() },
                (input) => this.get(input.draftId)
            ),
            tool(
                'read_plugin_file',
                '分页读取草稿内的静态 UTF-8 程序文件，不读取数据库或任意本机路径。',
                {
                    draftId,
                    path: z.string(),
                    offset: z.number().int().min(0).optional(),
                    limit: z.number().int().min(1).max(16000).optional()
                },
                (input) => this.readFile(input.draftId, input.path, input.offset, input.limit)
            ),
            tool(
                'write_plugin_files',
                '按 revision 原子写入一批草稿文本文件。仅包内相对路径，单批最多 64 KB；可删除同包普通文件。',
                {
                    draftId,
                    expectedRevision: revision,
                    files: z.array(z.object({ path: z.string(), content: z.string() })).max(20),
                    deletePaths: z.array(z.string()).max(20).optional()
                },
                (input) => this.write(input),
                true
            ),
            tool(
                'validate_plugin_draft',
                '校验清单、资源引用和 JS 语法，不执行插件。通过后给出安装凭据，改文件后需重新校验。',
                { draftId, expectedRevision: revision },
                (input) => this.validate(input.draftId, input.expectedRevision)
            ),
            tool(
                'install_plugin_draft',
                '用户已要求接入该插件时，安装校验过的同一版本草稿。可 enable/open；保留数据，拒绝覆盖默认插件。',
                {
                    draftId,
                    expectedRevision: revision,
                    validationToken: z.string().uuid(),
                    enable: z.boolean().optional(),
                    open: z.boolean().optional()
                },
                (input) => this.install(input),
                true
            ),
            tool(
                'get_plugin_runtime_status',
                '查看插件加载状态和受限脚本诊断，不返回页面文本、存储值或剪贴板。',
                { pluginId: z.string() },
                (input) => this.runtimeStatus(input.pluginId)
            ),
            tool(
                'set_plugin_enabled',
                '仅按用户要求启用或停用插件；停用会关闭其页面及后台能力，保留数据。',
                { pluginId: z.string(), enabled: z.boolean() },
                async (input) => {
                    await this.setEnabled(input.pluginId, input.enabled);
                    return { pluginId: input.pluginId, enabled: input.enabled };
                },
                true
            ),
            tool(
                'discard_plugin_draft',
                '用户要求删除不需要的开发草稿时使用；不会卸载已安装插件或删除插件数据。',
                { draftId, expectedRevision: revision },
                (input) => this.discard(input.draftId, input.expectedRevision),
                true
            )
        ];
    }
}
module.exports = { PluginDevelopment, relativeFile, filesIn, digest };
