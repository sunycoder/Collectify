# Collectify 打包与安装

项目根目录为 `D:\study\Collectify`。产品名 Collectify，包名 collectify，应用 ID `com.collectify.desktop`。本地项目直接使用新 SQLite 库，不兼容原项目身份和旧数据。

文中绝对路径为本机示例，其他电脑替换为自己的克隆目录。源码库不分发 build-tools 中的离线插件缓存，常规构建由 electron-builder 下载所需资源。

## Windows

```powershell
cd D:\study\Collectify
npm.cmd ci
npm.cmd test
npm.cmd run smoke
npm.cmd run dist:win
node scripts/verify-release.cjs
```

唯一安装包为 `dist/Collectify-Setup.exe`。双击后选择安装目录。同一 Collectify 身份的后续版本可以退出程序后直接安装更新。卸载默认保留 Collectify 用户目录；旧项目的安装和数据不参与此版本的初始化。

本机离线资源构建：

```powershell
$env:ELECTRON_BUILDER_COMPRESSION_LEVEL = '3'
$env:ELECTRON_BUILDER_NSIS_RESOURCES_DIR = 'D:\study\Collectify\build-tools\nsis-resources'
npm.cmd run dist:win -- --config.electronDist=node_modules/electron/dist
```

打包前自动生成 UI 与 MCP 供应文件。安装电脑无需安装 Node.js 或 SQLite；使用 Electron 自带的 Node SQLite 模块，不额外打包第三方 SQLite 原生扩展。

打包成功后清理 dist 顶层历史安装包与 blockmap，只保留一个最新安装包；失败不主动清理。`win-unpacked` 用于验证，不能代替安装器。验证脚本检查包内源码、产品名称、版本、图标及唯一安装包。

## 数据位置

Windows：`%APPDATA%\Collectify\collectify.sqlite`。
macOS：`~/Library/Application Support/Collectify/collectify.sqlite`。
Linux：一般为 `~/.config/Collectify/collectify.sqlite`。

实际路径在“设置”查看。备份使用该页面“备份数据库”，不要在运行期间只复制主文件。完整表结构和恢复步骤见 [数据模型](DATA-MODEL.md)。

## 图标

唯一源为 `assets/icon.png`。使用 Pillow 运行 `scripts/derive-icons.py` 派生 ICO / ICNS，不重绘原图。UI、托盘和窗口使用原 PNG；Windows exe 和安装器使用 ICO，macOS 使用 ICNS。

Windows 配置 `signExecutable: false` 仅跳过签名，仍编辑图标资源；不能设置 `signAndEditExecutable: false`。

## macOS

在 Mac 上复制源码并重新安装依赖：

```sh
npm ci
npm test
npm run smoke
npm run dist:mac
```

输出 Collectify 的 x64 / arm64 DMG，选择对应架构并拖入 Applications。正式外部分发需配置签名与公证。Windows 本机不生成或验证 macOS 包。

## Linux

在 Linux x64 上：

```sh
npm ci
npm test
npm run smoke
npm run dist:linux
```

输出 Collectify AppImage / deb，分别赋予执行权限或使用系统包管理器安装。Windows 本机不生成或验证 Linux 包。
