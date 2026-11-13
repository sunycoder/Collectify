const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs');
const { unzipSync, zlibSync } = require('fflate');
function zipBounds(bytes) {
    let total = 0,
        count = 0;
    unzipSync(bytes, {
        filter: (entry) => {
            total += entry.originalSize;
            if (++count > 3000 || total > 48 * 1024 * 1024 || entry.originalSize > 24 * 1024 * 1024)
                throw Error('文档展开后过大，已停止预览');
            return false;
        }
    });
}
function png(width, height, rgba) {
    const crc = (bytes) => {
        let c = 0xffffffff;
        for (const b of bytes) {
            c ^= b;
            for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
        }
        return (c ^ 0xffffffff) >>> 0;
    };
    const chunk = (type, data) => {
        const out = Buffer.alloc(data.length + 12);
        out.writeUInt32BE(data.length);
        out.write(type, 4);
        data.copy(out, 8);
        out.writeUInt32BE(crc(out.subarray(4, 8 + data.length)), 8 + data.length);
        return out;
    };
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width);
    header.writeUInt32BE(height, 4);
    header[8] = 8;
    header[9] = 6;
    const rows = Buffer.alloc(height * (width * 4 + 1));
    for (let y = 0; y < height; y++)
        Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(rows, y * (width * 4 + 1) + 1);
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk('IHDR', header),
        chunk('IDAT', Buffer.from(zlibSync(rows))),
        chunk('IEND', Buffer.alloc(0))
    ]);
}
async function preview() {
    const { file, type, sheetIndex = 0 } = workerData,
        bytes = fs.readFileSync(file);
    if (['xlsx', 'docx'].includes(type)) zipBounds(bytes);
    if (['xlsx', 'xls', 'csv'].includes(type)) {
        const XLSX = require('xlsx');
        const names = XLSX.read(bytes, { type: 'buffer', bookSheets: true }).SheetNames.slice(0, 50);
        const selected = Math.max(0, Math.min(names.length - 1, Number(sheetIndex) || 0));
        const book = XLSX.read(bytes, {
            type: 'buffer',
            sheets: selected,
            sheetRows: 201,
            cellFormula: false,
            cellHTML: false,
            cellStyles: false,
            bookVBA: false
        });
        const rows = XLSX.utils
            .sheet_to_json(book.Sheets[names[selected]], { header: 1, raw: false, defval: '', blankrows: true })
            .slice(0, 200)
            .map((row) => row.slice(0, 40).map((cell) => String(cell).slice(0, 512)));
        return { kind: 'table', sheets: names, selected, rows, truncated: true };
    }
    if (type === 'docx') {
        const result = await require('mammoth').extractRawText({ buffer: bytes });
        return {
            kind: 'text',
            text: result.value.slice(0, 300000),
            truncated: result.value.length > 300000,
            format: 'Word 文档'
        };
    }
    if (type === 'psd') {
        if (bytes.length < 26 || bytes.toString('ascii', 0, 4) !== '8BPS') throw Error('PSD 文件头无效');
        const height = bytes.readUInt32BE(14),
            width = bytes.readUInt32BE(18);
        if (width * height > 16000000) throw Error('PSD 像素超过 1600 万，使用外部程序打开');
        const reader = require('ag-psd');
        reader.initializeCanvas(
            () => {
                throw Error('PSD 画布不可用');
            },
            (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) })
        );
        const psd = reader.readPsd(bytes, { skipLayerImageData: true, skipThumbnail: true, useImageData: true });
        if (!psd.imageData) throw Error('PSD 没有合成预览图，请在 Photoshop 保存时启用兼容预览');
        return { kind: 'image', data: png(width, height, psd.imageData.data).toString('base64'), width, height };
    }
    throw Error('文档格式暂不支持内容预览');
}
preview().then(
    (result) => parentPort.postMessage({ result }),
    (error) => parentPort.postMessage({ error: error.message })
);
