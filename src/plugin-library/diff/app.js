const api = window.collectify,
    $ = (s) => document.querySelector(s);
const App = (window.DiffApp = {
    api,
    items: [null, null],
    sources: ['', ''],
    mode: 'text',
    content: 'text',
    settings: {},
    loads: new Map(),
    operation: 0,
    activeSide: 0,
    sessions: {},
    roots: [null, null],
    activeChange: -1,
    dirtySides: [false, false],
    currentDecorations: [],
    refreshControls() {
        window.OfficeUI?.refresh();
    },
    cacheSession() {
        this.sessions[this.mode] = {
            items: this.items,
            sources: [...this.sources],
            content: this.content,
            view: this.diff?.saveViewState(),
            dirtySides: [...this.dirtySides]
        };
    },
    occupied(side, mode = this.mode) {
        if (mode === 'folder') return !!this.roots[side];
        const value = mode === this.mode ? this : this.sessions[mode];
        return !!(value?.items?.[side] || value?.sources?.[side]);
    },
    chooseSide(side, mode = this.mode) {
        if (side === 0 || side === 1) return side;
        if (!this.occupied(0, mode)) return 0;
        if (!this.occupied(1, mode)) return 1;
        return this.activeSide;
    },
    async inputTask(action) {
        const previous = this.inputQueue || Promise.resolve(),
            epoch = this.inputEpoch || 0;
        const pending = previous
            .catch(() => {})
            .then(async () => {
                if (epoch !== (this.inputEpoch || 0)) return;
                this.operation++;
                document.body.classList.add('loading-input');
                try {
                    return await action(epoch);
                } finally {
                    this.operation--;
                    document.body.classList.toggle('loading-input', this.operation > 0);
                }
            });
        this.inputQueue = pending;
        return this.safe(() => pending);
    },
    status(text) {
        $('#status').textContent = text;
    },
    error(text) {
        $('#error').textContent = text || '';
    },
    summary(text) {
        $('#summary').textContent = text;
    },
    async safe(action) {
        try {
            this.error('');
            return await action();
        } catch (error) {
            this.error(error.message);
            this.status('操作未完成');
        }
    },
    script(file) {
        if (this.loads.has(file)) return this.loads.get(file);
        const promise = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = file;
            script.onload = resolve;
            script.onerror = () => {
                this.loads.delete(file);
                script.remove();
                reject(Error('本地组件加载失败：' + file));
            };
            document.head.append(script);
        });
        this.loads.set(file, promise);
        return promise;
    },
    normalize(text) {
        if (this.settings.ignoreQuotes) text = text.replace(/[“”„«»]/g, '"').replace(/[‘’‚]/g, "'");
        if (this.settings.ignoreDashes) text = text.replace(/[—–―‐‑]/g, '-');
        for (const rule of this.settings.ignoreRules || []) text = text.split(rule).join('');
        return text;
    },
    async editor() {
        if (this.diff) return this.diff;
        if (!this.editorPromise)
            this.editorPromise = this.createEditor().catch((error) => {
                this.editorPromise = null;
                throw error;
            });
        return this.editorPromise;
    },
    async createEditor() {
        if (this.diff) return this.diff;
        await this.script('vendor/editor.js');
        const css = document.createElement('link');
        css.rel = 'stylesheet';
        css.href = 'vendor/editor.css';
        await new Promise((resolve, reject) => {
            css.onload = resolve;
            css.onerror = () => reject(Error('编辑器样式加载失败'));
            document.head.append(css);
        });
        const M = window.DiffEditor;
        M.editor.defineTheme('diff-light', {
            base: 'vs',
            inherit: true,
            rules: [
                { token: 'keyword', foreground: '3C5C95' },
                { token: 'string', foreground: '587A48' },
                { token: 'comment', foreground: '81917B', fontStyle: 'italic' },
                { token: 'number', foreground: '287F8D' }
            ],
            colors: {
                'editor.background': '#ffffff',
                'diffEditor.insertedLineBackground': '#eaf5e7',
                'diffEditor.removedLineBackground': '#fbeceb',
                'diffEditor.insertedTextBackground': '#92c98266',
                'diffEditor.removedTextBackground': '#e3979466',
                'diffEditor.diagonalFill': '#c3cbd4',
                'diffEditor.border': '#cdd5df',
                'diffEditor.unchangedRegionBackground': '#f5f7f9',
                'editorLineNumber.foreground': '#99a2ae',
                'editorGutter.background': '#fafbfc',
                'editor.foreground': '#333b48',
                'editor.lineHighlightBackground': '#00000000'
            }
        });
        M.editor.defineTheme('diff-dark', {
            base: 'vs-dark',
            inherit: true,
            rules: [],
            colors: {
                'editor.background': '#1b2523',
                'diffEditor.insertedLineBackground': '#173d31',
                'diffEditor.removedLineBackground': '#422925'
            }
        });
        this.diff = M.editor.createDiffEditor($('#editor'), {
            automaticLayout: true,
            originalEditable: true,
            renderSideBySide: true,
            enableSplitViewResizing: true,
            useInlineViewWhenSpaceIsLimited: false,
            renderIndicators: false,
            renderMarginRevertIcon: false,
            lineNumbersMinChars: 4,
            lineDecorationsWidth: 10,
            glyphMargin: false,
            padding: { top: 12, bottom: 18 },
            renderLineHighlight: 'none',
            bracketPairColorization: { enabled: false },
            readOnly: false,
            fontSize: 14,
            fontFamily: 'Consolas, "SFMono-Regular", Menlo, monospace',
            lineHeight: 22,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            renderOverviewRuler: true,
            diffAlgorithm: 'advanced',
            maxComputationTime: 3000,
            accessibilityVerbose: true
        });
        this.models = [M.editor.createModel('', 'plaintext'), M.editor.createModel('', 'plaintext')];
        this.diff.setModel({ original: this.models[0], modified: this.models[1] });
        this.models.forEach((model, side) =>
            model.onDidChangeContent(() => {
                if (this.applying) return;
                if (model.getValueLength() > 2000000) {
                    this.applying = true;
                    model.setValue(this.sources[side]);
                    this.applying = false;
                    this.error('单侧文本超过 200 万字符，已恢复之前内容');
                    return;
                }
                this.sources[side] = model.getValue();
                this.dirtySides[side] = true;
                if (this.items[side]) this.items[side] = { ...this.items[side], dirty: true, text: model.getValue() };
                this.activeSide = side;
                this.refreshNames();
            })
        );
        for (const [side, editor] of [this.diff.getOriginalEditor(), this.diff.getModifiedEditor()].entries()) {
            editor.onDidFocusEditorText(() => (this.activeSide = side));
            editor.onDidScrollChange(() => this.drawLinks());
            editor.onDidLayoutChange(() => this.drawLinks());
            editor.onDidChangeCursorPosition((event) => {
                if (this.navigating) return;
                const changes = this.diff.getLineChanges() || [],
                    line = event.position.lineNumber;
                const index = changes.findIndex(
                    (c) =>
                        line >= Math.max(1, c[side ? 'modifiedStartLineNumber' : 'originalStartLineNumber']) &&
                        line <=
                            Math.max(
                                1,
                                c[side ? 'modifiedEndLineNumber' : 'originalEndLineNumber'] ||
                                    c[side ? 'modifiedStartLineNumber' : 'originalStartLineNumber']
                            )
                );
                if (index >= 0 && index !== this.activeChange) {
                    this.activeChange = index;
                    this.updateChangeControls();
                }
            });
            editor.addAction({
                id: 'diff.open-settings',
                label: '打开设置面板 / 切换语言模式',
                contextMenuGroupId: 'navigation',
                contextMenuOrder: 1,
                run: () => {
                    const controls = $('#controls');
                    controls.hidden = false;
                    controls.classList.add('settings-open');
                    document.body.classList.remove('tools-hidden');
                    document.body.classList.add('controls-open');
                    $('#language').tomselect?.focus();
                    $('#language').tomselect?.open();
                }
            });
        }
        this.diff.onDidUpdateDiff(() => {
            if (this.content !== 'text') return;
            const changes = this.diff.getLineChanges() || [];
            let removed = 0,
                added = 0;
            for (const c of changes) {
                if (c.originalEndLineNumber) removed += c.originalEndLineNumber - c.originalStartLineNumber + 1;
                if (c.modifiedEndLineNumber) added += c.modifiedEndLineNumber - c.modifiedStartLineNumber + 1;
            }
            this.summary(`${changes.length} 处更改 · − ${removed} 行 · ＋ ${added} 行`);
            this.changes = changes;
            this.activeChange = changes.length ? Math.min(Math.max(0, this.activeChange), changes.length - 1) : -1;
            $('.comparison-meta').dataset.state = changes.length ? 'different' : 'same';
            if (!this.occupied(0) || !this.occupied(1)) {
                $('.comparison-meta').dataset.state = 'waiting';
                this.summary(
                    this.occupied(0) || this.occupied(1)
                        ? '已载入一侧 · 拖入第二个文件即可开始对比'
                        : '输入文本，或连续拖入两个文件'
                );
            } else if (!changes.length)
                this.summary('两侧内容相同' + (this.settings.ignoreWhitespace ? '（已忽略空白）' : ''));
            this.updateChangeControls();
            if (this.diff.getDiffComputationResult?.()?.quitEarly) {
                this.summary('差异计算超过时间限制，请缩小内容或使用标准精度');
                $('.comparison-meta').dataset.state = 'waiting';
            }
        });
        $('#editor-loading').hidden = true;
        this.applySettings();
        return this.diff;
    },
    applySettings() {
        for (const id of ['view', 'language', 'precision', 'fontSize'])
            if (this.settings[id] !== undefined) $('#' + id).value = this.settings[id];
        for (const id of ['wrap', 'editable', 'ignoreWhitespace', 'collapse', 'ignoreQuotes', 'ignoreDashes'])
            $('#' + id).checked = !!this.settings[id];
        $('#ignoreRules').value = (this.settings.ignoreRules || []).join('\n');
        if (!this.diff) return;
        const filtered = this.settings.ignoreQuotes || this.settings.ignoreDashes || this.settings.ignoreRules?.length;
        this.diff.updateOptions({
            renderSideBySide: this.settings.view === 'split',
            readOnly: !this.settings.editable || !!filtered,
            originalEditable: this.settings.editable && !filtered,
            ignoreTrimWhitespace: this.settings.ignoreWhitespace,
            hideUnchangedRegions: { enabled: this.settings.collapse },
            wordWrap: this.settings.wrap ? 'on' : 'off',
            fontSize: this.settings.fontSize,
            diffAlgorithm: this.settings.precision,
            maxComputationTime: 3000
        });
        window.DiffEditor.editor.setTheme(document.body.dataset.scheme === 'dark' ? 'diff-dark' : 'diff-light');
        this.models.forEach((model, side) =>
            window.DiffEditor.editor.setModelLanguage(
                model,
                this.settings.language === 'auto' ? this.items[side]?.language || 'plaintext' : this.settings.language
            )
        );
        this.refreshControls();
    },
    async saveSettings(values) {
        const previous = this.settingsWrite || Promise.resolve();
        const write = previous
            .catch(() => {})
            .then(async () => {
                this.settings = await api.invoke('settings', values);
                this.applySettings();
                await this.updateModels();
                this.status('设置已保存');
            });
        this.settingsWrite = write;
        return write;
    },
    async updateModels() {
        if (!this.diff) return;
        this.applying = true;
        try {
            this.models.forEach((model, side) => {
                const value = this.normalize(this.sources[side]);
                if (model.getValue() !== value) model.setValue(value);
            });
        } finally {
            this.applying = false;
        }
    },
    async setTexts(values) {
        const mode = this.mode;
        await this.editor();
        if (mode !== this.mode) return;
        this.sources = values.map((v) => String(v || ''));
        if (!this.items.some(Boolean)) this.dirtySides = this.sources.map(Boolean);
        await this.updateModels();
        this.applySettings();
        this.refreshNames();
        await this.diff.waitForDiff();
    },
    refreshNames() {
        ['#left-name', '#right-name'].forEach((selector, side) => {
            $(selector).textContent = this.items[side]?.name || (side ? '更改内容' : '原始内容');
            $(selector).title = this.items[side]?.path || '';
            const item = this.items[side],
                text = this.sources[side] || '',
                detail = $(side ? '#right-detail' : '#left-detail');
            $(selector).textContent += item?.dirty ? ' •' : '';
            detail.textContent = item
                ? [
                      item.language || item.kind,
                      item.size !== undefined
                          ? item.size >= 1024
                              ? (item.size / 1024).toFixed(1) + ' KB'
                              : item.size + ' B'
                          : '',
                      item.dirty ? '已编辑（内存）' : item.path || ''
                  ]
                      .filter(Boolean)
                      .join(' · ')
                : text
                  ? `${text.split('\n').length} 行 · ${text.length.toLocaleString()} 字符`
                  : '拖入文件，或直接输入';
            detail.title = item?.path || detail.textContent;
            document.querySelector(`[data-reload="${side}"]`).disabled = !item?.path;
        });
        $('#text-empty-hint').hidden =
            this.content !== 'text' || this.sources.some(Boolean) || this.items.some(Boolean);
        document.querySelectorAll('[data-save-text]').forEach((button) => (button.hidden = this.content !== 'text'));
        this.scheduleWorkspace?.();
    },
    display(content) {
        this.content = content;
        $('#content-empty').hidden = content !== 'empty';
        $('#subfolder-panel').hidden = content !== 'subfolder';
        for (const type of ['text', 'image', 'document']) $('#' + type + '-panel').hidden = type !== content;
        $('.text-options').hidden = content !== 'text';
        $('.image-options').hidden = content !== 'image';
        $('.document-options').hidden = content !== 'document';
        const isSheet = content === 'document' && this.items.some((i) => i?.kind === 'sheet');
        $('.sheet-options').hidden = !isSheet;
        if (isSheet) $('.document-options').hidden = true;
        this.images?.visibilityChanged?.(content === 'image');
        $('.folder-options').hidden = this.mode !== 'folder';
        $('#folder-panel').hidden = this.mode !== 'folder';
        $('.input-bar').hidden = $('.comparison-meta').hidden = content === 'empty' || content === 'subfolder';
        $('.workspace').classList.toggle('folder-content-empty', this.mode === 'folder' && content === 'empty');
        $('.merge-actions').hidden = content !== 'text';
        $('#document-preview').hidden =
            content !== 'text' || !this.items.some((i) => ['pdf', 'sheet', 'slides'].includes(i?.kind));
        $('#previous').hidden = $('#next').hidden = $('#change-position').hidden = content !== 'text';
        $('#empty-left').textContent = this.mode === 'folder' ? '选择左侧文件夹' : '选择左侧文件';
        $('#empty-right').textContent = this.mode === 'folder' ? '选择右侧文件夹' : '选择右侧文件';
        $('#empty-title').textContent =
            this.mode === 'folder'
                ? this.folders.snapshot
                    ? '选择一对文件查看内容差异'
                    : '选择两个文件夹开始对比'
                : this.mode === 'document'
                  ? 'Word、Excel、PDF 与 PowerPoint'
                  : this.mode === 'image'
                    ? '放入两张图片'
                    : '选择对比内容';
        $('#empty-description').textContent =
            this.mode === 'folder'
                ? this.folders.snapshot
                    ? '单击文件自动配对，Ctrl / ⌘ + 单击或下拉框可独立指定。'
                    : '可以连续拖入两个文件夹；每侧独立浏览，扫描后自动配对同路径文件。'
                : '拖入两个文件，或分别打开左侧与右侧文件。';
        this.refreshNames();
        this.refreshControls();
        this.diff?.layout();
    },
    async showContent() {
        const kinds = this.items.filter(Boolean).map((i) => i.kind);
        if (!kinds.length && this.mode !== 'text' && !this.sources.some(Boolean)) {
            this.display('empty');
            return;
        }
        if (kinds.every((k) => k === 'text')) {
            this.display('text');
            await this.setTexts(this.items.map((i, side) => i?.text ?? this.sources[side] ?? ''));
        } else if (kinds.every((k) => k === 'image')) {
            this.display('image');
            await this.images.load(this.items);
        } else if (kinds.every((k) => ['pdf', 'slides', 'sheet'].includes(k)) && new Set(kinds).size === 1) {
            this.display('document');
            await this.documents.load(this.items);
        } else if (kinds.length) {
            this.display('text');
            await this.setTexts(this.items.map((i) => i?.text || ''));
            throw Error('两侧类型不同，请选择同类内容进行预览；目录树中的紫色表示类型不同。');
        }
    },
    async setMode(mode) {
        if (!['text', 'image', 'folder', 'document'].includes(mode)) return;
        const changed = this.mode !== mode;
        if (changed) {
            this.cacheSession();
            const session = this.sessions[mode] || {
                items: [null, null],
                sources: ['', ''],
                content: mode === 'text' ? 'text' : 'empty'
            };
            this.items = session.items;
            this.sources = [...session.sources];
            this.dirtySides = [...(session.dirtySides || [false, false])];
            this.content = session.content;
            this.activeChange = -1;
        }
        this.mode = mode;
        this.error('');
        document
            .querySelectorAll('[data-mode]')
            .forEach((b) => b.classList.toggle('selected', b.dataset.mode === mode));
        if (mode === 'folder') this.folders.render();
        if (!this.items.some(Boolean) && !this.sources.some(Boolean)) {
            this.display(mode === 'text' ? 'text' : 'empty');
            if (mode === 'text') {
                await this.editor();
                await this.updateModels();
            }
        } else if (this.content === 'text') {
            this.display('text');
            const dirty = [...this.dirtySides];
            await this.setTexts(this.sources);
            this.dirtySides = dirty;
        } else await this.showContent();
        this.refreshNames();
        if (changed && this.sessions[mode]?.view && this.content === 'text')
            this.diff?.restoreViewState(this.sessions[mode].view);
        this.status('就绪');
    },
    async accept(results) {
        if (!results) return;
        const isFolder = results.every((r) => r.item.kind === 'folder');
        if (results.some((r) => r.item.kind === 'folder') && !isFolder)
            throw Error('请分别对比文件或文件夹，不能混合选择。');
        const targetMode = isFolder
            ? 'folder'
            : this.mode === 'folder' && this.folders.snapshot
              ? 'folder'
              : results.some((r) => r.item.kind === 'image')
                ? 'image'
                : results.some((r) => r.item.kind !== 'text' || /\.docx$/i.test(r.item.name))
                  ? 'document'
                  : 'text';
        if (targetMode !== this.mode) await this.setMode(targetMode);
        if (isFolder) {
            for (const { side, item } of results) this.roots[side] = item;
            this.folders.invalidate();
            this.display('empty');
            if (this.roots.every(Boolean)) await this.folders.scan();
            else this.status('已选择' + (this.roots[0] ? '左' : '右') + '侧目录，请选择另一侧');
            return;
        }
        if (results.length === 1) {
            const { side, item } = results[0],
                other = this.items[1 - side];
            if (other && other.kind !== item.kind) this.items[1 - side] = null;
        }
        for (const { side, item } of results) {
            this.items[side] = item;
            this.sources[side] = item.kind === 'text' ? item.text || '' : '';
            this.dirtySides[side] = false;
        }
        this.refreshNames();
        const kinds = this.items.filter(Boolean).map((i) => i.kind);
        await this.showContent();
        this.status('已加载' + (results.length === 1 ? (results[0].side ? '右' : '左') + '侧' : '两侧') + '内容');
    },
    async choose(side, directory = false) {
        await this.inputTask(async (epoch) => {
            this.status('选择本地' + (directory ? '目录' : '文件'));
            const values = await api.invoke('choose', { side, directory });
            if (epoch !== (this.inputEpoch || 0)) return;
            await this.accept(values);
        });
    },
    async importPaths(paths, side = null) {
        return this.inputTask(async (epoch) => {
            this.status('正在读取本地内容…');
            const types = await api.invoke('probe', { paths });
            const mode = types.every((k) => k === 'folder')
                ? 'folder'
                : types.some((k) => k === 'image')
                  ? 'image'
                  : types.some((k) => k === 'document')
                    ? 'document'
                    : 'text';
            const target = this.chooseSide(side, mode);
            const results = await api.invoke('import', { paths, side: target });
            if (epoch !== (this.inputEpoch || 0)) return;
            await this.accept(results);
        });
    },
    async paste(side) {
        return this.safe(async () => {
            const value = await api.clipboard.snapshot();
            if (!value) {
                this.status('剪贴板为空');
                return;
            }
            if (value.kind === 'files') return this.importPaths(value.files.slice(0, 2), side);
            if (value.kind === 'image') {
                if (this.mode !== 'image') await this.setMode('image');
                const item = {
                    kind: 'image',
                    name: '粘贴的图片',
                    url: `data:${value.format};base64,${value.data}`
                };
                return this.accept([{ side, item }]);
            }
            if (this.mode !== 'text') await this.setMode('text');
            await this.editor();
            this.items[side] = null;
            this.sources[side] = value.text || '';
            this.dirtySides[side] = true;
            await this.updateModels();
            this.refreshNames();
        });
    },
    updateChangeControls() {
        const changes = this.diff?.getLineChanges() || [];
        $('#change-position').textContent = changes.length ? `${this.activeChange + 1} / ${changes.length}` : '0 / 0';
        $('#previous').disabled = $('#next').disabled = $('#first-diff').disabled = !changes.length;
        const writable =
            this.settings.editable &&
            !this.settings.ignoreQuotes &&
            !this.settings.ignoreDashes &&
            !this.settings.ignoreRules?.length;
        $('#merge-left').disabled = $('#merge-right').disabled = !changes.length || !writable;
        $('#undo-merge').disabled = !writable;
        if (!this.diff) return;
        const current = changes[this.activeChange];
        this.navigating = true;
        for (let side = 0; side < 2; side++) {
            const editor = side ? this.diff.getModifiedEditor() : this.diff.getOriginalEditor();
            const start = current?.[side ? 'modifiedStartLineNumber' : 'originalStartLineNumber'],
                end = current?.[side ? 'modifiedEndLineNumber' : 'originalEndLineNumber'];
            this.currentDecorations[side] = editor.deltaDecorations(
                this.currentDecorations[side] || [],
                current
                    ? [
                          {
                              range: new DiffEditor.Range(Math.max(1, start), 1, Math.max(1, end || start), 1),
                              options: {
                                  isWholeLine: true,
                                  className: 'diff-current-line',
                                  linesDecorationsClassName: 'diff-current-gutter'
                              }
                          }
                      ]
                    : []
            );
        }
        this.drawLinks();
    },
    drawLinks() {
        const svg = $('#diff-links');
        svg.replaceChildren();
        if (!this.diff || this.content !== 'text' || this.settings.view !== 'split') return;
        const parent = $('#editor').getBoundingClientRect(),
            left = this.diff.getOriginalEditor(),
            right = this.diff.getModifiedEditor(),
            lrect = left.getDomNode().getBoundingClientRect(),
            rrect = right.getDomNode().getBoundingClientRect();
        const x1 = lrect.right - parent.left - 9,
            x2 = rrect.left - parent.left + 9;
        if (x1 >= x2) return;
        for (const [index, change] of (this.diff.getLineChanges() || []).entries()) {
            const edges = [left, right].map((editor, side) => {
                const start = change[side ? 'modifiedStartLineNumber' : 'originalStartLineNumber'],
                    end = change[side ? 'modifiedEndLineNumber' : 'originalEndLineNumber'];
                const begin = editor.getTopForLineNumber(Math.max(1, start)) - editor.getScrollTop();
                const bottom = end
                    ? editor.getTopForLineNumber(end) +
                      editor.getOption(DiffEditor.editor.EditorOption.lineHeight) -
                      editor.getScrollTop()
                    : begin + 2;
                return [begin, bottom];
            });
            if (edges.every((e) => e[1] < 0 || e[0] > parent.height)) continue;
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute(
                'd',
                `M ${x1} ${edges[0][0]} C ${x2} ${edges[0][0]} ${x1} ${edges[1][0]} ${x2} ${edges[1][0]} L ${x2} ${edges[1][1]} C ${x1} ${edges[1][1]} ${x2} ${edges[0][1]} ${x1} ${edges[0][1]} Z`
            );
            path.classList.toggle('current', index === this.activeChange);
            svg.append(path);
        }
    },
    async next(direction = 1, first = false) {
        if (!this.diff) return;
        await this.diff.waitForDiff();
        const changes = this.diff.getLineChanges() || [];
        if (!changes.length) return;
        this.activeChange = first ? 0 : (this.activeChange + direction + changes.length) % changes.length;
        const current = changes[this.activeChange];
        for (const [side, editor] of [this.diff.getOriginalEditor(), this.diff.getModifiedEditor()].entries()) {
            const line = Math.max(1, current[side ? 'modifiedStartLineNumber' : 'originalStartLineNumber']);
            editor.revealLineInCenter(line);
            editor.setPosition({ lineNumber: line, column: 1 });
        }
        this.navigating = false;
        this.updateChangeControls();
    },
    async merge(targetSide) {
        if (
            !this.diff ||
            this.settings.ignoreRules?.length ||
            this.settings.ignoreQuotes ||
            this.settings.ignoreDashes ||
            !this.settings.editable
        )
            return;
        await this.diff.waitForDiff();
        const change = this.diff.getLineChanges()?.[this.activeChange];
        if (!change) return;
        const sourceSide = 1 - targetSide,
            source = this.models[sourceSide],
            target = this.models[targetSide];
        const sourceStart = change[sourceSide ? 'modifiedStartLineNumber' : 'originalStartLineNumber'],
            sourceEnd = change[sourceSide ? 'modifiedEndLineNumber' : 'originalEndLineNumber'];
        const targetStart = change[targetSide ? 'modifiedStartLineNumber' : 'originalStartLineNumber'],
            targetEnd = change[targetSide ? 'modifiedEndLineNumber' : 'originalEndLineNumber'];
        const block = sourceEnd
            ? Array.from({ length: sourceEnd - sourceStart + 1 }, (_, i) => source.getLineContent(sourceStart + i))
            : [];
        const lines = target.getLinesContent();
        lines.splice(targetEnd ? targetStart - 1 : targetStart, targetEnd ? targetEnd - targetStart + 1 : 0, ...block);
        const editor = targetSide ? this.diff.getModifiedEditor() : this.diff.getOriginalEditor();
        editor.pushUndoStop();
        editor.executeEdits('diff.apply-change', [
            { range: target.getFullModelRange(), text: lines.join(target.getEOL()) }
        ]);
        editor.pushUndoStop();
        this.lastEditedSide = targetSide;
        this.status('当前差异已应用到' + (targetSide ? '右' : '左') + '侧内存文本，可撤销');
    },
    async clearCurrent() {
        this.inputEpoch = (this.inputEpoch || 0) + 1;
        await api.invoke('cancel');
        this.images.cancel();
        await this.documents.dispose();
        this.items = [null, null];
        this.sources = ['', ''];
        this.dirtySides = [false, false];
        this.activeChange = -1;
        this.changes = [];
        if (this.mode === 'folder') {
            this.roots = [null, null];
            this.folders.invalidate();
            await api.invoke('clear-roots');
        }
        this.refreshNames();
        await this.updateModels();
        this.cacheSession();
        await this.setMode(this.mode);
        this.status('当前对比已清空');
    },
    async reload(side) {
        const item = this.items[side];
        if (!item?.path) return;
        if (item.dirty && !window.confirm('重新读取会丢弃这一侧的内存编辑，继续吗？')) return;
        await this.importPaths([item.path], side);
    },
    async report() {
        const report = {
            title: (this.items[0]?.name || '左侧') + ' ⇄ ' + (this.items[1]?.name || '右侧'),
            createdAt: new Date().toISOString(),
            note: '仅本地生成。' + (this.settings.ignoreWhitespace ? ' 忽略行首尾空白。' : '')
        };
        if (this.mode === 'folder' && this.folders.snapshot)
            return {
                ...report,
                title: '文件夹差异报告',
                roots: this.folders.snapshot.roots,
                rows: this.folders.snapshot.rows.filter((r) => r.state !== 'same' || r.differences),
                warnings: this.folders.snapshot.warnings
            };
        if (this.content === 'image')
            return {
                ...report,
                image: $('#image-canvas').toDataURL('image/png'),
                note: report.note + ' ' + $('#summary').textContent,
                rows: [
                    {
                        position: '像素对比',
                        state: 'changed',
                        before: this.items[0]?.name || '',
                        after: this.items[1]?.name || ''
                    }
                ]
            };
        if (this.content === 'document' && this.items.some((i) => i?.kind === 'sheet'))
            return {
                ...report,
                rows: this.documents.report(),
                note:
                    report.note +
                    ' Excel ' +
                    $('#sheet-mode').selectedOptions[0].text +
                    (this.documents.sheetUI.options.keyColumns.length
                        ? `；工作表 ${$('#sheet').value} 按业务键配对，其余工作表按行比较。`
                        : '')
            };
        let texts = this.sources;
        if (this.content === 'document') texts = await this.documents.texts();
        if (this.content === 'document' && !$('#document-difference').hidden)
            report.image = $('#document-difference').toDataURL('image/png');
        texts = texts.map((t) => this.normalize(t));
        if (this.settings.ignoreWhitespace)
            texts = texts.map((t) =>
                t
                    .split('\n')
                    .map((s) => s.trim())
                    .join('\n')
            );
        return {
            ...report,
            before: texts[0],
            after: texts[1],
            precision: 'character',
            note: report.note + this.items.map((i) => i?.note || '').join(' ')
        };
    }
});
// 只在内存上报离开检查状态；用户开启草稿后后台才落盘。关闭握手会刷新最后一次输入。
App.workspaceValue = function () {
    const states = [
        ...Object.entries(this.sessions)
            .filter(([mode]) => mode !== this.mode)
            .map(([, session]) => session),
        this
    ];
    const textState =
        this.content === 'text' && this.sources.some(Boolean)
            ? this
            : [...states].reverse().find((s) => s.content === 'text' && s.sources?.some(Boolean));
    const hasOtherEdits = states.some((s) => s.items?.some((i) => i?.dirty && i.kind !== 'text'));
    return {
        dirty: hasOtherEdits || states.some((s) => s.dirtySides?.some(Boolean) || s.items?.some((i) => i?.dirty)),
        hasOtherEdits,
        texts: textState ? [...textState.sources] : ['', ''],
        names: textState
            ? textState.items.map((item, side) => (item?.name || (side ? '右侧' : '左侧')).slice(0, 150))
            : ['左侧', '右侧']
    };
};
App.flushWorkspace = async function () {
    clearTimeout(this.workspaceTimer);
    const value = this.workspaceValue();
    this.scheduleValue = JSON.stringify(value);
    const previous = this.workspaceWrite || Promise.resolve();
    this.workspaceWrite = previous
        .catch(() => {})
        .then(() => api.invoke('workspace-state', value))
        .catch((error) => {
            this.scheduleValue = null;
            throw error;
        });
    return this.workspaceWrite;
};
App.scheduleWorkspace = function () {
    if (!this.settings.language) return;
    if (JSON.stringify(this.workspaceValue()) === this.scheduleValue) return;
    clearTimeout(this.workspaceTimer);
    this.workspaceTimer = setTimeout(
        () => this.flushWorkspace().catch((e) => this.error('工作副本保护失败：' + e.message)),
        250
    );
};
api.onPrepareClose?.(() => App.flushWorkspace());
App.images = new DiffImages(App);
App.folders = new DiffFolders(App);
App.documents = new DiffDocuments(App);
const languages = [
    'plaintext',
    'javascript',
    'typescript',
    'json',
    'html',
    'css',
    'scss',
    'less',
    'xml',
    'markdown',
    'yaml',
    'java',
    'go',
    'python',
    'ruby',
    'rust',
    'c',
    'cpp',
    'csharp',
    'shell',
    'powershell',
    'sql',
    'php',
    'kotlin',
    'swift',
    'lua',
    'dockerfile',
    'ini',
    'bat',
    'r',
    'dart',
    'fsharp',
    'objective-c',
    'perl',
    'redis',
    'scala',
    'vb'
];
for (const language of languages) $('#language').add(new Option(language, language));
function applyTheme(context) {
    for (const [key, value] of Object.entries(context.tokens || {}))
        document.documentElement.style.setProperty(key, value);
    document.body.dataset.scheme = context.tokens?.['color-scheme'] || 'light';
    App.applySettings();
}
api.onContextChanged(applyTheme);
api.onNavigate(({ route }) => {
    App.navigation = route || 'text';
    App.safe(() => App.setMode(App.navigation));
});
api.onEvent((event) => {
    if (event.name === 'preferences-changed') {
        App.settings = event.data;
        App.applySettings();
    }
    if (event.name === 'progress')
        $('#scan-progress').textContent = `${event.data.side ? '右' : '左'}侧 ${event.data.count} 项`;
});
$('#local-drafts').onchange = () =>
    App.safe(async () => {
        App.settings = await api.invoke('settings', { localDrafts: $('#local-drafts').checked });
        await App.flushWorkspace();
        App.status(App.settings.localDrafts ? '本机自动文本草稿已开启' : '自动草稿已关闭，已删除草稿文件');
    });
