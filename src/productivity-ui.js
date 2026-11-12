const TASK_STATUSES = {inbox: '收集箱', todo: '待处理', doing: '进行中', done: '已完成'};
const PRIORITIES = {high: '高优先级', medium: '普通', low: '低优先级'};
let editingTask = null, editingNote = null, taskAttachments = [], taskDragId = '', calendarDate = new Date(),
    taskView = 'list';

function localDay(value) {
    const d = new Date(value);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function localInput(value) {
    if (!value) return '';
    const d = new Date(value);
    return `${localDay(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formattedDate(value) {
    return value ? new Date(value).toLocaleString('zh-CN', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    }) : '未设置日期';
}

function isOverdue(t) {
    return window.TaskSchedule.overdue(t);
}

async function showSection(section) {
    currentSection = section;
    hideMenu();
    await call('home');
    updateViews();
    renderProductivity();
}

$('#tasks-nav').onclick = task(() => showSection('tasks'));
$('#notes-nav').onclick = task(() => showSection('notes'));

function taskFilters(){return {filter:$('#task-filter').value,query:$('#task-search').value,date:$('#task-date-query').value,dateField:$('#task-date-field').value};}
function clearTaskFilters(){
    $('#task-search').value='';$('#task-filter').value='active';
    $('#task-date-query')._flatpickr?.clear(false);$('#task-date-query').value='';
    window.OfficeUI?.refresh();renderProductivity();
}

function renderProductivity() {
    const tasks = state.tasks || [], active = tasks.filter(t => !t.archived && t.status !== 'done');
    $('#tasks-count').textContent = active.length;
    $('#task-stats').replaceChildren();
    for (const [label, count, name] of [['待推进', active.length, 'blue'], ['今天到期', active.filter(t => t.dueAt && localDay(t.dueAt) === localDay(new Date())).length, 'sage'], ['已逾期', active.filter(isOverdue).length, 'rose'], ['已完成', tasks.filter(t => t.status === 'done' && !t.archived).length, 'purple']]) {
        const node = el('div', `task-stat ${name}`);
        node.append(el('span', '', label), el('strong', '', count));
        $('#task-stats').append(node);
    }
    const filters=taskFilters(),filterValue=filters.filter;
    const visible = tasks.filter(t=>window.TaskQuery.matchesFilters(t,filters));
    let summary=$('#task-filter-summary');
    if(!summary){summary=el('div','task-filter-summary');summary.id='task-filter-summary';$('.task-toolbar').after(summary);}
    const filtered=!!(filters.date||filters.query.trim()||filters.filter!=='active');
    summary.replaceChildren(el('span','',`当前显示 ${visible.length} 项 · 全部未归档 ${tasks.filter(t=>!t.archived).length} 项${filters.date?` · ${$('#task-date-field').selectedOptions[0].textContent}：${filters.date}`:''}${filters.query.trim()?` · 搜索：${filters.query.trim()}`:''}${filters.filter!=='active'?` · ${$('#task-filter').selectedOptions[0].textContent}`:''}`));
    if(filtered)summary.append(button('清除全部筛选','close',clearTaskFilters,'quiet'));
    if(!visible.length&&filtered)summary.prepend(el('strong','','没有符合当前筛选的待办。'));
    $('#keep-in-tray').checked = state.settings?.keepInTray || false;
    $('#clear-task-date').hidden = !$('#task-date-query').value;
    for (const view of ['list', 'matrix', 'board', 'calendar']) {
        $(`#task-${view}-button`).classList.toggle('selected', taskView === view);
        $(`#task-${view}`).hidden = taskView !== view;
    }
    $('#task-board').replaceChildren();
    for (const [status, label] of Object.entries(TASK_STATUSES)) {
        const column = el('section', `task-column ${status}`);
        column.dataset.status = status;
        const items = visible.filter(t => t.status === status).sort((a, b) => ({
            high: 0,
            medium: 1,
            low: 2
        }[a.priority] - {
            high: 0,
            medium: 1,
            low: 2
        }[b.priority]) || (Date.parse(a.dueAt) || Infinity) - (Date.parse(b.dueAt) || Infinity));
        const heading = el('div', 'task-column-heading');
        heading.append(el('span', 'status-dot'), el('h2', '', label), el('b', '', items.length));
        if (filterValue !== 'archive') heading.append(button('添加待办', 'plus', () => showTask(null, {status}), 'icon-button'));
        column.append(heading);
        const body = el('div', 'task-column-body');
        for (const item of items) body.append(taskCard(item, true));
        if (!items.length) body.append(el('div', 'task-column-empty', status === 'done' ? '完成后，把任务移到这里' : '暂无任务，拖入或添加一条'));
        if (filterValue !== 'archive') body.append(button('添加待办', 'plus', () => showTask(null, {status}), 'board-add-task'));
        column.append(body);
        column.ondragover = event => {
            if (taskDragId && filterValue !== 'archive') {
                event.preventDefault();
                column.classList.add('drop-target');
            }
        };
        column.ondragleave = () => column.classList.remove('drop-target');
        column.ondrop = task(async event => {
            event.preventDefault();
            column.classList.remove('drop-target');
            const t = tasks.find(t => t.id === taskDragId);
            if (t && filterValue !== 'archive') {
                await call('task-save', {...t, status});
                taskDragId = '';
                await refresh();
            }
        });
        $('#task-board').append(column);
    }
    renderTaskList(visible);
    renderMatrix(visible);
    requestAnimationFrame(fitTaskBoard);
    if (taskView === 'calendar') renderOfficeCalendar(visible);
    $('#notes-grid').replaceChildren();
    const noteQuery = $('#note-search').value.trim().toLowerCase(),
        visibleNotes = (state.notes || []).filter(note => [note.title, note.content].some(value => value.toLowerCase().includes(noteQuery))).sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    $('#note-count').textContent = `${visibleNotes.length} 张便签`;
    for (const note of visibleNotes) {
        const node = el('article', `sticky-note ${note.color}`);
        node.dataset.id = note.id;
        const title = el('h2', '', note.title), content = el('p', '', note.content || '还没有内容');
        const actions = el('div', 'sticky-actions');
        actions.append(button('编辑', 'edit', () => showNote(note)), button('转为待办', 'list', () => showTask(null, {
            title: note.title,
            note: note.content
        })), button('删除便签', 'trash', () => confirmDelete('notes', note), 'icon-button'));
        node.append(title, content, el('small', '', `更新于 ${formattedDate(note.updatedAt)}`), actions);
        $('#notes-grid').append(node);
        node.tabIndex = 0;
        node.setAttribute('aria-label', `编辑便签 ${note.title}`);
        node.onclick = task(event => {
            if (!event.target.closest('button')) return showNote(note);
        });
        node.onkeydown = task(event => {
            if (event.target === node && event.key === 'Enter') return showNote(note);
        });
    }
    if (!state.notes?.length) $('#notes-grid').append(el('p', 'no-notes', '还没有便签。点击“写便签”，随手记录想法。'));
}

