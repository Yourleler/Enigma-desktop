# 隔离子任务、受控合并与可复现任务包

本页覆盖第四轮已接入的协作与复现能力。完整目标仍按 [工作台计划](workbench-plan.md)继续，包括项目知识与分支实验的深化、全部能力联调、平台与分发验收，以及最后的真实交互界面。

## 独立子任务

Pi 的 `delegate_task` 可以将按需阅读、研究或准备工作交给另一个 Pi 或 Codex。启动时复制当前代码快照和选定材料，子任务不持有父工作区的操作锁。仓库数量没有固定为两个，写入范围是当前已授权仓库的一个明确子集。

```bash
enigma-next delegates start '{"target":"pi","goal":"阅读三个仓库的调用链并说明迁移难点","writeRepos":[],"provider":"gateway","model":"gateway-gpt-6-1-sol","agentDir":"/absolute/path/to/existing/pi-config","timeoutMs":240000,"maxRequests":24}'
enigma-next delegates list
enigma-next delegates status DELEGATION_ID
enigma-next delegates wait DELEGATION_ID
enigma-next delegates cancel DELEGATION_ID
enigma-next delegates drain DELEGATION_ID
```

最多四个子任务可以同时准备/运行。每个任务有时间预算；Pi 的模型调用预算在公开 SDK 接口处计数，包含压缩使用的模型调用，不修改 Pi 内核。它是 SDK 模型调用次数，不等同于计费 token 或底层传输重试次数。Codex 使用公开 CLI 的时间/输出限制，未公开的调用次数保持未知，不能算作零成本。

Pi 阅读子任务只有读取工具；可写子任务仍不能新增仓库注册或扩大原写入范围。读取资料使用子任务的作用域，源任务私有材料不会自动变成项目共享材料。Codex 使用公开 `exec`/stdin 和读写沙箱，创建真实的新会话；没有写入目标私有历史格式。

源码位于单独工作区并不自动成为 OS 沙箱。Pi 的获准 shell 仍是宿主命令，具有既有执行边界；父文件保护来自受管文件工具、明确的合并范围与版本核对，不能据此承诺任意恶意宿主命令无法访问工作区之外。

`completed` 表示子 Agent 本轮执行已结束。可以通过 `checks` 从已有父检查中选择子任务的验收范围；检查命令来自既有定义，父任务检查不被删改。没有子任务检查时，其验收保持未验证。子结果和历史证据不能成为父任务完成的判据。

## 版本核对与合并

```bash
enigma-next delegates preview DELEGATION_ID
enigma-next delegates merge MERGE_PREVIEW_ID
```

预览比较原始快照、子任务实际文件和父工作区当前状态。父任务没有改过的文件可应用；内容已经相同的文件保留；同一文件的独立文本改动通过三方合并保留。重叠编辑、删除/模式冲突、无法安全合并的二进制或范围外改动都阻止合并。

提交预览后会再次核对子代码和父工作区。预览不锁定未来状态，后来改动会使其失效。应用使用既有检查点恢复机制：保护用户原有改动、保留当前父计划、记录部分失败及补偿，然后重新执行父工作区的全部原检查。只合入代码，不合入子任务的权限、运行配置或历史成功状态。

子任务未知执行效果、仍运行的操作或不完整工作区不能直接合并。取消的请求与确认停止分别记录；`drain` 等待拥有进程真正退出，不杀身份不明的进程，不因等待超时重启任务。后台命令同样提供 `background drain ID`，命令终态与 worker 退出分开表达。

已有 `task_events` 支持 `{kind:"delegation",task:"DELEGATION_ID"}` 条件，可在请求接续时投递结果；事件仍受原任务/分支与去重约束。`project_overview` 展示子任务、实际 SDK 调用数及不可获得的 Codex 调用数，不用活性或轮次冒充验收。

## 任务包

