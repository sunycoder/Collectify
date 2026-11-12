(function () {
    const selects = new Map(), dates = new Map();
    let pending = false;

    function selectOptions(select){return [...select.options].filter(option=>option.value!==''||option.text.trim()!=='');}
    function optionsSignature(select) {
        return JSON.stringify(selectOptions(select).map(o => [o.value, o.text, o.disabled]));
    }

    function positionCalendar(instance) {
        if (instance.isOpen) window.WorkspaceOverlay.show(instance._input, instance.calendarContainer, {width: 304});
    }

    function enhance() {
        pending = false;
        observer.disconnect();
        try {
            for (const [input, record] of selects) if (!input.isConnected) {
                record.instance.destroy();
                selects.delete(input);
            }
            document.querySelectorAll('select:not([data-native])').forEach(select => {
                let record = selects.get(select), signature = optionsSignature(select);
                if (!record) {
                    const parent = select.closest('dialog') || document.body;
                    const instance = new TomSelect(select, {
                        create: false,
                        allowEmptyOption: selectOptions(select).some(option=>option.value===''),
                        searchField: 'text',
                        controlInput: select.options.length > 8 ? undefined : null,
                        dropdownParent: parent,
                        plugins: [],
                        render: {no_results: () => '<div class="no-results">没有匹配选项</div>'},
                        onDropdownOpen() {
                            if(!selectOptions(select).some(option=>option.value===''))this.removeOption('');
                            // 小型枚举无需搜索输入；组件会在某些焦点状态恢复 display，统一收起空输入。
                            if(this.settings.controlInput===null&&this.control_input){this.control_input.hidden=true;this.control_input.style.display='none';}
                            window.WorkspaceOverlay.show(this.control, this.dropdown, {width: Math.max(this.control.getBoundingClientRect().width, 145)});
                        },
                        onDropdownClose() {
                            window.WorkspaceOverlay.close(this.dropdown);
                        }
                    });
                    record = {instance, signature: optionsSignature(select)};
                    selects.set(select, record);
                    select.addEventListener('change', () => {
                        if (String(instance.getValue()) !== select.value) instance.setValue(select.value, true);
                    });
                } else if (signature !== record.signature) {
                    const value = select.value,options=selectOptions(select).map(o=>({value:o.value,text:o.text,disabled:o.disabled}));
                    record.instance.clearOptions();
                    record.instance.addOptions(options);
                    record.instance.setValue(value, true);
                    record.signature = optionsSignature(select);
                } else if (String(record.instance.getValue()) !== select.value) record.instance.setValue(select.value, true);
                if (select.disabled) record.instance.disable(); else record.instance.enable();
                // 父级页面的 hidden 会自然隐藏整个控件；不要把隐藏状态复制到包装层，避免切换页面后仍不可见。
                record.instance.wrapper.hidden = select.hidden;
            });
            document.querySelectorAll('input[type=date],input[type=datetime-local]').forEach(input => {
                if (dates.has(input)) return;
                const time = input.type === 'datetime-local';
                input.dataset.pickerType = time ? 'datetime' : 'date';
                const instance = flatpickr(input, {
                    locale: {...flatpickr.l10ns.zh, firstDayOfWeek: 1},
                    disableMobile: true,
                    allowInput: false,
                    enableTime: time,
                    minuteIncrement: 1,
                    hourIncrement: 1,
                    time_24hr: true,
                    dateFormat: time ? 'Y-m-d\\TH:i' : 'Y-m-d',
                    altInput: true,
                    altFormat: time ? 'Y年n月j日 H:i' : 'Y年n月j日',
                    appendTo: input.closest('dialog') || document.body,
                    monthSelectorType: 'static',
                    onOpen: (_dates, _text, picker) => positionCalendar(picker),
                    onClose: (_dates, _text, picker) => window.WorkspaceOverlay.close(picker.calendarContainer),
                    onMonthChange: (_dates, _text, picker) => window.WorkspaceOverlay.reposition(picker.calendarContainer),
                    onYearChange: (_dates, _text, picker) => window.WorkspaceOverlay.reposition(picker.calendarContainer),
                    onChange: (_dates,_text,picker) => {
                        input.dispatchEvent(new Event('input', {bubbles: true}));
                        if(picker.datePointerSelection){
                            picker.datePointerSelection=false;
                            const day=picker.selectedDateElem;
                            if(day){day.tabIndex=-1;day.focus({preventScroll:true});}
                        }
                    },
                    onReady: (_dates, _text, picker) => {
                        const footer = document.createElement('div');
                        footer.className = 'picker-actions';
                        for (const [label, action] of [['清除', () => {
                            picker.clear();
                            picker.close();
                        }], ['今天', () => {
                            picker.setDate(new Date(), true);
                            picker.close();
                        }]]) {
                            const b = document.createElement('button');
                            b.type = 'button';
                            b.textContent = label;
                            b.onclick = action;
                            footer.append(b);
                        }
                        picker.calendarContainer.append(footer);
                        picker.calendarContainer.addEventListener('pointerdown',event=>{
                            picker.datePointerSelection=!!event.target.closest('.flatpickr-day');
                        },true);
                        // 选日期后组件默认会聚焦并全选小时。鼠标选择保留焦点在日期，
                        // 只有用户主动点击时间输入框时才进入时间编辑。
                        picker.calendarContainer.addEventListener('click', event => {
                            if (!event.target.closest('.flatpickr-day') || !time) return;
                            const selectedDay=picker.selectedDateElem;
                            if(selectedDay){ selectedDay.tabIndex=-1; selectedDay.focus({preventScroll:true}); }
                        });
                        if (time) {
                            picker.hourElement.setAttribute('aria-label', '小时');
                            picker.minuteElement.setAttribute('aria-label', '分钟');
                            picker.calendarContainer.querySelectorAll('.flatpickr-time .numInputWrapper').forEach((wrapper, index) => {
                                for (const [selector, label] of [['.arrowUp', '增加'], ['.arrowDown', '减少']]) {
                                    const arrow = wrapper.querySelector(selector);
                                    if (arrow) {
                                        arrow.setAttribute('role', 'button');
                                        arrow.setAttribute('aria-label', `${label}${index === 0 ? '小时' : '分钟'}`);
                                        arrow.tabIndex = 0;
                                        arrow.addEventListener('keydown', event => {
                                            if (['Enter', ' '].includes(event.key)) {
                                                event.preventDefault();
                                                arrow.click();
                                            }
                                        });
                                    }
                                }
                            });
                        }
                        picker.altInput.placeholder = time ? '选择日期与时间' : '选择日期';
                        picker.altInput.setAttribute('aria-label', input.getAttribute('aria-label') || input.name || '选择日期');
                    }
                });
                dates.set(input, instance);
                input.addEventListener('change', () => {
                    if (instance.input.value !== instance.lastSynced) {
                        instance.setDate(input.value || null, false);
                        instance.lastSynced = input.value;
                    }
                });
            });
            for (const [input, picker] of dates) {
                if (!input.isConnected) {
                    picker.destroy();
                    dates.delete(input);
                    continue;
                }
                if (!picker.isOpen && input.value !== picker.lastSynced) {
                    picker.setDate(input.value || null, false);
                    picker.lastSynced = input.value;
                }
                picker.altInput.disabled = input.disabled;
            }
        } finally {
            observer.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: true,
                attributeFilter: ['open', 'hidden', 'disabled']
            });
        }
    }

    const observer = new MutationObserver(() => {
        if (!pending) {
            pending = true;
            requestAnimationFrame(enhance);
        }
    });
    window.OfficeUI = {
        refresh: enhance, close: () => {
            selects.forEach(r => r.instance.close());
            dates.forEach(p => p.close());
        }
    };
    window.addEventListener('resize', () => {
        dates.forEach(p => {
            if (p.isOpen) window.WorkspaceOverlay.reposition(p.calendarContainer);
        });
    });
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') window.OfficeUI.close();
    });
    document.querySelectorAll('dialog').forEach(dialog => {
        // 滚动容器放在卡片内部，外层负责裁剪圆角，所有弹窗共用。
        const scroller=document.createElement('div'); scroller.className='dialog-scroll';
        while(dialog.firstChild)scroller.append(dialog.firstChild);
        dialog.append(scroller);
        new MutationObserver(()=>{
            if(dialog.open)requestAnimationFrame(()=>{if(dialog.open)scroller.scrollTop=0;});
        }).observe(dialog,{attributes:true,attributeFilter:['open']});
        let pressedOutside=false;
        const outside=event=>{
            if(event.target!==dialog)return false;
            const r=dialog.getBoundingClientRect();
            return event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom;
        };
        dialog.addEventListener('pointerdown',event=>{pressedOutside=outside(event);});
        dialog.addEventListener('pointerup',event=>{
            if(pressedOutside&&outside(event))dialog.close();
            pressedOutside=false;
        });
        dialog.addEventListener('close', () => {window.OfficeUI.close();scroller.scrollTop=0;});
    });
    enhance();
})();
