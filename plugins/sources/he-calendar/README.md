# he-calendar 的 Collectify 适配源码

上游：`https://github.com/scutken/he-calendar`，版本 1.5.2，提交 `b75a5db40e6177a8b4eae9449e85ad02892c5eda`，MIT License，Copyright (c) 2026 Kayu Tse。页面已移除“关于”展示；原作者及完整许可证保留在源码和插件安装包中。

保留上游 Vue Calendar 组件、24 节气配色、主题、月历与黄历布局、天气悬停卡片和历法核心。适配改动集中在：

- 使用 Collectify SDK 异步预读/串行保存偏好，替换 uTools / localStorage；加载失败保留原始配置。
- 使用签名插件后台的受限天气请求替换 Web 代理，不绕过沙箱网络权限。保留桌面版城市搜索；不申请浏览器定位。
- 原 MCP 工具改为宿主贡献的五个只读工具，不启动独立服务。历法、天气模型、MCP schema 均独立构建并在后台按需载入。
- 窗口隐藏/切换和停用时暂停天气请求与页面时钟；请求有超时、大小限制、缓存和旧响应隔离。
- 增加插件自有图标、窄屏布局、来源标注；天气预报改为今天后四天，日期范围限制为 1901～2099。
- 时辰的十二神名称直接使用 tyme4ts `LunarHour.getTwelveStar()`，前后端保持一致；天气预报时间按供应商本地时间展示，避免运行系统时区使日期/小时错位。

从仓库根目录执行：

```sh
npm ci --prefix plugins/sources/he-calendar --ignore-scripts
npm run calendar:build
# 先格式化手写源码，再构建；运行资源变化后必须重新签名
node scripts/sign-native-plugin.cjs src/plugin-library/chinese-calendar
npm run plugins:build
npm run smoke:calendar
```

本目录的依赖仅供开发构建，不进入插件包。实际分发目录为 `src/plugin-library/chinese-calendar`，包含可复现构建的 view、vendor 和许可证，不包含 node_modules。CI 普通检查使用已提交运行资源，不需重新安装 Vue 构建依赖。
