# Diff 构建依赖

这里只保存锁定的前端与解析依赖，运行时代码位于 `src/plugin-library/diff`，没有服务端服务或远程加载。

安装：`npm ci --prefix plugins/sources/diff --ignore-scripts`。构建：`npm run diff:build`。构建还使用已准备好的官方 SheetJS 0.20.3 源码 `build-tools/sheetjs/package`，打包后的 vendor 和许可证随 Diff 插件独立分发。私钥不属于源码或插件包。
