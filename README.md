# Collectify 5.4

独立的 Electron 桌面工作空间：分类资源收藏、待办清单、四象限、看板、日周月日历、便签、桌面待办与本机 MCP 服务。

## 项目与运行

包名 `collectify`，产品名 Collectify，应用 ID `com.collectify.desktop`。克隆后进入仓库根目录运行以下命令。本版本直接使用新 SQLite 数据库，不读取旧项目的数据，不提供旧 JSON / 旧密文的自动迁移。

```powershell
git clone https://github.com/sunycoder/Collectify.git
cd Collectify
npm.cmd ci
npm.cmd start
```

当前固定 Electron 45.2.3，自带的 Node.js 支持 `node:sqlite`，不引入需要重新编译的第三方 SQLite 原生驱动。开发/测试使用 Node.js 24.22 或更高版本。

## 数据存储

Windows：`%APPDATA%\Collectify\collectify.sqlite`。
macOS：`~/Library/Application Support/Collectify/collectify.sqlite`。
Linux：通常为 `~/.config/Collectify/collectify.sqlite`，实际以设置页显示路径为准。

分类、收藏、任务、任务附件、便签、设置、MCP 连接配置、MCP 审计分别存表。日历和看板是任务的不同视图，没有两套日程数据。使用事务、外键、约束、索引、WAL 和同步刷盘；内存只在事务成功后更新。并行实例的过期快照会被拒绝。

“设置与 AI 连接”可查看路径、打开数据目录或备份数据库。备份使用 `VACUUM INTO` 生成包含 WAL 中最新提交的一致快照，不能在程序运行时只复制主库文件。备份包含明文密码及 MCP 令牌；网页登录 Cookie 在 `Partitions` 中，独立于业务库。

完整设计、关联语义与恢复步骤见 [数据模型](docs/DATA-MODEL.md)。

## 收藏与 JSON 文件

内置 11 条演示收藏，覆盖文件共享、SVN、Jenkins、GM 和网络信息，使用示例地址且不含真实账号密码。个人真实配置放在仓库根目录的 `default-config.json`（Git 已忽略）；本机原有默认资料已保存在该文件，程序启动时优先读取。

新数据库首次初始化时加入 6 条待办、3 张便签，全部以“示例”标识。待办覆盖四种状态与四象限；日历包含当天全天事项、明天上午与后天下午的安排，日期以首次初始化当天为基准。示例不启用提醒，可随时编辑或删除；已有数据库不会自动覆盖或追加，删除示例后也不会重建。外部默认配置须显式设置 `initializeExamples: true` 才会添加同样示例。

支持网页、本地文件、文件夹、文本片段和账号资料。可分类、置顶、搜索、查看最近打开记录、拖动排序和跨分类移动。网页默认在客户端内打开，保留返回收藏夹及外部浏览器入口。

JSON 是收藏交换格式，不再是持久化数据库：

- 只支持当前 `version: 2` 的 JSON 配置，示例见 `config/example-import.json`。
- 初始化优先级：已有 SQLite 数据 > 软件旁 `default-config.json` > 包内默认配置。默认文件只初始化新库。
- 导入支持合并或替换收藏；不删除独立任务、便签或设置。整批验证并事务提交，成功即持久化。导入前生成数据库快照 `collectify.sqlite.before-import.bak`。
- 收藏导出包含账号密码，不包含任务、便签、设置和网页登录态；完整恢复使用数据库备份。

密码按产品要求明文保存，编辑时带回原值并可复制。JSON 未提供 password 表示保留合并目标的密码，显式空串表示清除。HTTP Basic 仅响应浏览器认证挑战；普通网页表单通过登录资料卡复制账号密码辅助输入。

## 待办与桌面窗口

收集箱 → 待处理 → 进行中 → 已完成 → 归档。支持时间范围、截止日、提醒、重要/紧急、优先级、备注、关联收藏和本地文件。可查询指定日期并切换清单、四象限、看板和日历。

看板等高列独立滚动，拖动改变状态；窄窗口横向滚动。桌面待办按日期与时间线分组，可悬浮置顶或作为普通独立窗口。启动是否恢复桌面待办由设置控制，默认关闭。

程序运行或驻留托盘时提醒；完全退出后不运行提醒。下次启动补发符合条件的提醒，已完成或归档事项不提醒。日期、时间、下拉和菜单均使用统一的主题及边界适配。

## AI 连接

在“设置与 AI 连接”开启 MCP 并复制配置。可查询收藏和任务、批量安排日程、创建便签及整理收藏分类。服务仅监听本机，要求 Bearer 令牌，AI 接口不返回账号密码。写工具的业务提交和审计在同一数据库事务中完成。详见 [MCP](docs/MCP.md)。

## 检查与打包

5.4.3 统一弹窗内部滚动与圆角裁剪，点击遮罩可关闭，背景提示在弹窗期间隐藏；日期选择不再自动全选小时，分钟按钮步长为 1。收藏列表操作不换行。待办展示筛选条件和实际数量，保存的事项若被筛选隐藏则清除筛选并提示，保持截止日期与计划日期的独立语义。

```powershell
npm.cmd test
npm.cmd run smoke
npm.cmd run dist:win
node scripts/verify-release.cjs
```

Windows 唯一安装包为 `dist/Collectify-Setup.exe`。图标唯一源为 `assets/icon.png`。`dist/win-unpacked` 是打包验证目录；`build-tools/nsis-resources` 是本机离线打包依赖。测试截图、日志和样例输出到系统临时目录 `Collectify-verification`，不创建 artifacts 目录。

macOS 和 Linux 的构建命令、安装说明见 [打包文档](docs/PACKAGING.md)。本机只生成并验证 Windows 包。

## 贡献与许可

开发约定与提交格式见 [CONTRIBUTING.md](CONTRIBUTING.md)。项目当前尚未指定开源许可证，package.json 标记为 UNLICENSED；第三方依赖遵循各自附带的许可证。
