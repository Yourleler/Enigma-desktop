# Enigma 工程插件

领域实现来自 `packages/enigma-engineering`；`SOURCE.json` 记录 Enigma-next 的原始提交和文件摘要。原仓库保留为历史稳定基线，后续工程核心在当前 workspace package 维护。

`host.ts` 是唯一 Hana 适配层：通过固定的 Pi 1.4.0 公开扩展加载器接入 11 个工程扩展，绑定原生会话、模型、审批、取消与会话资源。`server/routes/enigma.ts` 和原生 React 工程面板提供薄传输及界面入口。插件不启动第二个主 Agent，不调用旧 Web 工作台服务器。

工程模式按会话显式选择工作区。Hana 通用记忆和经验在该会话关闭；可选工程记忆使用原来的来源、作用域、版本与中文召回规则。托管、自修复、做梦及文档专精仍仅保留研究计划。
