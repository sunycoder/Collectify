# 官方插件目录

用户在“设置 → 插件 → 发现插件”中直接使用内置官方源，首次进入时读取目录。

已安装与发现插件使用市场卡片展示。构建目录时从插件包自己的 `icon` 生成可选 `iconData`（SVG Base64，最多 64 KiB），安装前无需额外图片请求即可展示 Logo；旧目录仍兼容并显示文字图标。已安装插件直接读取自己的图标，停用时也可在管理页展示，不会因此启动插件后台。插件来源地址在“插件来源设置”中展开配置。

固定目录地址：

```text
https://raw.githubusercontent.com/sunycoder/Collectify/main/plugins/catalog.json
```

`definitions.json` 是发布配置，`catalog.json` 是构建生成的公开目录。插件源码引用仓库内的静态模板，不包含任何本机数据。

当前独立插件为剪贴板历史、本地搜索、IP 地址查询、计算稿纸和日历。本地搜索 1.2.2 需要 Collectify 5.7.9，含发布者签名的原生后台、Everything 和预览依赖；安装前说明本机访问能力。IP 地址查询 1.0.3 需要 Collectify 5.7.9，按需查询 IPv4 / IPv6，不运行常驻任务，详见 [IP 插件说明](../docs/IP-QUERY.md)。这些插件均按需安装、独立更新和卸载。收藏、待办、便签、JSON、时间戳仍随主程序提供。

## 发布或更新

开发中的 Diff 1.0.4 为完全离线的文本、图片、文件夹和文档对比插件，支持表格按唯一业务键配对行，需要宿主 5.7.12，详见 [Diff 说明](../docs/DIFF.md)。插件源码、解析库与图标均独立，未打开时不扫描文件，不提供 AI 工具。

新增可选“日历”1.0.1，基于 MIT 开源 he-calendar 适配，支持节气主题、农历黄历、城市天气与只读 MCP 查询，详见 [日历说明](../docs/CHINESE-CALENDAR.md)。与默认待办中的日历独立。

可选插件“计算稿纸”1.0.4 支持可拖出主程序的独立桌面数学键盘、离线实时逐行计算、自动保存、多张稿纸、行引用和公式示例。悬浮位置可保存并恢复，缩小窗口后保持可见。图标由插件包自带，无原生后台和网络权限。安装与计算规则见 [计算稿纸说明](../docs/CALCULATOR.md)。

1. 修改插件源码；程序改变时提高 `definitions.json` 中对应插件的版本号。
2. 执行 `npm run plugins:build`，生成 `.plugin-release/` 安装包并更新公开目录。
3. 执行 `npm run plugins:check`，检查源码、版本、大小与 SHA-256 是否一致。
4. 提交源码、发布配置和目录并推送到 `main`，这一步只检查，不发布。
5. 推送对应标签，例如 `git tag plugin-collectify.clipboard-history-v2.1.1`，再执行 `git push origin plugin-collectify.clipboard-history-v2.1.1`。工作流发布该插件版本的独立 Release，不占主程序最新版入口；也可在 Actions 手动发布。
6. 工作流成功后，在应用中刷新目录并安装验证。

发布使用 GitHub Actions 自动提供的令牌，不需要向聊天或仓库添加个人令牌。已有同版本附件只做校验，不覆盖；重复运行可继续补齐尚未上传的文件。首次创建的 Release 在附件上传成功后才公开，后续插件版本采用新的文件名。

本机已安装并登录 GitHub CLI 时，也可执行 `npm run plugins:publish`；未登录时使用 Actions 发布即可。

`.plugin-release/` 为忽略的构建产物，不提交到 Git。目录中的包地址对应 GitHub Release 附件，不是仓库源码下载地址。
