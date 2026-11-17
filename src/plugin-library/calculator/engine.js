(function (root) {
    'use strict';
    const MAX_DIGITS = 500;
    function gcd(a, b) {
        a = a < 0n ? -a : a;
        while (b) [a, b] = [b, a % b];
        return a || 1n;
    }
    // 四则运算以有理数保存十进制原文；仅三角、对数等函数使用系统数学库近似值。
    class Value {
        constructor(n, d = 1n, approximate = false) {
            if (!d) throw Error('不能除以零');
            if (d < 0n) {
                n = -n;
                d = -d;
            }
            const common = gcd(n, d);
            this.n = n / common;
            this.d = d / common;
            this.approximate = approximate;
            if (this.n.toString().length > MAX_DIGITS || this.d.toString().length > MAX_DIGITS)
                throw Error('数值过大，请缩小计算范围');
        }
        static decimal(text, approximate = false) {
            const match = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(text);
            if (!match || !(match[2] || match[3])) throw Error('数字格式不正确');
            const power = Number(match[4] || 0) - (match[3]?.length || 0);
            if (Math.abs(power) > 300 || text.length > 320) throw Error('数字超出支持范围');
            let n = BigInt((match[2] || '0') + (match[3] || '')) * (match[1] === '-' ? -1n : 1n),
                d = 1n;
            if (power >= 0) n *= 10n ** BigInt(power);
            else d = 10n ** BigInt(-power);
            return new Value(n, d, approximate);
        }
        static number(number) {
            if (!Number.isFinite(number)) throw Error('结果不是有限实数，请检查函数定义域或数值范围');
            return Value.decimal(String(number), true);
        }
        number() {
            return Number(this.n) / Number(this.d);
        }
    }
    const exact = (n) => new Value(BigInt(n));
    function binary(op, a, b) {
        const approx = a.approximate || b.approximate;
        switch (op) {
            case '+':
                return new Value(a.n * b.d + b.n * a.d, a.d * b.d, approx);
            case '-':
                return new Value(a.n * b.d - b.n * a.d, a.d * b.d, approx);
            case '*':
                return new Value(a.n * b.n, a.d * b.d, approx);
            case '/':
                return new Value(a.n * b.d, a.d * b.n, approx);
            case '%': {
                if (!b.n) throw Error('不能对零取余');
                const q = (a.n * b.d) / (a.d * b.n);
                return new Value(a.n * b.d - q * b.n * a.d, a.d * b.d, approx);
            }
            case '^': {
                if (b.d === 1n && b.n >= -1000n && b.n <= 1000n) {
                    const exponent = b.n < 0n ? -b.n : b.n;
                    if (exponent * BigInt(Math.max(a.n.toString().length - 1, a.d.toString().length - 1)) > 1500n)
                        throw Error('幂运算结果过大');
                    return b.n < 0n
                        ? new Value(a.d ** exponent, a.n ** exponent, approx)
                        : new Value(a.n ** exponent, a.d ** exponent, approx);
                }
                return Value.number(Math.pow(a.number(), b.number()));
            }
            default:
                throw Error('不支持的运算符');
        }
    }
    function integer(value, mode) {
        let n = value.n / value.d;
        const rest = value.n % value.d;
        if (mode === 'floor' && rest < 0n) n--;
        if (mode === 'ceil' && rest > 0n) n++;
        // 与 Math.round 相同：半值向正无穷方向取整。
        if (mode === 'round') n = integer(binary('+', value, new Value(1n, 2n)), 'floor').n;
        return new Value(n, 1n, value.approximate);
    }
    function call(name, args) {
        const one = [
            'abs',
            'sqrt',
            'cbrt',
            'log',
            'log10',
            'log2',
            'exp',
            'sin',
            'cos',
            'tan',
            'asin',
            'acos',
            'atan',
            'ceil',
            'floor',
            'round',
            'trunc'
        ];
        const two = ['pow', 'atan2'];
        if ((one.includes(name) && args.length !== 1) || (two.includes(name) && args.length !== 2))
            throw Error(`${name} 的参数数量不正确`);
        if (['min', 'max', 'hypot'].includes(name) && (args.length < 1 || args.length > 30))
            throw Error(`${name} 需要 1～30 个参数`);
        if (name === 'pow') return binary('^', args[0], args[1]);
        if (name === 'abs') return new Value(args[0].n < 0n ? -args[0].n : args[0].n, args[0].d, args[0].approximate);
        if (['ceil', 'floor', 'round', 'trunc'].includes(name)) return integer(args[0], name);
        if (name === 'min' || name === 'max')
            return args.reduce((a, b) => ((name === 'min' ? a.n * b.d <= b.n * a.d : a.n * b.d >= b.n * a.d) ? a : b));
        if (![...one, ...two, 'min', 'max', 'hypot'].includes(name)) throw Error(`不支持的函数：${name}`);
        return Value.number(Math[name](...args.map((a) => a.number())));
    }
    function tokenize(source) {
        if (source.length > 1000) throw Error('每行公式最多 1000 个字符');
        // x/X 只在数字或括号之间作为乘号，函数名 exp/max 保持原样。
        source = source
            .replace(/×/g, '*')
            .replace(/÷/g, '/')
            .replace(/−/g, '-')
            .replace(/π/g, 'PI')
            .replace(/(?<=[\d)])\s*[xX]\s*(?=[\d.(])/g, '*');
        const tokens = [];
        let i = 0;
        while (i < source.length) {
            if (/\s/.test(source[i])) {
                i++;
                continue;
            }
            const part = source.slice(i);
            let match = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(part);
            if (match) {
                tokens.push({ type: 'number', text: match[0] });
                i += match[0].length;
            } else if ((match = /^(?:_[1-9]\d*|[a-zA-Z][a-zA-Z0-9]*)/.exec(part))) {
                tokens.push({ type: 'name', text: match[0] });
                i += match[0].length;
            } else if ((match = /^(?:\*\*|[+\-*/%^(),])/.exec(part))) {
                tokens.push({ type: match[0] === '**' ? '^' : match[0], text: match[0] });
                i += match[0].length;
            } else throw Error(`无法识别字符“${source[i]}”`);
            if (tokens.length > 500) throw Error('公式过于复杂');
        }
        tokens.push({ type: 'end' });
        return tokens;
    }
    function evaluate(source, previous = []) {
        const tokens = tokenize(source);
        let pos = 0,
            depth = 0;
        const peek = () => tokens[pos].type;
        function reference(index) {
            if (index < 0 || index >= previous.length) throw Error('只能引用前面已有的行');
            const result = previous[index];
            if (!result?.value) throw Error(`第 ${index + 1} 行没有有效结果`);
            return result.value;
        }
        function expression(min = 0) {
            if (++depth > 60) throw Error('公式嵌套过深');
            let a;
            const token = tokens[pos++];
            if (token.type === 'number') a = Value.decimal(token.text);
            else if (token.type === '+' || token.type === '-') {
                a = expression(25);
                if (token.type === '-') a = new Value(-a.n, a.d, a.approximate);
            } else if (token.type === '(') {
                a = expression();
                if (peek() !== ')') throw Error('缺少右括号');
                pos++;
            } else if (token.type === 'name') {
                if (peek() === '(') {
                    pos++;
                    const args = [];
                    if (peek() !== ')') {
                        do {
                            if (args.length) pos++;
                            args.push(expression());
                        } while (peek() === ',');
                    }
                    if (peek() !== ')') throw Error('函数缺少右括号');
                    pos++;
                    a = call(token.text, args);
                } else if (token.text === 'PI') a = Value.number(Math.PI);
                else if (token.text === 'E') a = Value.number(Math.E);
                else if (token.text === 'ans') a = reference(previous.length - 1);
                else if (/^_[1-9]\d*$/.test(token.text)) a = reference(Number(token.text.slice(1)) - 1);
                else throw Error(`未知名称：${token.text}`);
            } else throw Error('公式未完成，请补充数字或括号');
            const precedence = { '+': 10, '-': 10, '*': 20, '/': 20, '%': 20, '^': 30 };
            while (Object.hasOwn(precedence, peek()) && precedence[peek()] >= min) {
                const op = tokens[pos++].type,
                    priority = precedence[op];
                a = binary(op, a, expression(op === '^' ? priority : priority + 1));
            }
            depth--;
            return a;
        }
        const value = expression();
        if (peek() !== 'end') throw Error('公式包含多余内容，请检查运算符和括号');
        return value;
    }
    function format(value, grouping = true) {
        const negative = value.n < 0n,
            absolute = negative ? -value.n : value.n;
        const scale = 10n ** 12n;
        let scaled = (absolute * scale * 2n + value.d) / (2n * value.d);
        let whole = (scaled / scale).toString(),
            fraction = (scaled % scale).toString().padStart(12, '0').replace(/0+$/, '');
        const rounded = (absolute * scale) % value.d !== 0n;
        if (grouping) whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return {
            text: (negative && scaled ? '-' : '') + whole + (fraction ? '.' + fraction : ''),
            approximate: rounded || value.approximate
        };
    }
    function calculate(rows) {
        const results = [];
        for (const row of rows) {
            if (!row.expression.trim()) {
                results.push({ empty: true });
                continue;
            }
            try {
                const value = evaluate(row.expression, results);
                results.push({ value, ...format(value) });
            } catch (error) {
                results.push({ error: error.message });
            }
        }
        return results;
    }
    const api = { evaluate, calculate, format, Value, binary };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.PaperCalc = api;
})(globalThis);
