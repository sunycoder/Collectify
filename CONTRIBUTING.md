# Contributing to Collectify

## 开发与验证

使用 Node.js 24.22 或更高版本，在项目根目录执行：

```sh
npm ci
npm test
npm start
```

修改桌面交互时执行 `npm run smoke`。修改 UI/MCP 依赖后执行 `npm run build:assets`，同时提交供应文件及许可证。打包命令和平台限制见 [打包说明](docs/PACKAGING.md)。

使用 `npm run format` 统一格式化项目，使用 `npm run format:check` 只检查格式。规则集中在 `.prettierrc.json`，JavaScript 使用四空格、单引号和分号，JSON / Markdown 使用两空格，换行统一为 LF。依赖、供应文件、安装产物及本机配置通过 `.prettierignore` 排除。需要仅格式化某个文件时执行 `npx prettier --write src/main.js`。

业务数据读写由所属插件的领域模型与 SQLite 仓储处理，宿主只协调公共能力。新增表或字段必须提供结构版本升级与回归测试；禁止静默重置数据库。源码和文档使用 UTF-8。

## 提交规范

每个提交围绕一个明确目的，采用 Conventional Commits 形式：

```text
fix(calendar): 修复日期选择器超出窗口边界

调整待办弹窗尺寸时，将日期选择器保持在可见区域。
保留选中日期，时间按钮使用一分钟步长。

验证：npm test；npm run smoke -- --smoke-ui-only
```

常用类型：`feat`、`fix`、`refactor`、`test`、`docs`、`build`、`chore`。标题和正文使用中文，必要的专业术语保留英文。标题说明具体变化；复杂提交正文写明原因、行为变化、验证结果和限制。不能只写“修改”“优化”或“初始化”。未通过或未执行的检查须如实标注。

推送前查看 `git status` 和暂存差异，确认提交范围，不自动混入无关改动；正常推送不使用强制覆盖。

## 本机配置

仓库内 `config/default-config.json` 和 `config/example-import.json` 仅放演示资源，不包含实际账号密码。真实默认配置放在项目根目录的 `default-config.json`，该文件已忽略，由程序优先读取。

不要提交数据库、导出备份、日志、IDE 个人配置、安装产物、令牌和真实登录资料。本机离线打包缓存保留于已忽略的 build-tools 目录。

## 许可证

项目当前尚未指定开源许可证（package.json 为 UNLICENSED）。仓库可访问性不代表授予开源许可；第三方供应文件遵循各自附带的 LICENSE。
