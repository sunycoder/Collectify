const { webUrl } = require('./config');
class HttpError extends Error {
    constructor(status) {
        super(
            status === 401
                ? '登录已失效，请重新登录'
                : status === 403
                  ? '当前账号没有访问权限，请联系项目维护者'
                  : status === 404
                    ? '文件或版本不存在，或当前账号没有读取权限'
                    : `下载失败（HTTP ${status}）`
        );
        this.status = status;
    }
}
// 每次重定向重新判断凭据的目标；下载 CDN 不会收到 GitLab/GitHub Token。
async function request(
    url,
    { config, fetcher = fetch, headers = () => ({}), signal, limit = 1024 * 1024, sink, progress } = {}
) {
    const combined = signal
        ? AbortSignal.any([signal, AbortSignal.timeout(sink ? 30 * 60 * 1000 : 30000)])
        : AbortSignal.timeout(30000);
    for (let hop = 0; hop <= 5; hop++) {
        const target = webUrl(url, config);
        const response = await fetcher(target.href, {
            redirect: 'manual',
            credentials: 'omit',
            signal: combined,
            headers: headers(target)
        });
        if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get('location');
            await response.body?.cancel();
            if (!location || hop === 5) throw Error('下载重定向次数过多');
            const next = webUrl(new URL(location, target).href, config);
            if (target.protocol === 'https:' && next.protocol !== 'https:') throw Error('禁止下载降级到 HTTP');
            url = next.href;
            continue;
        }
        if (!response.ok) {
            await response.body?.cancel();
            throw new HttpError(response.status);
        }
        const total = Number(response.headers.get('content-length')) || 0;
        if (total > limit) {
            await response.body?.cancel();
            throw Error('下载超过大小限制');
        }
        const reader = response.body?.getReader();
        if (!reader) throw Error('下载内容为空');
        const chunks = [];
        let received = 0;
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                received += value.length;
                if (received > limit) throw Error('下载超过大小限制');
                if (sink) await sink(value);
                else chunks.push(Buffer.from(value));
                progress?.(received, total);
            }
        } catch (error) {
            await reader.cancel().catch(() => {});
            throw error;
        }
        combined.throwIfAborted();
        return sink ? received : Buffer.concat(chunks);
    }
}
function json(data) {
    try {
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(data).replace(/^\uFEFF/, ''));
    } catch {
        throw Error('服务器未返回有效 JSON，请检查文件路径、登录状态及源配置');
    }
}
module.exports = { request, json, HttpError };
