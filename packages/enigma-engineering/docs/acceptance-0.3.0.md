# 0.3.0 Mac 交付逐项验收

2026-10-25。范围来自 `implementation-plan.md`、`memory-observer-plan.md`、`context-handoff-plan.md` 和 `workbench-plan.md`，不以当前已实现部分缩小目标。用户已明确在 Mac 使用，本次以 macOS 完整测试、真实多仓库流程、界面和生产包验收。其他平台单列为未验证，GitHub Actions 保持关闭。

## 证据约定

“本地”指真实文件、进程、HTTP、SDK 或浏览器的受控验证，不是自由模型效果；“真实任务”指 Gateway 或实际 Codex 的执行报告，也不外推为普遍成功率。平台通过必须来自当前提交的实际运行。源码位于 `src/`，测试位于 `test/`；标题及具体断言可在表中对应文件回查。

本机记录根目录：`<LOCAL_AUDIT_ROOT>/2026-10-25/enigma-next-validation/`。最新完整任务见 `full-workflow-resumed/report.json`，包含最终保护文件、原检查定义、正常投递和子进程退出；真实界面见 `workbench-ui-resumed/report.json`；本机原检查见 `local-verification-final/report.json`；包安装见 `distribution-final.json`。报告分别绑定源码、工作区、会话或 archive hash，旧记录不替代后续变更的验证。

## 底座、多仓库与恢复

| 要求 | 当前证据 | 判断与边界 |
|---|---|---|
| Pi 公共插件/SDK、独立领域层 | `plugin.test.ts` 安装/移除及共存，`pi.test.ts` 真正执行工具；`workbench-session.ts` 使用公开 runtime | 本地与真实任务成立；无内核 patch，不使用第三方私有实现 |
| 可用 CLI 与 Web 安装入口 | `cli.test.ts` 的原生 CLI/HTTP 文件操作、`plugin.test.ts`；独立 tar 的 CLI/SDK/浏览器报告 | 已有实际安装证据，新增 UI 仍需与最新包对应复验 |
| 多仓库数量不限于二、运行中加入 | `pi.test.ts` 加入第四仓库；`recovery.test.ts` 早期恢复保留较晚仓库 | 本地成立；实际综合案例为三个独立 Git 仓库 |
| 仓库位置、角色、分支、权限、依赖 | `workspace.test.ts`、`planning.test.ts`、`changes.test.ts`；工作台 project 数据 | 本地成立；声明依赖与动态运行关系分别表达 |
| 各仓检查和真实联合验证 | 真实 Python/JS 三仓库的五项原检查、HTTP 和浏览器结果 | 案例成立；未改原检查来换成功 |
| 任务计划、进度、不可覆盖修订 | `planning.test.ts`、`solutions.test.ts` 的版本/上游变更/证据拒绝 | 本地成立；模型说明不能代替检查证据 |
| 会话树、代码快照与比较 | `pi.test.ts`、`solutions.test.ts`；综合任务的 v1/v2 回溯与恢复 | 本地与真实任务成立；上下文导航不自动恢复文件 |
| 用户原有修改、Git index、并发保护 | `workspace.test.ts`、`partial-restore.test.ts`、`delegation.test.ts` | 本地成立；不是跨仓库断电事务 |
| 最新要求、权限与累计消耗不回退 | `pi.test.ts`、`plugin.test.ts`、`handoff.test.ts`；最新真实回溯前后请求数均为 34 | 案例成立；费用不会随代码退回而消失 |
| 中断、取消、强杀、未知效果与部分恢复 | `process.test.ts`、`recovery.test.ts`、`audit.test.ts`、`partial-restore.test.ts` | 本地成立；三个 POSIX 专属用例在 Windows 明确跳过，不能声称在该 OS 验证了 POSIX 信号 |

## 阅读与项目资料

