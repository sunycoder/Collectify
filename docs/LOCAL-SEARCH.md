# 本地搜索插件

插件 ID：`collectify.local-search`，版本 1.0.0。属于随宿主提供的可信原生插件，页面、搜索引擎适配、文档解析、设置和生命周期位于 `src/plugins/local-search/`。不增加收藏、待办等宿主业务分支。

## 使用

1. 重启开发程序，点击一级入口“本地搜索”。若曾卸载，在设置的默认插件列表恢复。
2. Windows 点击“连接 Everything”。优先连接已运行实例，其次启动标准安装目录或注册表记录中的 Everything，最后使用随包绿色版。已安装的 Everything 不会被插件停用操作关闭。
3. 首次使用绿色版可能需要在“打开引擎”中配置索引。没有 Everything 服务时，读取 NTFS 全盘索引可能需要系统权限；插件不会自动申请管理员权限或替用户安装服务。此时也可直接选择文件夹搜索。
4. 输入文件名或路径关键词，按左侧类别过滤。结果每批 150 项，底部可加载更多，支持按修改时间、名称或大小排序。
5. 单击选择并预览，双击或 Enter 使用系统关联程序打开；右键菜单提供打开、定位和复制路径。↑/↓ 切换结果，Ctrl/Cmd+K 定位搜索。
6. 底部可关闭预览。齿轮中可拖动分类、上移/下移、开关分类或增加扩展名分类，保存后在本插件内持久化。

macOS/Linux 不包含 Everything 实现，使用文件夹搜索；本次实测环境为 Windows。文件夹模式仅搜索用户明确选择的范围，跳过符号链接，每次最多检查 30000 项或 5 秒，达到上限会明确提示，不能声称结果为全盘完整索引。搜索词按字面关键词处理，不直接执行 Everything 高级查询语法。

## 预览范围

| 类型                                           | 行为                                                                                                |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| png/jpg/jpeg/bmp/gif/svg/ico/webp              | 内核图片预览；SVG 作为图片加载，不嵌入可执行 HTML                                                   |
| psd                                            | 工作线程读取合成图；要求文件中存在兼容合成图，最大 1600 万像素                                      |
| ai                                             | PDF 兼容 AI 用 PDF 页面预览；其他 AI 尝试系统缩略图，无结果时显示说明并保留打开入口                 |
| xls/xlsx/csv                                   | SheetJS 只读表格、多工作表切换，最多 200 行/40 列，单元格截取 512 字符；公式仅显示已有缓存结果      |
| docx                                           | 提取正文文本，不承诺原版式或嵌入对象还原                                                            |
| pdf                                            | PDF.js Canvas 分页查看，解析上限 32 MB；不执行 PDF 脚本                                             |
| flac/mp4/m4a/mp3/ogv/ogm/ogg/oga/opus/webm/wav | 使用原生媒体控件，支持 Range；实际解码依赖 Electron 内核与具体编码，失败显示外部打开提示            |
| zip/gz/7z/rar/tar/xz/bz2                       | 7-Zip 只列目录，最多 1000 条，不解压；加密或不支持格式明确提示                                      |
| txt/md/代码及其他可读文件                      | 最大读取 256 KB；识别 UTF-8、UTF-16 BOM，其他尝试 GB18030；以纯文本显示，不执行 HTML、Markdown 脚本 |
| 文件夹、doc/ppt/pptx、其他二进制               | 显示文件信息及打开/定位操作，当前不提供内容还原                                                     |

图片上限 24 MB，Office/PSD 文档上限 32 MB，工作线程有 192 MB 堆上限与 7 秒超时；ZIP 文档展开前检查文件数和解压体积。超限或损坏文件不阻塞宿主窗口。

## 生命周期与数据

搜索结果只在内存中保存，页面对后台操作使用随机结果 ID，不传任意本机路径。预览文件通过短期随机票据、所属插件的资源协议读取；不建立监听网络端口。支持 GET/HEAD、Range 和过期检查。文档解析使用单独工作线程，界面不获得 Node、SQL 或任意文件系统接口。

宿主协议新增的是通用可信后台 `resource(relative,request)` 钩子，仅对有后台的默认插件开放。没有该钩子的其他插件仍保持原 CSP 和网络限制，不开放 file:// 或远程网络。

插件数据目录中保存 `data.sqlite` 偏好、绿色版执行组件副本和 Everything 自己的索引。搜索文件内容、结果列表、选中的文件夹路径不写入设置或云端；选择的搜索文件夹仅在本次运行有效。全局备份只包含分类、排序和预览偏好，不包含索引、文件内容或引擎程序。

停用/卸载会取消搜索、终止文档解析并撤销预览票据，仅关闭由本插件启动的独立绿色版实例；不关闭用户已运行或安装的 Everything。

## 依赖与分发

原生组件在 `vendor/native`，复制到插件数据目录后执行，兼容 ASAR 打包，无需修改宿主的 asarUnpack 配置。随包依赖及 SHA-256 见 [依赖说明](../src/plugins/local-search/vendor/README.md)。二进制为 Windows x64；Windows ARM64 需系统具备 x64 仿真能力。

这是可信原生默认插件，不能通过目前只接受沙箱静态资源的 `.collectify-plugin` 安装器单独导入；随下一个主程序包交付。开发程序重启即可加载。不能为方便安装而绕过插件包的原生后台限制。

## 验证与维护

```powershell
node --test test/local-search.test.js
node scripts/check-local-search-native.cjs
.\node_modules\electron\dist\electron.exe scripts/smoke-local-search.cjs
```

Everything 原生检查使用独立实例和人工生成的 EFU 文件列表，不扫描用户真实全盘。Electron 检查使用 `test/fixtures/local-search`，验证实际表格、正文、图像、PDF、音频和压缩目录预览。RAR、所有媒体编码和其他平台没有逐一实机覆盖。

重建预览供应文件需要先准备临时依赖目录（不修改宿主依赖）：

```powershell
npm install --prefix build-tools/local-search-deps --no-save --ignore-scripts mammoth@1.11.0 ag-psd@30.0.0 fflate@0.8.2 pdfjs-dist@3.11.174 7zip-bin@5.2.0
```

从 SheetJS 官方获取 0.20.3 的 tarball，解压到 `build-tools/sheetjs/package`，然后运行 `node scripts/build-local-search-vendor.cjs`。生成后的 JS 和许可证随源码提交，普通使用和打包不需要重新下载这些库。升级时重新测试解析限制与真实文件样例。
