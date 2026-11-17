const cache = new Map();
let pending = Promise.resolve(),
    errorMessage = '',
    viewActive = true,
    context;
const listeners = new Set();
function notify() {
    for (const listener of listeners) listener({ error: errorMessage, active: viewActive, context });
}
export async function initialize() {
    const state = await window.collectify.invoke('state');
    for (const [key, value] of Object.entries(state.preferences)) cache.set(key, value);
    viewActive = state.visible;
    context = await window.collectify.context();
    window.collectify.onEvent((event) => {
        if (event.name === 'visibility') {
            viewActive = event.data;
            notify();
        }
    });
    window.collectify.onContextChanged((next) => {
        context = next;
        notify();
    });
}
export function read(key, fallback = null) {
    return cache.has(key) ? cache.get(key) : fallback;
}
export function write(key, value) {
    cache.set(key, value);
    // SDK 事件仅作为展示状态，不包含配置正文。配置快照串行提交，旧保存不能覆盖新设置。
    const preferences = Object.fromEntries(cache);
    pending = pending.catch(() => {}).then(() => window.collectify.invoke('preferences', preferences));
    pending.then(
        () => {
            errorMessage = '';
            notify();
        },
        (error) => {
            errorMessage = '设置未保存：' + error.message;
            notify();
        }
    );
    return pending;
}
export function onState(callback) {
    listeners.add(callback);
    callback({ error: errorMessage, active: viewActive, context });
    return () => listeners.delete(callback);
}
export const invoke = (action, input) => window.collectify.invoke(action, input);
export function retry() {
    return write('calendar-theme', read('calendar-theme', 'auto'));
}
export function status() {
    return { error: errorMessage, active: viewActive, context };
}
