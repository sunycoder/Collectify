const { parentPort, workerData } = require('node:worker_threads');
const path = require('node:path');
const { unzipSync } = require('fflate');
const { XMLParser } = require('fast-xml-parser');
const { diffLines, diffChars } = require('diff');
const M = require('./model');
const xml = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@',
    processEntities: false,
    trimValues: false
});
const array = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
const entities = (value) =>
    String(value).replace(/&(amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi, (match, name) => {
        const predefined = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
        if (predefined[name]) return predefined[name];
        const point = name.startsWith('#x') ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
        return Number.isInteger(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : match;
    });
function text(node) {
    if (node == null) return '';
    if (typeof node !== 'object') return String(node);
    return Object.entries(node)
        .filter(([k]) => !k.startsWith('@'))
        .map(([k, v]) =>
            k === 'w:t' || k === 'a:t'
                ? array(v)
                      .map((x) => entities(typeof x === 'object' ? x['#text'] || '' : x))
                      .join('')
                : k === 'w:tab'
                  ? '\t'
                  : k === 'w:br'
                    ? '\n'
                    : array(v)
                          .map(text)
                          .join(k === 'w:p' || k === 'a:p' ? '\n' : '')
        )
        .join('');
}
function unzip(bytes) {
    let total = 0,
        count = 0;
    unzipSync(bytes, {
        filter: (e) => {
            total += e.originalSize;
            if (++count > 5000 || total > 64 * 1024 * 1024 || e.originalSize > 32 * 1024 * 1024)
                throw Error('Office 文件解压内容超过安全限制');
            return false;
        }
    });
    const zip = unzipSync(bytes);
    for (const v of Object.values(zip)) if (v.length > 32 * 1024 * 1024) throw Error('Office 单项过大');
    return zip;
}
function xmlFile(zip, name) {
    if (!zip[name]) throw Error('文档缺少 ' + name);
    return xml.parse(new TextDecoder().decode(zip[name]));
}
function slides(zip) {
    const presentation = xmlFile(zip, 'ppt/presentation.xml')['p:presentation'],
        size = presentation['p:sldSz'] || {};
    const relations = array(xmlFile(zip, 'ppt/_rels/presentation.xml.rels').Relationships.Relationship),
        map = new Map(relations.map((r) => [r['@Id'], r['@Target']]));
    const slideNames = array(presentation['p:sldIdLst']?.['p:sldId']).map((s) =>
        path.posix.normalize('ppt/' + map.get(s['@r:id']))
    );
    if (slideNames.length > 300) throw Error('幻灯片超过 300 页');
    return {
        kind: 'slides',
        width: Number(size['@cx']) || 9144000,
        height: Number(size['@cy']) || 5143500,
        slides: slideNames.map((name, index) => {
            const doc = xmlFile(zip, name)['p:sld'],
                tree = doc['p:cSld']?.['p:spTree'] || {},
                shapes = [];
            const relName = path.posix.join(path.posix.dirname(name), '_rels', path.posix.basename(name) + '.rels');
            const rels = zip[relName] ? array(xmlFile(zip, relName).Relationships.Relationship) : [];
            for (const shape of [...array(tree['p:sp']), ...array(tree['p:pic'])]) {
                const props = shape['p:spPr'] || {},
                    transform = props['a:xfrm'] || {},
                    off = transform['a:off'] || {},
                    ext = transform['a:ext'] || {};
                const paragraphs = array(shape['p:txBody']?.['a:p']),
                    first = array(paragraphs[0]?.['a:r'])[0]?.['a:rPr'] || {};
                const record = {
                    x: Number(off['@x']) || 0,
                    y: Number(off['@y']) || 0,
                    w: Number(ext['@cx']) || 4000000,
                    h: Number(ext['@cy']) || 600000,
                    text: text(shape['p:txBody']),
                    size: Number(first['@sz']) / 100 || 20,
                    color: first['a:solidFill']?.['a:srgbClr']?.['@val'],
                    fill: props['a:solidFill']?.['a:srgbClr']?.['@val']
                };
                const ref = shape['p:blipFill']?.['a:blip']?.['@r:embed'],
                    rel = rels.find((r) => r['@Id'] === ref);
                if (rel && rel['@TargetMode'] !== 'External') {
                    const imageName = path.posix.normalize(path.posix.dirname(name) + '/' + rel['@Target']),
                        mime = M.IMAGES[path.extname(imageName).toLowerCase()];
                    if (mime && zip[imageName])
                        record.image = 'data:' + mime + ';base64,' + Buffer.from(zip[imageName]).toString('base64');
                }
                shapes.push(record);
            }
            return {
                index,
                text: text(tree),
                shapes
            };
        }),
        note: '基础幻灯片预览：显示文本、图片与基础位置；母版、图表、SmartArt、动画和复杂样式不保证还原。文本差异按原始幻灯片内容计算。'
    };
}
async function parse(file) {
    const bytes = await M.readFile(file),
        ext = path.extname(file).toLowerCase();
    if (ext === '.docx') {
        const zip = unzip(bytes);
        return {
            kind: 'text',
            text: text(xmlFile(zip, 'word/document.xml')),
            language: 'plaintext',
            note: 'Word 仅比较正文文本，不检测样式或图片。'
        };
    }
    if (ext === '.pptx') return slides(unzip(bytes));
    if (['.xlsx', '.xls', '.csv'].includes(ext)) {
        if (ext === '.xlsx') unzip(bytes);
        const XLSX = require('xlsx'),
            book = XLSX.read(bytes, {
                type: 'buffer',
                cellFormula: true,
                cellHTML: false,
                bookVBA: false,
                cellStyles: true,
                cellNF: true
            });
        if (book.SheetNames.length > 100) throw Error('工作表超过 100 张');
        let total = 0;
        return {
            kind: 'sheet',
            sheets: book.SheetNames.map((name) => {
                const sheet = book.Sheets[name],
                    range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
                if ((range.e.r + 1) * (range.e.c + 1) > 250000 || range.e.c >= 1000 || range.e.r >= 50000)
                    throw Error('单表超过 25 万单元格、1000 列或 50000 行');
                total += (range.e.r + 1) * (range.e.c + 1);
                if (total > 500000) throw Error('工作簿超过 50 万单元格');
                const rows = [];
                for (let r = 0; r <= range.e.r; r++) {
                    const row = [];
                    for (let c = 0; c <= range.e.c; c++) {
                        const cell = sheet[XLSX.utils.encode_cell({ r, c })];
                        row.push({
                            v: cell ? String(cell.w ?? cell.v ?? '') : '',
                            f: cell?.f || '',
                            z: cell?.z || '',
                            s: cell?.s || null
                        });
                    }
                    rows.push(row);
                }
                return { name, rows };
            }),
            note: '按工作表名称与单元格坐标对比显示值或公式，不执行宏、公式或外部链接。'
        };
    }
    const value = M.decode(bytes);
    if (value.length > 2000000) throw Error('文本超过 200 万字符，请选择较小文件');
    return { kind: 'text', text: value, language: M.language(file) };
}
async function run(job) {
    if (job.action === 'scan') return M.scan(job.data, (data) => parentPort?.postMessage({ progress: data }));
    if (job.action === 'parse') return parse(job.data.file);
    if (job.action === 'report') {
        const report = { ...job.data };
        if (typeof report.before === 'string' && typeof report.after === 'string') {
            if (report.before.length + report.after.length > 4000000) throw Error('报告文本超过限制');
            const opts = { timeout: 2000, maxEditLength: 20000 };
            report.parts = (report.precision === 'character' ? diffChars : diffLines)(
                report.before,
                report.after,
                opts
            );
            if (!report.parts) throw Error('差异过多，报告计算已停止，请缩小内容');
            delete report.before;
            delete report.after;
        }
        return { report, html: M.reportHTML(report) };
    }
    throw Error('未知工作任务');
}
if (parentPort)
    run(workerData)
        .then((result) => parentPort.postMessage({ result }))
        .catch((e) => parentPort.postMessage({ error: e.message }));
module.exports = { run, parse, slides, unzip };