$('#save-draft').onclick = () =>
    App.safe(async () => {
        await App.flushWorkspace();
        const draft = await api.invoke('draft-save');
        App.showDraft(draft);
        App.status('文本工作副本已保存为本地草稿');
    });
$('#delete-draft').onclick = () =>
    App.safe(async () => {
        await api.invoke('draft-delete');
        $('#draft-notice').hidden = true;
        App.status('本地草稿已删除');
    });
$('#dismiss-draft').onclick = () => ($('#draft-notice').hidden = true);
App.showDraft = (draft) => {
    if (!draft) return;
    $('#draft-notice').hidden = false;
    $('#draft-notice-text').textContent =
        `有 ${new Date(draft.savedAt).toLocaleString()} 保存的文本草稿 · ${draft.characters?.toLocaleString() || ''} 字符`;
};
$('#restore-draft').onclick = () =>
    App.safe(async () => {
        const draft = await api.invoke('draft-read');
        if (!draft) return;
        if (App.workspaceValue().dirty && !window.confirm('恢复会替换当前文本工作副本，继续吗？')) return;
        await App.setMode('text');
        App.items = [null, null];
        await App.setTexts(draft.texts);
        App.dirtySides = [true, true];
        $('#draft-notice').hidden = true;
        await App.flushWorkspace();
        App.status('草稿已恢复；可另存文本或继续编辑');
    });
