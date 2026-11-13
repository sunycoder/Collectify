// 示例只加入尚未初始化的数据库；相对日期在首次初始化时转换成真实 UTC 时间。
function withInitialExamples(defaults, now = new Date()) {
    const data = structuredClone(defaults);
    if (data.initializeExamples !== true) return data;
    const at = (days, hour, minute = 0) =>
        new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, hour, minute).toISOString();
    const createdAt = now.toISOString();
    const bookmarkId = data.entries.find((entry) => entry.id === 'gm-trunk')?.id || '';
    // 每条都写明示例，可自由改写或删除。无提醒，避免首次启动触发系统通知。
    const tasks = [
        {
            id: 'example-inbox',
            title: '示例 · 收集一个临时想法',
            status: 'inbox',
            priority: 'low',
            important: false,
            urgent: false,
            note: '先记录标题，之后再补充日期和备注。拖动卡片可改变状态。'
        },
        {
            id: 'example-release-check',
            title: '示例 · 发布前检查',
            status: 'todo',
            priority: 'high',
            important: true,
            urgent: true,
            allDay: true,
            dueAt: at(0, 0),
            bookmarkId,
            note: '全天事项示例：检查版本与环境。此任务仅用于演示，不会执行实际操作。'
        },
        {
            id: 'example-environment-review',
            title: '示例 · 核对环境安排',
            status: 'doing',
            priority: 'medium',
            important: true,
            urgent: false,
            startAt: at(1, 9, 30),
            endAt: at(1, 10),
            dueAt: at(1, 10),
            bookmarkId,
            note: '明天 09:30–10:00。打开日历查看时间块，拖动可调整排期。'
        },
        {
            id: 'example-quick-reply',
            title: '示例 · 处理一条简短回复',
            status: 'todo',
            priority: 'medium',
            important: false,
            urgent: true,
            dueAt: at(1, 17),
            note: '紧急但不重要的示例；可在四象限中拖动改变重要与紧急。'
        },
        {
            id: 'example-planning',
            title: '示例 · 整理下一阶段计划',
            status: 'todo',
            priority: 'low',
            important: false,
            urgent: false,
            startAt: at(2, 14),
            endAt: at(2, 14, 45),
            note: '后天 14:00–14:45。备注可写背景、步骤和验收条件。'
        },
        {
            id: 'example-completed',
            title: '示例 · 完成一次资源整理',
            status: 'done',
            priority: 'medium',
            important: false,
            urgent: false,
            completedAt: createdAt,
            note: '已完成示例，可以尝试归档或重新打开。'
        }
    ].map((task) => ({ ...task, createdAt, remindAt: '', attachments: [] }));
    const notes = [
        {
            id: 'example-note-welcome',
            title: '示例 · 你的工作空间',
            color: 'blue',
            content:
                '收藏常用网页、SVN 地址和网络资料。\n网页可在客户端内打开；SVN 与 IP 作为文本直接复制。\n这些示例可以编辑或删除。'
        },
        {
            id: 'example-note-checklist',
            title: '示例 · 发布备忘',
            color: 'yellow',
            content: '1. 核对目标环境与版本\n2. 确认构建结果\n3. 记录验证结论\n需要安排时间时，点击“转为待办”。'
        },
        {
            id: 'example-note-ideas',
            title: '示例 · 随手记录',
            color: 'green',
            content: '临时想法先放在这里。\n便签适合记录内容，待办适合跟进状态，日历展示已安排的时间。'
        }
    ].map((note) => ({ ...note, updatedAt: createdAt }));
    const existingTaskIds = new Set((data.tasks || []).map((task) => task.id));
    const existingNoteIds = new Set((data.notes || []).map((note) => note.id));
    data.tasks = [...(data.tasks || []), ...tasks.filter((task) => !existingTaskIds.has(task.id))];
    data.notes = [...(data.notes || []), ...notes.filter((note) => !existingNoteIds.has(note.id))];
    return data;
}
module.exports = { withInitialExamples };
