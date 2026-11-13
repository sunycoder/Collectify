let editingNote = null,
    noteColor = 'all';
function formattedDate(value) {
    return new Date(value).toLocaleString('zh-CN', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}
function renderNotes() {
    $('#notes-grid').replaceChildren();
    const noteQuery = $('#note-search').value.trim().toLowerCase(),
        visibleNotes = (state.notes || [])
            .filter(
                (note) =>
                    (noteColor === 'all' || note.color === noteColor) &&
                    [note.title, note.content].some((value) => value.toLowerCase().includes(noteQuery))
            )
            .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    $('#note-count').textContent = `${visibleNotes.length} 张便签`;
    for (const note of visibleNotes) {
        const node = el('article', `sticky-note ${note.color}`);
        node.dataset.id = note.id;
        const title = el('h2', '', note.title),
            content = el('p', '', note.content || '还没有内容');
        const actions = el('div', 'sticky-actions');
        actions.append(
            button('编辑', 'edit', () => showNote(note)),
            button('转为待办', 'list', () => call('to-task', note.id)),
            button('删除便签', 'trash', () => confirmDelete('notes', note), 'icon-button')
        );
        node.append(title, content, el('small', '', `更新于 ${formattedDate(note.updatedAt)}`), actions);
        $('#notes-grid').append(node);
        node.tabIndex = 0;
        node.setAttribute('aria-label', `编辑便签 ${note.title}`);
        node.onclick = task((event) => {
            if (!event.target.closest('button')) return showNote(note);
        });
        node.onkeydown = task((event) => {
            if (event.target === node && event.key === 'Enter') return showNote(note);
        });
    }
    if (!state.notes?.length) $('#notes-grid').append(el('p', 'no-notes', '还没有便签。点击“写便签”，随手记录想法。'));
}

async function showNote(note = null) {
    await call('overlay', true);
    editingNote = note?.id || null;
    const form = $('#note-form');
    form.reset();
    form.querySelector('.form-error').textContent = '';
    for (const field of ['title', 'content', 'color'])
        form.elements[field].value = note?.[field] || (field === 'color' ? 'yellow' : '');
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

$('#note-form').onsubmit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget,
        submit = form.querySelector('[type=submit]');
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

async function refresh() {
    state = await call('state');
    renderNotes();
}
$('#new-note').onclick = task(() => showNote());
$('#note-search').oninput = renderNotes;
const ready = refresh();
collectify.onNavigate(({ route }) => {
    void ready.then(() => {
        noteColor = ['yellow', 'blue', 'pink', 'green'].includes(route) ? route : 'all';
        renderNotes();
    });
});
