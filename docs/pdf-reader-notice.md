# PDF 阅读器技术来源

从 0.452.93 起直接复用 Mozilla PDF.js 5.6.205 的完整 generic viewer。此前自写的 PDF 工具栏已由上游缩略图、大纲、附件、图层、查找、打印、属性和多种阅读布局替代。本项目只保留文件载入、主题、下载与权限适配。

- [官方源码](https://github.com/mozilla/pdf.js)
- [固定发布](https://github.com/mozilla/pdf.js/releases/tag/v5.6.205)
- [架构说明](https://mozilla.github.io/pdf.js/getting_started/)
- [复用范围及验证状态](open-source-preview-adoption-2026-10-29.md)

上游文件位于 `vendor/pdfjs-viewer`，`upstream.json` 记录 ZIP 与逐文件哈希；构建后增加主题/中文补丁和内容策略，原文件保留。Copyright Mozilla Foundation and contributors，Apache-2.0。LICENSE 与各资源目录内许可证随产物保留。

预览为阅读模式，不启用文档 JavaScript、自动打印或后台模型下载。可手动打印、下载；复杂表单/批注编辑使用系统阅读器。扫描件搜索仍需 OCR。没有将本地文档上传到第三方阅读服务。
