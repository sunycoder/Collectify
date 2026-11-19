(function () {
    const { computePosition, offset, flip, shift, size, autoUpdate } = window.FloatingUIDOM;
    const opened = new Map();

    function close(panel) {
        const entry = opened.get(panel);
        if (entry) {
            entry.cleanup?.();
            opened.delete(panel);
        }
        if (panel.matches(':popover-open')) panel.hidePopover();
    }

    function show(anchor, panel, options = {}) {
        close(panel);
        panel.setAttribute('popover', 'manual');
        panel.classList.add('managed-overlay');
        panel.style.margin = '0';
        panel.style.position = 'fixed';
        panel.style.inset = 'auto';
        // 坐标计算完成前不接受命中，避免弹层在旧坐标闪现并吞掉打开它的 mouseup。
        panel.style.visibility = 'hidden';
        panel.hidden = false;
        panel.showPopover();
        const entry = { cleanup: null };
        opened.set(panel, entry);
        let updating = false;

        async function update() {
            if (updating || !opened.has(panel) || !anchor.isConnected || !panel.isConnected) return;
            updating = true;
            try {
                if (options.width) panel.style.width = `${options.width}px`;
                const result = await computePosition(anchor, panel, {
                    strategy: 'fixed',
                    placement: options.placement || 'bottom-start',
                    middleware: [
                        offset(6),
                        flip({ padding: 10 }),
                        shift({ padding: 10 }),
                        size({
                            padding: 10,
                            apply({ availableHeight, availableWidth, elements }) {
                                Object.assign(elements.floating.style, {
                                    maxWidth: `${Math.max(0, availableWidth)}px`,
                                    maxHeight: `${Math.max(0, availableHeight)}px`,
                                    overflowY: 'auto',
                                    overflowX: 'hidden'
                                });
                            }
                        })
                    ]
                });
                if (opened.has(panel)) {
                    Object.assign(panel.style, { left: `${result.x}px`, top: `${result.y}px`, visibility: 'visible' });
                    panel.dataset.placement = result.placement;
                }
            } finally {
                updating = false;
            }
        }

        entry.update = update;
        entry.cleanup = autoUpdate(anchor, panel, update, {
            ancestorScroll: true,
            ancestorResize: true,
            elementResize: true,
            layoutShift: true
        });
        // 第三方组件在 onOpen 后仍会定位一次，下一帧统一接管最终坐标。
        requestAnimationFrame(update);
        return update;
    }

    function reposition(panel) {
        return opened.get(panel)?.update();
    }

    window.WorkspaceOverlay = {
        show,
        close,
        reposition,
        closeAll: () => {
            for (const panel of [...opened.keys()]) close(panel);
        }
    };
})();
