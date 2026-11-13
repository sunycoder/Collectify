# Collectify

Collectify 是一个 Electron 插件工作台。宿主提供窗口、两级导航、主题、插件管理、权限、数据交换和 MCP 接入；所有业务功能都作为插件加载。

| 默认插件 | 功能                                                         |
| -------- | ------------------------------------------------------------ |
| 收藏     | 分类资源、置顶、最近打开、登录资料、独立会话内置浏览器       |
| 待办     | 清单、四象限、看板、日历、提醒、桌面待办组件                 |
| 便签     | 编辑、颜色分类、搜索、转为待办                               |
| 时间戳   | 实时时间戳、暂停与复制、秒／毫秒双向转换、命名时区与批量处理 |
| JSON     | 格式化、压缩、校验、语法定位                                 |

左侧一级导航选择插件，二级导航由当前插件贡献。设置固定在左下角。默认插件与自有插件使用同一套清单、页面运行时、启停和数据管理机制，没有额外的“工具插件”分类。所有插件都可以停用；全部停用后只保留工作台与插件管理。

顶栏可收起或展开二级导航，重启后保持选择。网页默认使用内置浏览器，可在“设置 → 通用”切换到系统默认浏览器；收藏菜单可临时选择另一种打开方式。

## 运行

```powershell
git clone https://github.com/sunycoder/Collectify.git
cd Collectify
npm.cmd ci
npm.cmd run build:assets
npm.cmd start
```

固定 Electron 45.2.3，SQLite 使用 Electron 自带的 `node:sqlite`。开发测试使用 Node.js 24.22 或更高版本。Electron 运行文件必须安装完整；仅安装 npm 包而缺少 Electron 二进制时无法启动。

## 插件开发

“设置 → 插件”支持安装 `.collectify-plugin` 程序包，也支持配置 HTTPS 在线目录来搜索、下载和更新插件；开发者可从源码目录安装。同 ID 更新保留数据与启停状态。所有插件均可卸载，默认保留数据，也可明确删除；默认插件可随时恢复。默认程序随应用发布，不能被外部包覆盖。

使用方式、离线分发、目录合同和发布命令见 [插件安装与分发](docs/PLUGIN-DISTRIBUTION.md)。目前没有预设的公共目录服务，可使用实际发布者的目录地址或离线安装包。

插件页面隔离运行，通过 SDK 使用声明的能力。默认业务插件还提供随宿主代码发布的原生后台模块，拥有自己的领域仓储、导航、生命周期和 MCP 工具；不向本地页面插件开放任意 Node.js 入口。

清单、SDK、导航贡献、后台生命周期和最小可运行示例见 [插件架构](docs/plugin-system.md)。新增普通插件不需要修改宿主导航或增加业务 IPC 分支。

接入 MCP 后，也可以直接让 AI 新建并安装插件。宿主提供真实 SDK 合同、隔离草稿、批次写入、静态校验、安装更新、启停与受限加载诊断，并附带基础页面和剪贴板历史模板。详见 [通过 AI 扩展插件](docs/AI-PLUGIN-DEVELOPMENT.md)。

## 数据存储

数据目录：Windows 为 `%APPDATA%\Collectify`；macOS 为 `~/Library/Application Support/Collectify`；Linux 通常为 `~/.config/Collectify`。以“设置 → 通用”显示的实际目录为准。

```text
host.sqlite                         宿主偏好、插件启停、MCP 连接配置
plugins/collectify.bookmarks/data.sqlite
plugins/collectify.tasks/data.sqlite
plugins/collectify.notes/data.sqlite
plugins/<其他插件ID>/data.sqlite
plugin-packages/<插件ID>/            已安装自有插件的程序文件
```

收藏、任务和便签使用各自的关系表。日历、看板、四象限和清单是同一份任务数据的视图。时间戳和 JSON 只保存偏好，不保存输入文本。宿主没有统一业务 Store。

从旧单体版本升级时，各默认插件首次只读提取 `collectify.sqlite` 中属于自己的数据，保留原 ID、登录资料、关联和附件路径；原文件不删除、不覆盖。已建立插件领域数据后不会重复初始化。旧库仅作为迁移来源，此后业务修改写入各插件自己的数据库。

收藏支持网页、本地文件、文件夹、文本和账号资料。按产品要求，账号密码明文保存、编辑带回并可复制。HTTP Basic 认证与网页登录表单不同，普通登录可使用资料卡辅助输入。

仓库内的 `config/default-config.json` 为公开演示数据。根目录的个人 `default-config.json` 已被 Git 忽略；第一次初始化时优先使用该文件。示例只有首次初始化时添加，不覆盖已有数据。

## 导入、导出与恢复

“设置 → 导入 / 导出”按插件选择内容，可另选宿主设置及是否包含明文登录资料。当前交换格式为 `format: collectify-workspace`、`version: 2`；数据不包含插件程序、浏览器 Cookie、附件原文件或本机 MCP 令牌。

合并和替换仅影响勾选的插件。导入不会自动启用已停用插件；关系表数据由所属插件校验和处理。跨插件导入时，任务对收藏的可选关联由任务插件依据收藏插件给出的 ID 映射处理。

跨库导入会先保留恢复快照，异常退出后在插件启动前恢复；不宣称多个 SQLite 文件具有单库事务原子性。运行中请使用应用导出，或完全退出后备份整个数据目录，不只复制仍可能有 WAL 的单个数据库。

## AI 与桌面组件

“设置 → AI 连接”可启用本机 Streamable HTTP MCP，服务只监听本机，使用 Bearer 令牌。插件自行贡献工具，停用插件后相关 AI 工具同步移除。AI 接口不返回收藏账号密码。详见 [MCP](docs/MCP.md)。

桌面待办属于待办插件。停用待办会停止提醒并关闭桌面组件。主程序完全退出后不会继续提醒。主题中的实色／毛玻璃为公共桌面组件材质，实际透色由系统能力和后方内容决定；不会为浅色桌面伪造彩色背景。

## 检查与打包

```powershell
npm.cmd test
npm.cmd run smoke
npm.cmd run dist:win
node scripts/verify-release.cjs
```

`npm test` 包含领域模型、迁移、存储、插件合同、备份恢复等测试；`npm run smoke` 验证当前插件工作台的真实页面和 IPC 链路。`test/legacy-ui` 保留旧单体 DOM 测试参考，不计入当前通过的 UI 检查。

Windows 安装包为 `dist/Collectify-Setup.exe`，`dist/win-unpacked` 为打包中间产物。发布验证递归核对宿主、全部插件、SDK、共享模块和静态资源。图标源为 `assets/icon.png`，设置图标使用 `assets/设置 .svg`。截图及验证输出在系统临时目录 `Collectify-verification`。

当前已在 Windows 验证；macOS、Linux 的本轮改造尚未实机验证。构建命令见 [打包文档](docs/PACKAGING.md)。

## 贡献与许可

开发和中文提交约定见 [CONTRIBUTING.md](CONTRIBUTING.md)。项目尚未指定开源许可证，`package.json` 标记为 UNLICENSED；第三方依赖遵循附带许可证。
