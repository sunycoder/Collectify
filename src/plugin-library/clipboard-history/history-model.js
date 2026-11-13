(function (root) {
    const BUDGET = 6 * 1024 * 1024,
        MAX_ITEMS = 100,
        CHUNK = 120000;
    function makeEntry(snapshot, at = new Date().toISOString()) {
        if (!snapshot || !['text', 'image', 'files'].includes(snapshot.kind) || !/^\w{64}$/.test(snapshot.fingerprint))
            throw Error('剪贴板记录格式无效');
        const id = snapshot.fingerprint,
            body = snapshot.data || '',
            chunks = [];
        for (let start = 0; start < body.length; start += CHUNK) chunks.push(body.slice(start, start + CHUNK));
        const value = { ...snapshot };
        delete value.data;
        return {
            meta: {
                id,
                kind: snapshot.kind,
                at,
                favorite: false,
                bytes: snapshot.bytes,
                characters: snapshot.text?.length || 0,
                preview: snapshot.kind === 'text' ? snapshot.text.slice(0, 300) : '',
                files: snapshot.files || [],
                width: snapshot.width || 0,
                height: snapshot.height || 0,
                chunks: chunks.length,
                cost: body.length + (snapshot.text?.length || 0) * 3 + 1000
            },
            value,
            chunks
        };
    }
    function insert(items, entry) {
        const prior = items.find((item) => item.id === entry.meta.id),
            next = [
                { ...entry.meta, favorite: prior?.favorite || false },
                ...items.filter((item) => item.id !== entry.meta.id)
            ],
            removed = [];
        while (next.length > MAX_ITEMS || next.reduce((sum, item) => sum + item.cost, 0) > BUDGET) {
            const index = next.findLastIndex((item) => !item.favorite && item.id !== entry.meta.id);
            if (index < 0) throw Error('收藏或记录空间已满，请删除部分记录后继续');
            removed.push(next.splice(index, 1)[0]);
        }
        return { items: next, removed };
    }
    function keys(item) {
        return ['entry.' + item.id, ...Array.from({ length: item.chunks }, (_, i) => `blob.${item.id}.${i}`)];
    }
    function filter(items, tab, query) {
        const q = String(query || '')
            .trim()
            .toLowerCase();
        return items.filter(
            (item) =>
                (tab === 'all' || tab === 'favorites' ? tab !== 'favorites' || item.favorite : item.kind === tab) &&
                (!q || (item.preview + ' ' + item.files.join(' ')).toLowerCase().includes(q))
        );
    }
    async function fromLegacy(old) {
        if (typeof old?.text !== 'string' || new TextEncoder().encode(old.text).length > 65536) return null;
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('text\0' + old.text));
        const fingerprint = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
        return makeEntry(
            { kind: 'text', text: old.text, bytes: new TextEncoder().encode(old.text).length, fingerprint },
            old.at || new Date().toISOString()
        );
    }
    const api = { makeEntry, insert, keys, filter, fromLegacy, BUDGET, MAX_ITEMS };
    if (typeof module !== 'undefined') module.exports = api;
    else root.ClipboardHistory = api;
})(globalThis);
