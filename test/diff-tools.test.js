const { test } = require('node:test'),
    assert = require('node:assert/strict'),
    fs = require('node:fs'),
    path = require('node:path'),
    vm = require('node:vm');
const M = require('../src/plugin-library/diff/sheet-model');
const sheet = (rows) => ({ name: 'Data', rows: rows.map((row) => row.map((v) => ({ v: String(v), f: '' }))) });
test('表格可按表头映射调换列、重复表头不丢失，保留原坐标', () => {
    const pair = [
        sheet([
            ['ID', 'Name', 'Name'],
            [1, 'A', 'B']
        ]),
        sheet([
            ['Name', 'ID', 'Name'],
            ['A', 1, 'C']
        ])
    ];
    const result = M.build(pair, { matchHeaders: true });
    assert.equal(result.changes.length, 1);
    assert.equal(result.changes[0].leftAddress, 'C2');
    assert.equal(result.changes[0].rightAddress, 'C2');
    assert.equal(result.changes[0].before, 'B');
    assert.ok(M.build(pair).changes.length > 1);
});
test('表格忽略选项、隐藏未更改行列、公式与日期模式参与真实比较', () => {
    const pair = [
        sheet([
            ['Key', 'Value', 'Date'],
            ['ABC', 'x y', '12/31/2026'],
            ['same', 'same', 'same']
        ]),
        sheet([
            ['Key', 'Value', 'Date'],
            ['abc', 'xy', '2026-12-31'],
            ['same', 'same', 'same']
        ])
    ];
    assert.equal(M.build(pair).changes.length, 3);
    assert.equal(M.build(pair, { ignoreCase: true, ignoreSpace: true, date: 'US' }).changes.length, 0);
    const filtered = M.build(pair, { hideRows: true, hideCols: true });
    assert.deepEqual(filtered.rows, [1]);
    assert.deepEqual(filtered.cols, [0, 1, 2]);
    const a = sheet([[10]]),
        b = sheet([[10]]);
    a.rows[0][0].f = 'A1*2';
    b.rows[0][0].f = 'A1+5';
    assert.equal(M.build([a, b]).changes.length, 0);
    assert.equal(M.build([a, b], { mode: 'formulas' }).changes.length, 1);
    assert.equal(M.date('31/12/2026', 'EU'), '2026-12-31');
    assert.equal(M.date('31/02/2026', 'EU'), '31/02/2026');
    assert.equal(M.value({ v: 0 }, { mode: 'values' }), '0');
});
test('表格排序不更改输入、空表和 CSV 换行引号保留', () => {
    const pair = [sheet([['ID'], [2], [1]]), sheet([['ID'], [1], [2]])],
        before = JSON.stringify(pair);
    assert.equal(M.build(pair, { sortRows: 'asc' }).changes.length, 0);
    assert.equal(JSON.stringify(pair), before);
    assert.equal(M.build([undefined, undefined]).changes.length, 0);
    assert.equal(M.csv([['a"b', 'x\ny']]), '\ufeff"a""b","x\ny"');
});
test('业务键配对忽略插行和重排，区分新增删除修改并保留原始坐标', () => {
    const pair = [
        sheet([
            ['ID', 'Name'],
            [1, 'A'],
            [2, 'B'],
            [3, 'C']
        ]),
        sheet([
            ['ID', 'Name'],
            [3, 'C'],
            [2, 'B2'],
            [4, 'D'],
            [1, 'A']
        ])
    ];
    const before = JSON.stringify(pair),
        result = M.build(pair, { keyColumns: [{ left: 0, right: 0 }] });
    assert.equal(result.keyActive, true);
    assert.deepEqual(result.rowStats, { left: 0, right: 1, matched: 3, changed: 1 });
    assert.equal(result.changes.length, 3);
    assert.deepEqual(
        result.changes.find((c) => c.state === 'changed'),
        { row: 2, col: 1, before: 'B', after: 'B2', state: 'changed', leftAddress: 'B3', rightAddress: 'B3' }
    );
    assert.equal(result.sides[1][1].index, 4);
    assert.equal(result.sides[1][3].index, 1);
    assert.equal(JSON.stringify(pair), before);
    const removed = M.build([pair[1], pair[0]], { keyColumns: [{ left: 0, right: 0 }] });
    assert.equal(removed.rowStats.left, 1);
    assert.equal(removed.changes.filter((c) => c.state === 'left').length, 2);
});
test('组合键按多列匹配，列移动、公式模式和忽略选项不会改变键取值语义', () => {
    const pair = [
        sheet([
            ['ID', 'Type', 'Value'],
            ['a', 1, 10],
            ['a', 2, 20]
        ]),
        sheet([
            ['Type', 'Value', 'ID'],
            [2, 22, 'A'],
            [1, 10, 'A']
        ])
    ];
    const result = M.build(pair, {
        matchHeaders: true,
        ignoreCase: true,
        keyColumns: [
            { left: 0, right: 2 },
            { left: 1, right: 0 }
        ]
    });
    assert.equal(result.rowStats.matched, 2);
    assert.equal(result.changes.length, 1);
    assert.equal(result.changes[0].leftAddress, 'C3');
    assert.equal(result.changes[0].rightAddress, 'B2');
    const collision = M.build(
        [
            sheet([
                ['A', 'B'],
                ['a|b', 'c'],
                ['a', 'b|c']
            ]),
            sheet([
                ['A', 'B'],
                ['a', 'b|c'],
                ['a|b', 'c']
            ])
        ],
        {
            keyColumns: [
                { left: 0, right: 0 },
                { left: 1, right: 1 }
            ]
        }
    );
    assert.equal(collision.changes.length, 0);
    assert.equal(collision.rowStats.matched, 2);
    pair[0].rows[1][0].f = '1+2';
    const formulas = M.build([pair[0], pair[0]], {
        mode: 'formulas',
        keyColumns: [
            { left: 0, right: 0 },
            { left: 1, right: 1 }
        ]
    });
    assert.equal(formulas.rowStats.matched, 2);
});
test('重复键和空键显式诊断且不强行配对，缺少键列时回退并给出诊断', () => {
    const pair = [
        sheet([
            ['ID', 'V'],
            [1, 'a'],
            [1, 'b'],
            ['', 'c'],
            [0, 'z']
        ]),
        sheet([
            ['ID', 'V'],
            [1, 'a'],
            ['', 'c'],
            [0, 'z']
        ])
    ];
    const result = M.build(pair, { keyColumns: [{ left: 0, right: 0 }] });
    assert.equal(result.rowStats.matched, 1);
    assert.equal(result.keyIssues.filter((i) => i.kind === 'duplicate').length, 3);
    assert.equal(result.keyIssues.filter((i) => i.kind === 'blank').length, 2);
    assert.equal(result.keyIssues.find((i) => i.kind === 'blank').row, 4);
    assert.ok(result.changes.length > 0);
    const unavailable = M.build([pair[0], undefined], { keyColumns: [{ left: 0, right: 0 }] });
    assert.equal(unavailable.keyActive, false);
    assert.deepEqual(unavailable.keyIssues, [{ kind: 'unavailable' }]);
    assert.ok(unavailable.changes.length > 0);
});
function pixels(a, b, width, height, threshold = 0) {
    let output;
    const scope = {
        self: { postMessage: (value) => (output = value) },
        Uint8ClampedArray,
        Uint32Array,
        Math,
        Array,
        Number,
        Error
    };
    vm.runInNewContext(
        fs.readFileSync(path.resolve(__dirname, '../src/plugin-library/diff/pixel-worker.js'), 'utf8'),
        scope
    );
    scope.self.onmessage({ data: { id: 1, left: a.buffer, right: b.buffer, width, height, threshold } });
    return output;
}
test('图片区域统计覆盖独立像素、容差和绝对相减，透明度变化也计入差异', () => {
    const width = 120,
        height = 80,
        a = new Uint8ClampedArray(width * height * 4).fill(255),
        b = new Uint8ClampedArray(a);
    b[0] = 0;
    b[(60 * width + 100) * 4 + 3] = 0;
    const result = pixels(a, b, width, height);
    assert.equal(result.changed, 2);
    assert.equal(result.regions.length, 2);
    assert.equal(result.regionCount, 2);
    assert.equal(
        result.regions.reduce((sum, r) => sum + r.pixels, 0),
        2
    );
    assert.equal(new Uint8ClampedArray(result.subtract)[0], 255);
    const small = new Uint8ClampedArray(a);
    small[0] = 250;
    assert.equal(pixels(a, small, width, height, 10).changed, 0);
});
