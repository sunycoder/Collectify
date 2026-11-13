const { API_VERSION, PERMISSIONS } = require('./manifest');
const SDK_FILES = new Set(['tool.css', 'toolkit.js', 'workspace-ui.js', 'plugin-page.css', 'select.css']);
const SHARED_FILES = new Set([
    'vendor/tom-select.css',
    'vendor/flatpickr.css',
    'styles.css',
    'office-ui.css',
    'interaction-fixes.css',
    'readability.css',
    'board.css',
    'vendor/tom-select.js',
    'vendor/flatpickr.js',
    'vendor/flatpickr-zh.js',
    'vendor/fullcalendar.js',
    'vendor/floating-ui.js',
    'overlay.js',
    'theme.js',
    'ui-components.js'
]);
function reference(templates) {
    return {
        apiVersion: API_VERSION,
        purpose: '根据用户明确的新建或更新要求，编写自有页面插件并安装到 Collectify。无需修改宿主源码。',
        workflow: [
            'list_plugins',
            'get_plugin_sdk',
            'create_plugin_draft',
            'get_plugin_draft / read_plugin_file',
            'write_plugin_files',
            'validate_plugin_draft',
            'install_plugin_draft',
            'get_plugin_runtime_status'
        ],
        templates,
        permissions: PERMISSIONS,
        manifest: {
            required: ['id', 'name', 'description', 'version', 'apiVersion', 'entry', 'permissions', 'commands'],
            id: '反向域名格式，例如 personal.clipboard',
            version: 'x.y.z',
            apiVersion: API_VERSION,
            minHostVersion: '可选最低主程序版本，例如 5.6.0；新 SDK 能力应声明要求',
            platforms: '可选系统列表：win32、darwin、linux；省略表示不限制',
            entry: '包内 .html 文件',
            commands: [{ id: 'open', title: '打开插件' }],
            navigation: [{ id: 'home', label: '主页' }],
            backend: '页面插件不能声明 Node.js 后台入口',
            background: '可选包内 HTML 后台页面，需声明 background；在隔离渲染进程运行，不提供 Node.js'
        },
        sdk: {
            'collectify.context()': 'Promise<{apiVersion,plugin:{id,name,version},theme,tokens}>',
            'collectify.storage.get(key)': '需要 storage；只读取本插件的 JSON 值，不存在时为 null',
            'collectify.storage.set(key,value)': '需要 storage；单值 256 KB，最多 200 项、8 MB',
            'collectify.storage.delete(key)': '需要 storage；删除本插件键',
            'collectify.storage.batch({set,delete})':
                '需要 storage；原子写入和删除多项，失败全部回滚；仍遵守单值和总配额',
            'collectify.background.request(data)':
                '向本插件 background 页面发起请求，等待 onBackgroundRequest 的响应；不跨插件',
            'collectify.onBackgroundRequest(handler)': '后台处理请求，可返回 Promise；15 秒超时，停用时取消等待',
            'collectify.background.setActive(boolean)':
                '只允许后台调用；表示用户已开启后台工作，关闭主窗口后可驻留托盘',
            'collectify.clipboard.snapshot()':
                '需要 clipboard.read；返回文本、图片或文件列表快照。后台还需 clipboard.background 和用户开启的 active 状态；图片最多 4 MB，不读取文件原文',
            'collectify.clipboard.writeSnapshot(snapshot)':
                '需要 clipboard.write；恢复文本、PNG/JPEG 或文件列表到系统剪贴板',
            'collectify.notify(data)': '向本插件前台发送 plugin-notify 事件，不跨插件',
            'collectify.windows.open({focusItem})':
                '需要 window；打开本插件的隔离置顶窗口，同一插件复用一个窗口，停用时关闭',
            'collectify.windows.shortcut(enabled)':
                '需要 window 和清单 shortcut HTML 入口；显示/隐藏本插件的48px桌面快捷按钮，支持后台恢复、边缘拖动和位置保存。停用或卸载回收窗口。',
            'collectify.windows.reveal()': '需要 window；从插件前台主动唤起主窗口并切换至本插件，不接受其他插件ID。',
            'collectify.windows.drag({phase,x,y})':
                '仅 shortcut 页面且有 window 权限；phase 为 start/move/end，x/y 为指针屏幕坐标。只移动本插件自己的快捷按钮，位置约束在显示器可用区域。',
            'collectify.desktop.paste()':
                '需要 desktop.paste；仅前台插件主动调用，Windows 隐藏本应用后向恢复焦点的外部应用发送 Ctrl+V；其他平台明确报错',
            'collectify.clipboard.readText()':
                '需要 clipboard.read；仅当前插件显示、主窗口可见且未最小化时允许；最多 64 KB 文本。采集应由用户在插件中主动开启，离开页面时暂停；不要把文本写入日志。',
            'collectify.clipboard.writeText(text)': '需要 clipboard.write；复制文本',
            'collectify.selectNavigation(route)': '同步清单中已声明的二级导航选中状态',
            'collectify.onNavigate(callback)': '收到 {route,payload}；返回取消订阅函数',
            'collectify.onCommand(callback)': '收到 {id}；返回取消订阅函数',
            'collectify.onContextChanged(callback)': '收到新主题上下文；返回取消订阅函数',
            'ToolUI.run(asyncAction)': '公共 toolkit.js 的错误展示辅助函数',
            'ToolUI.message(text,isError=false)': '显示到 #message',
            'collectify.invoke': '仅可信默认后台插件可用，自有页面插件不能调用业务后台'
        },
        resources: {
            styles: 'collectify-plugin://collectify.sdk/tool.css',
            helpers: 'collectify-plugin://collectify.sdk/toolkit.js',
            public: [...SDK_FILES, ...SHARED_FILES]
        },
        constraints: [
            '使用独立经典脚本文件，不写内联 script、事件属性或 eval；当前草稿校验不支持 ESM 模块脚本',
            'DOM 使用 textContent，不把用户输入拼进 innerHTML',
            '网络、任意文件系统、跨插件存储和任意 Node.js 不可用；可声明受限后台页面，后台读取剪贴板需额外权限与用户主动开启',
            '输入文本只按用户要求保存；剪贴板采集默认关闭，历史保存在插件自己的 storage',
            '写入必须带 expectedRevision；并发修改会拒绝过期写入',
            '校验只编译脚本并检查资源，不执行插件。安装后可以查看受限诊断，不能据此宣称业务行为已完整验证'
        ],
        limits: { writeBatchUtf8Bytes: 65536, fileCount: 300, packageBytes: 10 * 1024 * 1024, draftCount: 50 },
        install:
            '使用 validate_plugin_draft 返回的 validationToken 安装原样草稿；改动文件后需重新校验。默认插件不能覆盖。更新程序需提高 version，创建更新草稿时会自动递增 patch。保留数据与启停状态，可显式 enable:true。响应结果不明时先读取草稿和已安装列表核验，不要盲目重复创建。',
        privacy:
            '开发工具只读写程序草稿与静态程序文件，不提供读取用户剪贴板、插件数据库、收藏密码或任意本机文件的工具。'
    };
}
module.exports = { SDK_FILES, SHARED_FILES, reference };
