const { test } = require('node:test');
const assert = require('node:assert/strict');
const tool = require('../src/plugins/timestamp/convert');
test('命名时区双向转换、负数和毫秒精度保持', () => {
    assert.equal(tool.formatInZone(0, 'Asia/Shanghai'), '1970-01-01 08:00:00.000');
    assert.equal(tool.fromDateInZone('1970-01-01 08:00:00.123', 'Asia/Shanghai').milliseconds, '123');
    assert.equal(tool.fromDateInZone('1970-01-01 05:30:00', 'Asia/Kolkata').milliseconds, '0');
    assert.equal(tool.formatInZone(-1, 'UTC'), '1969-12-31 23:59:59.999');
    assert.equal(tool.fromDateInZone('2024-02-29 12:34:56.789', 'UTC').utc, '2024-02-29T12:34:56.789Z');
    assert.throws(() => tool.fromDateInZone('2025-02-29 12:00', 'Asia/Shanghai'), /日期/);
    assert.throws(() => tool.formatInZone(0, 'not-a-zone'), /时区/);
});
test('夏令时跳过和重复的时刻拒绝，不静默偏移', () => {
    assert.throws(() => tool.fromDateInZone('2026-03-08 02:30:00', 'America/New_York'), /不存在/);
    assert.throws(() => tool.fromDateInZone('2026-11-01 01:30:00', 'America/New_York'), /重复/);
    assert.equal(tool.fromDateInZone('2026-07-01 12:00:00', 'America/New_York').utc, '2026-07-01T16:00:00.000Z');
    assert.equal(tool.fromDateInZone('2026-01-01 12:00:00', 'America/New_York').utc, '2026-01-01T17:00:00.000Z');
});
test('批量转换逐行保留错误与空行，拒绝超限，日期输出单位准确', () => {
    const rows = tool.batch('0\ninvalid\n\n-1', { unit: 'milliseconds', zone: 'UTC' });
    assert.deepEqual(
        rows.map((r) => r.ok),
        [true, false, false, true]
    );
    assert.equal(rows[3].output, '1969-12-31 23:59:59.999');
    const dates = tool.batch('1970-01-01 08:00:01.500', {
        direction: 'to-timestamp',
        unit: 'seconds',
        zone: 'Asia/Shanghai'
    });
    assert.equal(dates[0].output, '1.5');
    assert.throws(() => tool.batch('0\n'.repeat(501)), /500/);
    assert.throws(() => tool.batch('x'.repeat(64001)), /64,000/);
});
