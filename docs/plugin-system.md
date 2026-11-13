# 统一插件工作台

Collectify 本身是宿主。收藏、待办与日历、便签、时间戳、JSON 都是插件，前三者只是默认随包提供，不再有“原生业务区”和“工具插件区”两套入口。

## 边界与导航

- 宿主：窗口、一级插件入口、二级导航容器、主题、启停、权限、备份协调和 MCP 传输。
- 插件：业务页面、领域模型、关系表、业务操作、插件内部导航、桌面窗口、后台提醒及 MCP 工具。
- 一级导航按已启用清单生成；二级由当前插件清单或后台贡献。宿主不认识分类、任务状态或便签颜色。
- 默认插件和本地插件使用同一个页面运行时、导航合同、存储入口和启停机制。全部停用后显示空工作台，仍可打开设置管理插件。

| 插件   | 二级导航                       | 其他贡献                              |
| ------ | ------------------------------ | ------------------------------------- |
| 收藏   | 全部、置顶、最近打开、动态分类 | 内置浏览器、登录资料卡、收藏 MCP 工具 |
| 待办   | 清单、四象限、看板、日历、归档 | 桌面待办、提醒、任务 MCP 工具         |
| 便签   | 全部、按颜色                   | 转为待办、便签 MCP 工具               |
| 时间戳 | 时间戳转日期、日期转时间戳     | 本地转换、复制                        |
| JSON   | 格式化、压缩、校验             | 本地处理、复制                        |

待办各视图共用任务数据；日历不是独立的第二份日程库。便签转待办通过显式插件协作打开待办插件的新建表单，保留原便签。

## 代码与生命周期

```text
src/main.js                        通用宿主启动和 IPC
src/index.html / renderer.js        外壳、二级导航与全局设置
src/plugin-system/
  manifest.js                      清单、路径、能力合同
  registry.js                      安装信息、启停、数据协调
  runtime.js                       独立页面、资源协议、SDK 鉴权
  services.js                      可信默认后台的生命周期和贡献
  backup.js                        按插件备份与跨库恢复
  sdk/                             公共 UI 与页面 SDK 辅助资源
src/plugins/
  bookmarks/                       收藏页面、仓储、浏览器、资料卡
  tasks/                           待办各视图、模型、提醒、桌面组件
  notes/                           便签页面、仓储、转待办
  timestamp/                       时间戳页面与算法
  json/                            JSON 页面与算法
  .shared/                         领域仓储公共实现和旧数据迁移辅助
```

默认业务插件在清单中声明 `backend`，宿主只从随包的可信默认目录加载该入口。后台 `create(context)` 返回 `call`、`navigation`、`activate`、`deactivate`、`exportData`、`planData`、`importData`、`mcpTools` 等贡献。宿主遍历这些贡献，不增加具体业务 switch。

创建领域处理器与激活后台任务分离：停用插件的数据仍可备份，但不会运行其提醒、网页或桌面组件。后台初始化失败会记录为该插件的诊断，其他插件仍可使用。启停时销毁页面、关闭所属窗口并回收 MCP 能力；数据保留。

本地自有页面插件不提供任意 Node.js 后台入口。支持 `.collectify-plugin` 包导入、源码目录安装与 HTTPS 目录下载，确认名称、版本和声明能力；相同 ID 更新程序而保留数据。默认程序随 Collectify 更新，不能被外部包覆盖。所有插件支持卸载，默认保留数据，也可明确删除；默认插件使用持久卸载记录，支持恢复。详见 [插件安装与分发](PLUGIN-DISTRIBUTION.md)。

## 最小自有插件

新建目录，放入以下文件，再在“设置 → 插件 → 已安装 → 开发者选项 → 安装源码目录”选择该目录。无需修改宿主导航 HTML、IPC 分支或业务表。

`manifest.json`：

```json
{
  "id": "example.hello",
  "name": "问候",
  "glyph": "好",
  "order": 100,
  "description": "独立插件示例。",
  "version": "1.0.0",
  "apiVersion": 1,
  "entry": "index.html",
  "permissions": ["storage", "clipboard.write"],
  "commands": [{ "id": "open", "title": "打开问候" }],
  "navigation": [{ "id": "home", "label": "问候内容" }]
}
```

`index.html`：

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <title>问候</title>
    <link rel="stylesheet" href="collectify-plugin://collectify.sdk/tool.css" />
  </head>
  <body>
    <h1>问候</h1>
    <section class="panel">
      <label>称呼<input id="name" maxlength="80" /></label>
      <div class="toolbar"><button id="copy">保存并复制问候</button></div>
      <p id="message" role="status"></p>
    </section>
    <script src="collectify-plugin://collectify.sdk/toolkit.js"></script>
    <script src="app.js"></script>
  </body>
</html>
```

`app.js`：

```javascript
const input = document.querySelector('#name');
ToolUI.run(async () => {
  input.value = (await collectify.storage.get('name')) || '';
});
document.querySelector('#copy').onclick = () =>
  ToolUI.run(async () => {
    const name = input.value.trim() || '朋友';
    await collectify.storage.set('name', name);
    await collectify.clipboard.writeText(`你好，${name}`);
    ToolUI.message('已保存并复制');
  });
