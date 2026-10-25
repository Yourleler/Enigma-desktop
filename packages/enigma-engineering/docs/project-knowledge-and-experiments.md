# 项目知识与分支实验

本页对应第四轮的复用与方案探索。底层继续使用现有记忆、资料、隔离工作区、检查与合并能力，Pi 通过独立 `pi-learning` 插件接入。

## 材料关联的候选知识

`project_knowledge` 提供显式草稿和中文检索，默认随可选记忆能力启用，也可用 `--enigma-knowledge`。没有定时反思或额外后台模型。草稿支持材料、源码与本工作区证据，个人偏好不走这个入口。

```bash
enigma-next knowledge draft '{"title":"接口迁移经验","kind":"contract","content":"修改公共接口时同步核对生产者和调用方。","resources":["RESOURCE_ID"],"evidence":["PARENT_EVIDENCE_ID"]}'
enigma-next knowledge organize
enigma-next knowledge search '接口迁移'
```

Pi 运行中只记录未整理草稿；空闲时使用 `/knowledge-organize` 有界整理。材料 ID、修订、内容哈希与任务作用域进入知识来源，源码/证据仍按既有机制验证。材料变化、删除或失去访问范围后，关联记忆失效，旧检索摘要也从后续模型上下文中移除。

私有材料自动要求相同任务的记忆作用域，不变成共享项目偏好。导入网页只证明本地引用快照匹配；读取会注明远端新鲜度未核实，不能把本地版本有效当成网站当前内容已核实。整理生成的记录仍是 candidate，正文属于有来源的参考，不提升为系统指令。

知识入口即时拒绝其他工作区的证据编号。可以在文字中引用子任务观察，但应从父工作区重跑原检查获得父证据；子工作区的通过记录不是父验收。

## 对照真实分支

```bash
enigma-next experiments create '{"goal":"升级接口且保持应用可用","checks":["joint"],"candidates":[{"id":"A","delegation":"CHILD_A"},{"id":"B","delegation":"CHILD_B"}]}'
enigma-next experiments evaluate EXPERIMENT_ID
enigma-next experiments report EXPERIMENT_ID
enigma-next experiments select EXPERIMENT_ID A
```

先用 `delegate_task` / `delegates start` 创建两个到八个已有隔离实现。它们必须来自相同代码起点，选用相同父检查定义与检查集合。比较不会改检查命令，也不会仅根据模型宣称任务成功。

`evaluate` 在实际子工作区执行共同检查。源定义、当前子命令、源码与环境逐项核对：保留检查 ID 但改了命令也会被拒绝执行。报告区分通过、失败、无法验收、当前有效性，以及已知 SDK 调用数；缺少的 Codex 调用计数保持未知，不虚构 token 成本或收益。

`select` 只允许当前通过、证据仍匹配且父标准没变的候选，并产生原有合并预览。代码尚未应用；随后 `delegates merge PREVIEW_ID` 才按父当前基线与权限合并、运行全部父检查。实验的共同检查范围不会替代父任务完整验收。

原比较报告保存为版本记录。源码改变、检查被改或删除后，可以查看旧报告，但不能拿它选择当前方案。`project_overview` 的实验清单读取事实，不增加模型调用。

## 服务源码版本

运行就绪与源码有效分开检查。服务指针保存启动时工作区代码指纹；代码变化后返回 `source-changed` 并阻止把老进程的响应当作新代码浏览器验收。显式重启加载新代码后再验证。默认范围保守覆盖整个注册工作区，因此资料文件变化也可能要求重启。

指纹匹配是启动快照的核对，不是对所有热重载行为的内部追踪。代码恢复后仍应明确停止/重启目标服务，重新跑真实流程。服务指针和父工作区路径不是可移植运行状态；任务包恢复会将完整工作区参数映射到新位置，并重新启动与验收。

## 验证与剩余范围

130 项本地完整回归通过，新增实际模型协议/文件测试覆盖两种实现的共同检查、错误分支、篡改命令拒绝、源码与父标准失效、合并保护；知识覆盖材料修订/删除、私有作用域、中文召回及跨工作区证据拒绝。实际旧 HTTP 服务继续返回 v1，而源码改成 v2 时被阻止用于验收；重启后的浏览器流程通过。

真实 Gateway 创建两套三仓库实现，均实际输出 `lib:v2`、`sdk:lib:v2`、`app:sdk:lib:v2`，每个子任务各使用 15 次 SDK 调用，通过同一原检查并受控选择。第一轮经验草稿引用了子证据，整理器正确拒绝；记录保存在 `.../enigma-next-validation/learning/report.json`。

通过公开 Pi 会话接口接续原任务后，使用父新证据重新起草、空闲整理和中文检索成功，用户文件保留，扩展错误为空。最终记录在 `.../enigma-next-validation/learning-resumed-final/report.json`，关联原两种实现报告；没有重做已通过的模型实现，但环境证据失效时重新执行了共同检查。

知识与实验已进入最新三仓库完整流程，详见 [综合验收](full-workflow-acceptance.md)和[逐项验收](acceptance-0.3.0.md)。自动托管、内核维修和文档专精仍只研究，不属于本次启用功能。
