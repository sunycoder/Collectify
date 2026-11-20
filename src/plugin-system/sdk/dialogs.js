// 插件可显式绑定静态或动态弹窗，业务决定关闭时如何处理未保存内容。
const dialogStyles = document.createElement('link');
dialogStyles.rel = 'stylesheet';
dialogStyles.href = 'collectify-plugin://collectify.sdk/dialogs.css';
document.head.append(dialogStyles);
window.WorkspaceDialogs = {
    bind(dialog, requestClose = () => dialog.close()) {
        let pressedOutside = false,
            closing = false;
        const outside = (event) => {
            const r = dialog.getBoundingClientRect();
            return (
                event.target === dialog &&
                (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom)
            );
        };
        const close = async () => {
            if (closing || !dialog.open) return;
            closing = true;
            try {
                await requestClose();
            } finally {
                closing = false;
            }
        };
        dialog.addEventListener(
            'pointerdown',
            (event) => {
                pressedOutside = outside(event);
            },
            true
        );
        dialog.addEventListener(
            'pointerup',
            (event) => {
                const dismiss = pressedOutside && outside(event);
                pressedOutside = false;
                if (outside(event)) event.stopImmediatePropagation();
                if (dismiss) void close();
            },
            true
        );
        dialog.addEventListener('pointercancel', () => {
            pressedOutside = false;
        });
        dialog.addEventListener(
            'cancel',
            (event) => {
                event.preventDefault();
                event.stopImmediatePropagation();
                void close();
            },
            true
        );
        dialog.addEventListener('close', () => {
            pressedOutside = false;
        });
        return close;
    },
    confirmChanges(title) {
        const dialog = document.createElement('dialog');
        dialog.className = 'unsaved-changes-dialog';
        const heading = document.createElement('h2'),
            text = document.createElement('p'),
            actions = document.createElement('div');
        heading.textContent = title;
        text.textContent = '修改尚未保存。你可以保存后关闭，或放弃修改。';
        actions.className = 'dialog-actions';
        for (const [value, label] of [
            ['cancel', '继续编辑'],
            ['discard', '放弃修改'],
            ['save', '保存并关闭']
        ]) {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = label;
            button.dataset.choice = value;
            if (value === 'save') button.className = 'primary';
            button.onclick = () => dialog.close(value);
            actions.append(button);
        }
        dialog.append(heading, text, actions);
        document.body.append(dialog);
        window.WorkspaceDialogs.bind(dialog, () => dialog.close('cancel'));
        return new Promise((resolve) => {
            dialog.addEventListener(
                'close',
                () => {
                    const value = dialog.returnValue || 'cancel';
                    dialog.remove();
                    resolve(value);
                },
                { once: true }
            );
            dialog.showModal();
            actions.firstChild.focus();
        });
    }
};
