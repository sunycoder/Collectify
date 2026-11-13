const fs = require('node:fs'),
    path = require('node:path'),
    zlib = require('node:zlib'),
    { execFileSync } = require('node:child_process');
const { zipSync } = require('../build-tools/local-search-deps/node_modules/fflate');
const output = path.resolve(__dirname, '../test/fixtures/local-search');
fs.mkdirSync(output, { recursive: true });
const zip = (files) =>
    Buffer.from(
        zipSync(Object.fromEntries(Object.entries(files).map(([name, value]) => [name, Buffer.from(value)])), {
            level: 0
        })
    );
fs.writeFileSync(
    path.join(output, 'readme.txt'),
    '本地搜索预览测试\n<script>throw Error("must not execute")</script>\n'
);
fs.writeFileSync(path.join(output, 'table.csv'), '名称,数量\n测试,3\n');
fs.writeFileSync(
    path.join(output, 'sample.xlsx'),
    zip({
        '[Content_Types].xml':
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
        '_rels/.rels':
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
        'xl/workbook.xml':
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="示例表" sheetId="1" r:id="rId1"/></sheets></workbook>',
        'xl/_rels/workbook.xml.rels':
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
        'xl/worksheets/sheet1.xml':
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:B2"/><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>名称</t></is></c><c r="B1" t="inlineStr"><is><t>数量</t></is></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>测试</t></is></c><c r="B2"><v>3</v></c></row></sheetData></worksheet>'
    })
);
fs.writeFileSync(
    path.join(output, 'sample.docx'),
    zip({
        '[Content_Types].xml':
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
        '_rels/.rels':
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
        'word/document.xml':
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>文档预览测试</w:t></w:r></w:p></w:body></w:document>'
    })
);
const XLSX = require('../build-tools/sheetjs/package/xlsx.js'),
    book = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(
    book,
    XLSX.utils.aoa_to_sheet([
        ['名称', '数量'],
        ['测试', 3]
    ]),
    '示例表'
);
XLSX.writeFile(book, path.join(output, 'sample.xls'), { bookType: 'biff8' });
fs.writeFileSync(
    path.join(output, 'sample.zip'),
    zip({ 'folder/readme.txt': 'archive test', 'hello,世界.txt': '中文文件名' })
);
fs.writeFileSync(path.join(output, 'sample.gz'), zlib.gzipSync(Buffer.from('compressed test')));
const psd = Buffer.alloc(26 + 12 + 2 + 3);
psd.write('8BPS');
psd.writeUInt16BE(1, 4);
psd.writeUInt16BE(3, 12);
psd.writeUInt32BE(1, 14);
psd.writeUInt32BE(1, 18);
psd.writeUInt16BE(8, 22);
psd.writeUInt16BE(3, 24);
psd[40] = 255;
fs.writeFileSync(path.join(output, 'sample.psd'), psd);
fs.writeFileSync(
    path.join(output, 'sample.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="160" height="100"><rect width="160" height="100" fill="#dce8ff"/><circle cx="80" cy="50" r="25" fill="#3975e8"/></svg>'
);
fs.writeFileSync(
    path.join(output, 'sample.png'),
    Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aAXsAAAAASUVORK5CYII=',
        'base64'
    )
);
const wav = Buffer.alloc(44 + 1600);
wav.write('RIFF');
wav.writeUInt32LE(wav.length - 8, 4);
wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(8000, 24);
wav.writeUInt32LE(16000, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write('data', 36);
wav.writeUInt32LE(1600, 40);
fs.writeFileSync(path.join(output, 'sample.wav'), wav);
const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Length 46 >>\nstream\nBT /F1 18 Tf 30 120 Td (Local search PDF) Tj ET\nendstream'
];
let pdf = '%PDF-1.4\n',
    offsets = [0];
objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
});
const xref = Buffer.byteLength(pdf);
pdf +=
    `xref\n0 6\n0000000000 65535 f \n` +
    offsets
        .slice(1)
        .map((offset) => String(offset).padStart(10, '0') + ' 00000 n \n')
        .join('') +
    `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
fs.writeFileSync(path.join(output, 'sample.pdf'), pdf);
fs.writeFileSync(path.join(output, 'sample.ai'), pdf);
const seven = path.resolve(__dirname, '../src/plugins/local-search/vendor/native/7z.exe');
if (process.platform === 'win32')
    execFileSync(seven, ['a', path.join(output, 'sample.7z'), path.join(output, 'readme.txt')], {
        windowsHide: true,
        stdio: 'ignore'
    });
console.log('Local-search fixture files created.');
