# Enigma 液态玻璃/实时 token/男版头像 — 本轮交付核查（2026-10-26）

本文是对本轮三个直接需求的交付说明，以及对交接版 README 第 5 节"已实现/未闭环"
矩阵的独立核查结果。核查方式：代码走查 + 单测 + 本机真实 Gateway 模型流式验证 +
多宽度浏览器实测，不引用未亲验的日志。

## 1. 本轮直接交付

### 1.1 Apple 风格液态玻璃 UI（参考 任务型工作台）

- 重写 `desktop/src/react/engineering/engineering.css`：删除旧版 30 个
  `--enigma-color-N` 变量海和单行压缩风格，改为分层语义 token（`--lg-*`）：
  - 玻璃面板：`backdrop-filter: blur(30~40px) saturate(1.5~1.8)`；
  - 顶部/左侧浮岛：圆角、描边、内高光、环境投影；
  - 背景四色径向光斑（蓝/青/珊瑚/紫），深浅主题分别校色，不影响文字对比；
  - SVG `feDisplacementMap` 折射层 + 双层斜向高光，可在外观菜单整体关玻璃
    （`enigma-glass-off`）和关动效（`enigma-motion-off`），并跟随
    `prefers-reduced-motion`；无 backdrop-filter 支持时回落为实体表面。
- 布局：
  - 删除旧的 JS 硬算 `Math.max(300, Math.min(640, innerWidth - 240 - 420))`
    右栏宽度，改为 CSS `clamp(340px, 36vw, 520px)`；
  - 窄于 860px 时工程右栏变为覆盖式抽屉（≤88vw、420px 上限），
    `SidebarLayout.updateLayout` 在工程面板激活时不再把它计入聊天最小宽度，
    不再出现窄窗面板被自动收起、聊天被挤没的问题；
  - 1440/860/780/420 四档实测无横向溢出。
- 新 CSS 全部通过仓库既有的 `style-discipline`（字面量颜色/间距/时长 0 新增）
  和 `css-token-references` 守卫；未新增任何主题、未改
  `theme-registry.test.ts` 硬断言的 11 主题/默认 warm-paper/localStorage key。

### 1.2 Claude Code 风格实时 token 上行/下行计数

链路（真实 Gateway `gateway/gateway-gpt-6-1-sol` 端到端实测）：

- 服务端 `server/session-token-meter.ts`：
  - run = 一次用户执行（可能含多个模型请求/工具回合）；
  - 上行：`engine.getSessionContextUsage()` 上下文投影估算，provider usage
    真值（input + cacheRead + cacheWrite）到达后翻转 `estimated=false`；
  - 下行：流式 delta 字符估算（CJK 1 token/字、其余 4 字符/token），
    provider 末包/中途 usage 覆盖为真值；
  - ~7fps（140ms）节流 WS 广播 `token_meter`，含阶段（读取上下文/思考中/
    生成中/执行工具）、平滑速率、耗时、当前模型；
  - 适配了 Pi/Gateway 的轻事件链：该链没有标准 `turn_start/message_start/end`，
    输出走 `mood_text`，首个 request 在首个 delta 时懒建立，
    `turn_end`/`session_status(false)`/2.5s 空闲三路兜底收尾，
    终态快照保证广播。
- 传输：顶层广播消息（非 stream-scoped），`ws-message-handler` 独立 case 落
  zustand store，按 sessionPath 隔离。
- 前端 `TokenMeterPill`：输入框上方玻璃胶囊，↑ 上行（珊瑚色）/ ↓ 下行（绿色），
  `~` 估算标记，下行跳动脉冲，阶段点（思考=珊瑚/工具=蓝），速率、耗时、模型；
  回合结束保留 8s 后淡出。
- 实测样本：发送"写一首四句五言绝句…"，上行实时显示 ~12k 估算，
  下行从思考 delta 起逐字跳动（117→136→…，速率 293/s 等），
  完成态 `已完成 ↑11k ↓260 8s gateway-gpt-6-1-sol`（provider 真值，无 ~）。
  CDP 抓包确认 WS 帧与界面计数一致。
- 类型契约放 `shared/token-meter-types.ts`（前后端共享，已加入 export-manifest
  白名单，不产生 open→closed 边界违例）；服务端 6 个单测，前端格式化 2 个单测。

### 1.3 男版 Enigma 头像

- 新头像与 Hanako.png/Ming.png 同一构图语言：米纸底 + 双圈 + 蓝色男性右侧脸
  剪影（短发、鼻唇下巴轮廓、衬衫领），Enigma 轨道弧与青/灰轨道节点，
  替代原来的女性樱花/旧 E 圆标。
- 交付物：
  - `desktop/src/assets/enigma/avatar.svg`（矢量源，含品牌轨道）；
  - `desktop/src/assets/enigma/avatar.png` 512×512（Playwright 以 SVG 光栅化）；
  - 开发 profile `~/.enigma-desktop-dev/agents/enigma/avatars/agent.png`
    已同步（真实 profile 不自动覆盖既有头像，见 enigma-profile.mjs）。
