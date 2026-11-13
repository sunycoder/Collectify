const button = document.querySelector('#open');
let gesture = null,
    frame = 0;
const coordinates = (event, phase) => ({ phase, x: event.screenX, y: event.screenY });
const report = (error) => {
    button.title = error.message;
};
button.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    button.setPointerCapture(event.pointerId);
    gesture = { id: event.pointerId, x: event.screenX, y: event.screenY, moved: false, last: event };
    gesture.ready = collectify.windows.drag(coordinates(event, 'start')).catch(report);
});
button.addEventListener('pointermove', (event) => {
    if (!gesture || gesture.id !== event.pointerId) return;
    gesture.last = event;
    if (Math.hypot(event.screenX - gesture.x, event.screenY - gesture.y) >= 4) gesture.moved = true;
    if (!gesture.moved || frame) return;
    button.classList.add('dragging');
    frame = requestAnimationFrame(() => {
        frame = 0;
        const current = gesture;
        if (current)
            void current.ready
                .then(() => {
                    if (gesture === current) return collectify.windows.drag(coordinates(current.last, 'move'));
                })
                .catch(report);
    });
});
async function finish(event, cancelled = false) {
    const current = gesture;
    if (!current || current.id !== event.pointerId) return;
    gesture = null;
    cancelAnimationFrame(frame);
    frame = 0;
    button.classList.remove('dragging');
    if (button.hasPointerCapture(event.pointerId)) button.releasePointerCapture(event.pointerId);
    try {
        await current.ready;
        await collectify.windows.drag(coordinates(event, 'end'));
        if (!current.moved && !cancelled) await collectify.windows.reveal();
    } catch (error) {
        report(error);
    }
}
button.addEventListener('pointerup', (event) => void finish(event));
button.addEventListener('pointercancel', (event) => void finish(event, true));
button.onclick = (event) => {
    if (event.detail === 0 && !gesture) void collectify.windows.reveal().catch(report);
};
document.addEventListener('contextmenu', async (event) => {
    event.preventDefault();
    try {
        await collectify.background.request({ action: 'shortcut', enabled: false });
    } catch (error) {
        button.title = error.message;
    }
});
