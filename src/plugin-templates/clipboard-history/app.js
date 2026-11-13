const $ = (selector) => document.querySelector(selector);
let items = [],
    timer = null,
    busy = false,
    loaded = false,
    generation = 0;
function render() {
    $('#history').replaceChildren();
    const query = $('#search').value.trim().toLowerCase();
    for (const item of items.filter((item) => item.text.toLowerCase().includes(query))) {
        const row = document.createElement('article'),
            copy = document.createElement('button'),
            content = document.createElement('div'),
            text = document.createElement('pre'),
            date = document.createElement('small');
        row.className = 'history-item';
        text.textContent = item.text;
        date.textContent = new Date(item.at).toLocaleString();
        copy.textContent = '复制';
        copy.onclick = () =>
            ToolUI.run(async () => {
                await collectify.clipboard.writeText(item.text);
                ToolUI.message('已复制');
            });
        content.append(text, date);
        row.append(content, copy);
        $('#history').append(row);
    }
    if (!items.length) {
        const empty = document.createElement('p');
        empty.textContent = '还没有记录。点击“读取一次”或开启采集。';
        $('#history').append(empty);
    }
}
async function read() {
    if (busy || !loaded) return;
    busy = true;
    const started = generation;
    try {
        const text = await collectify.clipboard.readText();
        if (started !== generation) return;
        ToolUI.message(timer ? '采集中' : '读取完成');
        if (!text || items[0]?.text === text) return;
        if (text.length > 2000) {
            ToolUI.message('文本超过 2000 字符，本次不记录');
            return;
        }
        const next = [{ text, at: new Date().toISOString() }, ...items.filter((item) => item.text !== text)].slice(
            0,
            30
        );
        await collectify.storage.set('history', next);
        if (started !== generation) return;
        items = next;
        render();
        ToolUI.message(timer ? '采集中' : '已记录一次');
    } finally {
        busy = false;
    }
}
$('#capture').onclick = () => {
    if (timer) {
        generation++;
        clearInterval(timer);
        timer = null;
        $('#capture').textContent = '开启采集';
        ToolUI.message('已停止采集');
    } else {
        timer = setInterval(() => void ToolUI.run(read), 1000);
        $('#capture').textContent = '停止采集';
        void ToolUI.run(read);
    }
};
$('#read-once').onclick = () => ToolUI.run(read);
$('#clear').onclick = () =>
    ToolUI.run(async () => {
        if (!confirm('清空本机保存的剪贴板历史？')) return;
        generation++;
        clearInterval(timer);
        timer = null;
        $('#capture').textContent = '开启采集';
        await collectify.storage.delete('history');
        items = [];
        render();
        ToolUI.message('历史已清空');
    });
$('#search').oninput = render;
window.addEventListener('unload', () => clearInterval(timer), { once: true });
ToolUI.run(async () => {
    const saved = await collectify.storage.get('history');
    items = Array.isArray(saved)
        ? saved
              .filter(
                  (item) =>
                      item && typeof item.text === 'string' && item.text.length <= 2000 && typeof item.at === 'string'
              )
              .slice(0, 30)
        : [];
    loaded = true;
    render();
});
