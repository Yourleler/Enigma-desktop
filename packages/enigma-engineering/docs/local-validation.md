# 本机完整验收与验证凭据

GitHub Actions 已按用户要求在全部现有仓库关闭。项目原测试、三平台矩阵和手动工作流文件保留，关闭云端不会把未验证的平台变成通过。

## 在实际目标系统运行

在源码 checkout 中运行；独立生产包不包含开发测试和这些验收脚本。Node.js ≥22.19.0、Git、Python 3、gopls 0.23.0 与 Playwright Chromium 需要在目标系统可用。安装 gopls 0.23.0 使用 Go 1.26+，现有 CI 固定 Go 1.26.10。使用现成已验证工具时，实际版本随测试环境记录；缺依赖导致的失败不能跳过算通过。

```bash
npm ci --ignore-scripts
npx playwright install chromium
go install golang.org/x/tools/gopls@v0.23.0
npm run verify:local -- /absolute/path/to/validation-output
```

Windows PowerShell 的输出路径可以写成 `C:\enigma-validation`。工具通过 Node 执行当前 npm 入口，不将路径或参数拼为 shell 命令。Git、Python、Go/gopls 应已加入 PATH；需要指定 Python 时设置 `ENIGMA_PYTHON`，gopls 可用 `ENIGMA_GOPLS` 指向现成二进制。

`verify:local` 顺序执行原 `npm run check`、`npm test` 和实际 CLI `--help`。它不删改断言、延长单个测试的期限或把失败改成跳过。任何步骤返回非零，验收返回非零并保存失败日志。

输出目录包含 `report.json` 与各项日志。报告记录实际平台、架构、Node 版本、步骤退出码、耗时、日志哈希、Git HEAD 与未提交文件名，以及编译后应用文件的哈希。必须检查报告的实际退出结果和测试汇总，而不是仅凭报告存在判断成功。

默认输出放在工作区 `.enigma-next/local-validation/`，排除在代码快照之外。验证记录可能包含工程路径，应保存在可信位置；不自动上传或发送给其他人。

## 真实模型完整流程

以下命令会使用现有 Gateway 配置发起真实模型任务，CI 和本地回归不自动执行它们。网关已登录且可用时：

```bash
npm run build
node scripts/gateway-full-workflow.mjs /absolute/path/to/full-workflow-output
node scripts/gateway-workbench-ui.mjs /absolute/path/to/workbench-output /absolute/path/to/full-workflow-output/report.json
```

第一项使用新的三仓库 Python/JS 工程，覆盖资料/技能/Schema/源码地图、两个隔离方案、原标准比较和合并、服务与浏览器、代码和上下文恢复、事件接续与任务包新工作区复现。保护文件在完整流程结束后重新核对，原检查定义也必须保持一致。累计调用不因回溯归零，正常事件投递标记与子进程实际退出分别验收。

第二项绑定明确的已验证综合报告，并在浏览器中创建本次会话，使用其 ID 核对实际审批、原检查、重连和产物。两个报告都记录编译应用和脚本指纹，便于分清旧证据与当前构建。

当前报告仍是所执行案例的证据，不证明所有仓库或模型的普遍成功率。macOS 的报告不能替代 Windows 的实际执行；没有目标系统的结果时，保留相应验收缺口。
