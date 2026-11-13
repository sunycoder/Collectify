# 账号、更新与团队默认配置

Collectify 使用 GitLab 或 GitHub 提供的身份、文件和发布 API。客户端不依赖 Git 命令，不读取系统 Git 凭据，不把公司账号或项目地址写死。源码、插件与安装包仍可放在同一个现有仓库。

## 维护者一次性配置 GitLab

1. 在 GitLab 个人设置的 Applications 中注册 OAuth 应用；实际菜单名称可能随公司版本不同。
2. Redirect URI 填 `http://127.0.0.1:19287/oauth/callback`，取消 Confidential，勾选 `read_api`。客户端通过公共客户端 PKCE 完成授权，不需要 Client Secret。页面不可用时由管理员登记。
3. 复制 `config/distribution.example.json` 为根目录 `distribution.json`，填写服务地址、项目完整路径及公开 Application ID。公司目前只有 HTTP 的内网 IP 时，将 `allowInsecureHttp` 明确设为 true；HTTP 不加密令牌与下载流量。不会为 HTTPS 跳过证书校验。
4. 在公司 GitLab 对应的工作副本中执行 `node scripts/configure-source.cjs distribution.json`。命令更新 `plugins/definitions.json` 的发布目标、生成 `plugins/catalog.json`，并生成已忽略的 `config/distribution.json`。核对并将 definitions/catalog 提交到公司仓库；公司地址和配置不要提交到公开 GitHub 仓库。
5. 为公司 CI 设置公开变量 `COLLECTIFY_OAUTH_CLIENT_ID`。标签构建会生成部署配置并放进公司安装包，用户无需重复填地址。开发运行或已安装客户端也会读取安装目录旁的 `distribution.json`，仅首次初始化发布源，之后尊重用户设置。

普通用户打开“设置 → 账号与更新”，保存源后点击登录，在系统浏览器完成 GitLab 授权。令牌由 Electron 系统安全存储加密，授权过期时刷新；退出登录清除本地授权。源、项目和分支可在设置中修改。同一 GitLab OAuth 应用切换项目不需要更改认证实现，切换服务地址需要重新登录。

客户端允许匿名读取公开 GitHub 发布；私有 GitHub 源使用 OAuth App 设备登录。维护者在 GitHub 注册 OAuth App 并启用 Device Flow，填写新 Application ID；登录请求 repo 与 read:org，以读取私有文件及用户团队。企业 GitHub、自定义登录协议尚未实现，需要新增 provider 适配器。

## 主程序发布与检查更新

`.gitlab-ci.yml` 提供检查、各系统打包及发布任务。公司实际启用哪个系统，就设置对应变量：

| 变量                              | Runner 要求                                                 |
| --------------------------------- | ----------------------------------------------------------- |
| `COLLECTIFY_RELEASE_WINDOWS=true` | 标签 collectify-windows 的 Windows Shell Runner，Node.js 24 |
| `COLLECTIFY_RELEASE_MACOS=true`   | 标签 collectify-macos 的 macOS Shell Runner，Node.js 24     |
| `COLLECTIFY_RELEASE_LINUX=true`   | 支持 Docker 的 Linux Runner                                 |

推送与 package.json 一致的 `v<版本>` 标签后，已启用的平台构建并校验，发布任务使用 CI_JOB_TOKEN 上传 Generic Package Registry，再创建带下载链接的 Release。发布者需具备对应权限，项目需启用 Package Registry；不把 CI 凭据传给用户。未启用的平台不会出现安装包，客户端会明确提示无对应系统版本。主程序 Release 使用 v 标签，插件使用 plugin- 标签，客户端不会误把插件当作最新主程序。

