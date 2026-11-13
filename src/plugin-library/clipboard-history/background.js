let state = { version: 2, items: [], capturing: false, lastFingerprint: '' },
    lastError = '',
    queue = Promise.resolve();
const serial = (action) => {
    const next = queue.then(action);
    queue = next.catch(() => {});
    return next;
};
const announce = () => collectify.notify({ type: 'history-changed' });
async function save(next, { set = {}, remove = [], notify = true } = {}) {
    await collectify.storage.batch({ set: { ...set, 'history.v2': next }, delete: remove });
    state = next;
    if (notify) await announce();
}
async function append(snapshot) {
    if (!snapshot || snapshot.fingerprint === state.lastFingerprint) return;
    const entry = ClipboardHistory.makeEntry(snapshot),
        plan = ClipboardHistory.insert(state.items, entry),
        set = { ['entry.' + entry.meta.id]: entry.value };
    entry.chunks.forEach((part, index) => (set[`blob.${entry.meta.id}.${index}`] = part));
    await save(
        { ...state, items: plan.items, lastFingerprint: snapshot.fingerprint },
        { set, remove: plan.removed.flatMap(ClipboardHistory.keys) }
    );
    lastError = '';
}
async function capture() {
    if (!state.capturing) return;
    try {
        const priorError = lastError;
        await append(await collectify.clipboard.snapshot());
        lastError = '';
        if (priorError) await announce();
    } catch (error) {
        lastError = error.message;
        await announce();
    }
}
async function content(id) {
    const item = state.items.find((item) => item.id === id);
    if (!item) throw Error('记录已删除');
    const value = await collectify.storage.get('entry.' + id);
    if (!value) throw Error('记录内容缺失');
    if (item.chunks) {
        const chunks = [];
        for (let index = 0; index < item.chunks; index++)
            chunks.push(await collectify.storage.get(`blob.${id}.${index}`));
        if (chunks.some((part) => typeof part !== 'string')) throw Error('图片或文件记录不完整');
        value.data = chunks.join('');
    }
    return value;
}
const ready = (async () => {
    const saved = await collectify.storage.get('history.v2');
    if (saved?.version === 2 && Array.isArray(saved.items)) {
        state = saved;
    } else {
        // 1.0 的文本历史迁入新版，只有数据不迁入自动采集意图。
        const legacy = await collectify.storage.get('history');
        if (Array.isArray(legacy)) {
            const set = {},
                items = [];
            for (let i = 0; i < Math.min(legacy.length, 30); i++) {
                const entry = await ClipboardHistory.fromLegacy(legacy[i]);
                if (!entry || items.some((item) => item.id === entry.meta.id)) continue;
                items.push(entry.meta);
                set['entry.' + entry.meta.id] = entry.value;
            }
            await save({ ...state, items }, { set, remove: ['history'] });
        }
    }
    await collectify.background.setActive(state.capturing === true);
    await collectify.windows.shortcut(state.shortcutEnabled === true);
})();
collectify.onBackgroundRequest((request) =>
    serial(async () => {
        await ready;
        const { action, id } = request || {};
        switch (action) {
            case 'list': {
                const query = String(request.query || '')
                        .trim()
                        .toLowerCase(),
                    matches = [];
                for (const item of state.items) {
                    let text = item.files.join(' ');
                    if (query && item.kind === 'text')
                        text = (await collectify.storage.get('entry.' + item.id))?.text || item.preview;
                    if (!query || text.toLowerCase().includes(query)) matches.push(item.id);
                }
                return {
                    items: state.items,
                    matches,
                    capturing: state.capturing,
                    shortcutEnabled: state.shortcutEnabled === true,
                    error: lastError
                };
            }
            case 'shortcut':
                await collectify.windows.shortcut(request.enabled === true);
                await save({ ...state, shortcutEnabled: request.enabled === true });
                return;
            case 'capture':
                lastError = '';
                await save({ ...state, capturing: request.enabled === true });
                await collectify.background.setActive(state.capturing);
                if (state.capturing) await capture();
                return;
            case 'once': {
                const prior = state.capturing;
                await collectify.background.setActive(true);
                try {
                    await append(await collectify.clipboard.snapshot());
                } finally {
                    await collectify.background.setActive(prior);
                }
                return;
            }
            case 'content':
                return content(id);
            case 'copy': {
                const snapshot = await content(id);
                const written = await collectify.clipboard.writeSnapshot(snapshot);
                // 本插件复制只是恢复剪贴板，不是一次新的外部采集；保留原顺序和时间。
                await save(
                    { ...state, lastFingerprint: written?.fingerprint || snapshot.fingerprint },
                    { notify: false }
                );
                return;
            }
            case 'favorite':
                if (!state.items.some((item) => item.id === id)) throw Error('记录已删除');
                await save({
                    ...state,
                    items: state.items.map((item) => (item.id === id ? { ...item, favorite: !item.favorite } : item))
                });
                return;
            case 'delete': {
                const item = state.items.find((item) => item.id === id);
                if (!item) throw Error('记录已删除');
                await save(
                    { ...state, items: state.items.filter((item) => item.id !== id) },
                    { remove: ClipboardHistory.keys(item) }
                );
                return;
            }
            case 'clear': {
                const removed = state.items.filter((item) => !item.favorite);
                await save(
                    { ...state, items: state.items.filter((item) => item.favorite) },
                    { remove: removed.flatMap(ClipboardHistory.keys) }
                );
                return;
            }
            default:
                throw Error('未知的剪贴板操作');
        }
    })
);
const timer = setInterval(
    () =>
        void serial(async () => {
            await ready;
            await capture();
        }).catch(() => {}),
    1000
);
ready.catch((error) => {
    lastError = error.message;
    void collectify.notify({ type: 'history-changed' });
});
window.addEventListener('unload', () => clearInterval(timer), { once: true });
