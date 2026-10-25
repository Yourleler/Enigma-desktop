# 0.2.0 逐项验收

验收对象：原 Goal、2026-10-25 记忆/观察和上下文交接增补，以及对应实施文档。原范围全部保留。完成结论需最新版本的本地、分发与平台证据；下表列出已检查的权威来源，不以“未发现错误”替代验收。

## 能力证据

| 要求 | 实际证明与对应来源 | 范围/限制 |
|---|---|---|
| 历史基线与用户改动 | `$HOME/code/Enigma` 仍是 clean main，HEAD `33c9afed9decf199ef4bb933ad813644d615562b`；新仓库独立提交 | 未修改旧源码或强推旧分支 |
| Pi 插件与宿主无关核心 | `workspace.ts`/领域状态不解析 Pi 会话；宿主接口在 `pi-*.ts`；`plugin.test.ts` 原生安装/加载/移除、另一扩展工具与原生文件工具可用 | managed 模式只协调可信宿主内工具，不是 OS 沙箱 |
| 分发与便捷启动 | `package.json` pi manifest + peer dependencies；实际 tar 生产安装和领域 CLI 验证；PTY 启动五扩展并退出 | CLI 启动 Agent 需安装 Pi 1.4.0；不发布私有代码为公开 npm 包 |
| 多仓库数量与运行中注册 | `pi.test.ts` 任务中加入第四仓库并保留只读；`recovery.test.ts` 早期恢复不撤销新注册 | 文件读取和源发现预算有界，不写死双仓 |
| 依赖、契约与影响 | `cross-language.test.ts`/`contracts.ts` 三仓库、声明映射和 route/fetch 候选；`planning.test.ts` 上游变更使下游阻塞 | 静态声明的 confirmed 表示源码映射存在，实际行为靠联合检查 |
| 真实基础 coding 与联合验收 | Gateway 跨语言报告实际修改 server/model.py、sdk/index.js、app/index.js，四项检查 passed，真实 HTTP 为 app:v2 | 一项真实任务，不是普遍成功率 benchmark |
| TS/JS/Python 智能阅读 | checker 与标准库 AST，实际别名/重导出/项目 paths/同名遮蔽测试；源码 hash、位置、关系地图和阅读节点展开 | 无完整动态 call graph；解析器不执行项目代码 |
| 增量与旧阅读结果 | `semantic.test.ts` 不变 AST 重用/改动重解析；`reading-store.test.ts` 刷新取消保留旧发布，展开核对当前 hash | 陈旧版本不能认证新代码；外部包/动态关系未确认 |
| 轻量计划与进度 | `planning.test.ts` 依赖、ready/blocked、来源检查证据、变更/过期阻断、不可覆盖修订 | 仍由单 Agent 主循环推进，不新增多角色平台 |
| 方案比较和恢复 | `solutions.test.ts` 比较 diff/影响/计划；`pi.test.ts` context-only 不改代码，显式恢复代码并保留原分支 | 外部数据库/网络副作用不由文件快照恢复 |
| 用户原有修改/index | `workspace.test.ts` 原脏文件/index、较晚外部改动阻止覆盖；`partial-restore.test.ts` 并发改动保留 | 本地并发版本核对，不承诺分布式事务或断电 exactly-once |
| 中断、强杀和部分恢复 | `process.test.ts` 取消清理进程；`recovery.test.ts` SIGKILL 后实际写入观察，标 unknown；部分恢复补偿或 unknown 阻止重放 | 逃逸子进程清理不确定时不宣称已安全终止 |
| 最新要求、权限与累计消耗 | `pi.test.ts`/`handoff.test.ts` 回退后要求分页门禁，注册/权限不回退，来源与新会话消费分开；新背景计划隔离 | 原生外部 Agent 自有权限不因包输入提升 |
| 变更来源 | `changes.test.ts` 跨仓命令全部观察，晚用户编辑单列外部，未知影响阻止其他仓写入 | 观察窗口不证明精确作者归因 |
| 按需独立审查 | `review.test.ts` 全新上下文、冻结源码、无 shell/写工具，stale/取消；真实 Gateway 报告指出嵌套字段缺陷 | 模型审查是建议，不能替代实际验收 |
| 记忆类型、作用域和保鲜 | `memory.test.ts` 项目/仓库/任务/显式个人、中文精确/模糊召回、源码失效/无结果、手改正文 | 单库有界；语义 embedding 是可选以后接入，词法可独立工作 |
| 记忆纠正、忘记与来源 | 用户显式中英文命令、替代关系、单调删除；旧分支/代码恢复不复活；旧工具正文/摘要从未来 context 隐藏 | 原始日志保留，无法擦除所有同义转述/备份 |
| 记忆索引与整理 | `memory-index.test.ts` 派生索引重建、只重建变化、草稿有界、源码变化拒绝、活跃 writer 保留、unknown 不重放 | 整理用户空闲触发，不自动大模型反思 |
| 困难时经验召回 | 同签名三次、冷却/次数限制、作用域/版本检查、无结果无注入、详细正文一次暴露 | 疑似困难不等于判断所有长任务无效 |
| 记忆效用与总成本 | 两任务×三条件真实报告含建库/索引/工具/usage/耗时，全部成功；一次工具缺口失败单独保留 | 这组记忆未变快，因此按需启用，无论文数字外推 |
| 独立运行状态问答 | `observer.test.ts` 真实锁持有期间旁路返回、HTTP 等待、输出流、强杀/启动身份；`observer-boundaries.test.ts` 取消/等待/采集错误；问答无模型默认可用 | 进程活性不是有效进展；无服务端内部遥测不推断隐藏步骤 |
| 显式旁路模型解释 | 实际静默命令仍运行期间 Gateway 返回阶段/PID/耗时及未知；独立 budget/取消，解释无工具不排入主 Agent | 同模型服务资源共享，默认不连续请求 |
| 重试与过慢优化 | `provider-retry.test.ts` 真实 503 后再次请求/回应；快照 8→6 次与检查 2→1 次的实际计数和测量 | 阶段时间可重叠，局部优化不宣称普遍加速 |
| 同背景新任务 | `handoff.test.ts` 实际 Pi runtime replacement、背景输入、新目标、原文件不变、原计划不激活 | 仅背景模式不自动继续旧 Goal |
| 接着做/独立方案 | 新原生会话、code fork selected branch、较新要求/来源计数、不同 cwd/代码保留，历史验收重新待验 | 上下文复制与代码恢复分开；未知副作用不重放 |
| 跨 Agent 与包完整性 | 真实 Pi→Codex→Pi 新文档任务/源码回查；附件 hash/缺失、路径 ID 映射、超长/改包拒绝、忘记最新核对 | 通用背景输入，非任意私有历史/进程无损迁移 |