GitHub Actions 发布继续可用。两边均生成 `collectify-update.json`：记录版本、更新说明及每个系统/架构安装包的大小、SHA-256 和下载地址。客户端启动后及每小时检查，也可手动检查；下载流式写入临时文件，校验成功才成为可安装文件。用户确认后，Windows 退出并启动安装器，macOS/Linux 打开系统安装包。尚未做签名校验、静默更新或 macOS 自动替换；公司发布者需管理发布权限。开发模式也可验证下载，但不要在测试中执行安装器。

已发布文件不覆盖。上传中断时核对 Package Registry 和 Release 的真实状态，脚本遇到已有 Release 会停止，不能盲目重复发布同一个版本。

## 插件发布

修改插件源码和自身版本后执行 `npm run plugins:build`，核对并提交 catalog.json。推送 `plugin-<ID>-v<版本>` 标签，GitLab CI 上传插件包到 Generic Package Registry，独立创建插件 Release。目录 url 指向同一 GitLab 的 API，客户端按登录用户权限下载；直接填 Raw 地址也会转换成带授权的 API 请求。

目录和安装包都必须有权限，目录可读不代表安装包可读。下载重定向到 CDN 时不携带授权 Token。默认插件随主程序更新；可下载安装的插件独立更新并保留数据，新增权限仍需要用户确认。

## 团队默认配置

登录后“账号与更新”显示 GitLab 完整用户组路径；GitHub 对应 org/team。显示名不一定等于路径，不需要为 Collectify 另建用户组。

1. 在准备好默认内容的 Collectify 中通过“导入 / 导出”按插件导出工作台数据，按需要决定是否导出收藏凭据。
2. 将文件放进有真实 GitLab 访问控制的配置项目，例如该项目中的 `profiles/development.json`。团队保密配置应使用独立私有项目控制访问，不能只靠客户端组名筛选。
3. 在发布项目的 `profiles/definitions.json` 填写匹配规则：

```json
{
  "profiles": [
    {
      "id": "development",
      "name": "研发初始配置",
      "version": "1.0.0",
      "groups": ["company/development"],
      "file": "development.json",
      "path": "profiles/development.json"
    }
  ]
}
```

groups 使用完整路径，任一匹配即可；空数组表示所有已登录用户，文件权限仍由服务器判定。可额外填写 project 和 ref，指向另一个私有配置项目。`file` 是生成索引时的本机输入路径，不进入索引；`path` 是实际下载路径。

4. 执行 `node scripts/build-team-profiles.cjs` 自动生成大小与 SHA-256，然后将 index.json 和配置文件提交到公司 GitLab；每次改变内容都提高该配置自身版本。其他私有项目的配置，可将构建所需文件临时放到 profiles 下生成索引，实际文件仅提交所属私有项目。
5. 用户登录后检查更新，预览匹配配置，再确认应用。所需插件未安装时先提示安装；不会绕过权限确认自动执行新插件。包含多个用户组时显示多个可选配置，不暗自选择优先级。

配置是默认值，不是强制策略：已有值优先，新版本仅补充此前未下发的新条目；用户改过或删除的旧默认内容不会被恢复。初始主题、浏览器打开方式等仅在用户未设置时应用。应用复用工作台导入事务与恢复机制，失败可回滚，保留个人数据。应用记录按来源、账号及配置 ID 区分，但账号切换不自动擦除已应用到当前工作台的内容。配置不包含 OAuth/MCP 令牌，不自动授权、启用或安装插件。

## 扩展边界

`src/distribution/providers.js` 处理各平台 URL、用户组和 Release 差异；oauth.js 处理授权；client.js 统一认证下载；updates.js 处理平台选择与安装包校验；profiles.js 和 manager.js 处理默认值补充及流程。宿主只接 IPC 和生命周期，设置页面不持有 Token。增加平台时新增 provider 与对应登录适配，保持更新清单、插件目录和工作台导出格式不变。

公司 GitLab 的 OAuth 授权、Package Registry 策略、Runner 和成员组权限必须在实际环境联调。自动测试使用隔离目录、模拟服务器及测试令牌，不冒充真实公司授权结果。
