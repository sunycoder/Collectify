let officeCalendar = null,
    miniCalendar = null,
    calendarTasks = [],
    calendarFrame = 0;

function renderOfficeCalendar(tasks) {
    calendarTasks = tasks;
    if (!officeCalendar) {
        officeCalendar = new FullCalendar.Calendar(document.querySelector('#calendar-grid'), {
            initialView: 'timeGridWeek',
            initialDate: calendarDate,
            locale: 'zh-cn',
            firstDay: 1,
            buttonText: { today: '今天', month: '月', week: '周', day: '日', list: '日程' },
            headerToolbar: {
                left: 'today prev,next title',
                center: '',
                right: 'timeGridDay,timeGridWeek,dayGridMonth'
            },
            height: 610,
            allDayText: '全天',
            noEventsText: '暂无安排',
            nowIndicator: true,
            scrollTime: '08:00:00',
            scrollTimeReset: false,
            slotMinTime: '00:00:00',
            slotMaxTime: '24:00:00',
            slotDuration: '00:30:00',
            slotLabelInterval: '01:00',
            slotLabelFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
            eventTimeFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
            dayHeaderFormat: { weekday: 'short', month: 'numeric', day: 'numeric' },
            dayMaxEvents: 3,
            eventMinHeight: 38,
            expandRows: true,
            dayHeaderContent: (info) => {
                const wrapper = document.createElement('div');
                wrapper.className = 'office-day-heading';
                const weekday = document.createElement('span');
                weekday.textContent = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][info.date.getDay()];
                wrapper.append(weekday);
                if (info.view.type !== 'dayGridMonth') {
                    const number = document.createElement('strong');
                    number.textContent = String(info.date.getDate());
                    wrapper.append(number);
                    if (localDay(info.date) === localDay(new Date())) wrapper.classList.add('is-today');
                }
                return { domNodes: [wrapper] };
            },
            dayCellContent: (info) => ({ html: String(info.dayNumberText).replace('日', '') }),
            editable: true,
            selectable: true,
            selectMirror: true,
            eventDurationEditable: true,
            views: { dayGridMonth: { dayHeaderFormat: { weekday: 'short' }, fixedWeekCount: false } },
            eventClick: (info) => {
                const t = state.tasks.find((t) => t.id === info.event.id);
                if (t) void showTask(t);
            },
            select: (info) => {
                officeCalendar.unselect();
                void showTask(null, {
                    status: 'todo',
                    startAt: info.start.toISOString(),
                    endAt: info.allDay ? '' : info.end.toISOString(),
                    dueAt: (info.allDay ? info.start : info.end).toISOString(),
                    allDay: info.allDay
                });
            },
            eventDrop: async (info) => {
                const t = state.tasks.find((t) => t.id === info.event.id);
                try {
                    await call(
                        'task-save',
                        window.TaskSchedule.moveSchedule(t, info.event.start, info.event.end, info.event.allDay)
                    );
                    await refresh();
                } catch (e) {
                    info.revert();
                    toast(e.message);
                }
            },
            eventResize: async (info) => {
                const t = state.tasks.find((t) => t.id === info.event.id);
                try {
                    await call('task-save', {
                        ...t,
                        startAt: info.event.start.toISOString(),
                        endAt: info.event.end.toISOString(),
                        allDay: info.event.allDay
                    });
                    await refresh();
                } catch (e) {
                    info.revert();
                    toast(e.message);
                }
            },
            eventDidMount: (info) => {
                const t = state.tasks.find((t) => t.id === info.event.id);
                info.el.title = [t?.title, t?.startAt ? '计划' : '截止时间', t?.note].filter(Boolean).join('\n');
            },
            datesSet: (info) => {
                calendarDate = officeCalendar.getDate();
                if (miniCalendar) miniCalendar.setDate(calendarDate, false);
                markMiniRange(info.start, info.end);
            }
        });
        officeCalendar.render();
        const miniRoot = document.querySelector('#mini-calendar'),
            miniInput = document.createElement('input');
        miniInput.type = 'text';
        miniInput.hidden = true;
        miniRoot.append(miniInput);
        miniCalendar = flatpickr(miniInput, {
            inline: true,
            appendTo: miniRoot,
            locale: { ...flatpickr.l10ns.zh, firstDayOfWeek: 1 },
            defaultDate: calendarDate,
            dateFormat: 'Y-m-d',
            monthSelectorType: 'static',
            onChange: (dates) => {
                if (dates[0]) {
                    officeCalendar.gotoDate(dates[0]);
                    calendarDate = dates[0];
                }
            },
            onMonthChange: () => markMiniRange(officeCalendar.view.activeStart, officeCalendar.view.activeEnd),
            onReady: () => markMiniRange(officeCalendar.view.activeStart, officeCalendar.view.activeEnd)
        });
    }
    officeCalendar.batchRendering(() => {
        officeCalendar.removeAllEvents();
        officeCalendar.addEventSource(tasks.map(window.TaskSchedule.event).filter(Boolean));
    });
    const unscheduled = tasks.filter((t) => !window.TaskSchedule.anchor(t));
    document.querySelector('#unscheduled-count').textContent = unscheduled.length;
    const list = document.querySelector('#unscheduled-list');
    list.replaceChildren();
    for (const t of unscheduled) {
        const row = button(t.title, null, () => showTask(t), 'unscheduled-task');
        row.prepend(el('span', `agenda-dot ${t.important ? 'important' : ''}`));
        list.append(row);
    }
    if (!unscheduled.length) list.append(el('p', 'unscheduled-empty', '所有事项均已安排时间'));
    document.querySelector('#calendar-summary').textContent =
        `${tasks.filter((t) => window.TaskSchedule.anchor(t)).length} 项已安排 · ${unscheduled.length} 项未安排 · 点击空白时间创建，拖动事项改期`;
    cancelAnimationFrame(calendarFrame);
    calendarFrame = requestAnimationFrame(() => {
        if (!document.querySelector('#task-calendar').hidden) officeCalendar.updateSize();
    });
}

function markMiniRange(start, end) {
    document.querySelectorAll('#mini-calendar .flatpickr-day').forEach((node) => {
        const at = node.dateObj;
        node.classList.toggle('in-view-range', !!at && at >= start && at < end);
    });
}
