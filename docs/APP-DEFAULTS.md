# 程序默认配置

维护者统一编辑 `config/app-defaults.json`，重启或重新打包后生效：窗口尺寸、首次使用的设置、OAuth 回调端口、MCP 默认端口、更新检查间隔、发布源、仓库、分支、插件目录路径和团队配置索引。

配置入口只有两个：

| 文件                       | 用途                                        | 提交与打包         |
| -------------------------- | ------------------------------------------- | ------------------ |
| `config/app-defaults.json` | 程序默认配置，含 `initialData` 演示初始数据 | 提交并打包         |
| `config/local.json`        | 可选的本机覆盖、私有初始数据和其他服务预设  | 忽略且明确排除打包 |

本机覆盖优先于程序默认值，已保存的个人设置仍优先于默认设置。开发时只读取工作区 `config/local.json`；已安装程序只读取用户数据目录下 `config/local.json`（Windows 通常为 `%APPDATA%/Collectify/config/local.json`，macOS 为 `~/Library/Application Support/Collectify/config/local.json`）。配置必须是 JSON 对象，端口错误或 JSON 损坏会明确报错。

覆盖按设置组字段合并；`initialData` 整体替换，避免把演示收藏混入私人初始数据。其他服务可配置到 `sources.gitlab` 或 `sources.github`，当前首次使用的服务由 `distribution` 决定。普通用户无需编辑文件，继续使用设置页。演示导入文件放在 `examples`，不会被当成程序配置读取。

根目录旧配置与 `config/distribution.json` 已取消读取。旧工作副本执行 `node scripts/migrate-config.cjs` 可备份并迁移；冲突时停止并保留原文件。备份写入忽略目录 `dist/config-migration-*`，含私人数据，不要分享。此配置不存 OAuth Token 或 Client Secret。

历史发布源的 `clientId` 为空时，仅当服务类型、地址和仓库都与预设一致，启动会补齐预设 ID；保留已保存的分支、目录及其他设置，非空个人 ID 不覆盖。配置文件在进程启动时读取，修改后需完全退出（包括托盘）并重新启动。修改源码工作区文件仅影响开发运行；已安装程序使用安装包内的配置，需要重新打包或使用设置页修改。

- 修改 OAuth 回调端口后，需要同步修改 GitLab 应用登记的 Redirect URI；回调保持仅监听本机回环地址。
- MCP 已保存的端口仍优先，首次配置才采用默认端口；改动后可在设置中调整。
- 默认发布源不代表发布脚本的目标。`plugins/definitions.json` 是插件发布目录的构建输入，使用 `scripts/configure-source.cjs` 同步部署源和发布目录。
- `settings.theme` 可填写主题模型支持的默认字段（例如 `preset`、`accent`），空对象采用主题模型的基础值。业务插件自己的偏好由各插件管理，避免宿主依赖插件内部字段。

主程序使用原生标题栏，macOS 红黄绿按钮由系统绘制。macOS 关闭主窗口保留进程，可通过 Dock 或菜单栏图标恢复；明确退出时释放后台任务。Windows/Linux 根据托盘、后台任务和个人设置决定是否常驻。

macOS 的“执行粘贴”需要系统辅助功能权限；本地搜索使用文件夹搜索，Everything 是 Windows 专用引擎。Linux 粘贴暂提示手动切换目标应用执行。这里记录真实平台边界，不把可构建等同于所有功能已经实机验证。

Windows、macOS、Linux 的单元测试和桌面冒烟已配置到 `.github/workflows/ci.yml`，Linux 桌面使用 Xvfb。只有流水线实际执行成功才能报告该系统验证通过；本地 Windows 测试不代表 macOS 实机测试。系统托盘、Dock、辅助功能授权、系统毛玻璃和外部应用焦点仍需对应系统手动验证。