| 要求 | 当前证据 | 判断与边界 |
|---|---|---|
| Go 定义/引用/接口实现/调用、别名与遮蔽 | `go-reader.test.ts` 实际 gopls：Greet 调用、Greeter 实现及遮蔽排除；真实 Go 三仓库报告 | 本地与 Go 案例成立；动态派发、外部模块和 build tags 不完整 |
| TS/JS/Python 静态阅读及跨语言契约 | `semantic.test.ts`、`cross-language.test.ts`；真实 Python/JS 综合案例 | 本地与案例成立；候选关系不提升为运行事实 |
| Thrift/Protobuf/JSON Schema/配置契约 | `schema-reading.test.ts` 的字段位置、引用与声明映射 | 本地成立；不声称覆盖全部 IDL 或动态配置 |
| 问题驱动依赖展开、大仓库预算 | `semantic.test.ts` 的重导出优先展开，`go-reader.test.ts` 的晚文件索引；无 rg 用例 | 本地成立；有预算和未解析诊断，不能把未读源码算覆盖 |
| 版本化持久索引和可展开源码 | `reading-store.test.ts`、`semantic.test.ts`、`go-reader.test.ts` 的重建/失效/旧发布保留 | 本地成立；派生索引可重建，不等于通用语义数据库 |
| 任务/diff 地图、职责与核心改动分组 | `task-reading.test.ts` 的三仓节点、章节、分组和非预期仓库；真实综合地图 | 本地与案例成立；讲解/风险带源码锚点并标 model-inference |
| 需求到源码和验证的覆盖 | `task-reading.test.ts` 的原联合检查，源码变化使 coverage 失效 | 本地与案例成立；缺锚点、未跑检查与旧证据不算通过 |
| 资料关联、版本、来源角色与任务范围 | `project-context.test.ts`、`task-reading.test.ts`、`project-knowledge.test.ts` | 本地成立；资料不提升为系统指令 |
| HTTP/飞书获取、刷新及原始响应 | `resource-fetch.test.ts` 的实际 HTTP 与 CLI 协议；真实飞书修订 47 记录 | 本地与单次真实获取成立；账号/接口变化后需重新核对 |

## 环境、后台与交付

| 要求 | 当前证据 | 判断与边界 |
|---|---|---|
| 多仓库服务依赖、端口、就绪和重启 | `services.test.ts` 的真实 HTTP 依赖、重启/旧服务指针、端口冲突 | 本地与综合任务成立；既有用户进程不被误停 |
| 源码变化后的服务/浏览器重验 | `services.test.ts` 旧进程仍服务 v1、拒绝其验证 v2，重启后通过 | 本地成立；进程活着不证明加载新代码 |
| 浏览器动作、截图、trace 与版本 | `browser-validation.test.ts`；真实按钮显示 app:v2 | 本地与真实任务成立；不是字符串替代网页操作 |
| 有界持久后台、取消与物理结算 | `background.test.ts`、`process.test.ts` 的真实命令/退出/晚写保护 | 本地成立；终态记录与 worker 退出分别核对 |
| CI/进程/服务条件等待及一次正常接续 | `task-events.test.ts`、`delivery.test.ts`；综合任务正常投递标记为 1 | 本地与案例成立；不宣称跨崩溃 exactly-once |
| 等待不占工作区锁或主模型请求 | `task-events.test.ts`、`observer.test.ts`；等待期间实际操作及独立问答 | 本地成立；按可见事件判断，不推断隐藏计算 |
| 版本产物、来源 hash、文档/报告/截图 | `artifacts.test.ts` 实际字节、历史来源和错误任务；真实版本清单 | 本地与案例成立；截图/trace 可能包含应用内容，保持本地 |
| 产物预览与下载 | `workbench.test.ts` 实际 HTML 保存版预览和下载，源改后仍读保存字节、脚本不执行 | 最新本地浏览器成立；文本预览有输出/缓存预算 |
| 项目任务面板及实际控制 | `project-overview.ts`、`workbench.ts` 服务/等待/后台的领域调用；真实工作台截图与操作 | 已有实际后端；面板观察不能当作完成判定 |

## 复用、协作、记忆与观察