document.querySelectorAll('[data-save-text]').forEach(
    (button) =>
        (button.onclick = () =>
            App.safe(async () => {
                const side = Number(button.dataset.saveText),
                    value = App.sources[side],
                    result = await api.invoke('save-text', {
                        side,
                        text: value,
                        name: App.items[side]?.name || 'Diff-工作副本.txt',
                        originals: App.items.map((i) => i?.path).filter(Boolean)
                    });
                if (result) {
                    if (App.sources[side] === value) {
                        App.dirtySides[side] = false;
                        if (App.items[side]) App.items[side] = { ...App.items[side], dirty: false };
                    }
                    App.refreshNames();
                    await App.flushWorkspace();
                    App.status('工作副本已另存：' + result.file);
                }
            }))
);
document.querySelectorAll('[data-mode]').forEach(
    (b) =>
        (b.onclick = () => {
            App.safe(() => App.setMode(b.dataset.mode));
            void api.selectNavigation(b.dataset.mode).catch(() => {});
        })
);
document.querySelectorAll('[data-choose]').forEach((b) => (b.onclick = () => App.choose(Number(b.dataset.choose))));
document.querySelectorAll('[data-paste]').forEach((b) => (b.onclick = () => App.paste(Number(b.dataset.paste))));
document
    .querySelectorAll('[data-copy]')
    .forEach((b) => (b.onclick = () => App.safe(() => api.clipboard.writeText(App.sources[Number(b.dataset.copy)]))));
