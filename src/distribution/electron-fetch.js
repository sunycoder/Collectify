// Electron fetch 的 manual 重定向会取消请求；用 net.request 暴露重定向响应，交由 transport 逐跳验证。
function electronFetch(url, options = {}, network = require('electron').net) {
    return new Promise((resolve, reject) => {
        let settled = false,
            streamController,
            finished = false;
        const request = network.request({
            url: String(url),
            method: options.method || 'GET',
            headers: options.headers || {},
            redirect: 'manual',
            credentials: 'omit',
            useSessionCookies: false
        });
        const cleanup = () => options.signal?.removeEventListener('abort', abort);
        const fail = (error) => {
            if (finished) return;
            finished = true;
            cleanup();
            if (!settled) reject(error);
            else streamController?.error(error);
        };
        const abort = () => {
            fail(options.signal.reason || Error('下载已取消'));
            request.abort();
        };
        if (options.signal?.aborted) {
            abort();
            return;
        }
        options.signal?.addEventListener('abort', abort, { once: true });
        request.on('redirect', (status, method, target, raw) => {
            if (settled) return;
            settled = true;
            finished = true;
            cleanup();
            const headers = new Headers();
            for (const [key, value] of Object.entries(raw || {}))
                if (value) headers.set(key, Array.isArray(value) ? value.join(', ') : String(value));
            headers.set('location', target);
            resolve(new Response(null, { status, headers }));
            request.abort();
        });
        request.on('error', fail);
        request.on('abort', () => {
            if (!finished) fail(Error('下载已取消'));
        });
        request.on('response', (response) => {
            const headers = new Headers();
            for (const [key, value] of Object.entries(response.headers || {}))
                if (value) headers.set(key, Array.isArray(value) ? value.join(', ') : String(value));
            const body = new ReadableStream({
                start(controller) {
                    streamController = controller;
                    response.on('data', (chunk) => {
                        if (finished) return;
                        controller.enqueue(new Uint8Array(chunk));
                        if (controller.desiredSize <= 0) response.pause();
                    });
                    response.on('end', () => {
                        if (finished) return;
                        finished = true;
                        cleanup();
                        controller.close();
                    });
                    response.on('error', fail);
                    response.on('aborted', () => fail(Error('下载连接中断')));
                },
                pull() {
                    response.resume();
                },
                cancel() {
                    finished = true;
                    cleanup();
                    request.abort();
                }
            });
            settled = true;
            if ([204, 205, 304].includes(response.statusCode)) {
                void body.cancel();
                resolve(new Response(null, { status: response.statusCode, headers }));
            } else resolve(new Response(body, { status: response.statusCode, headers }));
        });
        request.end(options.body);
    });
}
module.exports = { electronFetch };
