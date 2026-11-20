window.DiffDocuments = class {
    constructor(app) {
        this.app = app;
        this.items = [null, null];
        this.pdfs = [null, null];
        this.generation = 0;
        this.tablePage = 0;
        this.columnPage = 0;
        this.highlight = false;
        this.canvases = [null, null];
        this.sheetUI = new DiffSheets(app, this);
        // 比较规则和低频操作沿用左侧工具区，主内容上方只保留工作表和视图切换。
        const tools = document.querySelector('.sheet-options');
        const filter = document.querySelector('.sheet-result-filter');
        const filterHeading = document.createElement('strong');
        filterHeading.textContent = '筛选对比结果';
        filter.prepend(filterHeading);
        tools.prepend(filter);
        const more = document.createElement('div');
        more.className = 'sheet-secondary-actions';
        for (const id of ['sheet-edit', 'sheet-export-csv', 'document-text', 'document-note'])
            more.append(document.querySelector('#' + id));
        tools.append(more);
        document.querySelector('#sheet-toolbar').prepend(document.querySelector('#sheet'));
        for (const id of ['sheet', 'sheet-mode'])
            document.querySelector('#' + id).onchange = () => {
                if (id === 'sheet') this.sheetUI.resetKeys();
                this.tablePage = 0;
                app.safe(() => this.render());
            };
        document.querySelector('#page').onchange = () => app.safe(() => this.render());
        document.querySelector('#document-highlight').onclick = () => {
            this.highlight = !this.highlight;
            app.safe(() => this.render());
        };
        document.querySelector('#document-text').onclick = () =>
            app.safe(async () => {
                const values = await this.texts();
                await app.setTexts(values);
                app.display('text');
            });
        document.querySelector('#table-prev').onclick = () => {
            if (this.items.some((i) => i?.kind === 'sheet')) {
                this.sheetUI.page--;
                this.sheetUI.render();
                return;
            }
            this.tablePage = Math.max(0, this.tablePage - 1);
            app.safe(() => this.render());
        };
        document.querySelector('#table-next').onclick = () => {
            if (this.items.some((i) => i?.kind === 'sheet')) {
                this.sheetUI.page++;
                this.sheetUI.render();
                return;
            }
            this.tablePage++;
            app.safe(() => this.render());
        };
        const bar = document.querySelector('.table-pagination');
        for (const [label, delta] of [
            ['← 前 30 列', -1],
            ['后 30 列 →', 1]
        ]) {
            const b = document.createElement('button');
            b.textContent = label;
            b.onclick = () => {
                if (this.items.some((i) => i?.kind === 'sheet')) {
                    this.sheetUI.columnPage = Math.max(0, this.sheetUI.columnPage + delta);
                    this.sheetUI.render();
                    return;
                }
                this.columnPage = Math.max(0, this.columnPage + delta);
                app.safe(() => this.render());
            };
            bar.append(b);
        }
    }
    async load(items) {
        const generation = ++this.generation;
        for (const doc of this.pdfs) await doc?.destroy();
        this.pdfs = [null, null];
        this.items = items;
        this.sheetUI.resetKeys();
        this.sheetUI.revision++;
        this.sheetUI.signature = '';
        this.sheetUI.page = this.sheetUI.columnPage = 0;
        this.tablePage = this.columnPage = 0;
        for (let side = 0; side < 2; side++)
            if (items[side]?.kind === 'pdf') {
                await this.app.script('vendor/pdf.js');
                if (generation !== this.generation) return;
                window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.js';
                const response = await fetch(items[side].url);
                if (!response.ok) throw Error('PDF 已变化，请重新打开');
                const document = await window.pdfjsLib.getDocument({
                    data: new Uint8Array(await response.arrayBuffer()),
                    isEvalSupported: false,
                    disableFontFace: true,
                    useSystemFonts: true
                }).promise;
                if (document.numPages > 300) {
                    await document.destroy();
                    throw Error('PDF 超过 300 页，请拆分后对比');
                }
                if (generation !== this.generation) {
                    await document.destroy();
                    return;
                }
                this.pdfs[side] = document;
            }
        const sheets = [...new Set(items.flatMap((i) => i?.sheets?.map((s) => s.name) || []))];
        document.querySelector('#sheet').replaceChildren(...sheets.map((name) => new Option(name, name)));
        document.querySelector('#page').value = 1;
        await this.render();
    }
    sheetPair() {
        const name = document.querySelector('#sheet').value;
        return this.items.map((i) => i?.sheets?.find((s) => s.name === name));
    }
    cellValue(cell) {
        return cell ? (document.querySelector('#sheet-mode').value === 'formulas' ? cell.f || cell.v : cell.v) : '';
    }
    column(n) {
        let s = '';
        for (n++; n; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
        return s;
    }
    async render() {
        const generation = ++this.generation,
            isSheet = this.items.some((i) => i?.kind === 'sheet'),
            isSlides = this.items.some((i) => i?.kind === 'slides'),
            pageControl = document.querySelector('#page'),
            page = Math.max(1, Math.trunc(Number(pageControl.value) || 1));
        document.querySelector('#sheet').hidden = document.querySelector('#sheet-mode').hidden = !isSheet;
        document.querySelector('.document-toolbar').hidden = isSheet;
        if (isSheet) {
            document
                .querySelector('.sheet-secondary-actions')
                .append(document.querySelector('#document-text'), document.querySelector('#document-note'));
        } else {
            document.querySelector('.document-toolbar').append(document.querySelector('#document-text'));
            document.querySelector('.document-body').before(document.querySelector('#document-note'));
        }
        document.querySelector('#document-panel').classList.toggle('is-sheet', isSheet);
        document.querySelector('.comparison-meta').classList.toggle('sheet-summary', isSheet);
        const sheetPicker = document.querySelector('#sheet').tomselect?.wrapper;
        if (sheetPicker && sheetPicker.parentElement.id !== 'sheet-toolbar')
            document.querySelector('#sheet-toolbar').prepend(sheetPicker);
        document.querySelector('.table-pagination').hidden = !isSheet;
        pageControl.parentElement.hidden = isSheet;
        document.querySelector('#document-highlight').hidden = isSheet;
        document.querySelector('#sheet-toolbar').hidden = !isSheet;
        document.querySelector('#sheet-changes').hidden = !isSheet;
        if (!isSheet) {
            document.querySelector('.document-pair').hidden = false;
            document.querySelector('#sheet-single').hidden = true;
        } else {
            this.sheetUI.options.mode = document.querySelector('#sheet-mode').value;
            document.querySelector('#sheet-compare').value = this.sheetUI.options.mode;
        }
        document.querySelector('#document-note').textContent =
            [...new Set(this.items.map((i) => i?.note).filter(Boolean))].join(' ') +
            (this.items.some((i) => i?.kind === 'pdf')
                ? ' PDF 按页渲染比较，差异高亮比较当前页像素；字体替代可能影响视觉结果。'
                : '');
        const count = Math.max(
            1,
            ...this.pdfs.map((p) => p?.numPages || 0),
            ...this.items.map((i) => i?.slides?.length || 0)
        );
        pageControl.max = count;
        pageControl.value = Math.min(page, count);
        document.querySelector('#page-total').textContent = isSheet ? '' : `/ ${count}`;
        if (isSheet) {
            this.renderSheets();
            document.querySelector('#document-difference').hidden = true;
            return;
        }
        const canvases = [];
        for (let side = 0; side < 2; side++) {
            const target = document.querySelector(side ? '#document-right' : '#document-left');
            target.replaceChildren();
            const canvas = document.createElement('canvas');
            canvas.width = 1000;
            canvas.height = 700;
            canvases[side] = canvas;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, 1000, 700);
            if (this.pdfs[side] && page <= this.pdfs[side].numPages) {
                const p = await this.pdfs[side].getPage(page),
                    base = p.getViewport({ scale: 1 }),
                    viewport = p.getViewport({ scale: 1000 / base.width });
                if (!Number.isFinite(viewport.width * viewport.height) || viewport.width * viewport.height > 16000000)
                    throw Error('PDF 页面渲染超过 1600 万像素');
                canvas.width = Math.ceil(viewport.width);
                canvas.height = Math.ceil(viewport.height);
                await p.render({ canvasContext: ctx, viewport }).promise;
            } else if (isSlides && this.items[side]?.slides?.[page - 1])
                await this.renderSlide(canvas, this.items[side], page - 1);
            else {
                ctx.fillStyle = '#8b9691';
                ctx.font = '16px sans-serif';
                ctx.fillText('此侧没有当前页 / 幻灯片', 30, 50);
            }
            if (generation !== this.generation) return;
            target.append(canvas);
        }
        this.canvases = canvases;
        this.app.summary(`${isSlides ? '幻灯片' : 'PDF'} 第 ${page} / ${count} 页`);
        if (this.highlight) await this.pixelHighlight(generation);
        else document.querySelector('#document-difference').hidden = true;
    }
    async renderSlide(canvas, item, index) {
        const ratio = 1000 / item.width;
        canvas.width = 1000;
        canvas.height = Math.ceil(item.height * ratio);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        for (const shape of item.slides[index].shapes) {
            const x = shape.x * ratio,
                y = shape.y * ratio,
                w = shape.w * ratio,
                h = shape.h * ratio;
            if (shape.fill && /^[a-f\d]{6}$/i.test(shape.fill)) {
                ctx.fillStyle = '#' + shape.fill;
                ctx.fillRect(x, y, w, h);
            }
            if (shape.image) {
                const image = new Image();
                image.src = shape.image;
                try {
                    await image.decode();
                    ctx.drawImage(image, x, y, w, h);
                } catch {}
            }
            if (shape.text) {
                const size = Math.max(6, shape.size * 12700 * ratio);
                ctx.font = size + 'px Arial,sans-serif';
                ctx.fillStyle = /^[a-f\d]{6}$/i.test(shape.color || '') ? '#' + shape.color : '#222';
                ctx.save();
                ctx.beginPath();
                ctx.rect(x, y, w, h);
                ctx.clip();
                let yy = y + size;
                for (const line of shape.text.split('\n')) {
                    let segment = '';
                    for (const char of line) {
                        if (ctx.measureText(segment + char).width > w && segment) {
                            ctx.fillText(segment, x, yy);
                            yy += size * 1.25;
                            segment = '';
                        }
                        segment += char;
                    }
                    ctx.fillText(segment, x, yy);
                    yy += size * 1.25;
                }
                ctx.restore();
            }
        }
    }
    renderSheets() {
        return this.sheetUI.render();
    }
    async pixelHighlight(generation) {
        const [a, b] = this.canvases;
        if (!a || !b) return;
        const width = Math.max(a.width, b.width),
            height = Math.max(a.height, b.height);
        if (width * height > 16000000) throw Error('页面画布超过 1600 万像素');
        const pixels = (canvas) => {
            const c = document.createElement('canvas');
            c.width = width;
            c.height = height;
            const ctx = c.getContext('2d');
            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, width, height);
            ctx.drawImage(canvas, 0, 0);
            return ctx.getImageData(0, 0, width, height).data;
        };
        const result = await this.app.images.compare(pixels(a), pixels(b), width, height, 20);
        if (generation !== this.generation) return;
        const target = document.querySelector('#document-difference');
        target.width = width;
        target.height = height;
        target.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(result.pixels), width, height), 0, 0);
        target.hidden = false;
        this.app.summary(
            `当前页 ${result.changed.toLocaleString()} 个差异像素 · ${((result.changed / (width * height)) * 100).toFixed(2)}%`
        );
    }
    async texts() {
        const result = [];
        for (let side = 0; side < 2; side++) {
            const item = this.items[side];
            if (item?.kind === 'pdf') {
                const pieces = [];
                for (let n = 1; n <= this.pdfs[side].numPages; n++) {
                    const page = await this.pdfs[side].getPage(n);
                    pieces.push(
                        (await page.getTextContent()).items.map((i) => i.str + (i.hasEOL ? '\n' : ' ')).join('')
                    );
                    if (pieces.join('').length > 2000000) throw Error('PDF 文本超过 200 万字符');
                }
                result.push(pieces.join('\n\f\n'));
            } else if (item?.kind === 'slides') result.push(item.slides.map((s) => s.text).join('\n\f\n'));
            else if (item?.kind === 'sheet')
                result.push(
                    item.sheets
                        .map(
                            (s) =>
                                s.name + '\n' + s.rows.map((r) => r.map((c) => this.cellValue(c)).join('\t')).join('\n')
                        )
                        .join('\n\f\n')
                );
            else result.push(item?.text || '');
        }
        return result;
    }
    report() {
        return this.sheetUI.report();
    }
    async dispose() {
        this.generation++;
        for (const doc of this.pdfs) await doc?.destroy();
        this.pdfs = [null, null];
    }
};
