(function (root) {
    'use strict';
    const MAX_SHEETS = 60,
        MAX_ROWS = 200;
    const uid = () => globalThis.crypto.randomUUID();
    function createSheet() {
        const time = new Date().toISOString();
        return {
            id: uid(),
            title: '',
            createdAt: time,
            updatedAt: time,
            locked: false,
            rows: [{ id: uid(), expression: '', note: '' }]
        };
    }
    function validate(sheet) {
        if (
            !sheet ||
            typeof sheet.id !== 'string' ||
            !/^[a-z0-9-]{1,60}$/.test(sheet.id) ||
            typeof sheet.title !== 'string' ||
            sheet.title.length > 80 ||
            typeof sheet.locked !== 'boolean' ||
            !Array.isArray(sheet.rows) ||
            !sheet.rows.length ||
            sheet.rows.length > MAX_ROWS
        )
            throw Error('稿纸数据格式不正确');
        if (![sheet.createdAt, sheet.updatedAt].every((t) => typeof t === 'string' && Number.isFinite(Date.parse(t))))
            throw Error('稿纸日期不正确');
        const ids = new Set();
        for (const row of sheet.rows) {
            if (
                !row ||
                typeof row.id !== 'string' ||
                !/^[a-z0-9-]{1,60}$/.test(row.id) ||
                ids.has(row.id) ||
                typeof row.expression !== 'string' ||
                row.expression.length > 1000 ||
                typeof row.note !== 'string' ||
                row.note.length > 200
            )
                throw Error('公式或备注超出限制');
            ids.add(row.id);
        }
        if (new TextEncoder().encode(JSON.stringify(sheet)).byteLength > 200000)
            throw Error('本张稿纸内容过多，请新建稿纸继续');
        return sheet;
    }
    function indexItem(sheet) {
        return {
            id: sheet.id,
            title: sheet.title,
            createdAt: sheet.createdAt,
            updatedAt: sheet.updatedAt,
            locked: sheet.locked,
            summary:
                sheet.rows
                    .map((row) => row.expression || row.note)
                    .find((text) => text.trim())
                    ?.slice(0, 80) || ''
        };
    }
    // 每次输入立即排队持久化完整快照；同一页写入串行，旧保存不能覆盖后来的输入。
    function createSaver(storage, report = () => {}) {
        let chain = Promise.resolve(),
            revision = 0,
            failed = false;
        return {
            save(batch) {
                const snapshot = JSON.parse(JSON.stringify(batch)),
                    current = ++revision;
                report('saving');
                const task = chain.catch(() => {}).then(() => storage.batch(snapshot));
                chain = task;
                task.then(
                    () => {
                        if (current === revision) {
                            failed = false;
                            report('saved');
                        }
                    },
                    (error) => {
                        failed = true;
                        report('error', error.message);
                    }
                );
                return task;
            },
            async flush() {
                await chain;
                if (failed) throw Error('数据未保存，请重试保存');
            }
        };
    }
    function searchText(sheet) {
        return [sheet.title, ...sheet.rows.flatMap((row) => [row.expression, row.note])].join('\n').toLocaleLowerCase();
    }
    const api = { MAX_SHEETS, MAX_ROWS, uid, createSheet, validate, indexItem, searchText, createSaver };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.CalcModel = api;
})(globalThis);
