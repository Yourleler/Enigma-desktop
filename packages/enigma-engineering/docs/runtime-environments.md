# 项目环境、后台命令与浏览器验收

这些能力通过 `pi-runtime` 扩展和共用领域模块接入，主模型循环、会话和终端仍由 Pi 提供。它们是既定项目工作台能力，不启用后续研究中的托管管家、自动回溯或内核维修。

## 服务配置与启动

```bash
enigma-next services add '{"id":"api","repo":"server","label":"API","argv":["python3","-u","server.py"],"portPrefix":"READY: ","readiness":{"type":"http","path":"/greet","includes":"message"}}'
enigma-next services start api
enigma-next services status api
enigma-next services stop api
```

`dependsOn` 表达服务依赖；`envFromServices` 可将已就绪依赖的 URL/端口传给消费者，不要求把某次临时端口写进仓库。`envRefs` 只保存环境变量名，不保存密钥值。动态端口可由命令输出的明确前缀提取；没有就绪条件时不把进程存活当成服务已就绪。

后台命令是经过授权的宿主执行，不是 OS 沙箱。启动派发记录、正在运行、实际退出和服务就绪分别表示。背景输出有界并对已知密钥脱敏，实际脚本仍可能影响仓库外的文件或外部系统。

上游服务重启后，消费者显示 `dependency-changed`，不能沿用旧就绪状态；重启消费者时重新传递依赖地址。配置替换前要停止已有实例。已占用的固定端口直接报错，不根据端口猜 PID 并杀掉用户进程。

## 后台命令

```bash
enigma-next background start '{"repo":"app","label":"build","argv":["npm","run","build"],"maxRuntimeMs":600000}'
enigma-next background status RUN_ID
enigma-next background wait RUN_ID
enigma-next background cancel RUN_ID
```

独立工作进程保存运行标识、命令指纹、进程启动身份、输出和终态。主会话/CLI 退出后命令仍有自己的生命周期，不长期占工作区锁。等待超时只结束等待，取消必须取得实际终态；未知或遗失的工作进程效果会阻止后续源码写入和验证，操作者确认已停止并检查实际效果后可用 `background acknowledge` 记录核对结果。原操作和未知记录仍保留，不自动重放。

取消处理已拥有的命令及进程组。逃逸进程、无法核实启动身份和外部副作用不被描述为完全可撤销。

## 浏览器场景

```bash
enigma-next browser add '{"id":"greeting-ui","label":"Greeting UI","service":"web","steps":[{"action":"click","selector":"#go"},{"action":"expect","selector":"#out","includes":"app:v2"},{"action":"screenshot","label":"greeting"}]}'
enigma-next browser run greeting-ui
enigma-next browser report BROWSER_RUN_ID
```

安装匹配的浏览器：`npx playwright install chromium`。CI 安装 Chromium 与系统依赖。场景执行真实页面行为，保存截图、执行轨迹、失败步骤及错误。导航/请求限制在项目服务和显式场景来源；浏览器步骤不提供任意脚本执行入口。场景配置由操作者通过 CLI/后续界面维护，Agent 工具可以列出、执行和查看报告。

结果关联源码、场景配置和服务运行代次；变化后重新检查。`passed` 只证明这个场景，完整目标仍通过注册的单仓库与联合检查验收。若将 `browser run ID` 注册为联合命令，CLI 用失败退出码表达失败/取消/过期，不能用通知或模型声明代替页面断言。

截图与 trace 可能含应用敏感数据，保存在可信本地工作区，不自动发布。文本日志脱敏不意味着所有图像或网络轨迹内容都已清除。

## 当前验证

- 136 项本地原回归与类型检查通过。后台取消/超时、未知效果、端口占用、依赖重启、源码/场景失效和浏览器成功/失败分别有实际验证。
- 最新真实 Gateway 完整 Python API、JS SDK、JS 应用三仓库流程见 `.../enigma-next-validation/full-workflow-resumed/report.json`：原五项检查最终通过，网页显示 `app:v2`，恢复后重新启动服务与验收，任务包在另一工作区复现通过。
- 本地工作台的真实浏览器与模型记录见 [交互工作台](interactive-workbench.md)。Mac 是本次实际交付平台，其他 OS 不由本机推定；GitHub Actions 保持关闭。
