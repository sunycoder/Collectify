(function (root) {
    const defaults = {
        mode: 'values',
        precision: 'smart',
        matchHeaders: false,
        keyColumns: [],
        ignoreSpace: false,
        ignoreCase: false,
        hideRows: false,
        hideCols: false,
        keepFormat: true,
        sortRows: 'none',
        sortCols: 'none',
        date: null
    };
    function date(value, region) {
        if (!region) return String(value ?? '');
        const match = String(value).match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})(.*)$/);
        if (!match) return String(value);
        const month = Number(match[region === 'US' ? 1 : 2]),
            day = Number(match[region === 'US' ? 2 : 1]),
            year = Number(match[3]),
            d = new Date(Date.UTC(year, month - 1, day));
        return d.getUTCFullYear() === year && d.getUTCMonth() === month - 1 && d.getUTCDate() === day
            ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}${match[4]}`
            : String(value);
    }
    function value(cell, options) {
        return date(options.mode === 'formulas' ? cell?.f || (cell?.v ?? '') : (cell?.v ?? ''), options.date);
    }
    function normalize(text, options) {
        let v = String(text ?? '');
        if (options.ignoreSpace) v = v.replace(/\s/g, '');
        if (options.ignoreCase) v = v.toLocaleLowerCase();
        return v;
    }
    function column(n) {
        let s = '';
        for (n++; n; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
        return s;
    }
    // 仅唯一且完整的业务键参与配对；重复、缺失键分别保留为独有行，避免静默错配。
    function alignRows(sides, keys, settings) {
        const issues = [],
            counts = [new Map(), new Map()];
        const entries = sides.map((rows, side) =>
            rows.slice(1).map((row) => {
                const parts = keys.map((key) =>
                    normalize(value(row.cells[key[side ? 'right' : 'left']], { ...settings, mode: 'values' }), settings)
                );
                const key = parts.some((p) => !p.trim()) ? null : JSON.stringify(parts);
                if (key !== null) counts[side].set(key, (counts[side].get(key) || 0) + 1);
                return { row, key };
            })
        );
        for (let side = 0; side < 2; side++)
            for (const entry of entries[side]) {
                if (entry.key === null) issues.push({ kind: 'blank', side, row: entry.row.index + 1 });
                else if (counts[0].get(entry.key) > 1 || counts[1].get(entry.key) > 1) {
                    issues.push({ kind: 'duplicate', side, row: entry.row.index + 1 });
                    entry.key = null;
                }
            }
        const right = new Map(entries[1].filter((e) => e.key !== null).map((e) => [e.key, e]));
        const used = new Set(),
            pairs = [[sides[0][0], sides[1][0]]];
        for (const entry of entries[0]) {
            const match = entry.key === null ? undefined : right.get(entry.key);
            if (match) used.add(match);
            pairs.push([entry.row, match?.row]);
        }
        for (const entry of entries[1]) if (!used.has(entry)) pairs.push([undefined, entry.row]);
        return { sides: [pairs.map((p) => p[0]), pairs.map((p) => p[1])], issues };
    }
    function build(pair, options = {}) {
        const settings = { ...defaults, ...options };
        const sides = pair.map((sheet) => (sheet?.rows || []).map((cells, index) => ({ cells, index })));
        if (settings.sortRows !== 'none')
            for (const rows of sides) {
                const first = rows.shift();
                rows.sort(
                    (a, b) =>
                        value(a.cells[0], settings).localeCompare(value(b.cells[0], settings), undefined, {
                            numeric: true
                        }) * (settings.sortRows === 'desc' ? -1 : 1) || a.index - b.index
                );
                if (first) rows.unshift(first);
            }
        const sizes = sides.map((rows) => Math.max(0, ...rows.map((r) => r.cells.length)));
        let columns = [];
        if (settings.matchHeaders) {
            const lists = sides.map((rows, side) => {
                const seen = new Map();
                return Array.from({ length: sizes[side] }, (_, index) => {
                    const label = normalize(value(rows[0]?.cells[index], settings), settings) || '（空表头）';
                    const occurrence = (seen.get(label) || 0) + 1;
                    seen.set(label, occurrence);
                    return { index, label, key: label + '\0' + occurrence };
                });
            });
            const right = new Map(lists[1].map((c) => [c.key, c]));
            for (const c of lists[0]) {
                columns.push({ left: c.index, right: right.get(c.key)?.index, label: c.label });
                right.delete(c.key);
            }
            for (const c of right.values()) columns.push({ left: undefined, right: c.index, label: c.label });
        } else
            columns = Array.from({ length: Math.max(...sizes) }, (_, i) => ({
                left: i < sizes[0] ? i : undefined,
                right: i < sizes[1] ? i : undefined,
                label: value(sides[1][0]?.cells[i] || sides[0][0]?.cells[i], settings) || column(i)
            }));
        if (settings.sortCols !== 'none')
            columns.sort(
                (a, b) =>
                    a.label.localeCompare(b.label, undefined, { numeric: true }) *
                    (settings.sortCols === 'desc' ? -1 : 1)
            );
        let keyIssues = [],
            keyActive = false;
        if (settings.keyColumns.length) {
            const valid = settings.keyColumns.every((key) =>
                ['left', 'right'].every(
                    (field, side) =>
                        Number.isInteger(key[field]) && key[field] >= 0 && key[field] < sizes[side] && sides[side][0]
                )
            );
            if (valid) {
                const aligned = alignRows(sides, settings.keyColumns, settings);
                sides[0] = aligned.sides[0];
                sides[1] = aligned.sides[1];
                keyIssues = aligned.issues;
                keyActive = true;
            } else keyIssues = [{ kind: 'unavailable' }];
        }
        const rowCount = Math.max(...sides.map((s) => s.length)),
            changes = [],
            changedRows = new Set(),
            changedCols = new Set(),
            byCell = new Map();
        function cell(side, r, c) {
            const index = columns[c]?.[side ? 'right' : 'left'];
            return index === undefined ? undefined : sides[side][r]?.cells[index];
        }
        for (let r = 0; r < rowCount; r++)
            for (let c = 0; c < columns.length; c++) {
                const before = value(cell(0, r, c), settings),
                    after = value(cell(1, r, c), settings);
                if (normalize(before, settings) === normalize(after, settings)) continue;
                const state = !sides[0][r]
                    ? 'right'
                    : !sides[1][r]
                      ? 'left'
                      : before === ''
                        ? 'right'
                        : after === ''
                          ? 'left'
                          : 'changed';
                const change = {
                    row: r,
                    col: c,
                    before,
                    after,
                    state,
                    leftAddress:
                        columns[c].left !== undefined && sides[0][r]
                            ? column(columns[c].left) + (sides[0][r].index + 1)
                            : '—',
                    rightAddress:
                        columns[c].right !== undefined && sides[1][r]
                            ? column(columns[c].right) + (sides[1][r].index + 1)
                            : '—'
                };
                byCell.set(r + ':' + c, change);
                changes.push(change);
                changedRows.add(r);
                changedCols.add(c);
            }
        return {
            settings,
            sides,
            columns,
            changes,
            byCell,
            cell,
            rowCount,
            keyActive,
            keyIssues,
            rowStats: {
                left: sides[0].filter((row, r) => r > 0 && row && !sides[1][r]).length,
                right: sides[1].filter((row, r) => r > 0 && row && !sides[0][r]).length,
                matched: sides[0].filter((row, r) => r > 0 && row && sides[1][r]).length,
                changed: [...changedRows].filter((r) => r > 0 && sides[0][r] && sides[1][r]).length
            },
            rows: Array.from({ length: rowCount }, (_, r) => r).filter((r) => !settings.hideRows || changedRows.has(r)),
            cols: columns.map((_, c) => c).filter((c) => !settings.hideCols || changedCols.has(c)),
            counts: {
                left: changes.filter((c) => c.state === 'left').length,
                right: changes.filter((c) => c.state === 'right').length,
                changed: changes.filter((c) => c.state === 'changed').length
            }
        };
    }
    function csv(rows) {
        return (
            '\ufeff' +
            rows
                .map((row) => row.map((value) => '"' + String(value ?? '').replaceAll('"', '""') + '"').join(','))
                .join('\r\n')
        );
    }
    const api = { defaults, date, value, normalize, column, build, csv };
    if (typeof module !== 'undefined') module.exports = api;
    else root.DiffSheetModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
