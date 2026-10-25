# 综合流程验收记录

2026-10-25，本页记录最新 macOS 综合验收，交互界面另有真实浏览器复验。用户明确在 Mac 使用，Windows/Linux 为未验证兼容项，GitHub Actions 保持关闭。

## 实际工程任务

三个独立 Git 仓库：Python HTTP API、JS SDK、JS 网页应用。将 `/greet` 的 v1 扁平响应迁为 `{data:{message:"v2"}}`，SDK 使用新字段，应用显示 `app:v2`。真实 Gateway 负责代码理解、两套独立方案、比较和合并，随后用实际服务与网页验收。

用户文件、原服务脚本、网页脚本、设计/Schema、package.json 均设为保护对象。检查命令预先固定，包含 Python/JS 语法、独立启动 Python 后执行 JS 调用的真实 HTTP 联合检查，以及真实浏览器按钮流程。没有用文本检查替代网页操作。

## 流程与证据

| 环节 | 本次实际证据 |
|---|---|
| 原生技能与材料 | Pi 原生技能发现/当前正文读取、设计资料与 JSON Schema 阅读 |
| 源码理解 | Python/JS 静态链路、契约、按任务地图与变更地图；旧图保留 stale，重建图为 current |
| 计划与协作 | 两个真实 Pi 子任务从相同起点实现；按原共同检查实际评估、选择、受控合并 |
| 环境与浏览器 | Python 服务、依赖 JS 服务、已登记配方、真实按钮点击、截图与 trace；结果为 `app:v2` |
| 原标准验收 | python-syntax、sdk-syntax、app-syntax、http-joint、browser-joint 五项最终 passed |
| 时光机与恢复 | 显式代码和上下文回溯到 v1，随后沿原用户要求恢复 v2并重验；最新回溯前后累计请求均为 34，没有把消耗归零 |
| 后台与产物 | 真正的后台结果 `WORKFLOW-9142` 到达后接续并登记报告；正常本次会话只有一条投递标记 |
| 任务包与新工作区 | 导出真实完成任务，恢复三个仓库和配方，准备新的 Pi 会话；新工作区配方和原完整检查通过 |
| 用户原文件保护 | 七个保护文件在流程结束后逐个哈希核对通过 |

最新主报告：`<LOCAL_AUDIT_ROOT>/2026-10-25/enigma-next-validation/full-workflow-resumed/report.json`，已直接核对流程结束后的七个保护文件、原检查定义、正常投递与子进程物理退出。旧报告和 `post-audit.json` 保留为历史。复现入口是 `scripts/gateway-full-workflow.mjs`，准备环境位于 `scripts/workflow-fixture.mjs`。

最新复验仍为 102 次主工具调用，其中 11 次被拒绝，涉及错误产物路径、未获准的原生入口、错误计划修订和无来源的解释。纠正后通过，扩展错误为空。拒绝没有隐藏为成功；这个工程案例证明已执行流程，不能外推普遍成功率。

截图已人工核对，网页真实显示 `app:v2`。该页面是验收对象，不是最终桌面工作台界面。

## 生产分发

使用当前编译产物打包，在独立临时目录安装生产依赖，检查公开 CLI，并单独安装 Pi 1.4.0 宿主。安装后的插件由真实 Pi 原生加载器成功加载 11 个扩展、36 个工具，没有把宿主作为生产依赖捆入插件。

最终分发记录为 `.../enigma-next-validation/distribution-final.json`，保存 0.3.0 archive SHA-256、独立安装路径、实际工具列表、原检查、浏览器重连与产物预览。早期 `distribution-workbench/report.json` 和 `host-load.json` 保留为历史；发行说明已按最终实现重写。

## 最终交付范围

本地完整原回归覆盖拒绝、取消、恢复、源码/配置失效、并发、进程清理、跨工作区来源与材料/记忆范围。Mac 本机结果已验证；Windows/Linux 当前版本未验证，不据此声称跨平台通过。用户已关闭 Actions，项目没有自动重启云端 CI。

测试清理增加了 `finally` 保证：即使 worker 退出确认断言失败，也关闭临时 HTTP 服务，使 CI 报告原失败而非因测试监听器遗留永久等待。原校验和退出断言没有放宽。

交互界面的实际验证见 [交互工作台](interactive-workbench.md)，包括真实流式对话、审批、恢复、源码、产物和浏览器重连。创新与文档专精总计划已在 Mac 综合/界面复验后写入 [后续计划](future-innovation-and-document-specialization.md)，逐项证据见 [验收表](acceptance-0.3.0.md)。托管管家、自修复仍仅研究。