```bash
enigma-next package export '{"goal":"复现接口迁移问题","resources":["RESOURCE_ID"],"evidence":["EVIDENCE_ID"]}'
enigma-next package inspect /absolute/path/to/package
enigma-next package restore /absolute/path/to/package /absolute/path/to/new-workspace
enigma-next package restore /absolute/path/to/package /absolute/path/to/new-workspace '{"writeRepos":["library","sdk","app"],"activateRuntime":true,"preparePi":true}'
```

任务包保存准确代码字节、来源 HEAD/分支、原目标和选定上下文、材料修订及来源捕获、检查/服务/浏览器/配方定义、来源环境、产物与未结算效果。代码快照保留文件模式，拒绝包含凭证的代码导出；不会复制 credential 文件、运行进程或私有会话历史。内容有哈希/长度校验与预算，失败导出保留明确的不完整状态。

默认恢复是只读仓库，运行定义不激活。`writeRepos` 与 `activateRuntime` 是目标操作者的明确选择。恢复创建新 Git 仓库并保存源 HEAD 作为来源记录，没有伪造相同的 Git 历史。仓库相对布局保留，完整 argv 文件路径和本机 Node 可执行文件映射到新位置；嵌入脚本源码的原目录不能静默重写，需要修改运行配方。

恢复后计划重建为待验状态，来源检查只存为历史数据。导入记忆不会成为活动记忆或个人偏好；材料已经陈旧时不进入当前材料列表，导入网页的远端新鲜度仍为未知。源机器的全部外部依赖、网络服务和副作用不是代码快照的一部分，需要按记录在目标环境准备和重新取得证据。

`preparePi=true` 使用 Pi 公开会话接口准备一个新会话，将选定私有材料/产物绑定到它，并写入本项目启动指针；其他会话不能因此获得这些私有材料。它不启动模型。随后 `agent` 使用该会话，模型后端继续使用既有配置或单独 `connect gateway`，不随任务包复制密钥。

## 当前证据

受控 HTTP 模型用于实际独立进程验证：两个 worker 的请求确实重叠；写入只留在副本；父并发文件与计划被保留；相同文件的独立编辑合并；重叠编辑、过期预览、父仓库注册、调用预算和取消都有实际效果断言。它们是执行边界证据，不是自由编码成功率。

任务包测试从三个仓库的真实失败状态复现失败，在目标修复后通过原检查与实际浏览器点击；父代码保持原值。还验证了只读/不激活默认值、来源变化、损坏字节/路径拒绝、历史证据不激活、忘记的记忆不提升，以及新 Pi 会话的私有材料绑定。

真实 Gateway 首轮通过 Pi→Codex→Pi：Codex 在独立 SDK 工作区生成实际调用链文档，父任务通过受控合并接回，原文档检查及应用结果 `v1` 通过；任务包在另一工作区复现成功。文档哈希与子结果一致，父 shell 只读和核对。报告位于 `.../enigma-next-validation/isolated-collaboration/report.json`，复现脚本为 `scripts/gateway-isolated-collaboration.mjs`。后续修改需要最新构建复验，不能将该首轮当成最终完整工作台验收。

最新构建的加强复验位于 `.../enigma-next-validation/isolated-collaboration-final/report.json`：30 次工具调用，四次参数/来源拒绝后纠正，扩展错误为空；父文档与实际 Codex 子文档哈希相同，并检查所有父 `write/edit/command` 操作没有绕过受控合并代写。原检查及另一工作区的复现均为 verified。拒绝中包含误把总结文本当成 Pi entry ID 的情况，错误来源没有被升级成用户原文。

上一版本 `5e43e73` 的 macOS/Linux CI 成功，Windows 命令结果与事件接续断言通过，但清理后台任务目录时遇到 EBUSY。新增 worker 身份查询收尾与显式退出等待后，需要当前提交的 Windows 结果证明修复。完整联调、生产包与交互界面仍未验收完成。
