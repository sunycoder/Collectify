# 本地搜索供应文件

所有程序仅在本机运行，不从这里连接第三方服务。程序为上游官方分发的未修改版本；许可证在本目录保留。原生组件 SHA-256 在 native/SHA256SUMS.json。

| 组件                    | 版本       | 来源与许可                                                                                                                                  |
| ----------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Everything portable x64 | 1.4.1.1030 | https://www.voidtools.com/Everything-1.4.1.1030.x64.zip；Everything.LICENSE.txt（MIT）                                                      |
| Everything ES x64       | 1.1.0.37   | https://www.voidtools.com/ES-1.1.0.37.x64.zip；同为 voidtools 分发                                                                          |
| 7-Zip x64               | 26.01      | https://www.7-zip.org/a/7z2601-x64.exe；7zip.LICENSE.txt、LGPL-2.1.txt、unRAR.LICENSE.txt                                                   |
| 7-Zip 对应完整源代码    | 26.01      | https://www.7-zip.org/a/7z2601-src.tar.xz；本目录 7zip-source.tar.xz 原样附带，解包后可按上游说明构建；组件可用相同架构的兼容未修改版本替换 |
| SheetJS                 | 0.20.3     | https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz；Apache-2.0                                                                             |
| Mammoth                 | 1.11.0     | npm mammoth；BSD-2-Clause                                                                                                                   |
| ag-psd                  | 30.0.0     | npm ag-psd；MIT                                                                                                                             |
| fflate                  | 0.8.2      | npm fflate；MIT                                                                                                                             |
| PDF.js                  | 3.11.174   | npm pdfjs-dist；Apache-2.0                                                                                                                  |

preview-worker.cjs 是本插件工作线程与 Office/PSD 解析库的离线 bundle，PDF.js 是独立页面脚本及 worker。直接许可证及 bundle 中的依赖许可证位于本目录和 dependency-licenses/。原生程序从数据目录调用，不通过 shell 拼接用户搜索内容；搜索只返回条目和文件元信息。压缩文件工具仅用于列目录，不实现 RAR 压缩算法。
