# Enigma-next

基于 Pi 公开插件与 SDK 的个人 coding agent，重点增强多仓库理解、协同改造和可核对的方案恢复。提供 Pi 原生 CLI 和本地 Web 工作台，共用同一套工程能力。

当前版本为 **0.4.2 完整交互工作台**，最新 [内容工作区](docs/workbench-content-workspace.md)提供标签、源码文件浏览与文档阅读，延续 [排版与动效调整](docs/workbench-layout-polish.md)的浅/深玻璃、指针反射与面板动效。核心功能范围和历史证据见 [0.4.0 验收](docs/acceptance-0.4.0.md)。上一代 Python [Enigma](https://github.com/Yourleler/Enigma) 保留为历史稳定版本。

## 能力

| 使用场景 | 实际能力 |
|---|---|
| 跨仓库改造 | 多个独立仓库、依赖与影响、版本计划、各仓检查和联合验证；运行中可纳入新仓库 |
| 理解项目 | TS/JS、Python、Go/gopls、Schema/IDL 阅读，问题与 diff 地图、职责/需求关联、来源位置和版本 |
| 使用项目资料 | 文件、HTTP、飞书材料，版本刷新、任务私有范围、中文按需召回 |
| 尝试与恢复 | Pi 会话分支、代码检查点、比较与独立方案、受保护恢复；保留最新要求和累计消耗 |
| 运行与验收 | 有界后台命令、多仓库服务配方、依赖/端口/就绪、真实 Playwright 操作、截图与轨迹 |
| 复用与协作 | 原生技能发现、操作者推广的任务配方、隔离 Pi/Codex 子任务、三方合并、同标准方案实验 |
| 接续与交付 | 持久等待与事件接续、版本产物和文本预览、项目概览、背景交接和新工作区任务包复现 |
| 可选增强 | 轻量项目知识、运行旁路问答和按需审查；可分别启用 |

公开能力、当前证据与限制分别见 [阅读与资料](docs/project-workbench.md)、[服务与浏览器](docs/runtime-environments.md)、[交付与事件](docs/events-and-artifacts.md)、[协作与任务包](docs/isolated-collaboration-and-packages.md)、[知识与实验](docs/project-knowledge-and-experiments.md)。

## 安装与启动

需要 Node.js ≥22.19.0 和 Git。Python 阅读需要 Python 3；Go 语义阅读需要 Go 与 gopls。`rg` 可选，缺失时使用有界文件索引。浏览器功能需要安装 Playwright Chromium。

```bash
npm ci --ignore-scripts
npm run build
npx playwright install chromium
npm run check
npm test
```

编译后可直接使用 `node dist/src/cli.js`；`npm link` 可提供 `enigma-next` 命令。也可安装为 Pi 插件：`pi install /absolute/path/to/Enigma-next`。独立生产安装与可选宿主依赖见 [插件使用](docs/plugin-usage.md)。

完整的本机验收可运行 `npm run verify:local -- /path/to/output`，原测试不变，报告保存当前系统与构建指纹。另一系统的验收与真实综合流程入口见 [本机验证](docs/local-validation.md)。

云端 Tests 按用户要求暂停自动运行，本分支仅保留 `workflow_dispatch`。需要云端验收时，先启用 Tests，再手动运行；日常检查继续使用 `npm run check` 和 `npm test`。GitHub 的免费额度由账号下的私有仓库共享，停用自动 CI 不代表平台验收已通过。

使用独立任务目录管理已有仓库，不移动或合并它们：

```bash
mkdir -p /path/to/task
enigma-next --workspace /path/to/task repos add library /path/to/library
enigma-next --workspace /path/to/task repos add sdk /path/to/sdk
enigma-next --workspace /path/to/task repos add app /path/to/app
enigma-next --workspace /path/to/task repos depends sdk library
enigma-next --workspace /path/to/task repos depends app sdk
enigma-next --workspace /path/to/task graph
```

默认注册为可写仓库；添加 `--read-only` 可限制文件工具。仓库数量不限于两个。

已有 Gateway 网关登录并启动时，可复用当前后端：

```bash
enigma-next --workspace /path/to/task connect gateway
enigma-next --workspace /path/to/task workbench --memory
# 或 Pi 原生终端
enigma-next --workspace /path/to/task agent --memory --observe
```

工作台输出本地访问链接，在浏览器打开即可。输入区右下角可切换真实模型和思考级别，侧栏工具箱按任务用途组织所有已有能力；[界面说明](docs/interactive-workbench.md)包含会话、审批、分支、恢复、资料和产物操作。默认审批为 `ask`；`--approval auto` 是显式允许宿主操作，`never` 拒绝副作用工具。

Gateway 配置写入任务 `.enigma-next/pi-agent/`，不修改 Codex 配置。默认 `http://127.0.0.1:8790/v1`、Responses API 和 `gateway-gpt-6-1-sol`，支持 `--base-url`、`--model`。显式 `PI_CODING_AGENT_DIR` 优先；不需要 Ollama。Pi→Gateway 路径由本项目独立联调，上游变化后仍需复验。

## 联合验收与恢复

检查由操作者注册，模型不能自行放宽标准。实际命令、版本与结果形成证据；失败、超时、取消、未知和来源过期分别表达。

```bash
enigma-next --workspace /path/to/task checks add library-check library -- npm test
enigma-next --workspace /path/to/task checks add sdk-check sdk -- npm test
enigma-next --workspace /path/to/task checks add integration app --joint -- npm test
enigma-next --workspace /path/to/task verify
enigma-next --workspace /path/to/task checkpoint baseline
```

没有检查保持 `unverified`；配置检查但未通过的单次任务返回非零退出码。源码、检查配置、环境和服务加载代码发生变化时，旧证据需重新核对。

Pi `/tree` 切换上下文，代码恢复需要另行操作。`restore TARGET EXPECTED` 先核对当前文件与 EXPECTED，外部修改或 Git 状态变化会阻止覆盖。跨历史方案可用 `fork CHECKPOINT DESTINATION` 创建独立工作区；[协同说明](docs/collaboration.md)说明原要求、预算和用户文件保护。

未知副作用需先检查实际状态；`operations`、`recover`、`acknowledge` 提供恢复记录与人工结算，不能自动重放。时光机不撤销模型费用或远端数据库、网络与服务副作用。

## 设计与证据


真实 Gateway 三仓库 Python/JS 综合流程、Pi→Codex→Pi 子任务见 [核心验收](docs/acceptance-0.3.0.md)。完整交互工作台的 143 项回归、两种实际 Gateway 模型、68 个表单、视觉与独立生产安装证据见 [0.4.0 验收](docs/acceptance-0.4.0.md)。用户明确本次在 Mac 使用；Windows/Linux 当前兼容性未验证，GitHub Actions 保持关闭。

命令、浏览器和独立子任务是授权的宿主执行能力，cwd 与应用锁不是 OS 沙箱。文件快照支持普通文件，默认排除凭证、依赖和运行时目录；单仓预算为 256 MiB/50,000 个文件。多仓库恢复不承诺分布式事务或跨崩溃 exactly-once。

托管管家和新的创新机制仍只研究、不启用，分别见 [托管可行性](docs/supervised-mode-feasibility.md)和[机制候选](docs/agent-friction-ideas.md)。完整收尾提案已在 Mac 复验后写入 [创新与文档专精计划](docs/future-innovation-and-document-specialization.md)。
