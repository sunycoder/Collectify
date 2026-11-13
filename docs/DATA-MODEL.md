> 当前运行时已改为统一插件工作台：宿主使用 host.sqlite，收藏、待办、便签分别使用自己的领域库。现行结构见 [插件架构](plugin-system.md)。下文保留旧 collectify.sqlite 单库模型，用于只读迁移和旧数据回归，不再代表当前运行时的统一业务库。

# Collectify SQLite 数据模型

应用版本 5.5.3。数据库结构版本 2，记录于 `PRAGMA user_version` 和 `schema_migrations`。全局 JSON 交换格式版本 1，原默认收藏配置版本 2；格式、数据库和应用版本分别管理。

本地项目直接建立新库，不读取旧 JSON 数据文件，不执行旧数据迁移或旧密文解密。以后需要调整表结构时在事务中编写明确的结构迁移；不能通过 UI 改版重置数据库。

结构 v2 补齐开发期 v1 缺少的 mcp_connection / mcp_audit 表；已有 MCP 表和记录保留。升级建表、迁移记录及 user_version 更新在同一事务内完成，重复启动不会重置业务内容或令牌。

## 分层

界面与本机 MCP → Store / productivity 业务校验 → SqliteRepository → SQLite。

Store 保留领域对象和业务方法；SqliteRepository 负责字段映射、参数化 SQL、事务及数据库约束。页面不拼接 SQL，DOM、列宽、组件库对象不写入业务表。设置的少量可变视图参数以独立键值 JSON 保存，业务实体使用真实列，不把整份业务快照塞进一个 JSON 字段。

SQL 建表定义及完整列以 `src/sqlite-repository.js` 为准。

## 表与字段

| 表                | 主要字段与关系                                                                                                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| categories        | id 主键、name、name_key 唯一、description、color、icon、sort_order；inbox 是系统保留分类                                                                                                   |
| entries           | id 主键、category_id 外键、type、name、url、local_path、content、environment、note、username、password、auth_mode、open_mode、favorite、last_opened、sort_order                            |
| tasks             | id 主键、title、note、status、priority、important、urgent、all_day、start_at、end_at、due_at、remind_at、notified_at、bookmark_id 可空外键、archived、created_at、completed_at、sort_order |
| task_attachments  | task_id 外键、position、path；联合主键 task_id + position                                                                                                                                  |
| notes             | id 主键、title、content、color、updated_at、sort_order                                                                                                                                     |
| settings          | key 主键、value_json；theme、widget、keepInTray、designVersion 分别存行                                                                                                                    |
| workspace_meta    | 单行；revision、initialized、config_source、source_name；管理初始化和乐观并发控制                                                                                                          |
| mcp_connection    | 单行；enabled、port、token；本机服务设置，不暴露给 AI 业务查询                                                                                                                             |
| mcp_audit         | id、at、tool、result；只记录成功写工具的名称、时间与结果，不保存工具参数或密码                                                                                                             |
| schema_migrations | version、applied_at；数据库结构变更记录                                                                                                                                                    |

所有表采用 STRICT 类型约束。布尔列限制为 0/1；状态、优先级、资源类型等由 CHECK 约束。SQL 字段使用 snake_case，领域对象使用 camelCase，映射仅存在于仓储层。

## 业务不变量

- 资源类型为 web/file/folder/text/credential。分类 ID 必须存在，分类删除前转移资源；ID 不因改名、移动或 UI 变化而变。
- 分类名以应用生成的 name_key 实现不区分大小写的唯一性。
- 任务状态为 inbox/todo/doing/done；优先级为 high/medium/low。important 和 urgent 独立于状态。只有已完成任务可归档。
- 日历、看板、清单和四象限共同读取 tasks，没有第二张日程表。逾期、四象限、统计数量属于派生信息，不持久化。
- bookmark_id 是可空关联。删除收藏时 ON DELETE SET NULL；Store 同步清理领域对象中的关联，不删除任务内容。
- 附件与任务一对多。删除任务级联删除附件记录，绝不删除用户本地文件；附件只保存绝对路径。
- 时间列使用 UTC ISO 8601 文本；未设置存 SQL NULL，领域对象返回空串。end_at 必须晚于 start_at。last_opened 使用 Unix 毫秒。查询某天按当前机器本地时区转换。
- 全天任务仍用 all_day + UTC 时间范围，由本地日期展示；当前没有重复日程和跨时区协作模型。未来新增这些业务时应单独设计规则和实例，不偷偷改变既有日期字段含义。
- 密码按要求明文保存。便签转任务创建新任务，不共享两者的可变正文。

