function transferMeter({ total = 0, now = Date.now } = {}) {
    const started = now();
    let previousAt = started,
        previousBytes = 0,
        speed = 0;
    return (received = 0, declared = total, phase = 'downloading') => {
        const at = now(),
            delta = at - previousAt;
        if (delta >= 500) {
            speed = Math.max(0, ((received - previousBytes) * 1000) / delta);
            previousBytes = received;
            previousAt = at;
        }
        const size = declared || total;
        return {
            phase,
            received,
            total: size,
            speed,
            elapsed: Math.max(0, (at - started) / 1000),
            remaining: speed > 0 && size > received ? (size - received) / speed : null,
            percent: size ? Math.min(100, (received / size) * 100) : null
        };
    };
}
function networkMessage(error, signal) {
    if (signal?.aborted)
        return signal.reason?.name === 'AbortError' ? '下载已取消' : signal.reason?.message || '下载已取消';
    if (error.name === 'TimeoutError') return '下载超时，请检查网络后重试';
    if (error.name === 'AbortError') return '下载已取消';
    if (
        error.message === 'fetch failed' ||
        /ECONNRESET|UND_ERR_|ETIMEDOUT|ENOTFOUND/.test(error.cause?.code || error.code || '')
    )
        return '下载连接中断，请检查代理或公司网络后重试';
    return error.message;
}
module.exports = { transferMeter, networkMessage };
