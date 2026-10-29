# 对话导航、操作提示与布局核查

2026-10-26，依据用户提供的对话导航截图，补齐实际工作台的交互信息。当前 Enigma 构建版本 0.450.3；Pi 仍为 1.4.0，上游宿主基线仍为 Hana 0.450.0。此前其他 Agent 的未提交功能与视觉改动全部保留。

## 使用效果

- 对话右侧常驻细导航条，显示当前位置与已加载轮数。悬停或键盘聚焦显示最多 320 字的消息摘要、轮次和时间，点击或 Enter 定位并高亮。上下方向键、Home/End 可移动定位点，Escape 关闭预览。
- 导航条上方打开“对话目录”，可筛选已加载的提问；明确标注历史加载范围，提供加载更早消息与全文查找入口。全文查找继续使用原有全会话搜索，不把目录筛选伪装成全文搜索。
- 超过 64 轮时，细导航条均匀抽取定位点，保留首尾与当前轮次；目录仍包含全部已加载的提问。跳转取消自动贴底跟随，短末轮到达底部时正确显示最后轮次。流式回复不反复重建相同的导航锚点。
- Web 与 Electron 都挂载统一提示层。复用原有 title、无障碍名称与显式说明，覆盖主界面、工程面板、菜单及常规控件；已有专用 Tooltip 保持自身职责。提示可换行、避开视口边界、支持键盘与 Escape，鼠标移入提示不会立刻消失。
- 为工程导航、文件/变更阅读、发送/停止、模型分工、管家、记忆整理、文档验证、恢复预览等关键操作增加效果与禁用原因说明。刷新过程显示忙碌状态，防止重复刷新。
- 模型分工、切换工作区、新建任务编排管家移到“更多功能 → 对话设置”；外观菜单只保留主题、玻璃与动效。
- 细导航条避开悬浮输入框。收起工程面板或关闭最后一页会真正关闭右栏，避免旧书桌继续遮住聊天；收起时保留标签页供下次继续。

## 验证范围与证据

- 界面完整测试：288 个文件、2236 项通过，日志 `/tmp/enigma-navigation-ui-suite.log`。
- 随后实机发现并修复末轮定位、窄窗面板收起、鼠标触发的焦点提示，以及 Enter 后浏览器默认点击导致目录重开的问题；最终定向回归 10 个文件、38 项通过，日志 `/tmp/enigma-navigation-tests-final.log`。涵盖悬停、键盘、失焦关闭、禁用原因、500 轮采样、取消贴底跟随、减少动效、末轮定位、关闭面板与标签。真实浏览器复验确认 Enter 后目录关闭、焦点回到入口、消息高亮；输入法组合输入不触发定位。
- 最终三套 TypeScript 检查通过，`git diff --check` 通过。
- Web 实际检查深色默认宽窗、780×740 窄窗与 420×780 浅色窗口：目录未超出视口，导航底部避开输入框；小窗没有页面横向溢出。实际检查了目录筛选/定位、提示、抽屉收起和主题切换。临时 viewport override 已恢复。
- 420 像素浅色截图：`<LOCAL_AUDIT_ROOT>/2026-10-26/enigma-navigation/narrow-light.png`。
- Mac 应用：`dist-enigma/mac-arm64/Enigma.app`。完整构建后使用相同构建函数更新最后的 renderer、重新封装并签署 seed、验证 seed kit、重建与 ad-hoc 签署应用；最终 `codesign --verify --deep --strict` 通过。日志 `/tmp/enigma-navigation-desktop-build.log` 与 `/tmp/enigma-navigation-desktop-final.log`。
- 增量重建 `build:main` 也必须传入与 seed 相同的 `HANA_SIGN_KEYSET` 和 `ENIGMA_DESKTOP_PRODUCT=1`，否则启动验签会拒绝本地 seed。本轮启动验证发现这一构建环境缺口后，使用正确 keyset 重建了主进程与应用外壳；日志 `/tmp/enigma-navigation-main-final.log`、`/tmp/enigma-navigation-shell-final.log`。
- 最终原生 Electron 已实际加载 `~/.enigma-desktop-dev/artifacts/renderer/0.450.3/index.html`，完成目录展开、输入筛选、Enter 定位和焦点返回验证，目录没有再次弹出。截图：`<LOCAL_AUDIT_ROOT>/2026-10-26/enigma-navigation/desktop-0.450.3-directory.png`；最终启动日志：`/tmp/enigma-navigation-desktop-app-final.log`。

此轮没有提交或推送，也没有正式发布；本地包位于仓库 dist-enigma，未安装到 /Applications。历史功能缺口仍以 README 为准。本轮不把 UI 改进当作全部工程功能验收完成。