| 要求 | 当前证据 | 判断与边界 |
|---|---|---|
| 原生技能意图发现、手动语义与版本 | `reuse.test.ts` 的原生目录、中文查询、变更、只读注册及 Pi 调用 | 本地与真实配方成立；不提升来源指令角色 |
| 可调整配方、成功任务提案待确认 | `reuse.test.ts` 实际 argv/服务/浏览器/原检查、未推广草稿 | 本地与真实配方成立；提案不自动执行 |
| 隔离委派、并行准备、限制预算与权限 | `delegation.test.ts` 实际重叠请求、源未写、取消/预算、拒绝注册父仓库 | 本地与真实子任务成立；父合并单独执行 |
| 三方合并、并发修改、父原标准重验 | `delegation.test.ts` 同文件独立行合并、冲突与预览失效 | 本地与真实综合任务成立；源结果不等于父验收 |
| Pi→Codex→Pi 实际执行与回流 | `isolated-collaboration-final/report.json`：父子文档 hash 一致、原检查与新工作区通过 | 案例成立；不保证任意 Agent 私有状态无损迁移 |
| 新背景会话、接着做、独立方案及降级包 | `handoff.test.ts` 原历史保留、计划隔离、来源角色、路径映射、缺附件/超长拒绝 | 本地与实际 Codex 任务成立；目标权限不随包扩大 |
| 任务包在另一工作区复现失败与成功 | `task-package.test.ts`；真实完整任务包的原配方和五项检查 | 本地与案例成立；历史验收不自动激活 |
| 同基线、同标准的方案比较和选择 | `experiments.test.ts` 原检查/篡改/过期拒绝；真实两方案比较 | 本地与真实任务成立；未把胜者判断变成普遍模型排名 |
| 轻量记忆、中文召回、纠正与忘记 | `memory.test.ts`、`memory-index.test.ts`：作用域、失效、原偏好来源、旧正文抑制 | 本地与真实对照成立；词法召回可用，不承诺所有同义召回 |
| 资料关联项目知识、按需空闲整理 | `project-knowledge.test.ts`；真实任务拒绝子证据后从父新证据整理并中文召回 | 本地与真实任务成立；不是常驻做梦/反思进程 |
| 记忆/观察成本与实际效用 | `memory-comparison.md` 的真实六任务、`observer.test.ts` 和局部性能记录 | 已有测量；记忆没有证明普遍更快，按需启用 |
| 运行慢、静默、审批、流、重试、取消、强杀问答 | `observer.test.ts`、`observer-boundaries.test.ts`、`observer-questions.test.ts`、`provider-retry.test.ts` | 本地和独立 Gateway 解释成立；心跳不是有意义进展 |
| 按需审查、新上下文、冻结 diff 与无写工具 | `review.test.ts`；真实独立缺陷审查记录 | 本地与案例成立；默认关闭，不代替原验收 |

## 界面、分发与尚未完成的门槛

| 要求 | 当前证据 | 判断与边界 |
|---|---|---|
| 会话新建/重命名/模型选择、流式回答/工具 | `workbench.test.ts`、`workbench-session.ts`；真实 Gateway 浏览器报告 | 实际 UI/SDK 已运行；选模型在创建会话时完成 |
| 审批、取消、Fork、持久重开、断连与恢复 | `workbench.test.ts` 的待审批实际不写、原历史保留、重开、文件恢复、立即取消 | 本地与真实审批/重连成立；不自动重放 |
| 资料、地图、差异、服务和产物入口 | `workbench.ts` 直接共用领域模块，真实界面截图及地图源码回读 | 实际后端成立；新文本预览已补本地验证 |
| 独立 tar、公开 SDK、浏览器实际写入与重连 | `distribution-final.json` 的 archive SHA-256、安装路径、实际文件检查 | 已有生产包证据；源码改变后需更新对应包报告 |
| 本次 Mac 平台与其他 OS 边界 | `local-verification-final/report.json`：darwin/arm64、类型检查、136 项原回归和 CLI 通过；最新真实工程原五项检查通过 | Mac 验收成立；Windows/Linux 当前版本未验证，保留原矩阵和失败历史，Actions 关闭 |
| 最终整体验收与发行说明 | 本表、`release-0.3.0.md`、README 与 `local-validation.md` 对照实际 Mac 交付 | 与最终构建和包 hash 核对；不把 Mac 结果当 Windows 通过 |
| 实施完成后的创新与文档专精总规划 | `future-innovation-and-document-specialization.md`：既有能力、公开先例、候选、成本/风险/验收、文档专精与托管路线 | 已在 Mac 综合与界面复验后撰写；所有新点子只研究，不启用实现 |

原 Enigma 仓库保持历史稳定状态。本表没有把托管管家、自动回溯、现场维修或新的文档专精插件标成已实现。
