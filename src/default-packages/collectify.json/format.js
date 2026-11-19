(function (root) {
    function parse(text) {
        if (typeof text !== 'string' || !text.trim()) throw Error('请先输入 JSON');
        if (new TextEncoder().encode(text).length > 1024 * 1024) throw Error('单次最多处理 1 MB JSON');
        try {
            return JSON.parse(text);
        } catch (error) {
            const match = /position (\d+)/.exec(error.message);
            if (match) {
                const before = text.slice(0, Number(match[1])),
                    lines = before.split('\n');
                throw Error(`JSON 语法错误：第 ${lines.length} 行，第 ${lines.at(-1).length + 1} 列。${error.message}`);
            }
            throw Error(`JSON 语法错误：${error.message}`);
        }
    }
    function ensureSafeNumbers(value) {
        const pending = [value];
        while (pending.length) {
            const item = pending.pop();
            if (
                typeof item === 'number' &&
                (!Number.isFinite(item) || (Number.isInteger(item) && !Number.isSafeInteger(item)))
            )
                throw Error('包含超出 JavaScript 精确整数范围的数值，已停止输出；请将大整数改为字符串，避免精度丢失');
            if (item && typeof item === 'object') for (const child of Object.values(item)) pending.push(child);
        }
    }
    function transform(text, mode, indent = '2') {
        const value = parse(text);
        if (mode === 'validate') return { text: '', message: 'JSON 语法有效（仅校验，不改写数值）' };
        if (!['format', 'compact'].includes(mode) || !['2', '4', 'tab'].includes(indent))
            throw Error('JSON 操作或缩进参数不正确');
        ensureSafeNumbers(value);
        const output = JSON.stringify(value, null, mode === 'compact' ? 0 : indent === 'tab' ? '\t' : Number(indent));
        return { text: output, message: mode === 'compact' ? '压缩完成' : '格式化完成' };
    }
    const api = { parse, transform };
    if (typeof module !== 'undefined') module.exports = api;
    else root.JsonTool = api;
})(globalThis);
