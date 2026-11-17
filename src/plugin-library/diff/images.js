window.DiffImages = class {
    constructor(app) {
        this.app = app;
        this.sources = [null, null];
        this.zoom = 1;
        this.generation = 0;
        this.pixelJob = 0;
        this.pending = new Map();
        this.canvas = document.querySelector('#image-canvas');
        this.overlay = document.querySelector('#image-regions');
        this.viewport = document.querySelector('#image-viewport');
        this.mode = 'split';
        this.rotation = 0;
        this.flip = false;
        this.offset = { x: 0, y: 0 };
        this.manual = [];
        this.ocrResults = null;
        this.frame = 0;
        this.analysis = null;
        this.transformRevision = 0;
        for (const id of ['image-mode', 'image-tool-mode'])
            document.querySelector('#' + id).onchange = (e) => app.safe(() => this.setMode(e.target.value));
        for (const [id, other] of [
            ['blend', 'image-tool-blend'],
            ['image-tool-blend', 'blend'],
            ['threshold', 'image-tool-threshold'],
            ['image-tool-threshold', 'threshold']
        ])
            document.querySelector('#' + id).oninput = (e) => {
                document.querySelector('#' + other).value = e.target.value;
                if (id.includes('threshold')) this.analysis = null;
                clearTimeout(this.adjustTimer);
                this.adjustTimer = setTimeout(() => app.safe(() => this.draw()), 100);
            };
        for (const id of ['image-rotate', 'image-flip', 'image-offset-x', 'image-offset-y'])
            document.querySelector('#' + id).onchange = () => {
                this.rotation = Number(document.querySelector('#image-rotate').value);
                this.flip = document.querySelector('#image-flip').checked;
                this.offset = {
                    x: Number(document.querySelector('#image-offset-x').value) || 0,
                    y: Number(document.querySelector('#image-offset-y').value) || 0
                };
                this.analysis = null;
                this.ocrResults = null;
                this.transformRevision++;
                this.generation++;
                app.safe(() => this.redraw(true));
            };
        document
            .querySelectorAll('[data-image-view]')
            .forEach((b) => (b.onclick = () => app.safe(() => this.setMode(b.dataset.imageView))));
        document.querySelector('#zoom-in').onclick = () => this.setZoom(this.zoom * 1.2);
        document.querySelector('#zoom-out').onclick = () => this.setZoom(this.zoom / 1.2);
        document.querySelector('#zoom-reset').onclick = document.querySelector('#image-fit-side').onclick = () =>
            this.fit();
        document.querySelector('#image-original').onclick = () => this.setZoom(1);
        document.querySelector('#image-boxes').onchange = () => this.drawRegions();
        document.querySelector('#image-align').onclick = () => app.safe(() => this.align());
        document.querySelector('#image-reset').onclick = () => app.safe(() => this.reset());
        document.querySelector('#image-ocr').onclick = () => app.safe(() => this.recognize());
        document.querySelector('#image-add-region').onclick = () => {
            this.selecting = !this.selecting;
            document.querySelector('#image-add-region').classList.toggle('selected', this.selecting);
            app.status(this.selecting ? '在图片上拖动框选关注区域' : '已退出框选');
        };
        document.querySelector('#export-image').onclick = () =>
            app.safe(() => app.api.invoke('export', { format: 'png', data: this.canvas.toDataURL('image/png') }));
        this.viewport.onwheel = (e) => {
            if (!this.sources.some(Boolean)) return;
            e.preventDefault();
            this.setZoom(this.zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
        };
        let drag = null;
        const point = (e) => {
            const rect = this.canvas.getBoundingClientRect();
            return { x: (e.clientX - rect.left) / this.zoom, y: (e.clientY - rect.top) / this.zoom };
        };
        this.viewport.onpointerdown = (e) => {
            drag = {
                x: e.clientX,
                y: e.clientY,
                left: this.viewport.scrollLeft,
                top: this.viewport.scrollTop,
                start: point(e)
            };
            this.viewport.setPointerCapture(e.pointerId);
        };
        this.viewport.onpointermove = (e) => {
            if (!drag) return;
            if (this.selecting) {
                this.selection = {
                    x: Math.min(drag.start.x, point(e).x),
                    y: Math.min(drag.start.y, point(e).y),
                    width: Math.abs(point(e).x - drag.start.x),
                    height: Math.abs(point(e).y - drag.start.y)
                };
                this.drawRegions();
            } else {
                this.viewport.scrollLeft = drag.left + drag.x - e.clientX;
                this.viewport.scrollTop = drag.top + drag.y - e.clientY;
            }
        };
        const end = () => {
            if (this.selection?.width > 2 && this.selection?.height > 2) {
                const region = { ...this.selection, manual: true };
                if (this.mode === 'split' && region.x > this.width + 32) region.x -= this.width + 32;
                region.x = Math.max(0, Math.min(this.width - 1, region.x));
                region.y = Math.max(0, Math.min(this.height - 1, region.y));
                region.width = Math.min(region.width, this.width - region.x);
                region.height = Math.min(region.height, this.height - region.y);
                this.manual.push(region);
                this.renderChanges();
            }
            this.selection = null;
            drag = null;
            this.drawRegions();
        };
        this.viewport.onpointerup = end;
        this.viewport.onpointercancel = () => {
            drag = null;
            this.selection = null;
        };
        this.resize = new ResizeObserver(() => {
            if (this.app.content === 'image' && this.sources.some(Boolean) && this.autoFit) this.fit();
        });
        this.resize.observe(this.viewport);
        document.addEventListener('visibilitychange', () => this.visibilityChanged(app.content === 'image'));
    }
    async load(items) {
        if (this.loadedItems?.every((i, index) => i === items[index])) return this.redraw();
        this.cancel();
        const generation = this.generation;
        this.loadedItems = [...items];
        const images = await Promise.all(
            items.map(async (item) => {
                if (item?.kind !== 'image') return null;
                const image = new Image();
                image.src = item.url;
                await image.decode();
                if (image.naturalWidth * image.naturalHeight > 16000000) throw Error('单图超过 1600 万像素');
                return image;
            })
        );
        if (generation !== this.generation) return;
        this.sources = images;
        this.analysis = null;
        this.manual = [];
        this.ocrResults = null;
        this.rotation = 0;
        this.flip = false;
        this.offset = { x: 0, y: 0 };
        this.syncTools();
        await this.redraw(true);
    }
    syncTools() {
        for (const [id, label] of [
            ['blink', '闪烁'],
            ['subtract', '相减'],
            ['ocr-rich', '富文本 OCR'],
            ['ocr-text', 'OCR 文本'],
            ['details', '文件详情']
        ]) {
            const select = document.querySelector('#image-mode');
            if (![...select.options].some((o) => o.value === id)) select.add(new Option(label, id));
        }
        document.querySelector('#image-rotate').value = String(this.rotation);
        document.querySelector('#image-flip').checked = this.flip;
        document.querySelector('#image-offset-x').value = this.offset.x;
        document.querySelector('#image-offset-y').value = this.offset.y;
        for (const id of ['image-mode', 'image-tool-mode']) {
            const select = document.querySelector('#' + id);
            if (![...select.options].some((o) => o.value === this.mode)) select.add(new Option(this.mode, this.mode));
            select.value = this.mode;
        }
        document
            .querySelectorAll('[data-image-view]')
            .forEach((b) => b.classList.toggle('selected', b.dataset.imageView === this.mode));
        this.app.refreshControls();
        document.querySelector('#blend').disabled = !['fade', 'slider'].includes(this.mode);
    }
    async setMode(mode) {
        this.mode = mode;
        this.stopBlink();
        this.syncTools();
        await this.redraw();
        if (mode === 'blink') this.visibilityChanged(true);
    }
    visibilityChanged(visible) {
        this.stopBlink();
        if (visible && this.mode === 'blink' && this.sources.every(Boolean) && !document.hidden)
            this.blink = setInterval(() => {
                this.frame = 1 - this.frame;
                this.paint();
            }, 600);
    }
    stopBlink() {
        if (this.blink) clearInterval(this.blink);
        this.blink = null;
    }
    cancel() {
        this.generation++;
        this.stopBlink();
        this.worker?.terminate();
        this.worker = null;
        for (const p of this.pending.values()) p.reject(Error('图片对比已取消'));
        this.pending.clear();
        this.analysis = null;
    }
    compare(left, right, width, height, threshold, align = false) {
        if (!this.worker) {
            this.worker = new Worker('pixel-worker.js');
            this.worker.onmessage = ({ data }) => {
                const pending = this.pending.get(data.id);
                if (pending) {
                    this.pending.delete(data.id);
                    data.error ? pending.reject(Error(data.error)) : pending.resolve(data);
                }
            };
            this.worker.onerror = () => {
                for (const p of this.pending.values()) p.reject(Error('像素工作线程异常'));
                this.pending.clear();
                this.worker?.terminate();
                this.worker = null;
            };
        }
        return new Promise((resolve, reject) => {
            const id = ++this.pixelJob;
            this.pending.set(id, { resolve, reject });
            this.worker.postMessage({ id, left: left.buffer, right: right.buffer, width, height, threshold, align }, [
                left.buffer,
                right.buffer
            ]);
        });
    }
    frames() {
        if (this.frameCache?.sources === this.sources && this.frameCache.revision === this.transformRevision)
            return this.frameCache.frames;
        const left = this.sources[0],
            right = this.sources[1],
            rightWidth = right ? (this.rotation % 180 ? right.naturalHeight : right.naturalWidth) : 1,
            rightHeight = right ? (this.rotation % 180 ? right.naturalWidth : right.naturalHeight) : 1;
        const origin = { x: Math.max(0, -this.offset.x), y: Math.max(0, -this.offset.y) };
        this.width = Math.max((left?.naturalWidth || 1) + origin.x, rightWidth + this.offset.x + origin.x);
        this.height = Math.max((left?.naturalHeight || 1) + origin.y, rightHeight + this.offset.y + origin.y);
        if (this.width * this.height > 16000000) throw Error('对齐画布超过 1600 万像素');
        const frames = this.sources.map((image, side) => {
            const c = document.createElement('canvas');
            c.width = this.width;
            c.height = this.height;
            const ctx = c.getContext('2d');
            if (!image) return c;
            if (side) {
                ctx.translate(origin.x + this.offset.x + rightWidth / 2, origin.y + this.offset.y + rightHeight / 2);
                ctx.rotate((this.rotation * Math.PI) / 180);
                ctx.scale(this.flip ? -1 : 1, 1);
                ctx.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);
            } else ctx.drawImage(image, origin.x, origin.y);
            return c;
        });
        this.frameCache = { sources: this.sources, revision: this.transformRevision, frames };
        return frames;
    }
    async analyze() {
        if (this.analysis) return this.analysis;
        if (!this.sources.every(Boolean)) return null;
        const [a, b] = this.frames(),
            generation = this.generation,
            signature = [this.transformRevision, Number(document.querySelector('#threshold').value)].join(':');
        const result = await this.compare(
            a.getContext('2d').getImageData(0, 0, a.width, a.height).data,
            b.getContext('2d').getImageData(0, 0, b.width, b.height).data,
            a.width,
            a.height,
            Number(document.querySelector('#threshold').value)
        );
        if (
            generation !== this.generation ||
            signature !== [this.transformRevision, Number(document.querySelector('#threshold').value)].join(':')
        )
            return null;
        this.analysis = result;
        return result;
    }
    async draw() {
        const value = document.querySelector('#image-mode').value;
        if (value && value !== this.mode) {
            this.mode = value;
            this.syncTools();
        }
        return this.redraw();
    }
    async redraw(fit = false) {
        const [left, right] = this.sources;
        document.querySelector('#image-empty').hidden = !!(left || right);
        if (!left && !right) {
            this.canvas.width = 0;
            return;
        }
        const generation = this.generation;
        const isOCR = this.mode.startsWith('ocr'),
            details = this.mode === 'details';
        document.querySelector('#image-viewport').hidden = isOCR || details;
        document.querySelector('#ocr-result').hidden = !isOCR;
        document.querySelector('#image-file-details').hidden = !details;
        if (details) {
            this.details();
            return;
        }
        if (isOCR) {
            this.renderOCR();
            return;
        }
        this.frames();
        await this.analyze();
        if (generation !== this.generation) return;
        this.paint();
        this.renderChanges();
        if (fit) this.fit();
        else this.setZoom(this.zoom, false);
        this.visibilityChanged(this.app.content === 'image');
    }
    paint() {
        if (!this.sources.some(Boolean)) return;
        const frames = this.frames(),
            mode = this.mode,
            blend = Number(document.querySelector('#blend').value) / 100;
        this.canvas.width = mode === 'split' ? this.width * 2 + 32 : this.width;
        this.canvas.height = this.height;
        const ctx = this.canvas.getContext('2d');
        if (mode === 'split') {
            ctx.drawImage(frames[0], 0, 0);
            ctx.drawImage(frames[1], this.width + 32, 0);
        } else if (['difference', 'subtract'].includes(mode) && this.analysis) {
            ctx.putImageData(
                new ImageData(
                    new Uint8ClampedArray(mode === 'difference' ? this.analysis.pixels : this.analysis.subtract),
                    this.width,
                    this.height
                ),
                0,
                0
            );
        } else if (mode === 'blink') ctx.drawImage(frames[this.frame], 0, 0);
        else {
            ctx.drawImage(frames[0], 0, 0);
            ctx.save();
            if (mode === 'fade') ctx.globalAlpha = blend;
            else if (mode === 'slider') {
                ctx.beginPath();
                ctx.rect(this.width * blend, 0, this.width, this.height);
                ctx.clip();
            }
            ctx.drawImage(frames[1], 0, 0);
            ctx.restore();
            if (mode === 'slider') {
                ctx.fillStyle = '#119e91';
                ctx.fillRect(this.width * blend - 1, 0, 2, this.height);
            }
        }
        this.drawRegions();
        this.setZoom(this.zoom, false);
        this.app.summary(
            this.analysis
                ? `${this.analysis.changed.toLocaleString()} 个差异像素 · ${((this.analysis.changed / (this.width * this.height)) * 100).toFixed(2)}% · ${this.analysis.regionCount} 个区域`
                : `左 ${this.sources[0] ? '已载入' : '未选择'} · 右 ${this.sources[1] ? '已载入' : '未选择'}`
        );
    }
    renderChanges() {
        const target = document.querySelector('#image-change-list');
        target.replaceChildren();
        const regions = [...(this.analysis?.regions || []), ...this.manual];
        document.querySelector('#image-change-count').textContent = String(
            (this.analysis?.regionCount || 0) + this.manual.length
        );
        if (!regions.length) {
            const p = document.createElement('p');
            p.textContent = this.sources.every(Boolean) ? '当前容差下没有差异' : '选择另一张图片后自动分析';
            target.append(p);
        }
        for (const [index, r] of regions.entries()) {
            const card = document.createElement('button');
            card.className = 'change-card';
            const title = document.createElement('strong');
            title.textContent = (r.manual ? '关注区域 ' : '变更 ') + (index + 1);
            const text = document.createElement('span');
            text.textContent = `${Math.round(r.width)} × ${Math.round(r.height)} px · (${Math.round(r.x)}, ${Math.round(r.y)})`;
            card.append(title, text);
            card.onclick = () => {
                this.focusRegion = r;
                this.setZoom(
                    Math.min(
                        4,
                        Math.max(
                            0.1,
                            Math.min(
                                this.viewport.clientWidth / (r.width + 60),
                                this.viewport.clientHeight / (r.height + 60)
                            )
                        )
                    ),
                    false
                );
                this.viewport.scrollLeft = Math.max(0, (r.x + r.width / 2) * this.zoom - this.viewport.clientWidth / 2);
                this.viewport.scrollTop = Math.max(
                    0,
                    (r.y + r.height / 2) * this.zoom - this.viewport.clientHeight / 2
                );
                this.drawRegions();
            };
            if (r.manual) {
                const remove = document.createElement('span');
                remove.textContent = ' × 删除';
                remove.onclick = (e) => {
                    e.stopPropagation();
                    this.manual = this.manual.filter((v) => v !== r);
                    this.renderChanges();
                    this.drawRegions();
                };
                card.append(remove);
            }
            target.append(card);
        }
        if ((this.analysis?.regionCount || 0) > 200) {
            const p = document.createElement('p');
            p.textContent = '区域较多，仅列出前 200 个；像素统计覆盖全部画面。';
            target.append(p);
        }
    }
    drawRegions() {
        this.overlay.width = this.canvas.width;
        this.overlay.height = this.canvas.height;
        const ctx = this.overlay.getContext('2d');
        if (document.querySelector('#image-boxes').checked) {
            for (const r of [...(this.analysis?.regions || []), ...this.manual]) {
                ctx.strokeStyle = r.manual ? '#2681d5' : r === this.focusRegion ? '#119e91' : '#ef5d6f';
                ctx.lineWidth = 2 / Math.max(0.1, this.zoom);
                ctx.strokeRect(r.x, r.y, r.width, r.height);
                if (this.mode === 'split') ctx.strokeRect(r.x + this.width + 32, r.y, r.width, r.height);
            }
        }
        if (this.selection) {
            ctx.strokeStyle = '#2681d5';
            ctx.strokeRect(this.selection.x, this.selection.y, this.selection.width, this.selection.height);
        }
    }
    setZoom(value, manual = true) {
        if (manual) this.autoFit = false;
        this.zoom = Math.min(8, Math.max(0.03, value));
        for (const canvas of [this.canvas, this.overlay]) canvas.style.transform = `scale(${this.zoom})`;
        const surface = document.querySelector('#image-surface');
        surface.style.width = this.canvas.width * this.zoom + 'px';
        surface.style.height = this.canvas.height * this.zoom + 'px';
        document.querySelector('#zoom-value').textContent = Math.round(this.zoom * 100) + '%';
    }
    fit() {
        if (!this.canvas.width) return;
        this.autoFit = true;
        this.setZoom(
            Math.min(
                1,
                (this.viewport.clientWidth - 50) / this.canvas.width,
                (this.viewport.clientHeight - 40) / this.canvas.height
            ),
            false
        );
        this.viewport.scrollLeft = this.viewport.scrollTop = 0;
    }
    async align() {
        if (!this.sources.every(Boolean)) throw Error('请先选择两张图片');
        const generation = this.generation;
        const [a, b] = this.frames(),
            result = await this.compare(
                a.getContext('2d').getImageData(0, 0, a.width, a.height).data,
                b.getContext('2d').getImageData(0, 0, b.width, b.height).data,
                a.width,
                a.height,
                0,
                true
            );
        if (generation !== this.generation) return;
        this.offset.x += result.alignment.dx;
        this.offset.y += result.alignment.dy;
        this.analysis = null;
        this.transformRevision++;
        this.generation++;
        this.syncTools();
        await this.redraw(true);
        this.app.status('已按局部像素匹配估计平移，可在工具面板微调 X / Y');
    }
    async reset() {
        this.generation++;
        this.rotation = 0;
        this.flip = false;
        this.offset = { x: 0, y: 0 };
        this.analysis = null;
        this.ocrResults = null;
        this.manual = [];
        this.transformRevision++;
        this.syncTools();
        await this.redraw(true);
    }
    async recognize() {
        if (!this.sources.some(Boolean)) throw Error('请先载入图片');
        const generation = this.generation,
            frames = this.frames(),
            results = [];
        document.querySelector('#image-ocr').disabled = true;
        this.app.status('正在离线识别文字…');
        try {
            for (let side = 0; side < 2; side++) {
                if (!this.sources[side]) {
                    results.push(null);
                    continue;
                }
                const frame = frames[side],
                    scale = Math.min(1, Math.sqrt(4000000 / (frame.width * frame.height))),
                    image = document.createElement('canvas');
                image.width = Math.round(frame.width * scale);
                image.height = Math.round(frame.height * scale);
                const context = image.getContext('2d');
                context.fillStyle = 'white';
                context.fillRect(0, 0, image.width, image.height);
                context.drawImage(frame, 0, 0, image.width, image.height);
                const result = await this.app.api.invoke('ocr', {
                    image: image.toDataURL('image/png').split(',')[1],
                    side,
                    language: document.querySelector('#ocr-language').value
                });
                if (generation !== this.generation) return;
                results.push({
                    ...result,
                    width: image.width,
                    height: image.height,
                    image: image.toDataURL('image/png')
                });
            }
            this.ocrResults = results;
            await this.setMode(this.mode.startsWith('ocr') ? this.mode : 'ocr-rich');
            this.app.status('识别完成，请核对文字与置信度');
        } finally {
            document.querySelector('#image-ocr').disabled = false;
        }
    }
    renderOCR() {
        const target = document.querySelector('#ocr-result');
        target.replaceChildren();
        if (!this.ocrResults) {
            const box = document.createElement('div');
            box.className = 'ocr-empty';
            box.textContent = '尚未识别文字。点击左侧“识别两侧文字”，使用包内简体中文与英文字库离线处理。';
            target.append(box);
            return;
        }
        const toolbar = document.createElement('div');
        toolbar.className = 'ocr-toolbar';
        const button = document.createElement('button');
        button.textContent = '打开 OCR 文本 Diff';
        button.onclick = () =>
            this.app.safe(async () => {
                const values = this.ocrResults.map((r) => r?.text || '');
                await this.app.setMode('text');
                this.app.items = [null, null];
                await this.app.setTexts(values);
            });
        toolbar.append(button);
        target.append(toolbar);
        const pair = document.createElement('div');
        pair.className = 'ocr-pair';
        this.ocrResults.forEach((result, side) => {
            const section = document.createElement('section'),
                h = document.createElement('h3');
            h.textContent =
                (side ? '右侧' : '左侧') + (result ? ` · 置信度 ${Math.round(result.confidence)}%` : ' · 未选择');
            section.append(h);
            if (result) {
                if (this.mode === 'ocr-text') {
                    const pre = document.createElement('pre');
                    pre.textContent = result.text;
                    section.append(pre);
                } else {
                    const view = document.createElement('div');
                    view.className = 'ocr-rich';
                    view.style.aspectRatio = result.width + '/' + result.height;
                    const image = document.createElement('img');
                    image.src = result.image;
                    view.append(image);
                    for (const word of result.words) {
                        const span = document.createElement('span');
                        span.textContent = word.text;
                        span.title = `${word.text} · 置信度 ${word.confidence.toFixed(0)}%`;
                        span.style.cssText = `left:${(word.x / result.width) * 100}%;top:${(word.y / result.height) * 100}%;width:${(word.width / result.width) * 100}%;height:${(word.height / result.height) * 100}%;`;
                        view.append(span);
                    }
                    section.append(view);
                }
            }
            pair.append(section);
        });
        target.append(pair);
    }
    details() {
        const target = document.querySelector('#image-file-details');
        target.replaceChildren();
        const grid = document.createElement('div');
        grid.className = 'details-grid';
        this.loadedItems.forEach((item, side) => {
            const box = document.createElement('section'),
                h = document.createElement('h3');
            h.textContent = (side ? '右侧' : '左侧') + ' · ' + (item?.name || '未选择');
            box.append(h);
            for (const [label, value] of [
                ['路径', item?.path || '剪贴板图片'],
                [
                    '尺寸',
                    this.sources[side]
                        ? `${this.sources[side].naturalWidth} × ${this.sources[side].naturalHeight}`
                        : '—'
                ],
                ['大小', item?.size ? item.size.toLocaleString() + ' B' : '—'],
                ['修改时间', item?.modified ? new Date(item.modified).toLocaleString() : '—']
            ]) {
                const p = document.createElement('p');
                p.textContent = label + '：' + value;
                box.append(p);
            }
            grid.append(box);
        });
        target.append(grid);
    }
};