collectify.onNavigate(({ route }) => {
  if (route === 'home') input.focus();
});
```

安装目录限制：10 MB、300 个文件、500 个目录项、20 层目录；不接受符号链接、特殊文件、`node_modules` 或隐藏依赖目录。支持静态 HTML、JS/MJS、CSS、JSON、常用图片、WOFF2、TXT、Markdown 和 LICENSE。`collectify.sdk` 为保留 ID。

## 页面 SDK

| API                         | 条件                   | 行为                                                                       |
| --------------------------- | ---------------------- | -------------------------------------------------------------------------- |
| `context()`                 | 无                     | 当前插件公开信息、主题和 CSS tokens                                        |
| `onContextChanged(fn)`      | 无                     | 主题变化，返回取消订阅函数                                                 |
| `onCommand(fn)`             | 无                     | 打开命令 `{id}`                                                            |
| `onNavigate(fn)`            | 无                     | 当前插件内部路由 `{route,payload}`                                         |
| `selectNavigation(route)`   | 路由须属于本插件       | 内容内切换时同步宿主二级导航选中状态                                       |
| `storage.get/set/delete`    | `storage`              | 按插件身份隔离的偏好键值                                                   |
| `clipboard.readText()`      | `clipboard.read`       | 当前插件显示、主窗口可见且未最小化时读取文本，上限 64 KB；隐藏和停用后拒绝 |
| `clipboard.writeText(text)` | `clipboard.write`      | 复制文本                                                                   |
| `invoke(action,data)`       | 可信默认插件有后台入口 | 仅调用本插件后台，不接受伪造其他插件 ID                                    |
| `onEvent(fn)`               | 无                     | 本插件的后台事件                                                           |

异步方法返回 Promise，失败抛出可展示错误。主进程逐次核对启用状态、WebContents、主框架和入口 URL。页面不拿到 Node.js、文件系统、原始 SQL 或全能宿主 IPC。

页面使用隔离上下文、沙箱和 Web 安全；`collectify-plugin://` 资源协议只提供自己的静态资源和公共 SDK 资源。跨插件文件、远程网络、弹窗和下载默认阻止。收藏中的远程网页使用收藏插件单独创建的隔离会话，既没有插件 SDK，也没有宿主 IPC。

## 数据与迁移

```text
用户数据目录/
  host.sqlite
  plugin-packages/<插件ID>/
  plugins/<插件ID>/data.sqlite
  collectify.sqlite                 旧单体库，只作首次迁移来源
```

宿主库 v2 存全局设置、插件注册信息与 MCP 配置。每个业务插件有自己的关系表、领域版本和修订号；元数据与领域实体分开，页面不决定 SQL 表结构。插件 ID 与领域版本身份校验不匹配时拒绝覆盖。

| 默认领域插件 | 关系表                      |
| ------------ | --------------------------- |
| 收藏         | `categories`、`entries`     |
| 待办         | `tasks`、`task_attachments` |
| 便签         | `notes`                     |

领域仓储使用事务、参数化 SQL、外键、约束、WAL 和修订号检查。MCP 写入审计保存在所属插件的 `domain_audit`，与同库业务提交一起完成。任务对收藏的关联跨插件存在，不使用跨库外键；收藏删除时通知待办清理引用，待办重新启用时也会核对失效引用。收藏停用时，编辑任务不会因下拉列表空而悄悄删除原关联。

首次迁移只读旧库，保留实体 ID、明文凭据、任务关联、便签和附件路径。每个插件已有领域状态后不再重新导入，不删除旧库。`src/store.js` 等旧导入位置仅为旧数据回归测试保留别名，宿主不再实例化统一业务 Store。

页面键值 SDK 只用于工具偏好，限 128 字符键、256 KB 单值、200 项和 8 MB／插件。时间戳与 JSON 不保存输入文本。业务实体不塞入该键值表。

## 备份与 MCP

当前全局交换文件为 `collectify-workspace` v2，按插件选择，可另选宿主偏好及是否包含明文登录资料。默认插件通过自己的领域导出与导入钩子处理数据，本地页面插件处理隔离键值数据。

替换只影响勾选插件；跨插件关联由领域处理器利用 ID 映射协调。文件不包含插件程序、浏览器 Cookie、附件原文件或本机 MCP 令牌，导入也不自动启用插件。旧单体 JSON 交换文件不直接作为 v2 插件备份导入；升级时的旧库提取是独立、只读的迁移链路。

多库导入先校验所有处理器的计划，再写 `workspace-import-recovery.json.before.json` 与恢复日志；失败补偿，异常退出后在插件后台启动前恢复。它是跨库恢复机制，不是多个 SQLite 文件的单事务。恢复失败保留快照并报告。

MCP 传输由宿主提供，工具由激活的后台插件贡献。每次请求读取当前贡献，停用后不继续暴露旧工具。账户密码不提供给 AI。

宿主另外提供插件开发工具：AI 可读取 SDK 合同，在 `plugin-drafts` 中创建程序草稿、按 revision 修改、静态校验并安装为自有页面插件。不会直接改项目源码，不开放任意 Node.js 后台或任意路径写入。完整使用方式见 [通过 AI 扩展插件](AI-PLUGIN-DEVELOPMENT.md)。

## 验证与范围

```powershell
npm test
npm run smoke
```

单元测试验证清单边界、隔离存储、迁移、关系表、写入冲突、备份恢复及工具算法。当前 Electron 冒烟覆盖五插件加载、二级导航、真实业务表单、多视图、跨插件操作、桌面组件、动态 MCP 和全部停用的空壳状态。历史单体 DOM 脚本在 `test/legacy-ui`，不计为本轮已通过的界面测试。

当前实测环境为 Windows，macOS／Linux 尚未实机验证。
