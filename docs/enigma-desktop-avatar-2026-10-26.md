# 桌面界面与头像验证

2026-10-26，承接本地未提交的界面改动。Web 和 Electron 共用 React 页面与工程样式，但此前桌面包没有重建。本轮生成并启动了新的 Mac 应用，直接核对原生窗口。

## 本轮改动

- 将人物头像替换为黑底、绿紫渐变的抽象星环；更新 SVG 和 512×512 PNG。
- 开发配置启动时只迁移已知旧默认头像的内容哈希，保留自定义头像。当前使用配置中的旧默认头像已备份并更新。
- Enigma 构建版本升至 0.450.1，避免同版本渲染资源缓存继续使用旧界面；上游宿主基线仍为 0.450.0。
- 重新构建 `dist-enigma/mac-arm64/Enigma.app`，完成本机 ad-hoc 签名并启动。未安装到 `/Applications`。

## 验证证据

- 实际 Electron 加载 `~/.enigma-desktop-dev/artifacts/renderer/0.450.1/index.html`，原生窗口可见新工程导航、浅紫界面和星环头像。
- 原生截图：`<LOCAL_AUDIT_ROOT>/2026-10-26/enigma-avatar-desktop/desktop-0.450.1.png`。
- 构建成功、类型检查通过、相关测试 92 项通过、`codesign --verify --deep --strict` 通过、持久化扫描通过（65 stores / 799 sites）。
- 日志：`/tmp/enigma-avatar-desktop-build.log`、`/tmp/enigma-avatar-desktop-types.log`、`/tmp/enigma-avatar-desktop-tests.log`、`/tmp/enigma-avatar-persistence.log`。

## 后续发行事项

当前为本机验证包，没有提交、推送或公开发布。自动更新检查仍存在私有仓库 release 404，以及继承的上游 artifact 更新地址；后者的密钥不匹配已被拒绝，没有安装更新。正式发行前仍需统一更新配置与验收。历史功能待办以 README 为准。