## 真实证据产物

报告都保存可回查的源码、工具轨迹、会话和结果，路径为本机绝对路径，仓库不提交敏感完整 Trace：

- `.../enigma-next-validation/gateway-cross-language/report.json`：真实三仓跨语言任务。
- `.../enigma-next-validation/gateway-cross-language-0.2.0/report.json`：0.2.0 再次实际完成三仓接口变更、18 次工具调用和四项联合检查。
- `.../enigma-next-validation/live-handoff-final/report.json`：真实 Codex 新任务和 Pi 回查，操作记录仅 sdk/HANDOFF.md 新增。
- `.../enigma-next-validation/live-review/report.json`：独立模型识别已知注入缺陷。
- `.../enigma-next-validation/memory-comparison-supported/report.json`：六项真实记忆条件任务与成本。
- `.../enigma-next-validation/live-observer-question-final/report.json`：主命令未结束时独立解释。
- `.../enigma-next-validation/observer-performance/before.json`、`after.json`：真实文件和子进程局部测量。
- `.../enigma-next-validation/artifacts/package-check.json`：生产 tar 安装和核心领域运行。
- `.../enigma-next-validation/artifacts/package-check-0.2.0.json`：0.2.0 生产包无宿主依赖、五扩展实际加载并运行仓库工具，无扩展错误。

以上 `...` 为 `<LOCAL_AUDIT_ROOT>/2026-10-25`。命令与限制详见各功能文档。

## 最终版本确认

0.2.0 本地严格检查和 86 项回归通过；代码相关证据按上述要求逐项核查。生产 tar 已在独立安装中加载五个扩展并实际调用仓库工具，无错误；Gateway 在 0.2.0 再次完成三仓跨语言迁移，四项实际检查通过。

远端最新提交的 Linux/macOS/Windows 校验与 PR 状态以 [PR #1](https://github.com/Yourleler/Enigma-next/pull/1) 的当前 head checks 为准，不能用历史绿色状态替代当前版本。验收结论只在这些 checks 实际全部成功后报告。原 Python Enigma 与其 main 分支保持原基线，新增实现位于独立仓库的可审查分支。