## 写入与并发

数据库连接启用 `foreign_keys=ON`、`busy_timeout=5000`、`journal_mode=WAL`、`synchronous=FULL`。

每次业务变更先验证完整候选领域对象，再 `BEGIN IMMEDIATE`，比对 revision，按 ID 删除实际移除的记录，UPSERT 实际变化的字段；未变化的行不会重写。附件仅在有变化时更新对应任务的子记录。最后更新 revision 并提交，提交成功才更新 Store 内存。

跨分类转移、批量日程安排与收藏导入都在一个事务中。任何约束或写入失败会回滚全部变更，界面不能显示部分成功。

MCP 写工具的审计记录随业务提交进入同一事务。连接配置单独保存，不改变业务 revision。主进程单实例是正常运行方式；独立实例读取过期快照后写入会被 revision 拒绝。外部数据库编辑器仅建议只读查看；直接 SQL 修改不会自动刷新应用内存或维护 revision。

业务读写每次打开并关闭连接，不长期占用句柄；每次快照读取在读事务内完成，避免表与表之间读到不同提交版本。

## 索引

收藏：category_id + sort_order、favorite + last_opened。
任务：archived + status、due_at、start_at、未确认提醒的 remind_at、bookmark_id。
便签：updated_at。日期列与状态列保持明确语义，不用显示文本代替可查询字段。

当前界面由领域快照完成筛选，索引供数据库查询及后续规模扩展复用；不宣称所有页面筛选已经下推 SQL。

## 初始化、备份与恢复

位置为平台 appData 下的 `Collectify/collectify.sqlite`，可在设置页确认。新库创建表与初始结构版本在同一事务中完成；首次默认数据成功提交后标记 initialized。初始化失败可修正配置后重试，不留下半份业务数据。

JSON 默认配置只初始化空库，保留 version 2。全局交换文件使用 format=collectify-workspace、version=1，sections 显式声明 bookmarks/tasks/notes/settings。导出仅写入勾选类型；settings 内不包含窗口位置、可见状态或 MCP 身份。

导入预览只返回文件名、类型和数量，不把登录资料发送到预览界面。用户确认的类型先在隔离 Store 快照中验证，再备份并单事务提交。替换只替换所选类型；合并更新同 ID 任务/便签，收藏复用现有资源去重规则。同步导入收藏和任务时，按资源映射重建 bookmarkId；缺少目标时解除关联。未勾选类型不被替换；删除收藏时原任务按既有业务语义解除关联。

原 version 2 收藏文件适配为只包含 bookmarks 的交换文件。只有全局数据库备份包含 mcp_connection 和 mcp_audit，不通过跨机器 JSON 导入覆盖本机令牌。settings 仍使用键值 JSON；新增 widgetMaterial 和 glassOpacity 属于 theme 参数，不改变 SQLite 表结构。

设置页“备份数据库”调用 `VACUUM INTO`，得到包含已提交 WAL 数据的一致数据库文件。导入前也生成 `collectify.sqlite.before-import.bak`。备份失败则不继续导入；备份不复制原文件的临时状态。正常运行时不要单独复制主库作为备份。

恢复步骤：

1. 从托盘完全退出 Collectify。
2. 将当前数据库及同目录的 `-wal`、`-shm` 文件整体移到一个临时保留目录。
3. 将通过“备份数据库”生成的快照复制到数据目录，命名为 `collectify.sqlite`。
4. 启动并核对内容。需要恢复网页登录状态时，另行恢复同次备份的 Partitions 目录。

本版本备份覆盖业务、设置、MCP 配置与审计；不包含用户本地附件文件和网页登录 Cookie。损坏、未知或未来结构版本数据库启动时直接报错，不用默认内容覆盖。
