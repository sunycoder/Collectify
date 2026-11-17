// 像素比较离开 UI 线程；返回可转移的缓冲区，不在工作线程内生成图片或访问网络。
self.onmessage = ({ data: { id, left, right, width, height, threshold = 16, align = false } }) => {
    const a = new Uint8ClampedArray(left),
        b = new Uint8ClampedArray(right),
        out = new Uint8ClampedArray(a.length);
    if (align) {
        let best = { error: Infinity, dx: 0, dy: 0 };
        const step = Math.max(1, Math.floor(Math.max(width, height) / 96)),
            radius = 8;
        for (let oy = -radius; oy <= radius; oy++)
            for (let ox = -radius; ox <= radius; ox++) {
                let sum = 0,
                    count = 0;
                for (let y = radius; y < Math.ceil(height / step) - radius; y += 2)
                    for (let x = radius; x < Math.ceil(width / step) - radius; x += 2) {
                        const ai = (Math.min(height - 1, y * step) * width + Math.min(width - 1, x * step)) * 4,
                            bi =
                                (Math.min(height - 1, (y - oy) * step) * width + Math.min(width - 1, (x - ox) * step)) *
                                4;
                        if (!a[ai + 3] || !b[bi + 3]) continue;
                        sum +=
                            Math.abs(a[ai] - b[bi]) + Math.abs(a[ai + 1] - b[bi + 1]) + Math.abs(a[ai + 2] - b[bi + 2]);
                        count++;
                    }
                const error = count ? sum / count : Infinity;
                if (
                    error < best.error - 0.01 ||
                    (Math.abs(error - best.error) < 0.01 &&
                        Math.abs(ox) + Math.abs(oy) < Math.abs(best.dx / step) + Math.abs(best.dy / step))
                )
                    best = { error, dx: ox * step, dy: oy * step };
            }
        self.postMessage({ id, alignment: best });
        return;
    }
    const subtract = new Uint8ClampedArray(a.length),
        tile = 12,
        cols = Math.ceil(width / tile),
        rows = Math.ceil(height / tile),
        grid = new Uint32Array(cols * rows);
    let changed = 0;
    for (let i = 0; i < a.length; i += 4) {
        let delta = 0;
        for (let c = 0; c < 4; c++) delta = Math.max(delta, Math.abs(a[i + c] - b[i + c]));
        if (delta > threshold) {
            changed++;
            const p = i / 4;
            grid[Math.floor(Math.floor(p / width) / tile) * cols + Math.floor((p % width) / tile)]++;
            out[i] = 244;
            out[i + 1] = 76;
            out[i + 2] = 97;
            out[i + 3] = 220;
        } else {
            const gray = Math.round(a[i] * 0.21 + a[i + 1] * 0.72 + a[i + 2] * 0.07);
            out[i] = out[i + 1] = out[i + 2] = gray;
            out[i + 3] = Math.min(a[i + 3], b[i + 3]) * 0.45;
        }
        for (let c = 0; c < 3; c++)
            subtract[i + c] = Math.max(Math.abs(a[i + c] - b[i + c]), Math.abs(a[i + 3] - b[i + 3]));
        subtract[i + 3] = 255;
    }
    const regions = [];
    for (let index = 0; index < grid.length; index++) {
        if (!grid[index]) continue;
        const queue = [index];
        let head = 0,
            minX = cols,
            minY = rows,
            maxX = 0,
            maxY = 0,
            pixels = grid[index];
        grid[index] = 0;
        while (head < queue.length) {
            const p = queue[head++],
                x = p % cols,
                y = Math.floor(p / cols);
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
            for (const [nx, ny] of [
                [x - 1, y],
                [x + 1, y],
                [x, y - 1],
                [x, y + 1]
            ]) {
                if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
                const q = ny * cols + nx;
                if (grid[q]) {
                    pixels += grid[q];
                    grid[q] = 0;
                    queue.push(q);
                }
            }
        }
        regions.push({
            x: minX * tile,
            y: minY * tile,
            width: Math.min(width, (maxX + 1) * tile) - minX * tile,
            height: Math.min(height, (maxY + 1) * tile) - minY * tile,
            pixels
        });
    }
    regions.sort((x, y) => x.y - y.y || x.x - y.x);
    self.postMessage(
        {
            id,
            width,
            height,
            changed,
            regions: regions.slice(0, 200),
            regionCount: regions.length,
            pixels: out.buffer,
            subtract: subtract.buffer
        },
        [out.buffer, subtract.buffer]
    );
};
