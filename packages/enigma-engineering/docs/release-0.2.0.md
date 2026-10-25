# Enigma-next 0.2.0

0.2.0 在 Pi 1.4.0 公开插件接口上增强个人多仓库改造，不修改内核；历史 Python Enigma 保留。多仓库工具、计划、版本恢复、记忆、观察、交接和审查按职责分开，按需启用。

## 开始使用

```bash
cd $HOME/code/Enigma-next
npm ci --ignore-scripts
npm run build
node dist/src/cli.js --help
enigma-next agent --observe --memory
```

已有工作区已接通 Gateway；新任务先用 `repos add` 注册实际仓库、`checks add` 配置实际验收，再调用 `connect gateway`。原生 Pi 插件使用：构建后 `pi install $HOME/code/Enigma-next`，观察与记忆分别用 `--enigma-observe`/`--enigma-memory`，移除用 `pi remove`。包不带 Pi 内核，作为 CLI 启动器使用时需本机 Pi 宿主安装。

## 能力与边界

| 能力 | 0.2.0 行为 | 边界 |
|---|---|---|
| 多仓库协同 | 动态仓库注册、依赖与反向影响、契约映射、轻量计划及联合检查 | 自动 endpoint 相同仅是候选；无完整动态服务图 |
| 代码阅读 | TS/JS checker、Python AST、别名与重导出、版本地图和源码展开 | 有界注册源码；不执行仓库代码，不确认动态 dispatch |
| 时光机 | 对话树关联代码/计划/证据、比较、恢复预览、独立 code fork 会话接续 | 不是外部服务回滚；部分失败/未知不会重放 |
| 记忆 | 作用域、中文/符号召回、来源保鲜、显式纠正/忘记、索引和草稿整理 | 不自动建设通用画像/向量平台；短背景未显示更快 |
| 运行观察 | 旁路状态、疑似重复、阶段耗时、确定性问答与显式模型解释 | 活性不等于进展；未知内部阶段如实表达 |
| 背景交接 | Pi 同背景新任务、公开 native fork、Markdown/JSON 与 Codex 实际接入 | 不转换私有历史/进程/权限；新任务不激活旧 Goal |
| 独立审查 | 用户触发的新 Pi 会话，仅能读冻结源码，报告绑定版本 | 模型意见是建议，实际验收仍独立 |

## 验证资料

- 实际文件、进程、锁与 Pi SDK 回归覆盖动态新增仓库、原 index/用户修改、检查失效、取消/强杀、部分恢复、最新要求、记忆忘记和插件共存。
- Gateway 完成 Python 服务、JS SDK、JS 应用三个独立仓库接口变更；语法及真实 HTTP 检查通过。
- Pi→Codex→Pi 新任务新增接口文档并复查实际源文件；没有执行来源旧迁移。
- 独立 Gateway 审查识别注入的生产/消费字段层级不一致，未改源文件。
- 两任务×三条件记忆对照全部成功，记忆未显示时间改善，继续按需使用。
- 原生 PTY 验证五个扩展的 TUI 启动和退出；生产 tar 包安装后核心领域 CLI 可运行，没有携带 Pi 内核。

逐项记录见 [验证记录](validation.md)、[实施进度](upgrade-progress.md)与后续最终验收。没有覆盖所有模型、任意工程规模或断电情况。

完整能力与具体证据见 [逐项验收](acceptance-0.2.0.md)。本机严格检查和 86 项回归通过，生产包验证包含五扩展实际加载。跨平台状态查看 [PR #1](https://github.com/Yourleler/Enigma-next/pull/1) 最新 head，只有该版本全部通过后才报告完成。
