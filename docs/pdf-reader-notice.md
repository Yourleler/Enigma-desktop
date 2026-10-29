# PDF 阅读器技术来源

增强 PDF 阅读使用 Mozilla Foundation 的 PDF.js（pdfjs-dist 5.6.205，Apache-2.0）。复用官方解析、按需页面渲染、文字/注释层、搜索和内部链接组件；应用自行实现工具栏、主题、状态、错误恢复及系统阅读器切换。

- 官方源码与许可证：[mozilla/pdf.js](https://github.com/mozilla/pdf.js)
- 架构与接入：[Getting started](https://mozilla.github.io/pdf.js/getting_started/)
- 公开示例：[PDF.js examples](https://mozilla.github.io/pdf.js/examples/)

PDF.js Copyright Mozilla Foundation。原发行包的版权注释、Apache-2.0 LICENSE，以及 CMaps/字体目录内的独立许可证随界面产物保留。应用内不启用 PDF JavaScript，也不把本地文档上传到第三方服务。打印、下载与填写表单仍可切换到 Chromium 系统阅读器；扫描件搜索需要另外提供 OCR，本阅读器不宣称支持。
