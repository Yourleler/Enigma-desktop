# 事件接续、任务产物与进度快照

## 有界条件等待

`events wait JSON` 可等待已有后台命令终态、项目服务就绪/停止，或 GitHub Actions 指定 run 的终态。等待运行在独立进程，不占主模型请求或工作区操作锁；保存原 task、entry、来源观察、轮询次数、错误和终态。轮询失败不会假装外部任务结束，取消和超时有显式结果。

```bash
enigma-next events wait '{"label":"等构建完成","task":"TASK_ID","condition":{"kind":"background","run":"RUN_ID"},"resume":true}'
enigma-next events waits TASK_ID
enigma-next events list TASK_ID
enigma-next events cancel WAIT_ID
```

Pi 的 `task_events` 工具自动绑定当前会话与分支来源。`resume=true` 才允许独立结果触发接续；旧分支来源不再存活时只保留本地事件，不唤醒当前分支。模型收到的结果是参考数据，必须核对实际源码和当前要求，不能当成用户的新指令或完整验收。

正常投递使用事件标识、原生会话标记和持久回执去重。投递前已准备、但崩溃导致是否入队不确定时，保留 `prepared`，不自动重发。这里不承诺跨进程/网络断电下的 exactly-once；本地可核对状态优先于猜测任务已接续。等待进程丢失时必须显示进程身份/观察不确定，不能用旧 state 文件证明它仍运行。

## 版本化产物

```bash
enigma-next artifacts add '{"title":"接口设计","kind":"document","repo":"sdk","file":"DESIGN.md","task":"TASK_ID"}'
enigma-next artifacts list TASK_ID
enigma-next artifacts read ARTIFACT_ID TASK_ID
```

产物支持文档、代码、报告、截图、trace 和任务包；保存内容指纹、来源、task/entry、源码观察和验证引用。实际字节保存为独立版本，原文件变化后仍可查看旧结果，同时明确 `sourceCurrent=false`。代码/文档/报告对已声明密钥脱敏；图像和执行轨迹可能有应用敏感信息，不自动发布。

运行产物来源限制在工作区的批准结果目录，拒绝目录穿越与符号链接。读取时核对实际 blob 的哈希与长度。Pi 自动归档 `browser_validate` 的截图和 trace；其他结果可用 `artifact_manage` 明确登记。

## 多仓库进度

`overview [TASK_ID]` / `project_overview` 聚合仓库、原检查、正确会话作用域的计划、服务、后台命令、条件等待、事件投递和产物。它读取事实，不调用模型，也不把 ready/finished 与整个任务 verified 混为一谈。最后的工作台界面将直接使用同一领域数据。

## 当前证据与剩余范围

111 项本地回归及严格类型检查通过。真实 Pi SDK 根据实际后台结果接续一次，重复轮询不再次触发；取消/超时、分任务读取、不可变产物、损坏内容拒绝和来源过期有实际验证。

真实 Gateway 验证：主轮结束后收到 `EVENT-CONTRACT-7342`，读取实际输出，新增 `sdk/RESULT.md` 并登记产物，API 源码保持原值；原生会话只有一条投递标记。报告：`<LOCAL_AUDIT_ROOT>/2026-10-25/enigma-next-validation/event-delivery/report.json`。

上一批服务提交的 Windows CI 将取消结果报告为 unknown，原断言保留。`8ceed46` 的取消测试已通过，Windows 仍在自然退出/超时与事件测试清理处失败：[push CI](https://github.com/Yourleler/Enigma-next/actions/runs/40130762014)、[PR CI](https://github.com/Yourleler/Enigma-next/actions/runs/40130757452)。日志保存在 `.../services-browser/windows-ci-latest.log` 与 `windows-ci-second.log`。

核查发现慢 OS 身份查询可以读取到命令退出前的快照，再把已退出的进程误标 unknown。现在在查询后重读实际终态，并分别表示持久执行状态与观察不确定：身份信息暂缺不会被条件等待当成执行已经结束，真实进程丢失仍为未知终态。新增实际短命令与延迟/丢失探针测试；事件用例等待 Pi 真正空闲后清理。它们覆盖已复现的竞态，新 Windows 结果仍需核实，不能先宣称所有远端故障已解决。

技能发现和配方首批已接入，见 [使用与边界](skills-and-recipes.md)；委派与合并、复现任务包、完整全流程和最后的交互界面继续实施。托管管家等新增头脑风暴仍为计划文档，不启用自动回溯或现场内核维修。
