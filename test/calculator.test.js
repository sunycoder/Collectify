const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'),
    path = require('node:path'),
    os = require('node:os'),
    vm = require('node:vm');
const engine = require('../src/plugin-library/calculator/engine');
const model = require('../src/plugin-library/calculator/model');
const value = (formula) => engine.format(engine.evaluate(formula), false).text;
test('计算稿纸截图公式、十进制四则运算及运算符优先级正确，大整数不丢失', () => {
    for (const [formula, result] of [
        ['55+88+7689*543', '4175270'],
        ['4270-55+855+5525+88+66+4556+3.25*9825-5875/5+85+5369.55+83.45', '51599.25'],
        ['2^5+888+99x878.467', '87888.233'],
        ['0.1+0.2', '0.3'],
        ['0.3-0.1', '0.2'],
        ['0.1*0.2', '0.02'],
        ['0.3/0.1', '3'],
        ['9007199254740993+1', '9007199254740994'],
        ['1e-5*1e5', '1'],
        ['2^3^2', '512'],
        ['-2^2', '-4'],
        ['(-2)^2', '4'],
        ['2^-2', '0.25'],
        ['17%5', '2'],
        ['-17%5', '-2'],
        ['8÷2×3', '12'],
        ['2 ** 10', '1024'],
        ['.25+.5', '0.75']
    ])
        assert.equal(value(formula), result, formula);
    assert.equal(engine.format(engine.evaluate('1/3')).approximate, true);
    assert.equal(engine.format(engine.evaluate('1e-20')).approximate, true);
});
test('常用函数、定义域、取整及三角函数弧度计算正确', () => {
    for (const [formula, result] of [
        ['sqrt(144)', '12'],
        ['cbrt(27)', '3'],
        ['hypot(3,4)', '5'],
        ['abs(-3.14)', '3.14'],
        ['ceil(-3.7)', '-3'],
        ['floor(-3.7)', '-4'],
        ['round(-1.5)', '-1'],
        ['round(4.567)', '5'],
        ['trunc(-3.7)', '-3'],
        ['min(1200,850,960)', '850'],
        ['max(1200,850,960)', '1200'],
        ['log10(1000)', '3'],
        ['log2(1024)', '10'],
        ['pow(2,10)', '1024'],
        ['sin(PI/6)', '0.5'],
        ['cos(PI/3)', '0.5'],
        ['tan(PI/4)', '1']
    ])
        assert.equal(value(formula), result, formula);
    assert.ok(Math.abs(engine.evaluate('atan2(1,1)*4').number() - Math.PI) < 1e-12);
    for (const formula of [
        'sqrt(-1)',
        'log(0)',
        '1/0',
        '1%0',
        '0^-1',
        'pow(-1,0.5)',
        'exp(1000)',
        'ceil(1,2)',
        'min()',
        'unknown(1)',
        'pow(2)'
    ])
        assert.throws(() => engine.evaluate(formula), undefined, formula);
});
test('行引用只允许前面已有的有效结果；编辑、删除、空行和错误不会复用过期值', () => {
    const rows = ['1+2', 'ans*2', '_1+_2', '(_1+_2+_3)/3'].map((expression) => ({ expression }));
    assert.deepEqual(
        engine.calculate(rows).map((x) => x.text),
        ['3', '6', '9', '6']
    );
    rows[0].expression = '10';
    assert.deepEqual(
        engine.calculate(rows).map((x) => x.text),
        ['10', '20', '30', '20']
    );
    rows[0].expression = '1/0';
    assert.ok(engine.calculate(rows).every((x) => x.error));
    assert.match(
        engine.calculate([{ expression: '2' }, { expression: '' }, { expression: 'ans+1' }])[2].error,
        /第 2 行/
    );
    assert.match(engine.calculate([{ expression: '_1+2' }])[0].error, /前面/);
    assert.match(engine.calculate([{ expression: '1' }, { expression: '_3' }])[1].error, /前面/);
    const changed = engine.calculate([{ expression: '3' }, { expression: '_1*2' }]);
    assert.equal(changed[1].text, '6');
});
test('公式解析不执行脚本，拒绝属性访问、赋值、未知字符与过量计算', () => {
    for (const formula of [
        'globalThis.process.exit()',
        'constructor.constructor("return 1")()',
        'alert(1)',
        '1;2',
        'a=1',
        '[1,2]',
        '2(3)',
        '2+',
        '(1+2',
        '1..2',
        '2**',
        '999^99999',
        '9^999',
        '1e999',
        '('.repeat(100) + '1' + ')'.repeat(100),
        '1+'.repeat(501) + '1'
    ])
        assert.throws(() => engine.evaluate(formula), undefined, formula.slice(0, 40));
    const scope = { window: {} };
    vm.runInNewContext(
        fs.readFileSync(path.resolve(__dirname, '../src/plugin-library/calculator/examples.js'), 'utf8'),
        scope
    );
    const exampleRows = [{ expression: '100' }, { expression: '200' }, { expression: '300' }];
    for (const group of scope.window.CalcExamples)
        for (const [formula] of group.items) {
            exampleRows.push({ expression: formula });
            assert.equal(engine.calculate(exampleRows).at(-1).error, undefined, formula);
        }
});
test('保存队列提交调用时快照，按序落库，失败后可重试并明确报告', async () => {
    const jobs = [],
        states = [],
        written = [];
    const saver = model.createSaver(
        {
            batch: (snapshot) =>
                new Promise((resolve, reject) =>
                    jobs.push({
                        snapshot,
                        resolve: () => {
                            written.push(snapshot);
                            resolve();
                        },
                        reject
                    })
                )
        },
        (...s) => states.push(s)
    );
    const batch = { set: { x: { value: 1 } } };
    const first = saver.save(batch);
    batch.set.x.value = 2;
    const second = saver.save(batch);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].snapshot.set.x.value, 1);
    jobs[0].resolve();
    await first;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(jobs.length, 2);
    assert.equal(jobs[1].snapshot.set.x.value, 2);
    const rejected = assert.rejects(second, /磁盘/);
    jobs[1].reject(Error('磁盘已满'));
    await rejected;
    await assert.rejects(saver.flush(), /磁盘/);
    assert.equal(states.at(-1)[0], 'error');
    const retry = saver.save(batch);
    await new Promise((resolve) => setImmediate(resolve));
    jobs[2].resolve();
    await retry;
    await saver.flush();
    assert.equal(states.at(-1)[0], 'saved');
    assert.equal(written.at(-1).set.x.value, 2);
});
test('稿纸数量和内容有界，使用 SDK SQLite 原子保存与重启，程序包不含后台和网络权限', async (t) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'collectify-calc-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const { PluginStorage } = require('../src/plugin-system/storage');
    const id = 'collectify.calculator';
    const storage = new PluginStorage(root),
        sheet = model.createSheet();
    sheet.rows[0].expression = '0.1+0.2';
    sheet.rows[0].note = '中文备注';
    assert.equal(model.validate(sheet), sheet);
    const index = { schemaVersion: 1, active: sheet.id, sheets: [model.indexItem(sheet)] };
    const saver = model.createSaver({ batch: (input) => storage.batch(id, input) });
    await saver.save({ set: { index, ['sheet:' + sheet.id]: sheet } });
    await saver.flush();
    const reopened = new PluginStorage(root);
    assert.deepEqual(reopened.get(id, 'sheet:' + sheet.id), sheet);
    assert.equal(engine.calculate(reopened.get(id, 'sheet:' + sheet.id).rows)[0].text, '0.3');
    const source = path.resolve(__dirname, '../src/plugin-library/calculator');
    const { readManifest } = require('../src/plugin-system/manifest');
    const manifest = readManifest(source);
    assert.deepEqual(manifest.permissions, ['storage', 'clipboard.write', 'window']);
    assert.equal(manifest.backend, undefined);
    assert.equal(manifest.background, undefined);
    assert.equal(manifest.runtime, undefined);
    assert.deepEqual(
        fs.readFileSync(path.join(source, manifest.icon)),
        fs.readFileSync(path.resolve(__dirname, '../assets/计算器.svg'))
    );
    const invalid = structuredClone(sheet);
    invalid.rows[0].expression = '1'.repeat(1001);
    assert.throws(() => model.validate(invalid));
    invalid.rows[0].expression = '1';
    invalid.rows.push({ ...invalid.rows[0] });
    assert.throws(() => model.validate(invalid));
});