function fitTaskBoard() {
    const board = $('#task-board');
    if (board.hidden) return;
    // 以真实可用高度分配等高列，长列表在列内滚动，标题和筛选始终容易找到。
    board.style.setProperty('--board-height', `${Math.max(280, window.innerHeight - board.getBoundingClientRect().top - 24)}px`);
}

window.addEventListener('resize', fitTaskBoard);

function taskCard(t, board = false) {
    const node = el('article', `task-card priority-${t.priority}${isOverdue(t) ? ' overdue' : ''}`);
    node.dataset.id = t.id;
    node.draggable = !t.archived;
    node.ondragstart = event => {
        taskDragId = t.id;
        event.dataTransfer.setData('text/plain', t.id);
        event.dataTransfer.effectAllowed = 'move';
    };
    node.ondragend = () => {
        taskDragId = '';
        document.querySelectorAll('.task-column').forEach(c => c.classList.remove('drop-target'));
    };
    const top = el('div', 'task-card-top');
    top.append(el('span', `priority-label ${t.priority}`, PRIORITIES[t.priority]));
    if (t.important) top.append(el('span', 'board-important', '重要'));
    if (t.urgent) top.append(el('span', 'board-urgent', '紧急'));
    if (t.notifiedAt && t.status !== 'done' && !t.archived) top.append(el('span', 'reminded-label', '已提醒'));
    const edit = button(t.title, null, () => showTask(t), 'task-title');
    node.append(top, edit);
    if (t.note) node.append(el('p', 'task-excerpt', t.note));
    if (t.dueAt) {
        const date = el('span', `task-date${isOverdue(t) ? ' overdue' : ''}`, `${isOverdue(t) ? '已逾期 · ' : ''}${formattedDate(t.dueAt)}`);
        date.title = '截止时间';
        node.append(date);
    } else if (t.startAt) node.append(el('span', 'task-date', `计划 ${formattedDate(t.startAt)}`));
    if (t.remindAt && t.status !== 'done' && !t.archived) node.append(el('span', 'task-reminder-time', `提醒 ${formattedDate(t.remindAt)}`));
    const bookmark = state.entries.find(e => e.id === t.bookmarkId);
    if (bookmark) node.append(button(bookmark.name, 'external', () => open(bookmark), 'task-link'));
    else if (t.bookmarkId) node.append(el('small', 'task-reminder-time', '关联收藏已删除'));
    if (t.attachments.length) {
        const files = el('div', 'task-files');
        t.attachments.forEach((file, index) => files.append(button(file.split(/[\\/]/).at(-1), 'folder', () => call('open-file', {
            id: t.id,
            index,
            reveal: true
        }), 'task-file')));
        node.append(files);
    }
    const actions = el('div', 'task-card-actions');
    if (t.archived) actions.append(button('恢复到看板', 'reload', async () => {
        await call('task-save', {...t, archived: false});
        await refresh();
    }));
    else {
        const status = el('select');
        status.setAttribute('aria-label', '变更状态');
        for (const [value, label] of Object.entries(TASK_STATUSES)) {
            const option = el('option', '', label);
            option.value = value;
            status.append(option);
        }
        status.value = t.status;
        status.onchange = task(async () => {
            await call('task-save', {...t, status: status.value});
            await refresh();
        });
        actions.append(status);
        if (t.status === 'done') actions.append(button('归档', 'folder', async () => {
            await call('task-save', {...t, archived: true});
            await refresh();
        }));
        else actions.append(button('稍后 10 分钟', 'clock', async () => {
            await call('task-save', {...t, remindAt: new Date(Date.now() + 600000).toISOString()});
            await refresh();
            toast('将在 10 分钟后提醒');
        }, 'icon-button'));
    }
    actions.append(button('删除待办', 'trash', () => confirmDelete('tasks', t), 'icon-button'));
    node.append(actions);
    if (board) {
        node.classList.add('board-card');
        node.tabIndex = 0;
        node.setAttribute('aria-label', `${t.title}，${TASK_STATUSES[t.status]}，${PRIORITIES[t.priority]}`);
        node.onclick = task(event => {
            if (!event.target.closest('button,input,select,.ts-wrapper')) return showTask(t);
        });
        node.onkeydown = task(event => {
            if (event.target === node && event.key === 'Enter') return showTask(t);
        });
    }
    return node;
}