for (const id of ['view', 'language', 'precision', 'fontSize', 'wrap', 'editable', 'ignoreWhitespace', 'collapse'])
    $('#' + id).onchange = () =>
        App.safe(() =>
            App.saveSettings({
                [id]: ['wrap', 'editable', 'ignoreWhitespace', 'collapse'].includes(id)
                    ? $('#' + id).checked
                    : id === 'fontSize'
                      ? Number($('#' + id).value)
                      : $('#' + id).value
            })
        );
$('#apply-rules').onclick = () =>
    App.safe(() =>
        App.saveSettings({
            ignoreQuotes: $('#ignoreQuotes').checked,
            ignoreDashes: $('#ignoreDashes').checked,
            ignoreRules: $('#ignoreRules')
                .value.split('\n')
                .map((s) => s.trim())
                .filter(Boolean)
        })
    );
document.querySelectorAll('[data-transform]').forEach(
    (b) =>
        (b.onclick = () =>
            App.safe(async () => {
                await App.editor();
                if (App.settings.ignoreRules.length || App.settings.ignoreQuotes || App.settings.ignoreDashes)
                    throw Error('请先清除忽略规则，再转换原文');
                const values = App.models
                    .map((m) => m.getValue())
                    .map((t) =>
                        b.dataset.transform === 'trim'
                            ? t
                                  .split('\n')
                                  .map((l) => l.trimEnd())
                                  .join('\n')
                            : b.dataset.transform === 'sort'
                              ? t.split('\n').sort().join('\n')
                              : JSON.stringify(JSON.parse(t), null, 2)
                    );
                App.models.forEach((m, i) =>
                    m.pushEditOperations([], [{ range: m.getFullModelRange(), text: values[i] }], () => null)
                );
            }))
);
$('#first-diff').onclick = () => App.next(1, true);
$('#previous').onclick = () => App.next(-1);
$('#next').onclick = () => App.next();
$('#document-preview').onclick = () => App.safe(() => App.showContent());
$('#merge-left').onclick = () => App.safe(() => App.merge(0));
$('#merge-right').onclick = () => App.safe(() => App.merge(1));
$('#undo-merge').onclick = () => {
    if (App.diff) {
        const editor = App.lastEditedSide ? App.diff.getModifiedEditor() : App.diff.getOriginalEditor();
        editor.trigger('diff', 'undo');
    }
};
document
    .querySelectorAll('[data-reload]')
    .forEach((b) => (b.onclick = () => App.safe(() => App.reload(Number(b.dataset.reload)))));
