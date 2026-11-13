# Collectify

可扩展的个人插件工作台：把收藏、待办、日历和便签放在一起，也可以安装新插件，或让接入的 AI 按你的需求编写插件。

## 下载

当前主程序版本 **5.6.0**。下载后直接安装，无需 Git、Node.js 或数据库环境。

| 系统                | 安装包                                                                                                                                                                                                                         | 状态         |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| Windows 10/11 x64   | [下载安装包](https://github.com/sunycoder/Collectify/releases/download/v5.6.0/Collectify-5.6.0-windows-x64-setup.exe)                                                                                                          | 已做桌面验证 |
| macOS Apple Silicon | [下载 DMG](https://github.com/sunycoder/Collectify/releases/download/v5.6.0/Collectify-5.6.0-macos-arm64.dmg)                                                                                                                  | 试用         |
| macOS Intel         | [下载 DMG](https://github.com/sunycoder/Collectify/releases/download/v5.6.0/Collectify-5.6.0-macos-x64.dmg)                                                                                                                    | 试用         |
| Linux x64           | [AppImage](https://github.com/sunycoder/Collectify/releases/download/v5.6.0/Collectify-5.6.0-linux-x86_64.AppImage) / [deb](https://github.com/sunycoder/Collectify/releases/download/v5.6.0/Collectify-5.6.0-linux-amd64.deb) | 试用         |

[全部版本与发布说明](https://github.com/sunycoder/Collectify/releases) · [安装、更新与备份](docs/USER-GUIDE.md) · [更新记录](CHANGELOG.md) · [反馈问题](https://github.com/sunycoder/Collectify/issues/new/choose)

安装包暂未签名，macOS 未公证；各平台验证范围见对应 Release。不要将 GitHub 的 Source code 源码压缩包当作安装包。

## 开始使用

1. 安装并打开 Collectify，左侧选择插件。
2. 收藏、待办与日历、便签、JSON、时间戳默认提供；侧栏可收放。
3. 设置 → 插件 → 发现插件，直接安装官方插件，如剪贴板历史。
4. 设置 → 导入 / 导出，按需备份数据。

网页默认使用内置浏览器，可在设置中改为系统默认浏览器。插件可以独立更新、停用和卸载；更新主程序保留本机数据。

## 按需求扩展

Collectify 宿主负责窗口、主题、导航、权限和公共能力，业务由插件提供。插件可贡献自己的页面、导航和后台任务，不设额外的“工具插件”分类。

设置 → AI 连接，开启本机 MCP 后，可让 AI 创建并安装自有页面插件。例如：“给我添加一个可搜索的文本整理插件”。详见 [AI 插件开发](docs/AI-PLUGIN-DEVELOPMENT.md)。

## 开发与维护

```sh
npm ci
npm run build:assets
npm start
```

使用 Node.js 24.22 或更高版本。常用检查为 `npm test`、`npm run smoke` 和 `npm run format:check`。用户数据与安装产物不提交仓库，个人默认配置放在已忽略的根目录 `default-config.json`。

- [贡献约定](CONTRIBUTING.md) · [构建与发布](docs/PACKAGING.md)
- [插件架构](docs/plugin-system.md) · [官方插件发布](plugins/README.md)
- [GitLab/GitHub 登录、更新与团队配置](docs/GIT-SOURCES.md)（5.7.0 开发版）
- [数据说明](docs/DATA-MODEL.md) · [MCP](docs/MCP.md)

项目许可尚未选定，当前标记为 UNLICENSED。第三方依赖和素材保留各自的来源与许可。
