# 测试目录

Diff 独立回归使用 `npm run smoke:diff`，覆盖实际 Monaco 页面、拖放路径、剪贴板测试数据、文件夹、DOCX/XLSX/XLS/PDF/PPTX、像素对比、报告和热插拔；`test/diff.test.js` 验证相同大小时间下的真实内容差异、解析、边界、设置及取消时序。

| 位置         | 用途                                 | 执行入口                |
| ------------ | ------------------------------------ | ----------------------- |
| `*.test.js`  | Node 单元与业务回归测试              | `npm test`              |
| `smoke/`     | Electron 冒烟场景与场景编排          | `npm run smoke`         |
| `support/`   | 被测宿主模块定位、截图输出等测试辅助 | 由测试引用              |
| `fixtures/`  | 文档、图片等固定测试样例             | 由测试读取              |
| `tools/`     | 测试样例生成工具                     | `npm run test:fixtures` |
| `legacy-ui/` | 旧版界面测试归档，不作为当前通过依据 | 见目录说明              |

`src/` 存放宿主和插件运行代码，`scripts/` 存放构建、发布与维护工具。测试场景、模拟对象和截图辅助不进入正式安装包。

完整冒烟：`npm run smoke`。指定场景可追加参数，例如 `npm run smoke -- --smoke-fullscreen`、`npm run smoke -- --smoke-shutdown`。本地搜索预览验证用 `npm run smoke:local-search`，需要已准备好插件依赖与 `fixtures/local-search/` 样例。

IP 可选插件独立验证使用 `npm run smoke:ip-query`，包含签名安装、真实页面与 IPC、取消与热插拔；默认使用隔离响应。追加 `-- --live-network` 可查询供应商的公共 IPv4 / IPv6 测试地址，不读取用户保存的 Key。三系统 CI 运行隔离冒烟。

计算稿纸独立验证使用 `npm run smoke:calculator`，完全离线，覆盖真实页面实时求值、自动保存与重开、多稿纸、引用重算、保存失败重试及热插拔。

日历独立验证使用 `npm run smoke:calendar`，包含上游 Vue 实际页面、农历黄历、主题与月份切换、隔离天气、MCP 工具和热插拔。追加 `-- --live-network` 查询真实天气服务的公共测试城市。

验证打包版时，测试脚本仍由源码检出目录提供，必须显式指定绝对路径：

```powershell
$runner = (Resolve-Path test/smoke/runner.js).Path
$process = Start-Process -FilePath dist/win-unpacked/Collectify.exe -ArgumentList '--smoke-test','--smoke-startup',"--smoke-runner=`"$runner`"" -WindowStyle Hidden -PassThru -Wait
if ($process.ExitCode -ne 0) { throw '打包版冒烟失败' }
```

打包版冒烟通过 `support/host.js` 引用安装包内的业务模块，避免误测工作区源码。普通启动不会加载测试入口；截图保存在系统临时目录的 `Collectify-verification` 下。`scripts/verify-release.cjs` 同时检查安装包不含测试文件。
