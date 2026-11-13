(function () {
    const bytes = (value) =>
        value >= 1024 * 1024
            ? (value / 1024 / 1024).toFixed(1) + ' MB'
            : value >= 1024
              ? (value / 1024).toFixed(1) + ' KB'
              : Math.round(value) + ' B';
    const phases = {
        connecting: '正在连接下载服务器',
        downloading: '正在下载',
        verifying: '正在校验文件',
        confirming: '等待安装确认',
        installing: '正在安装',
        complete: '已完成',
        cancelled: '已取消',
        error: '下载失败'
    };
    window.TransferUI = {
        render(container, state, cancel) {
            container.hidden = !state;
            if (!state) return;
            if (!container.querySelector('progress')) {
                const heading = document.createElement('strong'),
                    bar = document.createElement('progress'),
                    details = document.createElement('span'),
                    button = document.createElement('button');
                heading.className = 'transfer-heading';
                details.className = 'transfer-detail';
                button.type = 'button';
                button.className = 'subtle';
                button.textContent = '取消下载';
                bar.setAttribute('aria-label', '下载进度');
                bar.max = 100;
                container.append(heading, bar, details, button);
            }
            container.querySelector('strong').textContent =
                (state.label ? state.label + ' · ' : '') + (phases[state.phase] || '正在处理');
            const bar = container.querySelector('progress');
            if (state.total > 0) {
                bar.value = Math.min(100, (state.received / state.total) * 100);
            } else bar.removeAttribute('value');
            const text = [
                state.total ? Math.floor((state.received / state.total) * 100) + '%' : '',
                bytes(state.received || 0) + (state.total ? ' / ' + bytes(state.total) : ''),
                state.phase === 'downloading' ? bytes(state.speed || 0) + '/s' : '',
                state.remaining ? '预计剩余 ' + Math.ceil(state.remaining) + ' 秒' : ''
            ]
                .filter(Boolean)
                .join(' · ');
            container.querySelector('span').textContent = state.error || text;
            const button = container.querySelector('button');
            button.hidden = !['connecting', 'downloading'].includes(state.phase);
            button.onclick = cancel;
        }
    };
})();