function checklistRow(t) {
    const row = el('article', `checklist-row${t.status === 'done' ? ' completed' : ''}`);
    row.dataset.id = t.id;
    row.draggable = !t.archived;
    row.ondragstart = event => {
        taskDragId = t.id;
        event.dataTransfer.setData('text/plain', t.id);
    };
    row.ondragend = () => {
        taskDragId = '';
        document.querySelectorAll('.quadrant').forEach(n => n.classList.remove('drop-target'));
    };
    const check = el('input');
    check.type = 'checkbox';
    check.checked = t.status === 'done';
    check.setAttribute('aria-label', `完成 ${t.title}`);
    check.onchange = task(async () => {
        await call('task-save', {...t, status: check.checked ? 'done' : 'todo'});
        await refresh();
    });
    const content = el('div', 'checklist-content');
    content.append(button(t.title, null, () => showTask(t), 'checklist-title'));
    const meta = el('div', 'checklist-meta');
    const anchor = window.TaskSchedule.anchor(t);
    if (anchor) meta.append(el('span', isOverdue(t) ? 'overdue' : '', `${t.allDay ? '全天 · ' : ''}${formattedDate(anchor)}`));
    if (t.remindAt) meta.append(el('span', '', `提醒 ${formattedDate(t.remindAt)}`));
    if (t.note) meta.append(el('span', 'checklist-note', t.note));
    content.append(meta);
    const tags = el('div', 'checklist-tags');
    if (t.important) tags.append(el('span', 'flag-important', '重要'));
    if (t.urgent) tags.append(el('span', 'flag-urgent', '紧急'));
    tags.append(el('span', `task-status ${t.status}`, TASK_STATUSES[t.status]));
    const actions = el('div', 'checklist-actions');
    if (t.status === 'done') actions.append(button(t.archived ? '恢复' : '归档', 'folder', async () => {
        await call('task-save', {...t, archived: !t.archived});
        await refresh();
    }, 'icon-button'));
    actions.append(button('编辑待办', 'edit', () => showTask(t), 'icon-button'), button('删除待办', 'trash', () => confirmDelete('tasks', t), 'icon-button'));
    row.append(check, content, tags, actions);
    return row;
}

