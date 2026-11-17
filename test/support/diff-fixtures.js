const fs = require('node:fs'),
    path = require('node:path');
const { crc32 } = require('node:zlib');
function office(entries) {
    const local = [],
        central = [];
    let offset = 0;
    for (const [name, value] of Object.entries(entries)) {
        const filename = Buffer.from(name),
            data = Buffer.from(value),
            crc = crc32(data),
            header = Buffer.alloc(30),
            index = Buffer.alloc(46);
        header.writeUInt32LE(0x04034b50);
        header.writeUInt16LE(20, 4);
        header.writeUInt16LE(0x800, 6);
        header.writeUInt32LE(crc, 14);
        header.writeUInt32LE(data.length, 18);
        header.writeUInt32LE(data.length, 22);
        header.writeUInt16LE(filename.length, 26);
        index.writeUInt32LE(0x02014b50);
        index.writeUInt16LE(20, 4);
        index.writeUInt16LE(20, 6);
        index.writeUInt16LE(0x800, 8);
        index.writeUInt32LE(crc, 16);
        index.writeUInt32LE(data.length, 20);
        index.writeUInt32LE(data.length, 24);
        index.writeUInt16LE(filename.length, 28);
        index.writeUInt32LE(offset, 42);
        local.push(header, filename, data);
        central.push(index, filename);
        offset += header.length + filename.length + data.length;
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50);
    end.writeUInt16LE(Object.keys(entries).length, 8);
    end.writeUInt16LE(Object.keys(entries).length, 10);
    end.writeUInt32LE(
        central.reduce((n, b) => n + b.length, 0),
        12
    );
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...local, ...central, end]);
}
function create(directory) {
    fs.mkdirSync(directory, { recursive: true });
    const write = (name, bytes) => {
        const file = path.join(directory, name);
        fs.writeFileSync(file, bytes);
        return file;
    };
    const docx = (value) =>
        office({
            '[Content_Types].xml': '<Types/>',
            'word/document.xml': `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>合同：${value}</w:t></w:r></w:p><w:p><w:r><w:t>第二段 &amp; 安全</w:t></w:r></w:p></w:body></w:document>`
        });
    const pptx = (value) =>
        office({
            '[Content_Types].xml': '<Types/>',
            'ppt/presentation.xml':
                '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId r:id="rId1"/></p:sldIdLst><p:sldSz cx="9144000" cy="5143500"/></p:presentation>',
            'ppt/_rels/presentation.xml.rels':
                '<Relationships><Relationship Id="rId1" Target="slides/slide1.xml"/></Relationships>',
            'ppt/slides/slide1.xml': `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:spPr><a:xfrm><a:off x="600000" y="600000"/><a:ext cx="7000000" cy="1200000"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:rPr sz="2800"/><a:t>季度计划 ${value}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`
        });
    const xlsx = (value) =>
        office({
            '[Content_Types].xml':
                '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
            '_rels/.rels':
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
            'xl/workbook.xml':
                '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Budget" sheetId="1" r:id="rId1"/></sheets></workbook>',
            'xl/_rels/workbook.xml.rels':
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
            'xl/worksheets/sheet1.xml': `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:B2"/><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Amount</t></is></c><c r="B1"><v>${value}</v></c></row><row r="2"><c r="A2"><f>B1*2</f><v>${value * 2}</v></c></row></sheetData></worksheet>`
        });
    const files = {
        left: write('before.js', 'const budget = 100;\n// 本地对比\n'),
        right: write('after.js', 'const budget = 120;\n// 本地对比\nconst approved = true;\n'),
        docxLeft: write('before.docx', docx(100)),
        docxRight: write('after.docx', docx(120)),
        pptxLeft: write('before.pptx', pptx(100)),
        pptxRight: write('after.pptx', pptx(120)),
        xlsxLeft: write('before.xlsx', xlsx(100)),
        xlsxRight: write('after.xlsx', xlsx(120))
    };
    const left = path.join(directory, 'left'),
        right = path.join(directory, 'right');
    for (const root of [left, right]) fs.mkdirSync(path.join(root, 'nested'), { recursive: true });
    const time = new Date('2026-01-01T00:00:00Z');
    for (const root of [left, right]) {
        fs.writeFileSync(path.join(root, 'same.txt'), 'same');
        fs.utimesSync(path.join(root, 'same.txt'), time, time);
    }
    fs.writeFileSync(path.join(left, 'nested', 'changed.txt'), 'AAAA');
    fs.writeFileSync(path.join(right, 'nested', 'changed.txt'), 'BBBB');
    for (const root of [left, right]) fs.utimesSync(path.join(root, 'nested', 'changed.txt'), time, time);
    fs.writeFileSync(path.join(left, 'removed.txt'), 'removed');
    fs.writeFileSync(path.join(right, 'added.txt'), 'added');
    fs.writeFileSync(path.join(left, 'type'), 'text');
    fs.mkdirSync(path.join(right, 'type'));
    return { ...files, roots: [left, right] };
}
module.exports = { create, office };
