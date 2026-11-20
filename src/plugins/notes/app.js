let editingNote = null,
    noteColor = 'all';
function updatePageCache() {
    void collectify.page
        ?.setReclaimable(!document.querySelector('dialog[open]'), { query: $('#note-search').value, color: noteColor })
        .catch(() => {});
}
function formattedDate(value) {
    return new Date(value).toLocaleString('zh-CN', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}
function renderNotes() {
    updatePageCache();
    $('#notes-grid').replaceChildren();
    const previousScroll = document.scrollingElement.scrollTop;
    const noteQuery = $('#note-search').value.trim().toLowerCase(),
        visibleNotes = (state.notes || [])
            .filter(
                (note) =>
                    (noteColor === 'all' || note.color === noteColor) &&
                    [note.title, note.content].some((value) => value.toLowerCase().includes(noteQuery))
            )
            .sort(state.noteSort === 'manual' ? () => 0 : (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    $('#note-sort').value = state.noteSort || 'updated';
    $('#note-count').textContent = `${visibleNotes.length} 张便签`;
    const queryKey = JSON.stringify([noteQuery, noteColor, state.noteSort]);
    if (queryKey !== noteQueryKey) {
        noteQueryKey = queryKey;
        noteLimit = 100;
    }
    $('#more-notes').hidden = visibleNotes.length <= noteLimit;
    $('#note-count').textContent += visibleNotes.length > noteLimit ? ` · 已显示 ${noteLimit}` : '';
    for (const note of visibleNotes.slice(0, noteLimit)) {
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
        if (state.noteSort === 'manual') {
            const position = visibleNotes.findIndex((n) => n.id === note.id);
            const move = async (delta) => {
                const target = visibleNotes[position + delta];
                if (!target) return;
                await call(
                    'note-move',
                    delta < 0 ? { id: note.id, before: target.id } : { id: target.id, before: note.id }
                );
                await refresh();
                $('#notes-grid').querySelector(`[data-id="${note.id}"]`)?.focus({ preventScroll: true });
            };
            const up = button('向前移动', 'up', () => move(-1), 'icon-button'),
                down = button('向后移动', 'down', () => move(1), 'icon-button');
            up.disabled = position === 0;
            down.disabled = position === visibleNotes.length - 1;
            actions.prepend(up, down);
            node.draggable = true;
            node.ondragstart = (event) => event.dataTransfer.setData('application/collectify-note', note.id);
            node.ondragover = (event) => event.preventDefault();
            node.ondrop = task(async (event) => {
                event.preventDefault();
                const id = event.dataTransfer.getData('application/collectify-note');
                if (id && id !== note.id) {
                    await call('note-move', { id, before: note.id });
                    await refresh();
                }
            });
        }
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
    document.scrollingElement.scrollTop = previousScroll;
    if (!visibleNotes.length) {
        const empty = el('div', 'no-notes');
        empty.append(
            el(
                'p',
                '',
                state.notes?.length
                    ? '没有匹配的便签，可清除搜索与颜色筛选。'
                    : '还没有便签。点击“写便签”，随手记录想法。'
            )
        );
        if (state.notes?.length)
            empty.append(
                button('清除筛选', null, () => {
                    $('#note-search').value = '';
                    noteColor = 'all';
                    renderNotes();
                })
            );
        $('#notes-grid').append(empty);
    }
}

async function showNote(note = null) {
    await collectify.page?.setReclaimable(false);
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
        form.markSaved?.();
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
let noteLimit = 100,
    noteQueryKey = '';
$('#more-notes').onclick = () => {
    noteLimit += 100;
    renderNotes();
};
$('#note-search').oninput = renderNotes;
$('#note-sort').onchange = task(async () => {
    await call('note-sort', $('#note-sort').value);
    await refresh();
});
guardEditor($('#note-form'));
const ready = refresh();
document.querySelectorAll('dialog').forEach((dialog) => {
    dialog.addEventListener('close', updatePageCache);
    new MutationObserver(updatePageCache).observe(dialog, { attributes: true, attributeFilter: ['open'] });
});
collectify.onEvent(({ name, data }) => {
    if (name === 'page-restored')
        void ready.then(() => {
            $('#note-search').value = typeof data?.query === 'string' ? data.query : '';
            noteColor = ['yellow', 'blue', 'pink', 'green'].includes(data?.color) ? data.color : 'all';
            renderNotes();
        });
});
collectify.onNavigate(({ route, payload }) => {
    void ready.then(() => {
        if (payload?.focusId) {
            const item = state.notes.find((n) => n.id === payload.focusId);
            if (item) void showNote(item);
            return;
        }
        noteColor = ['yellow', 'blue', 'pink', 'green'].includes(route) ? route : 'all';
        renderNotes();
    });
});
