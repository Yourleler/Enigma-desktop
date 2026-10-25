# Enigma 桌面迁移与验收

2026-10-25，Mac。源：Enigma-next 0.4.2，提交 `878e0598b7ecd4b8d52c03ed040640bf03f58c8b`。目标：Hana 0.450.0 + Pi 1.4.0。开发分支：`codex/engineering-migration`。GitHub Actions 保持关闭。

## 已迁入的能力

工程核心、CLI、11 个 Pi 扩展、全部原回归与研究文档已迁入 workspace package `packages/enigma-engineering`。`SOURCE.json` 记录原提交和 188 个原文件的 SHA256；本仓适配修改保留 diff。原 Enigma 与 Enigma-next 继续保留。

| 范围 | 原生宿主接入 |
|---|---|
| 多仓协同 | 注册数量不限两个，职责/依赖、原联合检查、独立 worktree、协作与方案比较 |
| 代码阅读 | TS/JS/Python/Go、Schema、来源版本、任务地图、项目资料 |
| 计划与交付 | 按会话独立计划、进度、原要求与验收证据、中断恢复、版本产物 |
| 记忆与复用 | 可选工程记忆、中文召回、来源范围/保鲜、纠正忘记、技能与配方 |
| 时光机与交接 | 代码/上下文恢复、最新要求及累计调用、原生 fork、新背景任务、通用包 |
| 运行与边界 | 独立观察、服务/后台/等待、取消、审批、只读拒绝、Mac 命令沙箱 |
| 界面 | 左项目/会话，中央聊天/任务功能，右持久标签/文件树/领域操作；输入区保留模型/思考/权限 |

Hana 与工程工厂共享同一主会话、ModelRuntime、SessionManager、ExtensionRuntime 和 EventBus。工程界面是原生 React，没有嵌入旧工作台或建立第二个主循环；数据与产物按原生会话身份归属。

## 本轮修复

- Pi 1.4 allowlist 纳入实际加载的扩展工具，绑定后读取结构化系统/工具声明。
- workspace、模型、审批、取消与资源桥接；fork/新任务保留原始要求，计划不串会话，验收重新核对。
- 默认 Auto reviewer 读取实际原用户要求及检查 argv/cwd；兼容 Gateway utility Responses 的实际 SSE 返回。
- 工程命令、后台和隔离 worker 接入 Mac 进程边界；保护凭证/只读仓库，Seatbelt 路径正确转义。
- 本机 Web owner 登录、theme.js 构建、Zustand selector、会话 locator、标题栏遮挡和操作 JSON 展示。
- 工具栏按聊天区实际可用宽度换行，导航名称不被挤压；深浅玻璃、高光、过渡、动效开关和 CSS 减少动态回退。
- 宿主退出关闭文件历史 watcher/数据库，验证进程自然结束；清理本任务已完成的残留探针，历史结果保留。

## 实际验证

统一证据根：`<LOCAL_AUDIT_ROOT>/2026-10-25/enigma-desktop-migration/`。

| 验证 | 结果与证据 |
|---|---|
| 工程原回归 | 144/144 通过，`engineering-regression.log` |
| 完整 Hana 回归 | 11,221 项：11,212 通过、7 跳过、2 失败，`hana-full-delivery.log` |
| 三套 TypeScript | 全部通过，`typecheck-final.log` |
| Pi/审批/Gateway SSE/路由边界 | 78 项专项通过，`targeted-delivery.log` |
| 持久化/闭包/导出/样式契约 | 83 项专项通过，`contracts-delivery.log` |
| watcher 自然退出 | 18 项相关回归通过，`shutdown-regression.log` |
| 受控原生完整流程 | HanaEngine、3 个真实 Git 仓库、原联合检查、14 类数据接口、恢复/fork/背景任务/三仓代码方案、审批取消和只读拒绝，`native-shutdown-final/report.json` |
| 真实 Gateway 默认 Auto | 实际写入、联合验证、恢复和新会话通过，`native-gateway-authorized-root/report.json`；代码方案使用已授权工作区，不放宽 reviewer |
| 实际打包 | 当前服务及 renderer；测试 Ed25519 和 Mac ad-hoc 签名，`server-build-final.log`、`seed-final.log` |
| 当前打包运行时 | 捆绑 Node 24.15.0 实际启动；认证、三仓连接、源码读取、68 个动作、原生产物下载通过，`packaged-current-report.json` |
| 打包 worker | 取消后无迟到写入，`packaged-worker-report.json`，属于前一轮同实现的专项记录 |
| 浏览器 | 13 类入口、68 个表单打开；计划操作、文件树/预览、标签恢复、主题与效果开关，`ui/forms.json`、`ui/visual.json` |
| 最终窄窗 | 900/600 宽度无页面横向溢出，名称不被挤压、内容按需抽屉展示，`ui/final-narrow-900.png`、`ui/final-narrow-600.png` |

专项与完整回归互有重叠，不相加冒充总数。真实模型、受控流程和表单覆盖分别表达；打开表单不证明所有参数组合。Pi→Codex 与跨语言真实案例保留在导入工程文档的历史验收中，本轮没有把所有目标 Agent 再测一遍。

两项完整回归失败均来自上游公开树缺少发布镜像 workflow：`mirror-release-to-atomgit.test.ts` 与 `release-mirror-workflow.test.ts`。建仓时已在未修改上游复现。未删除或跳过测试，未启用 Actions。

## 使用与交付边界

开发入口：`npm run enigma:web`，独立数据目录默认 `~/.enigma-desktop-dev`。当前工作台为 `http://127.0.0.1:38392/desktop/`。在会话中选择工程工作区；也可用 `node scripts/launch-enigma.mjs server --models /path/to/models.json --workspace /path/to/workspace` 显式导入配置和目录。

当前是可运行的 Mac 开发版及本地签名验证的服务/renderer。内部 package 仍为 Hana 0.450.0；定制应用标识、安装位置、更新源、生产签名和正式发行未完成，不能把继承的 Hana 安装脚本当独立 Enigma 安装器。工程进程边界未在其他平台验证，启用沙箱时不会悄悄退成 unrestricted。