function renderTaskList(tasks) {
    const list = $('#task-list');
    list.replaceChildren();
    const groups = [['overdue', '已逾期', t => isOverdue(t)], ['today', '今天', t => !isOverdue(t) && t.status !== 'done' && window.TaskSchedule.anchor(t) && localDay(window.TaskSchedule.anchor(t)) === localDay(new Date())],
        ['future', '之后的安排', t => t.status !== 'done' && !isOverdue(t) && window.TaskSchedule.anchor(t) && localDay(window.TaskSchedule.anchor(t)) !== localDay(new Date())], ['unscheduled', '未安排时间', t => t.status !== 'done' && !window.TaskSchedule.anchor(t)], ['done', '已完成', t => t.status === 'done']];
    for (const [key, title, predicate] of groups) {
        const items = tasks.filter(predicate).sort((a, b) => (Date.parse(window.TaskSchedule.anchor(a)) || Infinity) - (Date.parse(window.TaskSchedule.anchor(b)) || Infinity));
        if (!items.length) continue;
        const section = el('section', `checklist-section ${key}`), heading = el('div', 'checklist-heading');
        heading.append(el('span', 'group-dot'), el('h2', '', title), el('span', '', items.length));
        section.append(heading);
        for (const t of items) section.append(checklistRow(t));
        list.append(section);
    }
    if (!tasks.length) list.append(el('div', 'task-list-empty', '没有匹配的待办，试试调整筛选或创建新事项。'));
    const quick = el('form', 'quick-task'), input = el('input');
    input.placeholder = '＋ 添加待办，按 Enter 保存';
    input.maxLength = 160;
    input.setAttribute('aria-label', '快速添加待办');
    quick.append(input);
    quick.onsubmit = task(async event => {
        event.preventDefault();
        if (input.value.trim()) {
            const saved=await call('task-save', {title: input.value.trim(), status: 'todo'});
            if(!window.TaskQuery.matchesFilters(saved,taskFilters())){clearTaskFilters();toast('已添加待办，并清除筛选以显示该事项');}
            await refresh();
            $('#task-list .quick-task input')?.focus();
        }
    });
    list.append(quick);
}

