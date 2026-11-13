# 官方插件目录

用户在“设置 → 插件 → 发现插件”中直接使用内置官方源，首次进入时读取目录。

固定目录地址：

```text
https://raw.githubusercontent.com/sunycoder/Collectify/main/plugins/catalog.json
```

`definitions.json` 是发布配置，`catalog.json` 是构建生成的公开目录。插件源码引用仓库内的静态模板，不包含任何本机数据。

当前可下载插件为 `collectify.clipboard-history`（剪贴板历史）：仅在插件显示且用户主动开启时采集文本，保存最近 30 条，支持搜索、复制和清空。收藏、待办、便签、JSON、时间戳仍随 Collectify 提供。

## 发布或更新

1. 修改插件源码；程序改变时提高 `definitions.json` 中对应插件的版本号。
2. 执行 `npm run plugins:build`，生成 `.plugin-release/` 安装包并更新公开目录。
3. 执行 `npm run plugins:check`，检查源码、版本、大小与 SHA-256 是否一致。
4. 提交源码、发布配置和目录并推送到 `main`。
5. GitHub Actions 的“发布官方插件”工作流自动把附件发布到 `plugins-v1` Release；也可在 Actions 中手动重新运行。
6. 工作流成功后，在应用中刷新目录并安装验证。

发布使用 GitHub Actions 自动提供的令牌，不需要向聊天或仓库添加个人令牌。已有同版本附件只做校验，不覆盖；重复运行可继续补齐尚未上传的文件。首次创建的 Release 在附件上传成功后才公开，后续插件版本采用新的文件名。

本机已安装并登录 GitHub CLI 时，也可执行 `npm run plugins:publish`；未登录时使用 Actions 发布即可。

`.plugin-release/` 为忽略的构建产物，不提交到 Git。目录中的包地址对应 GitHub Release 附件，不是仓库源码下载地址。
