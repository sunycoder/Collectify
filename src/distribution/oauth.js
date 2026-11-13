const http = require('node:http');
const { randomBytes, createHash, timingSafeEqual } = require('node:crypto');
const { CALLBACK } = require('./config');
function equal(a, b) {
    return (
        typeof a === 'string' &&
        typeof b === 'string' &&
        Buffer.byteLength(a) === Buffer.byteLength(b) &&
        timingSafeEqual(Buffer.from(a), Buffer.from(b))
    );
}
async function form(url, values, { fetcher = fetch, signal } = {}) {
    const response = await fetcher(url, {
        method: 'POST',
        redirect: 'error',
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
        headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(values).toString()
    });
    const text = await response.text();
    if (text.length > 65536) throw Error('授权响应过大');
    let value;
    try {
        value = JSON.parse(text);
    } catch {
        throw Error('授权服务器未返回有效 JSON');
    }
    if (!response.ok && !value.error) throw Error(`授权失败（HTTP ${response.status}）`);
    return value;
}
function tokens(value, previous = {}) {
    if (
        !value.access_token ||
        typeof value.access_token !== 'string' ||
        value.access_token.length > 8192 ||
        value.error
    )
        throw Error('授权失败，请重新登录并检查 OAuth 应用配置');
    return {
        accessToken: value.access_token,
        refreshToken: value.refresh_token || previous.refreshToken || '',
        expiresAt: value.expires_in ? Date.now() + Number(value.expires_in) * 1000 : 0
    };
}
async function gitlabLogin(config, provider, { openExternal, fetcher, signal }) {
    const verifier = randomBytes(32).toString('base64url'),
        state = randomBytes(32).toString('base64url');
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const code = await new Promise((resolve, reject) => {
        let settled = false;
        const finish = (error, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            signal.removeEventListener('abort', abort);
            server.close();
            server.closeIdleConnections?.();
            if (error) reject(error);
            else resolve(value);
        };
        const abort = () => finish(Error('登录已取消'));
        const server = http.createServer((request, response) => {
            let url;
            try {
                url = new URL(request.url, CALLBACK);
            } catch {
                response.writeHead(400);
                response.end('Invalid callback');
                return;
            }
            if (
                request.method !== 'GET' ||
                url.pathname !== '/oauth/callback' ||
                !equal(url.searchParams.get('state'), state)
            ) {
                response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
                response.end('无效的登录回调');
                return;
            }
            const value = url.searchParams.get('code');
            response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
            response.end(value ? '授权已收到，请返回 Collectify。' : '授权未完成，请返回 Collectify 重试。');
            finish(value ? null : Error('GitLab 授权被取消或拒绝'), value);
        });
        const timer = setTimeout(() => finish(Error('登录超时，请重试')), 5 * 60 * 1000);
        signal.addEventListener('abort', abort, { once: true });
        server.on('error', () => finish(Error('无法监听登录回调端口 19287，请检查端口占用')));
        server.listen(19287, '127.0.0.1', async () => {
            if (signal.aborted) return abort();
            const url = new URL(provider.authUrl);
            url.search = new URLSearchParams({
                client_id: config.clientId,
                redirect_uri: CALLBACK,
                response_type: 'code',
                state,
                scope: 'read_api',
                code_challenge: challenge,
                code_challenge_method: 'S256'
            }).toString();
            try {
                await openExternal(url.href);
            } catch {
                finish(Error('无法打开系统浏览器，请检查默认浏览器设置'));
            }
        });
    });
    return tokens(
        await form(
            provider.tokenUrl,
            {
                grant_type: 'authorization_code',
                client_id: config.clientId,
                redirect_uri: CALLBACK,
                code,
                code_verifier: verifier
            },
            { fetcher, signal }
        )
    );
}
async function githubLogin(
    config,
    provider,
    {
        openExternal,
        fetcher,
        signal,
        pending,
        wait = (ms, signal) =>
            new Promise((resolve, reject) => {
                const abort = () => {
                    clearTimeout(timer);
                    reject(Error('登录已取消'));
                };
                const timer = setTimeout(() => {
                    signal.removeEventListener('abort', abort);
                    resolve();
                }, ms);
                signal.addEventListener('abort', abort, { once: true });
            })
    }
) {
    const device = await form(
        provider.authUrl,
        { client_id: config.clientId, scope: 'repo read:org' },
        { fetcher, signal }
    );
    if (!device.device_code || !device.user_code || !Number.isFinite(device.expires_in))
        throw Error('GitHub 设备登录未启用，请维护者检查 OAuth 应用配置');
    pending({ userCode: device.user_code });
    await openExternal('https://github.com/login/device');
    const end = Date.now() + Math.min(device.expires_in, 900) * 1000;
    let interval = Math.max(5, device.interval || 5);
    while (Date.now() < end) {
        signal.throwIfAborted();
        await wait(interval * 1000, signal);
        const result = await form(
            provider.tokenUrl,
            {
                client_id: config.clientId,
                device_code: device.device_code,
                grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
            },
            { fetcher, signal }
        );
        if (result.error === 'authorization_pending') continue;
        if (result.error === 'slow_down') {
            interval += 5;
            continue;
        }
        return tokens(result);
    }
    throw Error('设备登录超时，请重试');
}
async function refresh(config, provider, prior, options) {
    if (!prior.refreshToken) throw Error('登录已过期，请重新登录');
    return tokens(
        await form(
            provider.tokenUrl,
            { grant_type: 'refresh_token', client_id: config.clientId, refresh_token: prior.refreshToken },
            options
        ),
        prior
    );
}
module.exports = { gitlabLogin, githubLogin, refresh, form, tokens, equal };
