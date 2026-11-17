const { test } = require('node:test'),
    assert = require('node:assert/strict');
const K = require('../src/plugin-library/calculator/keyboard');
const C = require('../src/plugin-library/calculator/engine');
const key = (token) => K.groups.flatMap((g) => g.keys).find((k) => k[1] === token);
test('数学键盘在选区或光标插入，函数保留选中内容，删除与长度限制正确', () => {
    assert.deepEqual(K.edit('12', 0, 2, key('pow')), { text: 'pow(12, )', caret: 8 });
    assert.deepEqual(K.edit('', 0, 0, key('sqrt')), { text: 'sqrt()', caret: 5 });
    assert.deepEqual(K.edit('1+2', 0, 3, key('^2')), { text: '(1+2)^2', caret: 7 });
    assert.equal(K.edit('20+30', 0, 5, key('/100')).text, '(20+30)/100');
    assert.equal(K.edit('90', 0, 2, key('*PI/180')).text, '(90)*PI/180');
    assert.equal(K.edit('1234', 1, 3, ['9']).text, '194');
    assert.equal(K.edit('a😀b', 3, 3, ['', '', '', 'delete']).text, 'ab');
    assert.equal(K.edit('1234', 1, 3, ['', '', '', 'clear']).text, '');
    assert.throws(() => K.edit('1'.repeat(1000), 1000, 1000, ['1']), /1000/);
});
test('数学键盘函数与常量均由现有安全计算引擎支持', () => {
    for (const k of K.groups.flatMap((g) => g.keys)) {
        if (!['function', 'pair'].includes(k[3])) continue;
        const input =
            k[3] === 'pair'
                ? ['2', '3']
                : ['log', 'log10', 'log2'].includes(k[1])
                  ? ['10']
                  : ['sin', 'cos', 'tan', 'asin', 'acos', 'atan'].includes(k[1])
                    ? ['0.5']
                    : ['4'];
        assert.doesNotThrow(() => C.evaluate(`${k[1]}(${input.join(',')})`), k[1]);
    }
    assert.equal(C.format(C.evaluate('(20+30)/100'), false).text, '0.5');
});
