# 浏览器与预览：复用成熟开源实现

日期：2026-10-29。范围是本项目的浏览器外层和文件预览，沿用现有 Pi 运行时、工程功能、权限与工作区。用户已授权复用合适的公开开源代码；本页区分实际接入和候选方案。

## 当前判断

桌面浏览器已经是 Electron Chromium，通过 `WebContentsView` 显示网页。当前不完整之处主要在应用外层：侧栏和独立窗口存在两套控件、能力不一致；文件预览部分使用了成熟解析库，却又写了过薄的显示层。更换浏览器内核不能直接解决这些问题。[Electron WebContentsView](https://www.electronjs.org/docs/latest/api/web-contents-view)

OpenAI 官方文档说明内置浏览器与连接已有 Chrome 等浏览器标签是两种入口，未据此确认 Codex 内置浏览器的具体内核实现。我们的体验目标是完整导航、状态、下载、文件联动与人工接管，不假定能复制其未公开实现。[Browser](https://learn.chatgpt.com/codex/browser)

## 选择与取舍

| 部分 | 成熟实现 | 本项目处理方式 | 状态 |
| --- | --- | --- | --- |
| 网页浏览器 | [Min](https://github.com/minbrowser/min)，Apache-2.0 | 参考/复用可独立提取的地址栏、快捷键和标签工作区实现；保留 Chromium 宿主与对话权限。先统一侧栏/独立窗口，再补完整地址导航、页面搜索、缩放、下载和恢复。Min 是整套应用，不能当单个 React 组件直接插入。 | 0.452.101 已统一两种窗口并接入 Chromium 原生查找/缩放；未复制 Min 源码，原生 UI 待验收 |
| PDF | [Mozilla PDF.js](https://github.com/mozilla/pdf.js/releases/tag/v5.6.205)，Apache-2.0 | 直接复用官方完整 generic viewer，替换自写工具栏。上游负责缩略图、大纲、附件、图层、查找、打印、属性和阅读布局；本项目只适配文件、主题、下载与权限。 | 0.452.93 源码已接入；Web 实测，原生待验收 |
| DOCX | [docx-preview](https://github.com/VolodymyrBaydalka/docxjs)，Apache-2.0 | 从当前 Mammoth 语义转换改为保留版式的渲染；检查页眉页脚、图片、表格、显式分页，保留纯文本回退。库对分页/域等有明确限制，不承诺与 Word 像素一致。 | 0.452.99 源码已接入；Web 实测通过，原生待验收 |
| XLSX / CSV | [Univer](https://github.com/dream-num/univer)，Apache-2.0 OSS 核心 | 验证真实表格交互，替换截断 HTML 表格。其官方文件导入导出、打印等列在 Pro 范围；必须先验证不依赖商业服务的本地导入路径及样式保真，不能把 OSS 内核误说成免费完整 Office。 | 0.452.110 已接入 OSS 表格与本地 ExcelJS/PapaParse 导入，Web 实测通过，原生待验收 |
| 图片 | [PhotoSwipe](https://github.com/dimsemenov/PhotoSwipe)，MIT | 用成熟缩放、拖动、触控和画廊交互替换重复的自写控制层，接入现有文件身份、下载与主题。 | 候选 |
| 音视频 | [Video.js](https://github.com/videojs/video.js)、[Media Chrome](https://github.com/muxinc/media-chrome) | 以当前稳定发布的完整播放器/React 集成为首选。Media Chrome README 已说明相关团队合流到新版 Video.js；不盲搬旧控件。接入前核对所用包许可证、离线资源、字幕、键盘、全屏和恢复。 | 候选，尚未替换现有播放器 |
| Markdown / 代码 | 已有 CodeMirror、Markdown 渲染与 Mermaid | 保留成熟依赖；补完整目录、搜索、行定位、折叠、主题与导出。避免另起解析器或把页面源码直接当产品浏览器。 | 已有基础，继续统一 |

补充候选 [EmbedPDF](https://github.com/embedpdf/embed-pdf-viewer) 的 SDK 属于 Apache-2.0，而同仓 CloudPDF server 属于不同许可；当前采用 PDF.js，避免同时引入两套 PDF 引擎。[许可范围](https://github.com/embedpdf/embed-pdf-viewer/blob/main/LICENSING.md)

## 本轮实际替换

- `vendor/pdfjs-viewer` 保留 Mozilla 5.6.205 官方发布文件，核对 GitHub 发布的 ZIP SHA-256，并记录每个上游文件哈希。构建校验 viewer 与 npm core/worker 的版本一致。
- 删除应用自写的 PDF 控件实现，使用独立 iframe 中的完整上游界面。保留页面位置，外层只显示文件名和系统阅读器入口。
- 独立样式与中文补丁在构建时添加，不直接改上游源文件。所有语言、图标、字体、CMaps、ICC 与 WASM 随本地构建打包，无外部阅读服务。
- 预览采用阅读模式：可选择文字和使用阅读工具；不静默编辑原文件，表单/批注编辑转系统应用。不启用文档脚本、自动打印与后台模型下载。
- 下载由宿主页面承接。实测发现内嵌 iframe 的附件下载不触发后，改用官方提供的附件字节在父页面下载；没有把文件上传到外部服务。
- 测试使用原创新建 PDF，含实际大纲、附件与可选图层。已确认大纲跳转第二页、附件列表及下载内容、全文搜索/整词选项、PDF 下载一致性、文档属性、420 px 工具菜单及第二页/缩放恢复。图层开关有实际对象；渲染显隐与原生打印仍须进一步复核。

## 交付与后续

当前正式界面仍为 0.452.91。16 项相关回归、三套类型检查和边界检查通过。新 viewer 已生成候选，但原生点击与正式安装因 Mac 锁屏未完成；不把 Web 验证等同桌面交付。后续沿同一 Goal 继续原生验收和逐类替换，并继续未精确归因的草稿持久性专项。

每个替换必须验证真实文件、失败恢复、窄窗口、深浅主题、键盘和重新打开；有可复用实现时先接上游能力，只保留本项目必要适配。上游许可证、版权与修改说明进入源码和发行产物。


DOCX 后续已按上述选择落地，详见 [Word 预览实现与验收](docx-preview-adoption-2026-10-29.md)。浏览器外层统一、表格/图片/媒体替换及草稿专项继续执行，未缩小 Goal。


交互表格与 CSV 编辑保留已落地，范围、导入保真限制和保存修复见 [表格预览验收](spreadsheet-preview-adoption-2026-10-29.md)。
