# 当前架构

Enigma-next 通过 Pi 1.4.0 公开插件与 SDK 提供个人多仓库工作台。Pi 负责模型适配、工具循环、会话树、压缩与终端交互；本项目负责工程领域状态和本地 Web 宿主，没有修改 Pi 内核。

## 模块与入口

| 领域 | 模块与责任 |
|---|---|
| 工作区与执行 | `workspace.ts` 管理注册仓库、权限、文件快照、恢复与验收；`process.ts` 管理 argv 执行、超时、取消和嵌套探针取消 |
| 计划与方案 | `planning.ts`、`solutions.ts` 保存版本计划和会话关联；`experiments.ts` 按同基线和原检查比较真实子任务 |
| 代码阅读 | `reading.ts`、语言 reader、`schema-reading.ts`、`source-index.ts`、`task-reading.ts` 提供来源阅读、可重建索引和任务地图 |
| 项目资料 | `project-context.ts`、`resource-fetch.ts` 提供有来源、版本与作用域的材料和 HTTP/飞书获取 |
| 环境与浏览器 | `background.ts`、`background-worker.ts`、`services.ts`、`browser-validation.ts` 分别管理实际后台进程、服务依赖/就绪和 Playwright 用户流程 |
| 接续与交付 | `task-events.ts`、`artifacts.ts`、`project-overview.ts` 保存有界等待、归属事件、版本产物和观察快照 |
| 复用与协作 | `recipes.ts`、`skill-discovery.ts`、`delegation.ts`、`delegation-worker.ts`、`pi-delegation-run.ts` 提供原生技能、操作者推广配方、隔离子任务和受控合并 |
| 交接与复现 | `handoff.ts`、`pi-session.ts`、`codex-handoff.ts`、`task-package.ts` 通过公开输入传递背景、代码和材料 |
| 可选知识 | `memory.ts`、`recall.ts`、`project-knowledge.ts` 保存作用域、保鲜、忘记和按需整理 |
| 观察与审查 | `observer.ts`、`telemetry.ts`、`observer-questions.ts` 提供事实镜像与独立问答；`review.ts` 提供用户触发的增量审查 |
| Pi 适配 | `pi-*.ts` 按协同、资料、环境、交付、复用、协作、学习、观察、记忆、交接和审查分别注册薄插件 |
| Web 宿主 | `workbench.ts` 提供本地 HTTP/SSE；`workbench-session.ts` 使用公开 AgentSessionRuntime 管理会话和审批；`workbench-layout.ts` / `workbench-style.ts` / `workbench-client.ts` 分别提供布局、视觉与客户端；`workbench-models.ts` 发现本机目录，`workbench-domain.ts` 适配已有领域操作 |
| CLI 与存储 | `cli.ts` 共用领域能力；`storage.ts` 原子发布 JSON、校验与脱敏；`model-config.ts` 保存任务级 Gateway 配置 |

## 状态归属与恢复

Pi 会话树是对话来源；`.enigma-next/workspace.json` 是操作者注册的仓库与检查定义。计划、阅读、材料、证据、后台回执和交接包分别保存领域数据，不复制完整历史或重做通用上下文管理。

快照关联实际普通文件、HEAD、分支和 Git index 的保护条件。对话导航只改变上下文，代码恢复独立且显式。恢复前核对 EXPECTED 和并发修改；旧执行尚未停止或存在未知效果时禁止覆盖。跨 Git 历史的方案采用独立工作区，保留原仓库。

恢复不退回最新用户要求、权限或累计消耗。旧阅读、材料、检查和服务证据按当前版本重新核对。单文件原子发布不是多仓库事务；部分恢复记录补偿或 unknown，不承诺断电后的 exactly-once。

## 阅读与知识

TS/JS 静态编译器、Python 标准库 AST、Go/gopls，以及 Thrift/Protobuf/JSON Schema 阅读分别表达确定关系和候选。按问题展开入口、契约、实现、消费者和测试，结论关联源码和工具版本。索引可重建，来源变化使地图失效，不声称构建全语言或完整运行时调用图。

资料和记忆按来源与作用域处理，不提高指令权限。项目知识需要可核对的父任务来源；子任务声称通过不能成为父证据。整理可选且按需，不自动推广或执行新配方。

## 生命周期与协作

服务、后台命令、等待事件和模型会话分别管理生命周期。心跳、有输出、源码变化、进程退出、服务就绪与检查通过分别表达。回执绑定进程启动身份；暂时失去 OS 观测不能冒充完成。

子任务使用隔离快照，限制可写仓库和 SDK 模型调用，不能注册父仓库绕过合并。父任务预览三方差异，重查并发修改和最新计划，运行原检查后采纳。模型完成、终态记录和 worker 退出分别核对，未知副作用不重放。

取消覆盖初始化和嵌套仓库探针，避免随后继续派发。仓库核对采用有界并行读取；修改与状态发布仍由原操作锁协调。

## 本地工作台

页面是领域状态的投影，常用表单和分组工具箱操作已有领域模块，会话使用公开 AgentSessionRuntime 创建、载入、分支和关闭，审批通过 ExtensionUIContext 桥接。最终空闲来自实际收尾，断连只重建投影，不批准或重放操作。

HTTP 只监听 127.0.0.1，API/SSE 需要 token 并校验 Host/Origin。产物提供实际保存字节，网页内容按文本渲染。托管管家、自动回溯和现场维修仍仅为未来研究。

## 执行边界

文件工具限制在注册仓库内，拒绝路径穿越、符号链接和凭证路径。命令和浏览器是经授权的宿主能力，cwd 与应用锁不是 OS 沙箱。文件恢复不能撤销远端服务、数据库、网络或费用。