- 应用图标 `desktop/src/icon.png/.icns/.ico` 是独立的几何 E app icon，
  本轮未改；如需统一为男性剪影品牌需单独重生成三尺寸（ico 7 尺寸契约在
  `tests/windows-icon-contract.test.ts`）。

## 2. 对交接 README 第 5 节矩阵的核查结论

| 能力 | README 声称 | 本轮核查 |
|---|---|---|
| 多仓协同/智能阅读 | 工作/暂存/提交/MR + 平级 diff | 代码存在且结构完整（workspace/change-reading/merge-request-source）；前序真实报告 r2 在证据目录，本轮未重跑真实多仓任务 |
| 时光机 | 模型主动回溯 | 代码存在（time-machine 路径在 host/pi-extension）；前序 r1 真实通过，本轮未重跑 |
| 模型分工/运行时切模 | single/plan-execute/adaptive | `plugins/enigma/model-policy.ts` + `agent_phase` 工具存在；工作台"新任务模型分工"按钮实测可见；真实多模型切换未重跑（README 也注明 Kimi/DeepSeek 组合未实测） |
| 旁路观察/托管管家 | 独立进程 | `guardian-host.ts` 99 行 + UI 存在；前序 guardian-r1 真实通过，本轮未重跑 |
| 记忆/做梦 | 增量旁路整理 | `memory-host.ts` + Memory 面板存在；前序 memory-dream-r3 真实通过，本轮未重跑 |
| 特殊对话编排管家 | manager/worker | conductor.ts + 创建对话框存在；前序 conductor r4 真实通过，本轮未重跑 |
| task_acceptance | UI + 对账 | 代码与"要求与验收"面板存在；前序加强断言复测见 README 遗留 |
| 文档专精 | register/example | Documents 面板存在；README 自述 r3/r4 整体失败、r5 无终态——**仍属未闭环，本轮未触碰** |
| token 实时计数 | README 未提 | **本轮新增并真实流式验证通过** |
| 液态玻璃/窄窗/深浅 | "最新菜单/420 未复验、玻璃待做" | **本轮完成 CSS 重构与 1440/860/780/420/深浅实测** |

## 3. 验证记录（本轮亲验）

- `npm run typecheck`：三套 tsc（app/node/test）全绿。
- 定向测试：enigma 5 件套 + meter 8 项 + 样式/主题契约 + 闭包/边界/持久化
  tripwire/store-registry/startup-receipt + sidebar-ui 等 88 项全绿。
- 全量 vitest：11224 通过；**仍有 3 类失败，均为本轮之前已存在**：
  - `mirror-release-to-atomgit` / `release-mirror-workflow`（2 项）：workflow 文件
    在提交 `85f59fd0`（CI remove the AtomGit release mirror workflow）被删，
    测试仍引用该文件；与本轮改动无关，HEAD 即失败。
  - `api-health-session-store-integration`（2 项）/
    `server-composition-boundary`（1 项）：真实 spawn 完整 server 60s 超时。
    手动 spawn 复现：干净 HANA_HOME 冷启动跑 53 条迁移+插件加载超过 100s
    仍在 `server entry import`，是环境/冷启动耗时问题（README §6 已记
    "全量宿主测试时源码/生成清单变化+并行超时"），非代码回归。
- 构建：`build:renderer` 多次通过；`compute-cli-closure` 重新生成闭包与
  open-boundary 基线（新增 meter 边已通过把 meter 移入白名单+shared 类型
  下沉消解，基线维持原有 1 条 evidence-needed 债务，没有新增）；
  persistence fingerprint/inventory/startup receipt 已用生成器重新钉版
  （compatible，schema 1/DATA_EPOCH 不变；同时修复了
  `external-enigma-conductor-reports` 豁免正则在 prettier 格式化后
  `file,redact` 空格不匹配的隐患）。
- 浏览器实测：真实 Gateway 对话 3 轮、meter 流式/终态截图、工程工作区连接、
  深色/浅色、780/420 抽屉截图均在临时开发数据目录完成
  （`ENIGMA_DESKTOP_DATA=/tmp/enigma-inspect/devdata`）。

实测截图留档：`docs/screenshots-2026-10/`（液态玻璃浅色、深色工作台、
780 抽屉、男版头像、meter 流式/完成态）。

## 4. 明确未做/遗留

1. 文档专精 r5 收尾、自动暂存/MR 端到端复验、真实多仓联合验收、最终 Mac 包
   启动——属 README §5.1 原有未闭环项，需要真实长任务，本轮没有冒充完成。
2. 生产签名/公证、PR 合并/公开发布未做（按约束）。
3. `dist-enigma/`（619MB）仍是未跟踪构建产物，未 `git add`。
4. 真实 profile 冷启动慢（file-history 对超大工作区 watcher 注册）会让
   `~/.enigma-desktop-dev` 的 server 在该机器上 ready 很慢；本轮验证用小工作区
   临时 profile 绕过，根因（大工作区 fsevents 风暴）值得单独优化。
