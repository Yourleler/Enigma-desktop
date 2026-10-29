# 跨语言三仓迁移与文档验收

2026-10-27。证据范围：真实 Gateway Pi 工作进程、应用领域接口、隔离文件系统和实际 HTTP 请求。本报告不替代桌面按钮的交互验收。

## 同一任务的实际结果

三个独立 Git 仓库组成一条调用链：Python `server` 提供 HTTP 接口，JavaScript `sdk` 读取接口，JavaScript `app` 展示结果。

| 阶段 | 实际证明 |
| --- | --- |
| 基线 | 原服务实际返回 `v1`；新联合检查先失败 |
| 阅读 | 建立10个源码节点、7条静态关系；`fetch`和JSON运行行为仍标为需实际验证 |
| 计划 | 三个依赖步骤共用原 `http-chain` 检查 |
| 隔离实现 | Gateway在独立目录改4个文件：Python返回新信封、SDK兼容新旧结构、应用加`app:`、编写迁移文档；原目录保持不变 |
| 预览与整合 | 预览只包含允许的4个文件，确认后整合；并发添加的用户备注保留 |
| 父工作区验收 | 原检查文件与定义未改，真实Python HTTP→SDK→应用调用通过；计划3/3，原代码地图失效 |
| 文档交付 | 登记源码行依据和可执行例子；文档例子实际运行通过，指南登记为不可变成果 |
| 独立复验 | 第二个Gateway上下文只根据指南执行，实际输出一致；没有新增、删除或修改源码文件 |

确切联合检查输出：

```text
HTTP3_REPO_OK raw=v2 sdk=v2 app=app:v2 legacy=legacy
```

成功尝试使用14次实现请求、7次独立文档验证请求。两个工作进程均已退出。机器可用性、模型选择或网络变化时，不能据此次样本推断所有任务表现。

## 实跑发现的监听权限缺口

第一次模型完成修改，但Python在`socket.bind`处被系统拒绝，原联合检查没有启动成功；模型正确报告未通过。失败记录保留，没有修改原检查规避问题。

根因是工程命令沙盒只允许出站网络，没有服务监听能力。查询了[Codex当前Seatbelt实现](https://raw.githubusercontent.com/openai/codex/main/codex-rs/sandboxing/src/seatbelt.rs)作为语法参考，并在本机实际验证。`localhost`表达式在这台macOS上不能证明“只允许回环地址绑定”：通配及另一个本机接口地址也能绑定。数值IP表达式则不被该SBPL解析器接受。因此没有把它作为可靠的地址隔离承诺。

最终增加用户显式的“工程开发服务器”设置，默认关闭，只作用于Mac工程命令。开启后监听地址由项目决定；关闭网络时仍禁止监听。模型设置工具不能自行开启。测试项目明确绑定`127.0.0.1`，设置只在隔离验收配置中开启，用户现有配置没有改变。通用命令沙盒默认规则也没有自动放开。

## 可复现证据

- Runner：`scripts/verify-enigma-cross-language.mjs <新证据目录>`，需要现有本机Gateway配置；不输出或提交密钥。
- 首次失败：`<LOCAL_AUDIT_ROOT>/2026-10-27/enigma-12h/cross-language-e2e-r1/report.json`。
- 成功完整链路：`<LOCAL_AUDIT_ROOT>/2026-10-27/enigma-12h/cross-language-e2e-r2/report.json`。
- 实际指南：`.../cross-language-e2e-r2/workspace/app/MIGRATION.md`。
- 监听设置验收：`tests/enigma-loopback-sandbox.test.ts`；默认关闭、显式开启后服务通信、网络关闭后拒绝均为真实进程结果。
- 配置/模型限制：`tests/preferences-sandbox-network.test.ts`、`tests/update-settings-tool.test.ts`、`SecurityTab.test.tsx`。

原语言级与跨仓测试仍保留；这个场景补的是阅读→计划→独立修改→整合→联合验收→文档交付在同一任务里的执行证据。