function renderMatrix(tasks) {
    const root = $('#task-matrix');
    root.replaceChildren();
    for (const [id, title, description, important, urgent] of [['do', '重要且紧急', '立即处理，优先推进', true, true], ['plan', '重要不紧急', '提前规划，持续投入', true, false], ['delegate', '紧急不重要', '简化执行，及时处理', false, true], ['later', '不重要不紧急', '稍后处理，适当留白', false, false]]) {
        const items = tasks.filter(t => window.TaskSchedule.quadrant(t) === id),
            section = el('section', `quadrant ${id}`);
        section.dataset.quadrant = id;
        const head = el('div', 'quadrant-heading');
        const copy = el('div');
        copy.append(el('h2', '', title), el('p', '', description));
        head.append(copy, el('span', '', items.length), button('添加待办', 'plus', () => showTask(null, {
            important,
            urgent,
            status: 'todo'
        }), 'icon-button'));
        section.append(head);
        for (const t of items) section.append(checklistRow(t));
        if (!items.length) section.append(el('div', 'quadrant-empty', '拖入事项，或点击 ＋ 添加'));
        section.ondragover = e => {
            if (taskDragId) {
                e.preventDefault();
                section.classList.add('drop-target');
            }
        };
        section.ondragleave = () => section.classList.remove('drop-target');
        section.ondrop = task(async e => {
            e.preventDefault();
            const t = state.tasks.find(t => t.id === taskDragId);
            if (t && !t.archived) {
                await call('task-save', {...t, important, urgent});
                taskDragId = '';
                await refresh();
            }
        });
        root.append(section);
    }
}

function renderAttachments() {
    $('#task-attachments').replaceChildren();
    taskAttachments.forEach((file, index) => {
        const row = el('div', 'attachment-row');
        row.append(el('span', '', file), button('移除附件', 'close', () => {
            taskAttachments.splice(index, 1);
            renderAttachments();
        }, 'icon-button'));
        $('#task-attachments').append(row);
    });
}

async function showTask(t = null, initial = {}) {
    hideMenu();
    await call('overlay', true);
    editingTask = t?.id || null;
    const form = $('#task-form'), value = t || initial;
    form.reset();
    form.querySelector('.form-error').textContent = '';
    $('#task-dialog-title').textContent = t ? '待办详情' : '新建待办';
    for (const field of ['title', 'note', 'status', 'priority']) form.elements[field].value = value[field] || ({
        status: 'inbox',
        priority: 'medium'
    }[field] || '');
    for (const field of ['dueAt', 'remindAt', 'startAt', 'endAt']) form.elements[field].value = localInput(value[field]);
    for (const field of ['important', 'urgent', 'allDay']) form.elements[field].checked = value[field] === true;
    form.elements.bookmarkId.replaceChildren(el('option', '', '不关联'));
    form.elements.bookmarkId.firstChild.value = '';
    for (const bookmark of state.entries) {
        const option = el('option', '', bookmark.name);
        option.value = bookmark.id;
        form.elements.bookmarkId.append(option);
    }
    form.elements.bookmarkId.value = state.entries.some(e => e.id === value.bookmarkId) ? value.bookmarkId : '';
    taskAttachments = [...(value.attachments || [])];
    renderAttachments();
    $('#task-dialog').showModal();
}

async function showNote(note = null) {
    await call('overlay', true);
    editingNote = note?.id || null;
    const form = $('#note-form');
    form.reset();
    form.querySelector('.form-error').textContent = '';
    for (const field of ['title', 'content', 'color']) form.elements[field].value = note?.[field] || (field === 'color' ? 'yellow' : '');
    $('#note-dialog').showModal();
}

