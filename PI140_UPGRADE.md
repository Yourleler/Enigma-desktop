# HanaAgent 的 Pi 1.4.0 本地底座

2026-10-25，Mac。基于 OpenHanako/HanaAgent `9a6cabf8c513db5edc6cf8179a538c9075885c6e`、应用版本 0.450.0，在本地 `codex/pi-1.4.0` 分支升级。没有修改 Pi 安装包源码，也没有安装到 /Applications、迁移用户的 ~/.hanako、修改 Codex/Gateway 登录或启用 GitHub Actions。

## 已完成的适配

- `pi-coding-agent`、`pi-agent-core`、`pi-ai` 统一固定为 1.4.0，TypeBox 固定为 1.3.27，锁文件同步。
- Hana 的模型/认证门面使用公开 ModelRuntime 作为唯一执行运行时，再提供旧界面所需的目录和状态投影。会话创建传入同一个 modelRuntime，旧 authStorage/modelRegistry 参数由适配层转换。
- OAuth 选择/设备码/取消桥接新接口，凭证刷新仍使用同一份 auth.json 和 SDK 的文件锁；同步显示读取不阻塞异步写入。无效注册和失败的凭证操作保持可见，显式移除/重试可以恢复。
- 适配公开 `streamFunction`、`finishTurn` 与 transcript system 消息；提示词与工具声明保留在会话消息中，工具执行函数不进入 provider-visible transcript。
- `max` 采用 Pi 1.4 原生级别，保留历史 xhigh 兼容；识别模型的 max 映射，避免将用户的 max 选择降级。
- Hana 的专用思考协议元数据使用 `hanaThinkingFormat`，避免填入 Pi 1.4 范围更窄的 thinkingFormat 枚举。保留当前 SDK 目录的模型/头部信息，不使用过时默认目录冒充现有广告能力。
- 原生压缩请求与 Pi 1.4 实际文本、split-turn 提示和 provider-default 输出策略对齐。预算记录区分模型上限与缺失元数据的估计。
- 老 JSONL 首次读取被 SDK 规范化后，有界复读搜索来源，保持修订号与实际消息一致。
- 更新实际运行依赖闭包、明确的 SDK 调用说明、导出清单和持久化指纹；Hana store 的结构及 DATA_EPOCH 没有改变。

## 仍需维护的边界

Pi 1.4 没有在包根导出 file credential backend 和 prepareCompaction。为了让普通 OAuth 刷新与被拒收 token 的强制刷新共享原锁，适配层使用固定版本中的 credential backend；prepareCompaction 深路径继续留在既有适配层。没有改 node_modules 或取消权限检查。这两个位置以后升级 SDK 时必须复验。

Hana 仍管理其原有记忆、权限、会话资源和压缩宿主策略。本轮不代表 Enigma 的多仓库、受保护恢复、工程记忆、资料或 UI 已迁移。

## 验证证据

输出根目录：`<LOCAL_AUDIT_ROOT>/2026-10-25/openhanako-evaluation/`。

| 证据 | 结果范围 |
|---|---|
| `pi140-baseline-types.log`、`pi140-baseline-tests.log` | 原版类型检查与 61 项关键测试，用于确定升级前状态 |
| `pi140-typecheck-final.log` | 三套 TypeScript 项目检查 |
| `pi140-final-adapter-recovery-tests.log` | 实际 SDK 的 max、模型/认证恢复，以及原目录和会话回归 |
| `pi140-packaging-contract-tests-final.log` | 原生压缩对照、依赖闭包、导出边界与持久化指纹 |
| `pi140-full-tests-delivery.log` | 最终完整测试日志，失败、通过和跳过分别报告，不能把已知上游失败当作通过 |
| `baseline-existing-failure-audit.log` | 未修改的上游副本同样缺少 mirror-release-to-atomgit.yml，两项发布镜像测试失败；原 Git 测试也会超时 |
| `pi140-merge-audit-final.log` | 实际 Git 验证全通过；保留所有断言，上限由 10s 调整为 30s，适应在当前 Mac 实测的 11–13s 操作 |
| `pi140-renderer-build.log` | React renderer 实际构建 |
| `pi140-gateway-delivery/report.json` | Hana ModelManager/SDK 适配器通过现有 Gateway 实际模型完成隔离文件读写、settlement 和持久会话重开 |
| `pi140-server-build-signed-delivery.log`、`pi140-packaged-runtime-report.json` | 构建产物和捆绑 Node 的实际服务启动与认证接口；使用一次性本地测试签名，不是生产签名或发布 |

`scripts/patch-pi-sdk.cjs` 继续只读验证 1.4.0；`scripts/verify-pi140-gateway.mjs` 是隔离联调入口。最终 `acceptance-pi140.json` 记录源码/报告/产物的哈希与实际结果。此前失败日志保留，不改写历史记录。

## 下一步

可以在这个底座上实现 Enigma 宿主适配和工程插件。下一轮应先接入一个真实三仓任务、审批/取消、原联合检查和一次受保护恢复，证明状态与权限保持一致，再切换当前 Enigma Web 主入口。现有 Enigma-next 0.4.2 和 Pi 1.4.0 工作台继续保留为对照与回退。
