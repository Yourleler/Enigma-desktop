# Enigma-desktop 开发基线

建立日期：2026-10-25。

## 来源

- 上游：[liliMozi/openhanako（HanaAgent）](https://github.com/liliMozi/openhanako)。
- 上游基线：`9a6cabf8c513db5edc6cf8179a538c9075885c6e`，应用版本 `0.450.0`。
- Pi 1.4.0 适配提交：`56d2ba1f776d71372694e07658839d482f21d9b5`。
- 本仓库：[Yourleler/Enigma-desktop](https://github.com/Yourleler/Enigma-desktop)，私有仓库。
- 保留完整来源历史及 [Apache-2.0 许可证](LICENSE)。上游作者、第三方声明和资源来源继续保留。

当前应用仍使用上游的内部包名和版本；Enigma-desktop 是本开发仓库的名称。README 的项目入口说明为本仓库新增，原上游说明继续保留。

## 已有能力与迁移方式

当前代码包含 Hana 宿主、桌面和 Web 界面，以及已完成的 Pi 1.4.0 适配。[PI140_UPGRADE.md](PI140_UPGRADE.md) 记录具体变更与两个 SDK 深路径的维护边界。

[Enigma-next](https://github.com/Yourleler/Enigma-next) 保留已有的工程插件与 Web 工作台；[Enigma](https://github.com/Yourleler/Enigma) 保留原 Python 历史版。后续从 Enigma-next 逐步接入多仓库协同、代码阅读、计划与验收、项目记忆、时光机、旁路观察等能力，优先共用核心模块。当前尚未完成这些迁移。

先通过真实多仓任务、审批/取消、联合验收与受保护恢复验证宿主边界，再切换主入口。托管管家、做梦、自修复和文档专精继续作为研究议题。

## 已有验证

在建立本仓库前，适配提交已在 Mac 完成以下验证：

- 三套 TypeScript 项目检查、React renderer 构建及服务端产物构建。
- 完整测试共 11,215 项：11,206 通过、7 跳过、2 失败。
- 两项失败来自上游公开树缺少发布镜像 workflow，原版复验同样失败；它们仍是未解决的上游测试问题。
- 真实 Gateway 模型通过 Hana 模型管理器与 SDK 适配层完成隔离文件读写，并验证会话重开。
- 使用一次性本地测试签名构建服务产物，实际启动与认证接口通过；生产签名与发布尚未完成。

本次仓库准备只增加来源与项目说明，并未重新执行上述运行时验收。原始日志和验收 JSON 位于本机 `Documents/Codex/2026-10-25/openhanako-evaluation/`，其中运行配置、依赖、构建产物及签名材料不随本仓库提交。

## 仓库与发布边界

`origin` 指向本人的 Enigma-desktop 仓库，`upstream` 指向 Hana 上游。GitHub Actions 在首次推送前关闭；保留 workflow 文件便于以后有意恢复，当前不运行。

定制发行前需要配置独立的应用标识、安装位置、数据目录、更新源与签名。当前源码继承 Hana 的安装/更新设置，不能直接将其作为已完成品牌隔离的 Enigma-desktop 安装包发布。