async function confirmDelete(kind, item) {
    await showAction({
        title: kind === 'tasks' ? '删除这条待办？' : '删除这张便签？',
        description: item.title,
        hideTarget: true,
        danger: true,
        confirm: '删除',
        action: async () => {
            await call(kind === 'tasks' ? 'task-delete' : 'note-delete', item.id);
            await refresh();
            toast('已删除');
        }
    });
}

for (const id of ['task-dialog', 'note-dialog']) {
    const dialog = document.getElementById(id);
    // 这些弹窗在脚本加载前已被主脚本绑定通用关闭行为。
    dialog.addEventListener('close', () => {
        if (id === 'task-dialog') taskAttachments = [];
    });
}
$('#new-task').onclick = task(() => showTask());
$('#new-note').onclick = task(() => showNote());
$('#task-form').onsubmit = async event => {
    event.preventDefault();
    const form = event.currentTarget, submit = form.querySelector('[type=submit]');
    submit.disabled = true;
    try {
        const value = Object.fromEntries(new FormData(form));
        value.attachments = taskAttachments;
        for (const field of ['dueAt', 'remindAt', 'startAt', 'endAt']) value[field] = value[field] ? new Date(value[field]).toISOString() : '';
        for (const field of ['important', 'urgent', 'allDay']) value[field] = form.elements[field].checked;
        if (editingTask) value.id = editingTask;
        const saved=await call('task-save', value);
        const wasHidden=!window.TaskQuery.matchesFilters(saved,taskFilters());
        if(wasHidden)clearTaskFilters();
        $('#task-dialog').close();
        await refresh();
        if(taskView==='calendar'&&typeof officeCalendar!=='undefined'&&officeCalendar){officeCalendar.gotoDate(saved.startAt||saved.dueAt||new Date());}
        toast(wasHidden?'待办已保存，已清除筛选以显示该事项':'待办已保存');
    } catch (error) {
        form.querySelector('.form-error').textContent = error.message;
    } finally {
        submit.disabled = false;
    }
};
$('#note-form').onsubmit = async event => {
    event.preventDefault();
    const form = event.currentTarget, submit = form.querySelector('[type=submit]');
    submit.disabled = true;
    try {
        const value = Object.fromEntries(new FormData(form));
        if (editingNote) value.id = editingNote;
        await call('note-save', value);
        $('#note-dialog').close();
        await refresh();
        toast('便签已保存');
    } catch (error) {
        form.querySelector('.form-error').textContent = error.message;
    } finally {
        submit.disabled = false;
    }
};
for (const [id, action] of [['attach-file', 'pick-files'], ['attach-folder', 'pick-folder']]) document.getElementById(id).onclick = task(async () => {
    const files = await call(action);
    taskAttachments = [...new Set([...taskAttachments, ...files])];
    renderAttachments();
});
$('#task-search').oninput = $('#task-filter').onchange = renderProductivity;
$('#note-search').oninput = renderProductivity;
$('#task-date-query').onchange = $('#task-date-field').onchange = renderProductivity;
$('#clear-task-date').onclick = () => {
    $('#task-date-query').value = '';
    renderProductivity();
};
$('#desktop-tasks').onclick = event => menu(event.currentTarget, [
    {label: '悬浮置顶待办', icon: 'pin', run: () => call('widget-open', 'floating')},
    {label: '独立桌面待办（不置顶）', icon: 'external', run: () => call('widget-open', 'desktop')}
]);
for (const view of ['list', 'matrix', 'board', 'calendar']) $(`#task-${view}-button`).onclick = () => {
    taskView = view;
    renderProductivity();
};
$('#keep-in-tray').onchange = task(async () => {
    await call('settings', {keepInTray: $('#keep-in-tray').checked});
    await refresh();
    toast(state.settings.keepInTray ? '关闭窗口后将驻留托盘；从托盘菜单可完全退出' : '关闭窗口将退出程序并停止提醒');
});
