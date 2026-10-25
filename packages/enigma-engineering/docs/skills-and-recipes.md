# 原生技能发现与任务配方

本页描述第四轮已实现的技能发现与可调整配方。隔离委派、受控合并、复现任务包、完整联调与最终交互界面仍需继续完成，见 [工作台计划](workbench-plan.md)。托管、自修复和新增头脑风暴只在研究文档中。

## 原生技能发现

`skill_discover` 使用当前 Pi 会话的原生技能目录；frontmatter、重复技能处理与加载规则由 Pi 的公开 `loadSkills` 负责。按名称和描述做有界词法匹配，支持中文片段，返回来源、文件、内容版本和原生 `/skill:NAME` 命令。没有额外模型调用，也不自动安装或调用技能。

```bash
enigma-next skills paths '["/absolute/path/to/skills"]'
enigma-next skills search '接口迁移'
enigma-next skills list
enigma-next skills open SKILL_ID CONTENT_VERSION
```

`paths` 是操作者配置，通过 Pi 的公开 `resources_discover` 接入加载；更改后需重载会话。CLI 可查看配置/default 目录，Pi 插件仅搜索宿主当前已加载的原生目录。发现根不扩大仓库写入权限；只读仓库内的技能仍不能借此变成可写仓库。

`disable-model-invocation` 的技能从模型候选中排除，操作者列表可以看到其存在，但 `open` 不允许模型绕过人工调用要求。打开前重新加载并核对内容版本，变化后需要重新选择。每个文件有 256 KB 预算，目录总正文有 4 MB 预算，超限来源报告不可用。词法匹配没有翻译或语义相似保证；没有候选时应说明缺口。

## 可调整任务配方

配方描述有顺序的具体动作，复用当前领域能力：直接 argv 命令、已登记服务的启动/停止、操作者定义的浏览器场景、原联合检查。它不是固定角色循环。配方的新增、修改和推广只在操作者 CLI 中提供，Pi 的 `recipe_manage` 可以查阅和经审批运行已有版本。

```bash
enigma-next recipes save '{"id":"api-migration","label":"接口迁移","timeoutMs":300000,"parameters":{"version":{"description":"目标版本"}},"steps":[{"id":"migrate","kind":"command","repo":"library","argv":["node","scripts/migrate.mjs","--version","{{version}}"]},{"id":"acceptance","kind":"verify"}]}'
enigma-next recipes read api-migration
enigma-next recipes run api-migration '{"version":"v2"}'
enigma-next recipes runs
enigma-next recipes report RECIPE_RUN_ID
```

例子假定目标仓库确实存在对应脚本并已登记原验收检查，不能直接证明迁移可用。更新已有配方用 `recipes save JSON CURRENT_REVISION`，旧修订保留。整体默认预算为五分钟、最多一小时；达到期限取消当前动作，进程清理仍需等待实际终态。

参数必须占据一个完整 argv 值，不能替换可执行程序、拼进脚本源码或充当常见解释器的内联代码。命令不经过额外 shell 拼接；配置中显式写入 shell/解释器代码仍是需要审批的宿主能力，自定义脚本如何解释参数也需操作者审查。`envRefs` 可将环境变量名映射到已有值，避免把密钥写进配方和运行记录。

最终步骤必须执行当前工作区登记的原检查。缺少检查、检查失败或证据过期都不能把配方标为通过。Pi 适配还保护当前会话的原始要求与检查：回溯后未读最新要求、或检查在本轮被改动时，禁止运行/生成配方。

## 运行与中断

每步执行前后写持久回执，记录配方版本、任务/会话节点、参数、源码观察、结果和验收证据。命令使用现有 `Workspace.mutate` 记录整个工作区的实际变化；服务/浏览器使用同一管理器。结果里的 `passed` 表示本次程序与原检查在那个版本通过，`current` 单独表示这些环境/源码/配置是否仍匹配。

同一工作区只能同时运行一个配方；这把锁与工作区工具锁分开，服务/浏览器可以使用已有领域接口。进程中断后不会自动重跑配方，也不会把旧 `running` 当成仍活跃。取消结果不确定或存在未结算操作时继续保留未知效果。

```bash
enigma-next recipes reconcile '已检查旧拥有进程退出与实际文件、服务效果；这次只解除遗留配方锁'
```

`reconcile` 只接受已退出或明确 PID 重用的拥有进程，保存操作者说明并解除遗留配方锁；它不重放步骤，也不消除现有工作区未知操作。仍活跃或身份不确定时拒绝解除。任务记录可以通过 `recipe_manage report/runs` 按当前任务读取。

## 从成功任务提出草稿

```bash
enigma-next recipes propose
```

仅从全部步骤有当前检查证据、且没有验收缺口的计划提出草稿。草稿保留原目标、每步目标/仓库/检查与证据来源，默认可执行部分只有原检查。计划没有记录完整编辑过程，不能凭空推导安全可重放的修改脚本；操作者应补齐具体步骤和参数后通过 `save` 推广。

草稿单独存储，不加入可运行配置、不改变当前证据。推广改变配置，因此新运行必须取得新证据。旧任务的成功只作为来源，不能成为新任务的成功判定。

## 验证范围

六项新增测试覆盖原生加载、中文候选、人工技能限制、来源变化、只读仓库、实际 argv 数据、服务/浏览器、原联合检查、版本失效、持久取消、并发拒绝、草稿来源与原要求保护。真实进程与浏览器断言分别验证效果；受控模型用来检查 Pi 接入与权限拒绝。

真实 Gateway 通过 `skill_discover` 发现并打开技能，运行预备的三仓库迁移配方：实际应用返回 `app:sdk:v2`，浏览器点击呈现同一结果，三项检查通过，计划完成后生成未推广草稿。13 次工具调用中原生 read 一次被 managed 模式拒绝、草稿参数两次被拒绝后纠正；扩展错误为空。报告：`<LOCAL_AUDIT_ROOT>/2026-10-25/enigma-next-validation/skill-recipes/report.json`，复现入口 `scripts/gateway-reuse.mjs`。

这是对真实模型技能选择、配方运行和草稿提出的验证，迁移程序是预备脚本，不能把它外推为模型自由编码的成功率或整个工作台已完成。最终分发与当前提交的三平台 CI 仍需核对。
