let data, selectedDate = '';
const $ = selector => document.querySelector(selector);

function day(value) {
    const d = new Date(value);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function call(action, payload) {
    const result = await window.desktop.call(action, payload);
    if (!result.ok) {
        $('#error').textContent = result.error;
        return;
    }
    return result.data;
}

function render(next) {
    data = next;
    window.ShiyueTheme.apply(data.theme);
    $('#mode').classList.toggle('active', data.mode === 'floating');
    $('#mode').textContent = data.mode === 'floating' ? '已置顶' : '桌面';
    $('#mode-description').textContent = data.mode === 'floating' ? '悬浮置顶' : '独立桌面窗口';
    $('#day-title').textContent = selectedDate ? selectedDate === day(new Date()) ? '今天的安排' : `${Number(selectedDate.slice(5, 7))} 月 ${Number(selectedDate.slice(8))} 日` : '手边的事';
    const at = t => t.startAt || t.dueAt || '';
    const tasks = data.tasks.filter(t => !t.archived && (!selectedDate || (at(t) && day(at(t)) === selectedDate))).sort((a, b) => (Date.parse(at(a)) || Infinity) - (Date.parse(at(b)) || Infinity));
    $('#count').textContent = `${tasks.filter(t => t.status !== 'done').length} 件未完成`;
    $('#tasks').replaceChildren();
    const grouped = new Map();
    for (const t of tasks) {
        const key = at(t) ? day(at(t)) : 'unscheduled';
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key).push(t);
    }
    for (const [key, items] of grouped) {
        const heading = document.createElement('div');
        heading.className = 'timeline-day';
        heading.textContent = key === 'unscheduled' ? '未安排时间' : new Date(key + 'T12:00:00').toLocaleDateString('zh-CN', {
            weekday: 'long',
            month: '2-digit',
            day: '2-digit'
        });
        $('#tasks').append(heading);
        for (const task of items) {
            const row = document.createElement('label');
            row.className = `widget-task ${task.priority}${task.status === 'done' ? ' done' : ''}`;
            row.dataset.id = task.id;
            const check = document.createElement('input');
            check.type = 'checkbox';
            check.checked = task.status === 'done';
            check.onchange = () => call('toggle-task', task.id);
            const copy = document.createElement('div'), title = document.createElement('strong'),
                meta = document.createElement('small');
            title.textContent = task.title;
            meta.textContent = task.note || {
                inbox: '收集箱',
                todo: '待处理',
                doing: '进行中',
                done: '完成'
            }[task.status];
            const time = document.createElement('span');
            time.className = 'timeline-time';
            time.textContent = !at(task) ? '待定' : task.allDay ? '全天' : new Date(at(task)).toLocaleTimeString('zh-CN', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            });
            if (task.endAt && !task.allDay) {
                const end = document.createElement('small');
                end.textContent = new Date(task.endAt).toLocaleTimeString('zh-CN', {
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false
                });
                time.append(end);
            }
            copy.append(title, meta);
            row.append(time, check, copy);
            $('#tasks').append(row);
        }
    }
    if (!tasks.length) {
        const empty = document.createElement('p');
        empty.className = 'widget-empty';
        empty.textContent = selectedDate ? '这一天还没有安排。\n到主窗口中添加待办。' : '暂时没有待办。给自己留一点空白。';
        $('#tasks').append(empty);
    }
}

$('#date').onchange = () => {
    selectedDate = $('#date').value;
    render(data);
};
$('#all').onclick = () => {
    selectedDate = '';
    $('#date').value = '';
    render(data);
};
$('#today').onclick = () => {
    selectedDate = day(new Date());
    $('#date').value = selectedDate;
    render(data);
};
$('#mode').onclick = () => call('mode', data.mode === 'floating' ? 'desktop' : 'floating');
$('#open').onclick = () => call('open-main');
$('#hide').onclick = () => call('hide');
window.desktop.onState(render);
call('state').then(value => {
    if (value) render(value);
});
