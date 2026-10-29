# 基于 Codex 设计语言的整体重置

用户目标：**各类设计基于 Codex 的设计语言重置**。

参考为用户上传截图 `$HOME/.codex/attachments/def5d46d-0801-476d-a3ca-a214c96b239f/image-1.png`。采用其中的中性配色、细分隔线、清晰的侧栏/正文/上下文面板层级、克制圆角与阴影、明确控件状态。产品仍叫 Enigma。此次方向替代此前大面积极光与液态玻璃皮肤。

## 交付状态

2026-10-26，本轮设计重置已完成。**最终本地 Mac 包为 0.451.1**，已启动并确认 Electron 加载 `~/.enigma-desktop-dev/artifacts/renderer/0.451.1/index.html`。应用位于 `dist-enigma/mac-arm64/Enigma.app`，未安装到 /Applications，未提交、推送或公开发布。

先前锁屏阻塞已解除。0.451.0 是验收中间版本；最终 0.451.1 包含原生标题栏多余留白的修正及所有后续对比度改进。UI 设计验收不代表 README 中历史业务功能待办全部完成。

## 最终改动

- 统一 `enigma-design.css` 与各窗口共用的 `EnigmaDesign`。浅色白/灰，深色黑/灰；链接、权限和运行结果保留语义色。删除旧 `enigma-glass.css`、折射 SVG、光斑、鼠标高光与玻璃开关。
- 重置主窗口、标题栏与会话标题、左侧新对话入口、任务工具栏、正文和头像尺寸、输入框与圆形发送按钮、token 状态及右侧工程面板。Web 和 Electron 的标题栏布局分别正确避让。
- 菜单、Tooltip、快速目录、表单与模态框使用同一套边框、圆角、字体与间距；保留目录筛选、Enter 跳转、焦点返回、点击定位与暂停贴底跟随。
- 设置主题收敛为浅色/深色/跟随系统；移除纸纹、树影入口，保留阅读字号/字体、权限与运行设置。避免主题卡片的 `data-theme` 意外重新套用旧主题变量，移除旧渐变字，限制表单内容宽度。
- 欢迎、初始化六步、设置独立窗口、快速对话、文件预览及浏览器查看器接入共享设计；启动页使用中性色并遵循减少动效。初始化预览无需 Electron IPC，不创建真实 profile。
- 主按钮、确认按钮、频道发送、音频播放、设置保存及开关滑块使用主题前景色，修复深色模式白底白字/白滑块。初始化记忆开关不再重复标签并挤成竖排。
- 快速对话可通过现有 platform HTTP fallback 读取本地服务，保持 Electron IPC 优先。仅用于兼容与真实界面验证，不改变权限、模型循环或任务语义。

## 按要求完成审计

| 要求 | 证明与检查范围 | 结果 |
| --- | --- | --- |
| 全局 token、排版、去除旧玻璃 | 共用设计文件；七类 renderer HTML 构建引用同一个 EnigmaDesign CSS；Web/原生深浅截图；设置卡片旧样式实测后修复 | 通过 |
| 主窗口、对话、输入与工程面板 | 原生 0.451.1 会话恢复、三栏、时光机、源码阅读、输入区；原生外壳标题栏不再重复留白 | 通过 |
| 菜单、提示、目录、表单、设置及其余界面 | Web 模型表单/菜单/目录；原生设置深浅、欢迎、文件编辑预览；初始化六步实际浏览；快速对话 600×260 实际组件连接本地服务；独立 viewer 共用资产与主题回归 | 通过 |
| 功能、键盘、忙碌/空状态保留 | 原生目录输入 hi → Enter → 面板关闭、当前第 2/2 轮；原生文件树双击 index.js 显示源码；设置可用/禁用控件、空态与预览连接失败态可读；完整界面回归 | 通过 |
| 深浅、响应式、动效 | 原生深浅与窗口缩放；420×780 Web 下无横向溢出，导航避开输入；原生动效关闭后再打开菜单仍为关闭，恢复原偏好；CSS reduced-motion 与导航减少动效测试 | 通过 |
| 类型、回归、构建和桌面交付 | 最终三套 TypeScript、2524 项界面测试、签名 seed 校验、codesign 验证、最终原生启动与实际资源版本 | 通过 |

视觉验证侧重各类共享组件与代表性真实状态；未重新发起付费模型任务，也未重跑与设计无关的历史业务端到端场景。快速对话的 OS 全局快捷键注册不属于本轮设计改造，也未以浏览器预览冒充其验收。

## 测试与构建证据

- 最终完整界面测试：**346 文件、2524 项通过、0 失败**，`/tmp/enigma-design-final-ui.log`。一次中间回归的旧“设置页必须占满宽度”断言已随新设计契约更新；最终重新完整运行通过。
- 三套 TypeScript 检查：`/tmp/enigma-design-final-types.log`；`git diff --check` 通过。
- 最终产品身份、shell manifest、splash 与运行时资产检查：`/tmp/enigma-design-final-contracts.log`。此前包括启动 artifact 的 108 项检查也通过，见 `/tmp/enigma-design-contracts.log`。
- 持久化扫描：**65 stores / 799 sites**，`/tmp/enigma-design-final-persistence.log`；无新增持久化域。
- 完整构建：`/tmp/enigma-design-desktop-build.log`；最后客户端构建：`/tmp/enigma-design-client-final.log`；最终 renderer/seed/应用封装：`/tmp/enigma-design-desktop-release.log`。
- `codesign --verify --deep --strict dist-enigma/mac-arm64/Enigma.app` 通过；Bundle 与实际启动版本均为 **0.451.1**。
- 最终启动日志：`/tmp/enigma-design-native-final.log`。主流程正常加载；既有自动更新 release 检查仍可能报告私有仓库无 release，未发布或安装外部更新，本轮不修改 OTA 配置。

## 视觉证据

目录：`<LOCAL_AUDIT_ROOT>/2026-10-26/enigma-codex-design/`。

- `native-final-light.png`、`native-final-dark.png`：最终 0.451.1 原生主界面。
- `native-settings-light.png`、`native-settings-dark.png`：原生设置与主题切换。
- `native-welcome.png`、`native-file-preview.png`、`native-source.png`：原生欢迎、文件编辑预览和工程源码阅读。
- `settings-light.png`、`settings-dark.png`、`setup-dark.png`、`quick-chat.png`：设置、初始化和快速对话代表界面。
- `web-light.png`、`web-dark-directory.png`、`model-dialog.png`、`narrow-dark.png`：Web 主界面、目录、模型表单与窄窗。

420×780 实测：页面 scrollWidth=420；目录 x=21…371、y=190…571.8；导航底部 y=650，输入顶部 y=688。临时 viewport override 已恢复；原生主题、动效及窗口缩放恢复到验收前的设置。

## 后续维护

界面以 `EnigmaDesign` 与 `enigma-design.css` 为唯一产品视觉入口；新增窗口必须挂载该入口。领域布局仍在 `engineering.css`，不可重新加入独立玻璃/极光色板。构建主进程须传与 seed 一致的本地 `HANA_SIGN_KEYSET`，不要只更新同版本 renderer 后期待已安装缓存自动替换。所有历史仓库、业务功能与用户资料保留，后续待办继续按 README 推进。