$('#empty-left').onclick = () => App.choose(0, App.mode === 'folder');
$('#empty-right').onclick = () => App.choose(1, App.mode === 'folder');
$('#toggle-tools').onclick = () => {
    const hidden = document.body.classList.toggle('tools-hidden');
    document.body.classList.toggle('controls-open', !hidden);
    $('#toggle-tools').setAttribute('aria-expanded', String(!hidden));
    App.diff?.layout();
};
$('#shortcuts-open').onclick = () => $('#shortcuts-dialog').showModal();
$('#shortcuts-close').onclick = () => $('#shortcuts-dialog').close();
document.addEventListener('keydown', (event) => {
    if (event.key === 'F7' && !document.querySelector('dialog[open]')) {
        event.preventDefault();
        App.next(event.shiftKey ? -1 : 1);
    }
});
$('#swap').onclick = () =>
    App.safe(async () => {
        if (App.mode === 'folder') {
            if (!App.roots.every(Boolean)) {
                App.status('请选择两侧目录后交换');
                return;
            }
            App.roots.reverse();
            await api.invoke('swap-roots');
            await App.folders.scan();
        } else {
            App.items.reverse();
            App.sources.reverse();
            if (App.content === 'text') await App.updateModels();
            else await App.showContent();
        }
        App.refreshNames();
    });
