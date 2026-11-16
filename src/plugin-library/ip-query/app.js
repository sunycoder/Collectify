const api = window.collectify,
    $ = (selector) => document.querySelector(selector);
let state,
    result,
    myIp = '',
    revision = 0,
    removeKey = false,
    settingsUI;
const message = (text, error = false) => {
    $('#status').textContent = text;
    $('#status').classList.toggle('error', error);
};
const safe =
    (action) =>
    async (...args) => {
        try {
            await action(...args);
        } catch (error) {
            message(error.message, true);
        }
    };
// 只复用宿主主题令牌；下拉控件仅在打开设置时加载，不引入日历依赖。
const applyTheme = (context) => {
    for (const [key, value] of Object.entries(context.tokens)) document.documentElement.style.setProperty(key, value);
    document.documentElement.dataset.scheme = context.tokens['color-scheme'];
};
api.onContextChanged(applyTheme);
safe(async () => applyTheme(await api.context()))();
function renderHistory(items) {
    $('#history').replaceChildren();
    $('#history-empty').hidden = items.length > 0;
    $('#clear-history').disabled = !items.length;
    for (const item of items) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = item.ip;
        button.title = `${item.source} · ${new Date(item.queriedAt).toLocaleString()}`;
        button.onclick = () => {
            $('#address').value = item.ip;
            void query(item.ip);
        };
        $('#history').append(button);
    }
}
function render(value) {
    result = value;
    $('#result').hidden = false;
    $('#result-ip').textContent = value.ip;
    $('#result-type').textContent = value.type;
    $('#fields').replaceChildren();
    const fields = [
        ['归属地', [value.country, value.region, value.city].filter(Boolean).join(' · ')],
        ['网络服务商', value.isp],
        ['组织', value.organization],
        ['ASN', value.asn],
        ['时区', value.timezone],
        ['经纬度', value.latitude !== null && value.longitude !== null ? `${value.longitude}, ${value.latitude}` : '']
    ];
    for (const [label, text] of fields) {
        if (!text) continue;
        const row = document.createElement('div'),
            title = document.createElement('span'),
            content = document.createElement('div');
        title.className = 'field-label';
        title.textContent = label;
        content.className = 'field-value';
        content.textContent = text;
        row.append(title, content);
        $('#fields').append(row);
    }
    $('#result-meta').textContent =
        `${value.source} · ${new Date(value.queriedAt).toLocaleString()}${value.cached ? ' · 缓存结果' : ''}`;
    renderHistory(value.history);
}
function busy(value) {
    $('#cancel').hidden = !value;
    $('#submit').textContent = value ? '重新查询' : '查询';
    $('#result').setAttribute('aria-busy', String(value));
}
async function query(ip, refresh = false) {
    const current = ++revision;
    busy(true);
    message(ip ? '正在查询地址信息…' : '正在获取公网出口地址…');
    try {
        const value = await api.invoke('query', { ip, refresh });
        if (current !== revision) return;
        if (value.local) {
            $('#result').hidden = true;
            message(value.message);
            return;
        }
        if (!ip) {
            myIp = value.ip;
            $('#my-ip').textContent = value.ip;
            $('#copy-my').hidden = false;
        }
        render(value);
        message(value.cached ? '已读取缓存；刷新公网 IP 可重新联网查询。' : '查询完成');
    } catch (error) {
        if (current === revision) message(error.message, true);
    } finally {
        if (current === revision) busy(false);
    }
}
$('#query-form').onsubmit = (event) => {
    event.preventDefault();
    void query($('#address').value.trim());
};
$('#refresh-my').onclick = () => void query('', true);
$('#cancel').onclick = safe(async () => {
    revision++;
    busy(false);
    await api.invoke('cancel');
    message('已取消查询');
});
$('#copy-my').onclick = safe(async () => {
    await api.clipboard.writeText(myIp);
    message('公网 IP 已复制');
});
$('#copy-result').onclick = safe(async () => {
    await api.clipboard.writeText(result.ip);
    message('IP 地址已复制');
});
$('#clear-history').onclick = safe(async () => {
    revision++;
    busy(false);
    state = await api.invoke('clear-history');
    renderHistory(state.history);
    message('查询记录和缓存已清空');
});
function providerNote() {
    const keyed = $('#provider').value === 'ipinfo';
    $('#key-field').hidden = !keyed;
    $('#provider-note').textContent = keyed
        ? 'IPinfo Lite 需要个人 Key，主要提供国家与 ASN，不包含城市或精确位置。'
        : 'IPWhois 无需 Key，可返回地区、运营商、时区等字段；免费服务可能限流或暂时不可用。';
}
$('#provider').onchange = providerNote;
function prepareSettingsUI() {
    if (!settingsUI) {
        settingsUI = (async () => {
            await new Promise((resolve, reject) => {
                const link = document.createElement('link');
                link.rel = 'stylesheet';
                link.href = 'collectify-plugin://collectify.sdk/select.css';
                link.onload = resolve;
                link.onerror = () => {
                    link.remove();
                    reject(Error('下拉控件样式加载失败，请重试'));
                };
                document.head.append(link);
            });
            for (const resource of [
                'vendor/tom-select.js',
                'vendor/floating-ui.js',
                'overlay.js',
                'ui-components.js'
            ]) {
                await new Promise((resolve, reject) => {
                    const script = document.createElement('script');
                    script.src = `collectify-plugin://collectify.sdk/${resource}`;
                    script.onload = resolve;
                    script.onerror = () => {
                        script.remove();
                        reject(Error('下拉控件加载失败，请重试'));
                    };
                    document.head.append(script);
                });
            }
        })().catch((error) => {
            settingsUI = undefined;
            throw error;
        });
    }
    return settingsUI;
}
function keyStatus() {
    const hasKey = state.settings.hasKey;
    $('#remove-key').hidden = !hasKey;
    $('#remove-key').textContent = removeKey ? '撤销移除' : '移除 Key';
    $('#api-key').disabled = removeKey;
    $('#api-key').placeholder = removeKey
        ? '已标记移除，保存后生效'
        : hasKey
          ? '留空继续使用已保存的 Key'
          : '填写 IPinfo 账号的 API Key';
    $('#key-status').textContent = removeKey
        ? '保存后将移除本机 Key，IPinfo 查询需重新填写。'
        : hasKey
          ? '已加密保存 Key；输入框留空即可继续使用。'
          : '尚未保存 Key。使用 IPinfo 前需填写并保存。';
}
$('#settings-open').onclick = safe(async () => {
    await prepareSettingsUI();
    state = await api.invoke('state');
    $('#provider').value = state.settings.provider;
    $('#api-key').value = '';
    removeKey = false;
    keyStatus();
    $('#settings-error').textContent = '';
    providerNote();
    window.OfficeUI.refresh();
    $('#settings-dialog').showModal();
});
$('#remove-key').onclick = () => {
    removeKey = !removeKey;
    if (removeKey) $('#api-key').value = '';
    keyStatus();
};
const clearSecret = () => {
    $('#api-key').value = '';
    removeKey = false;
    $('#api-key').disabled = false;
};
$('#settings-close').onclick = () => $('#settings-dialog').close();
$('#settings-dialog').onclose = clearSecret;
$('#settings-form').onsubmit = async (event) => {
    event.preventDefault();
    $('#settings-error').textContent = '';
    try {
        state = await api.invoke('settings', {
            provider: $('#provider').value,
            key: $('#api-key').value,
            clearKey: removeKey
        });
        revision++;
        busy(false);
        clearSecret();
        $('#settings-dialog').close();
        $('#result').hidden = true;
        message('数据源已更新，下次查询使用新设置。');
    } catch (error) {
        $('#settings-error').textContent = error.message;
    }
};
safe(async () => {
    state = await api.invoke('state');
    for (const provider of state.providers) {
        const option = document.createElement('option');
        option.value = provider.id;
        option.textContent = provider.label;
        $('#provider').append(option);
    }
    renderHistory(state.history);
    await query('');
})();
