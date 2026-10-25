# 协同计划与方案状态

`task_plan` 创建有仓库责任和前置依赖的轻量计划。模型仍由 Pi 执行；该模块记录任务进度和实际验收，未引入第二个 agent loop。

例如已有 library、sdk、app 以及 syntax/joint 检查后：

```json
{
  "action": "create",
  "goal": "升级公共 API 并保持应用可运行",
  "steps": [
    { "id": "library", "repo": "library", "goal": "修改上游契约", "checks": ["library-syntax"] },
    { "id": "sdk", "repo": "sdk", "goal": "适配调用方", "requires": ["library"], "checks": ["sdk-syntax"] },
    { "id": "app", "repo": "app", "goal": "联合验收", "requires": ["sdk"], "checks": ["app-syntax", "joint"] }
  ]
}
```

`task_plan` 的 `read` 返回计划 ID、修订号、可执行步骤、阻塞原因、检查缺口和反向影响。`advance` 必须带当前计划 ID、修订号、步骤和阶段；`verified` 还要带 `workspace_verify` 返回的证据 ID。失败、覆盖不足或过期证据不能完成步骤。计划变化后旧更新被拒绝。

CLI 等价入口：`plan create JSON`、`plan show` 和 `plan step PLAN_ID STEP REVISION PHASE [EVIDENCE]`。这些配置和计划操作不执行模型或 shell 检查；`verify` 才执行用户注册的命令。

当前证据仍保守绑定整个工作区，任何源码变化可能让多项检查同时失效。不要为了保留绿色状态缩小未知影响范围。代码依赖与更细的证据范围将在阅读阶段完善。

同一用户回合显式验收通过后，收尾会重新核对证据，源码/配置/环境和执行效果仍有效才复用通过记录。它减少重复检查命令，不减少失效核对；未知操作存在、实际代码或规则变化后不能复用。

检查点保存对应计划修订。`compare LEFT RIGHT` 同时显示文本变化、历史计划、当前有效的阅读/检查证据，以及声明依赖得到的受影响仓库。历史通过不代表当前代码通过。

`restore-preview TARGET EXPECTED` 给出变化和冲突；`restore` 会重新核对文件，恢复目标计划修订，同时保留所有后续修订。纯上下文导航不切换代码或当前计划。独立 code fork 带来源计划，但已有检查需重新验证。

`changes BASELINE` / `workspace_changes` 展示相对基线的实际内容变化。受管命令的观察窗口覆盖全部注册仓库；外部编辑和未知效果单独标识。观察到文件变化不等于能证明是谁写入；未注册目录、凭证、忽略文件和外部服务副作用不在覆盖范围。