$('#clear').onclick = () =>
    App.safe(async () => {
        if (!window.confirm('清空当前两侧内容？不会修改原文件。')) return;
        await App.clearCurrent();
    });
$('#cancel').onclick = () =>
    App.safe(async () => {
        await api.invoke('cancel');
        App.inputEpoch = (App.inputEpoch || 0) + 1;
        App.folders.generation++;
        App.images.cancel();
        await App.documents.dispose();
        App.status('任务已取消');
    });
$('#export').onclick = () => {
    if (App.mode === 'folder' && !App.folders.snapshot) {
        App.status('请先完成目录扫描再导出报告');
        return;
    }
    if (App.mode !== 'folder' && !App.items.some(Boolean) && !App.sources.some(Boolean)) {
        App.status('请先选择内容再导出报告');
        return;
    }
    $('#export-dialog').showModal();
};
$('#cancel-export').onclick = () => $('#export-dialog').close();
$('#export-dialog').onclick = (e) => {
    if (e.target === $('#export-dialog')) {
        const r = e.target.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) e.target.close();
    }
};
$('#confirm-export').onclick = () =>
    App.safe(async () => {
        const button = $('#confirm-export');
        button.disabled = true;
        try {
            App.status('正在生成报告…');
            const result = await api.invoke('export', {
                format: $('#export-format').value,
                report: await App.report()
            });
            if (result) {
                $('#export-dialog').close();
                App.status('报告已保存：' + result.file);
            } else App.status('已取消导出');
        } finally {
            button.disabled = false;
        }
    });
