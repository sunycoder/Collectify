(function (root) {
    const groups = [
        {
            id: 'basic',
            name: '常用',
            keys: [
                ['7'],
                ['8'],
                ['9'],
                ['÷', '/', '除法'],
                ['(', '(', '左括号'],
                [')', ')', '右括号'],
                ['4'],
                ['5'],
                ['6'],
                ['×', '*', '乘法'],
                ['x²', '^2', '平方', 'square'],
                ['√', 'sqrt', '平方根', 'function'],
                ['1'],
                ['2'],
                ['3'],
                ['−', '-', '减法'],
                ['xʸ', '^', '幂运算'],
                ['π', 'PI', '圆周率'],
                ['0'],
                ['.'],
                [',', ',', '函数参数分隔符'],
                ['+', '+', '加法'],
                ['百分比', '/100', '除以 100', 'percent'],
                ['ans', 'ans', '上一行结果']
            ]
        },
        {
            id: 'math',
            name: '数学函数',
            keys: [
                ['绝对值', 'abs', '绝对值', 'function'],
                ['平方根', 'sqrt', '平方根', 'function'],
                ['立方根', 'cbrt', '立方根', 'function'],
                ['幂', 'pow', '幂：pow(底数, 指数)', 'pair'],
                ['最小值', 'min', '多个数的最小值', 'pair'],
                ['最大值', 'max', '多个数的最大值', 'pair'],
                ['ln', 'log', '自然对数', 'function'],
                ['log₁₀', 'log10', '以 10 为底的对数', 'function'],
                ['log₂', 'log2', '以 2 为底的对数', 'function'],
                ['向上取整', 'ceil', '向上取整', 'function'],
                ['向下取整', 'floor', '向下取整', 'function'],
                ['四舍五入', 'round', '半值向正无穷取整', 'function'],
                ['截取整数', 'trunc', '截去小数部分', 'function'],
                ['取余', '%', '取余，例如 17 % 5 = 2'],
                ['e', 'E', '自然常数'],
                ['eˣ', 'exp', 'e 的幂', 'function'],
                ['勾股', 'hypot', '勾股长度', 'pair']
            ]
        },
        {
            id: 'trig',
            name: '三角函数',
            keys: [
                ['sin', 'sin', '正弦（弧度）', 'function'],
                ['cos', 'cos', '余弦（弧度）', 'function'],
                ['tan', 'tan', '正切（弧度）', 'function'],
                ['asin', 'asin', '反正弦，返回弧度', 'function'],
                ['acos', 'acos', '反余弦，返回弧度', 'function'],
                ['atan', 'atan', '反正切，返回弧度', 'function'],
                ['atan2', 'atan2', 'atan2(y, x)，返回弧度', 'pair'],
                ['角度→弧度', '*PI/180', '角度乘以 PI / 180', 'degrees'],
                ['π', 'PI', '圆周率']
            ]
        }
    ];
    function edit(value, start, end, key) {
        start = Math.max(0, Math.min(value.length, start));
        end = Math.max(start, Math.min(value.length, end));
        const selected = value.slice(start, end),
            token = key[1] ?? key[0],
            kind = key[3];
        let insert = token,
            offset;
        if (kind === 'function' || kind === 'pair') {
            insert = token + '(' + selected + (kind === 'pair' ? ', ' : '') + ')';
            offset = kind === 'pair' ? insert.length - 1 : selected ? insert.length : token.length + 1;
        } else if (kind === 'square') insert = selected ? '(' + selected + ')^2' : '^2';
        else if (kind === 'percent') insert = selected ? '(' + selected + ')/100' : '/100';
        else if (kind === 'degrees') insert = selected ? '(' + selected + ')*PI/180' : '*PI/180';
        else if (kind === 'delete') {
            if (start === end && start > 0) start -= [...value.slice(0, start)].at(-1).length;
            insert = '';
        } else if (kind === 'clear') {
            start = 0;
            end = value.length;
            insert = '';
        }
        const text = value.slice(0, start) + insert + value.slice(end);
        if (text.length > 1000) throw Error('每行公式最多 1000 个字符');
        return { text, caret: start + (offset ?? insert.length) };
    }
    const api = { groups, edit };
    if (typeof module !== 'undefined') module.exports = api;
    else root.CalcKeyboard = api;
})(typeof window !== 'undefined' ? window : globalThis);
