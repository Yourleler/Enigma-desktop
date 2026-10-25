# 0.4.0 工作台逐项验收

2026-10-25，macOS / Node.js 24.19.0 / Pi 1.4.0。对应 [本轮界面要求](workbench-interface-plan.md)。上一轮核心工程验收保留在 [0.3.0](acceptance-0.3.0.md)，本轮增加完整界面、真实模型选择和常用领域表单。

## 已完成的当前构建验证

| 用户要求 | 实际结果与证据 |
|---|---|
| Codex 风格的会话与输入区 | 左侧新建/搜索/切换会话；主区安全 Markdown、流式输出、实际工具结果；底部输入区右下角模型/思考选择。重命名、审批输入、取消、重连、Fork 与新背景会话有真实后端 |
| 多个真实可用模型 | 现有本机 Gateway 目录返回 50 个 Messages 模型，保留原 Responses 模型，共 51 个配置项。实际页面分别调用 `claude-gpt-6-1-sol` 和 `claude-deepseek-v4-1-flash`；目录不等同于全部模型都已实测 |
| 思考设置实际生效 | 受控 HTTP 测试核对 Messages 路径、实际模型 ID 和 high effort；模型、思考、记忆和审批设置在 Pi SDK 重开后保留，运行中禁止修改 |
| 相关能力有清晰交互 | 13 个分组、68 项已注册领域操作。全部面板加载与表单构造逐项通过；重复行、排序、记录选择器、参数和高级 JSON 可用 |
| 表单避免无关字段 | 配方按步骤类型、浏览器按动作、等待按来源显示字段；隐藏字段不进入请求。实际提交配方写入文件，再通过原检查；浏览器定义和后台等待请求保留正确字段，并核对进程退出 |
| 功能有实际效果 | 原回归与新增界面测试共 143 项通过。覆盖真实文件/检查、计划、资料、记忆、原生技能展开、服务/浏览器、失败/取消、隔离子任务预览/合并、交接与任务包复现 |
| 真实多仓库流程 | 两种实际 Gateway 模型都读取 library → sdk → app 链路并运行原联合检查；审批和页面重连通过，三个源码保护哈希一致，无页面错误 |
| 界面美化与窄窗口 | 实际核看浅/深主题、工具箱、模型库、配方与窄窗截图。1440/1060/800/615/390 五种宽度无横向溢出；面板抽屉可点击关闭，玻璃关闭回退通过，支持低动态偏好 |
| 完成与事实边界 | 工作台请求保存为用户输入，结果保存为有来源的自定义事件；执行终态与领域验收分别展示。取消等待实际收尾，原标准、用户文件、最新要求、版本和未知效果边界保留 |

## 证据与复验

本机证据根目录：`<LOCAL_AUDIT_ROOT>/2026-10-25/enigma-next-validation/`。

| 文件 | 记录内容 |
|---|---|
| `workbench-0.4-final-tests.log` | 严格类型检查后运行的 143 项完整回归，143 passed / 0 failed / 0 skipped |
| `workbench-0.4-contextual-verified-tests.log` | 条件字段的真实提交、文件/原检查与后台进程收尾 |
| `workbench-0.4-final-live/report.json` | 两个真实模型、原检查、审批、保护源码、重连、截图和当前分发 JavaScript 哈希 |
| `workbench-0.4-final-visual/report.json` | 68 个表单、13 面板、主题/玻璃回退、五种宽度、截图与构建哈希 |
| `distribution-0.4.json` | 独立 tar 生产安装的版本/归档 SHA-256、公开 SDK、实际浏览器写文件/检查/重连、保存版 HTML 安全预览/下载和模型/思考切换结果 |
| `distribution-0.4-files.json` | 分发文件与当前 checkout 的逐文件核对；仅 `verified` 报告表示一致 |

在源码 checkout 可复验：

```bash
npm run check
npm test
node scripts/gateway-workbench-interface.mjs /absolute/path/to/live-output
node scripts/workbench-visual-audit.mjs /absolute/path/to/live-output/report.json /absolute/path/to/visual-output
npm pack --pack-destination /absolute/path/to/output
```

真实模型脚本使用独立的三个测试仓库和已有本机 Gateway 认证，不在用户当前项目对话中派发测试任务。视觉审计的“68 个表单通过”指实际构造、可见性和面板读取，不冒充每个提交组合都已穷举；执行效果由功能回归和真实流程另证。各报告记录当前 JavaScript 文件哈希，测试发生在提交前时 HEAD 是父提交，应核对文件哈希。

## 交付范围

实际使用平台为 Mac。GitHub Actions 按用户要求保持关闭；云端 CI 和 Windows/Linux 本轮未验证。PR #2 保持待审，不自动合并或公开发布。

价格来自网关的实际计费规则，目录没有提供价格；SDK 零成本兼容元数据不代表免费。命令和浏览器是授权宿主执行能力，应用锁不是 OS 沙箱。时光机不撤销远端数据库、网络或费用；旁路观察不自动修复或回溯。托管、做梦、内核维修和文档专精仍仅有计划，本轮不启用。