function eventSide(event) {
    const side = event.target.closest?.('[data-side]')?.dataset.side;
    if (side !== undefined) return Number(side);
    if (!App.occupied(0)) return 0;
    if (!App.occupied(1)) return 1;
    const rect = $('.workspace').getBoundingClientRect();
    return Number.isFinite(event.clientX) ? (event.clientX < rect.left + rect.width / 2 ? 0 : 1) : App.activeSide;
}
document.addEventListener(
    'dragover',
    (e) => {
        if (!Array.from(e.dataTransfer?.types || []).includes('Files')) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
        $('#drop-overlay').hidden = false;
        const target = eventSide(e);
        document
            .querySelectorAll('[data-drop-side]')
            .forEach((node) => node.classList.toggle('active', Number(node.dataset.dropSide) === target));
    },
    true
);
document.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget) $('#drop-overlay').hidden = true;
});
window.addEventListener('blur', () => ($('#drop-overlay').hidden = true));
document.addEventListener(
    'drop',
    (e) => {
        const files = Array.from(e.dataTransfer.files);
        if (!files.length) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        $('#drop-overlay').hidden = true;
        const explicit = e.target.closest?.('[data-side]')?.dataset.side;
        const side =
            explicit === undefined ? (App.occupied(0) && App.occupied(1) ? eventSide(e) : null) : Number(explicit);
        App.safe(async () => {
            const paths = await api.files.paths(files);
            if (!paths.length) throw Error('无法取得拖入文件的本地路径，请使用“打开文件”');
            await App.importPaths(paths, side);
        });
    },
    true
);
document.addEventListener(
    'paste',
    (e) => {
        const files = Array.from(e.clipboardData?.files || []);
        if (!files.length) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        const side = eventSide(e);
        App.safe(async () => {
            const paths = await api.files.paths(files);
            if (paths.length) return App.importPaths(paths, side);
            if (files[0].type.startsWith('image/')) {
                const url = await new Promise((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(files[0]);
                });
                return App.accept([{ side, item: { kind: 'image', name: '粘贴的图片', url } }]);
            }
            return App.paste(side);
        });
    },
    true
);
window.addEventListener('beforeunload', () => {
    App.images.cancel();
    void App.documents.dispose();
});
App.ready = App.safe(async () => {
    const context = await api.context();
    applyTheme(context);
    const value = await api.invoke('state');
    App.settings = value.settings;
    $('#local-drafts').checked = App.settings.localDrafts === true;
    App.showDraft(value.draft);
    if (value.draftError) App.error(value.draftError);
    App.applySettings();
    await App.setMode(App.navigation || 'text');
    if (App.mode === 'text') await App.editor();
    App.status('就绪 · 全部对比在本地完成');
    try {
        const snapshot = await api.clipboard.snapshot();
        if (snapshot?.kind === 'files' && snapshot.files.length) await App.importPaths(snapshot.files.slice(0, 2), 0);
    } catch {}
    return true;
});
