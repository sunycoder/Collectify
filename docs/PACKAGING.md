# 构建与发布

主程序和插件在同一仓库维护，分别发布。日常提交只运行检查，确认版本后通过标签发布，不把每次 UI 调试变成一次公开更新。

## 主程序

1. 修改 `package.json`、锁文件的版本，并补充 `CHANGELOG.md` 与 `docs/releases/<版本>.md`。
2. 检查 README 的下载链接版本。
3. 执行 `npm run format:check`、`npm test`、`npm run smoke`。
4. 提交并推送，再创建并推送对应标签，如 `v5.6.0`。
5. “发布主程序”工作流在 Windows、macOS、Linux 分别构建，全部产物核对通过后公开 Release。

安装包文件名包含版本、系统和架构。Windows 提供 x64 NSIS 安装器，macOS 提供 arm64 / x64 DMG，Linux 提供 x64 AppImage / deb。Windows 打包版还执行启动验证；macOS/Linux 尚未手工桌面实测，下载页标记为试用。本轮不配置商业签名或 macOS 公证。

工作流先上传完整安装包和 SHA256SUMS.txt，再公开草稿，插件 Release 不作为主程序最新版。已正式发布的附件不覆盖，修改程序后发布新版本。

## 本机构建

```sh
npm ci
npm run dist:win
node scripts/release-files.cjs verify
```

macOS 上运行 `npm run dist:mac`，Linux 上运行 `npm run dist:linux`。本机 `dist` 保留本次构建的安装包并清理旧包；构建失败不清理。`win-unpacked` 等目录用于验证，不是给普通用户安装的文件。GitHub 保留历史 Release。

离线 Windows 构建可复用已忽略的 `build-tools` 缓存，或通过 `--config.electronDist=node_modules/electron/dist` 使用本机 Electron；常规发布由 CI 下载依赖。

## 插件

修改插件源码及自身版本，运行 `npm run plugins:build` 和 `npm run plugins:check`，提交源码与目录。推送 `plugin-<插件ID>-v<版本>` 标签后，“发布官方插件”工作流只发布对应插件。详细操作见 [官方插件目录](../plugins/README.md)。

插件的 `minHostVersion` 和可选 `platforms` 用于安装前检查。后台采集和悬浮窗口等新能力需要 Collectify 5.6.0；发现页面会明确提示先升级。

## 数据与资源

数据位置、备份及升级步骤以 [用户指南](USER-GUIDE.md) 为准，插件各自拥有数据库。发布安装包不包含真实用户数据、个人默认配置、浏览器会话或 MCP 令牌。设置中没有“备份单个总数据库”的入口。

图标源为 `assets/icon.png`，ICO / ICNS 由 `scripts/derive-icons.py` 派生。Windows 保留图标资源编辑；`signExecutable: false` 仅跳过签名。Windows 粘贴助手从 `app.asar.unpacked` 执行，外部进程不读取虚拟 ASAR 路径。
