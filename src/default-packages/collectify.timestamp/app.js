const $ = (selector) => document.querySelector(selector);
const run = (action) => () => ToolUI.run(action);
let paused = false,
    clockUnit = 'milliseconds',
    clockValue = Date.now(),
    lastDateResult = null;
const systemZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const zones = [
    ['local', `本机时区 · ${systemZone}`],
    ['UTC', 'UTC'],
    ['Asia/Shanghai', 'Asia/Shanghai'],
    ['Asia/Tokyo', 'Asia/Tokyo'],
    ['Asia/Kolkata', 'Asia/Kolkata'],
    ['Europe/London', 'Europe/London'],
    ['Europe/Berlin', 'Europe/Berlin'],
    ['America/New_York', 'America/New_York'],
    ['America/Los_Angeles', 'America/Los_Angeles'],
    ['Australia/Sydney', 'Australia/Sydney']
];
for (const id of ['date-zone', 'zone', 'batch-zone'])
    for (const [value, text] of zones) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = text;
        $('#' + id).append(option);
    }
function syncControls() {
    window.OfficeUI?.refresh();
}
function tick() {
    if (!paused) clockValue = Date.now();
    $('#clock').textContent = String(clockUnit === 'seconds' ? Math.floor(clockValue / 1000) : clockValue);
    $('#clock-unit').textContent = clockUnit === 'seconds' ? '秒' : '毫秒';
    $('#clock-zone').textContent = `${TimestampTool.formatInZone(clockValue, 'local')} · ${systemZone}`;
}
function clearResult(target, copy) {
    $(target).value = '';
    $(copy).disabled = true;
}
function convertTimestamp() {
    clearResult('#date-result', '#copy-date');
    const result = TimestampTool.fromTimestamp($('#timestamp').value, $('#unit').value);
    $('#date-result').value = TimestampTool.formatInZone(Number(result.milliseconds), $('#date-zone').value);
    $('#copy-date').disabled = false;
    ToolUI.message('转换完成');
}
function showTimestamp() {
    if (!lastDateResult) return;
    $('#timestamp-result').value = lastDateResult[$('#output-unit').value];
    $('#copy-timestamp').disabled = false;
}
function convertDate() {
    lastDateResult = null;
    clearResult('#timestamp-result', '#copy-timestamp');
    lastDateResult = TimestampTool.fromDateInZone($('#datetime').value, $('#zone').value);
    showTimestamp();
    ToolUI.message('转换完成');
}
async function copy(target) {
    const text = $(target).value;
    if (!text) throw Error('请先完成转换');
    await collectify.clipboard.writeText(text);
    ToolUI.message('结果已复制');
}
function selectMode(batch) {
    $('#single-panel').hidden = batch;
    $('#batch-panel').hidden = !batch;
    $('#single-tab').setAttribute('aria-pressed', String(!batch));
    $('#batch-tab').setAttribute('aria-pressed', String(batch));
}
$('#single-tab').onclick = () => selectMode(false);
$('#batch-tab').onclick = () => selectMode(true);
$('#switch-clock-unit').onclick = run(async () => {
    clockUnit = clockUnit === 'seconds' ? 'milliseconds' : 'seconds';
    tick();
    await savePreferences();
});
$('#pause-clock').onclick = () => {
    paused = !paused;
    $('#pause-clock').textContent = paused ? '继续' : '暂停';
    $('#pause-clock').setAttribute('aria-pressed', String(paused));
    tick();
};
$('#copy-clock').onclick = run(async () => {
    await collectify.clipboard.writeText($('#clock').textContent);
    ToolUI.message('当前时间戳已复制');
});
$('#convert-timestamp').onclick = run(convertTimestamp);
$('#convert-date').onclick = run(convertDate);
$('#use-now').onclick = run(() => {
    const now = Date.now();
    $('#timestamp').value = String($('#unit').value === 'seconds' ? Math.floor(now / 1000) : now);
    convertTimestamp();
});
$('#copy-date').onclick = run(() => copy('#date-result'));
$('#copy-timestamp').onclick = run(() => copy('#timestamp-result'));
$('#timestamp').oninput = () => clearResult('#date-result', '#copy-date');
$('#datetime').oninput = () => {
    lastDateResult = null;
    clearResult('#timestamp-result', '#copy-timestamp');
};
$('#convert-batch').onclick = run(() => {
    clearResult('#batch-output', '#copy-batch');
    $('#batch-summary').textContent = '';
    const rows = TimestampTool.batch($('#batch-input').value, {
        direction: $('#batch-direction').value,
        unit: $('#batch-unit').value,
        zone: $('#batch-zone').value
    });
    $('#batch-output').value = rows.map((row) => (row.ok ? row.output : `错误：${row.output}`)).join('\n');
    const success = rows.filter((row) => row.ok).length;
    $('#batch-summary').textContent = `共 ${rows.length} 行，成功 ${success} 行，失败 ${rows.length - success} 行`;
    $('#copy-batch').disabled = false;
    ToolUI.message('批量转换完成');
});
$('#copy-batch').onclick = run(() => copy('#batch-output'));
$('#clear-batch').onclick = () => {
    $('#batch-input').value = '';
    clearBatch();
};
function clearBatch() {
    clearResult('#batch-output', '#copy-batch');
    $('#batch-summary').textContent = '';
}
$('#batch-input').oninput = clearBatch;
async function savePreferences() {
    await collectify.storage.set('preferences', {
        unit: $('#unit').value,
        zone: $('#zone').value,
        dateZone: $('#date-zone').value,
        outputUnit: $('#output-unit').value,
        batchUnit: $('#batch-unit').value,
        batchZone: $('#batch-zone').value,
        clockUnit
    });
}
for (const id of ['unit', 'date-zone', 'zone', 'output-unit', 'batch-unit', 'batch-zone', 'batch-direction'])
    $('#' + id).onchange = run(async () => {
        if (['unit', 'date-zone'].includes(id)) clearResult('#date-result', '#copy-date');
        if (id === 'zone') {
            lastDateResult = null;
            clearResult('#timestamp-result', '#copy-timestamp');
        }
        if (id === 'output-unit') showTimestamp();
        if (id.startsWith('batch-')) clearBatch();
        await savePreferences();
    });
collectify.onCommand(() => $('#timestamp').focus());
collectify.onNavigate(({ route }) => {
    selectMode(false);
    const target = route === 'to-timestamp' ? '#datetime' : '#timestamp';
    $(target).scrollIntoView({ block: 'center' });
    $(target).focus({ preventScroll: true });
});
ToolUI.run(async () => {
    const preferences = await collectify.storage.get('preferences');
    for (const [id, key] of [
        ['unit', 'unit'],
        ['zone', 'zone'],
        ['date-zone', 'dateZone'],
        ['output-unit', 'outputUnit'],
        ['batch-unit', 'batchUnit'],
        ['batch-zone', 'batchZone']
    ]) {
        const value = preferences?.[key] === 'utc' ? 'UTC' : preferences?.[key];
        if ([...$('#' + id).options].some((option) => option.value === value)) $('#' + id).value = value;
    }
    if (['seconds', 'milliseconds'].includes(preferences?.clockUnit)) clockUnit = preferences.clockUnit;
    await ToolUI.ready;
    syncControls();
    tick();
});
$('#datetime').value = TimestampTool.formatInZone(Date.now(), 'local');
tick();
const timer = setInterval(tick, 1000);
window.addEventListener('unload', () => clearInterval(timer), { once: true });
