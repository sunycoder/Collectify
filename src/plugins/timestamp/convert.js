(function (root) {
    function describe(milliseconds) {
        if (!Number.isSafeInteger(milliseconds) || Math.abs(milliseconds) > 8640000000000000)
            throw Error('时间戳超出日期支持范围');
        const date = new Date(milliseconds),
            pad = (n, size = 2) => String(n).padStart(size, '0');
        return {
            milliseconds: String(milliseconds),
            seconds: String(milliseconds / 1000),
            utc: date.toISOString(),
            local: `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
        };
    }
    function fromTimestamp(text, unit) {
        if (!['seconds', 'milliseconds'].includes(unit)) throw Error('请选择秒或毫秒');
        if (typeof text !== 'string' || !/^-?\d+$/.test(text.trim()))
            throw Error('请输入整数时间戳，支持负数；单位请显式选择');
        const value = Number(text.trim());
        if (!Number.isSafeInteger(value)) throw Error('时间戳超出安全整数范围');
        return describe(unit === 'seconds' ? value * 1000 : value);
    }
    function fromDate(text, zone) {
        const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(text || '');
        if (!match || !['local', 'utc'].includes(zone)) throw Error('请输入完整日期和时间，并选择本地时间或 UTC');
        const [, y, m, d, h, min, sec = '0', fraction = '0'] = match;
        const fields = [+y, +m - 1, +d, +h, +min, +sec, +fraction.padEnd(3, '0')];
        const date = new Date(0),
            prefix = zone === 'utc' ? 'UTC' : '';
        date[`set${prefix}FullYear`](fields[0], fields[1], fields[2]);
        date[`set${prefix}Hours`](fields[3], fields[4], fields[5], fields[6]);
        const actual = ['FullYear', 'Month', 'Date', 'Hours', 'Minutes', 'Seconds', 'Milliseconds'].map((name) =>
            date[`get${prefix}${name}`]()
        );
        if (actual.some((value, i) => value !== fields[i])) throw Error('日期不合法，或该本地时间因夏令时切换而不存在');
        return describe(date.getTime());
    }
    function normalizeZone(zone) {
        if (zone === 'local') return Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (zone === 'utc') return 'UTC';
        try {
            return new Intl.DateTimeFormat('en-US', { timeZone: zone }).resolvedOptions().timeZone;
        } catch {
            throw Error('时区不受支持');
        }
    }
    function zoneParts(milliseconds, zone) {
        const parts = new Intl.DateTimeFormat('en-CA-u-ca-gregory-nu-latn', {
            timeZone: normalizeZone(zone),
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hourCycle: 'h23'
        }).formatToParts(new Date(milliseconds));
        const values = Object.fromEntries(parts.map((p) => [p.type, p.value]));
        return [
            Number(values.year),
            Number(values.month),
            Number(values.day),
            Number(values.hour),
            Number(values.minute),
            Number(values.second)
        ];
    }
    function formatInZone(milliseconds, zone) {
        describe(milliseconds);
        const [y, m, d, h, min, s] = zoneParts(milliseconds, zone),
            pad = (value, n = 2) => String(value).padStart(n, '0');
        return `${pad(y, 4)}-${pad(m)}-${pad(d)} ${pad(h)}:${pad(min)}:${pad(s)}.${pad(new Date(milliseconds).getUTCMilliseconds(), 3)}`;
    }
    function fromDateInZone(text, zone) {
        if (zone === 'local') zone = normalizeZone(zone);
        if (zone === 'utc' || zone === 'UTC') return fromDate(text, 'utc');
        normalizeZone(zone);
        const base = fromDate(text, 'utc'),
            naive = Number(base.milliseconds),
            date = new Date(naive);
        const desired = [
            date.getUTCFullYear(),
            date.getUTCMonth() + 1,
            date.getUTCDate(),
            date.getUTCHours(),
            date.getUTCMinutes(),
            date.getUTCSeconds()
        ];
        if (desired[0] < 1) throw Error('命名时区仅支持公元 0001 年以后的日期');
        const offsets = new Set(),
            matches = new Set();
        // 枚举日期前后的实际偏移，覆盖半小时时区及夏令时，拒绝不存在或有歧义的时刻。
        for (let hour = -36; hour <= 36; hour += 6) {
            const sample = naive + hour * 3600000,
                p = zoneParts(sample, zone),
                utc = new Date(0);
            utc.setUTCFullYear(p[0], p[1] - 1, p[2]);
            utc.setUTCHours(p[3], p[4], p[5], date.getUTCMilliseconds());
            offsets.add(utc.getTime() - sample);
        }
        for (const offset of offsets) {
            const candidate = naive - offset;
            if (zoneParts(candidate, zone).every((value, i) => value === desired[i])) matches.add(candidate);
        }
        if (!matches.size) throw Error('该时区日期不存在，可能处于夏令时跳过区间');
        if (matches.size > 1) throw Error('该时区日期因夏令时重复，请改用 UTC 明确具体时刻');
        return describe([...matches][0]);
    }
    function batch(text, { direction = 'to-date', unit = 'milliseconds', zone = 'local' } = {}) {
        if (typeof text !== 'string' || text.length > 64000) throw Error('批量输入最多 64,000 个字符');
        if (!['to-date', 'to-timestamp'].includes(direction) || !['seconds', 'milliseconds'].includes(unit))
            throw Error('批量转换方向或单位不正确');
        const lines = text.split(/\r?\n/);
        if (!text.trim() || lines.length > 500) throw Error('请输入 1 至 500 行，每行一个值');
        return lines.map((input, index) => {
            try {
                const result =
                    direction === 'to-date' ? fromTimestamp(input.trim(), unit) : fromDateInZone(input.trim(), zone);
                return {
                    line: index + 1,
                    input,
                    output: direction === 'to-date' ? formatInZone(Number(result.milliseconds), zone) : result[unit],
                    ok: true
                };
            } catch (error) {
                return { line: index + 1, input, output: error.message, ok: false };
            }
        });
    }
    const api = { describe, fromTimestamp, fromDate, normalizeZone, formatInZone, fromDateInZone, batch };
    if (typeof module !== 'undefined') module.exports = api;
    else root.TimestampTool = api;
})(globalThis);
