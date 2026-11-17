// 冒烟场景编排仅存在于测试目录；打包版由 CI 显式指定本文件。
exports.run = async (context) => {
    const verification = require('./smoke-shell');
    const { trayAccess } = context;
    context.withTestTray = async (action) => {
        const previous = trayAccess.get();
        let menu;
        trayAccess.set({
            setContextMenu(value) {
                menu = value;
            }
        });
        try {
            trayAccess.update();
            await action(menu);
        } finally {
            trayAccess.set(previous);
        }
    };
    if (process.argv.includes('--smoke-usability')) await require('./smoke-usability').run(context);
    else if (process.argv.includes('--smoke-shutdown')) {
        await require('./smoke-shutdown').run(context);
        return false;
    } else if (process.argv.includes('--smoke-product')) await require('./smoke-product').run(context);
    else if (process.argv.includes('--smoke-market')) await require('./smoke-market').run(context);
    else if (process.argv.includes('--smoke-resources')) await require('./smoke-bookmark-resources').run(context);
    else if (process.argv.includes('--smoke-fullscreen')) await require('./smoke-fullscreen').run(context);
    else if (process.argv.includes('--smoke-deployment')) await require('./smoke-distribution').deployment(context);
    else if (process.argv.includes('--smoke-distribution')) await require('./smoke-distribution').run(context);
    else if (process.argv.includes('--smoke-clipboard')) await require('./smoke-clipboard').run(context);
    else if (process.argv.includes('--smoke-official')) await require('./smoke-official').run(context);
    else if (process.argv.includes('--smoke-tools')) await require('./smoke-tools').run(context);
    else if (process.argv.includes('--smoke-navigation')) await require('./smoke-navigation').run(context);
    else if (process.argv.includes('--smoke-startup')) {
        await verification.startup(context);
        await require('./smoke-packages').run(context);
        await require('./smoke-navigation').run(context);
        await require('./smoke-tools').run(context);
        await require('./smoke-distribution').run(context);
    } else {
        await verification.run(context);
        await require('./smoke-bookmark-resources').run(context);
        await require('./smoke-fullscreen').run(context);
        await require('./smoke-lifecycle').run(context);
        await require('./smoke-development').run(context);
        await require('./smoke-packages').run(context);
        await require('./smoke-navigation').run(context);
        await require('./smoke-tools').run(context);
        await require('./smoke-clipboard').run(context);
        await require('./smoke-distribution').run(context);
    }
};
