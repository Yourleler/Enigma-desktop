# 首次启动、图标与可跳过设置修复

版本：0.452.36。用户截图暴露了此前验收的遗漏：CLI预配置目录已使用Enigma，但双击打包应用仍经core/first-run.ts播种Hanako；desktop/src/icon.png与icon.icns仍是旧人物图标。此前“主界面头像已改”的结论不能覆盖首次启动与Dock。

## 修复

- Dock图标由共享的极光星环SVG重新生成PNG、ICNS和ICO；Mac启动时显式设置Dock图标，避免同路径更新仍用旧缓存。启动页使用产品品牌，不再被当前助手的旧头像覆盖；文案为“Enigma 正在准备启动组件”。
- 打包首次启动依据产品标识创建enigma默认助手及自己的workspaces目录，不依赖CLI预配置脚本。已有旧默认hanako仅在名称/yuan均为原样、未设自定义头像时修正；保留ID、模型、目录、会话等，并先备份config.yaml.before-enigma-branding。
- 向导每一步顶部均可“稍后设置，进入工作台”。使用现有受认证的setup-complete接口保存状态，不要求填姓名、模型或密钥；以后可在设置中补充。真正的启动组件解压仍必须完成，不将未就绪的服务伪装成可用。

## 验证

- 类型检查通过；13个功能测试文件48项通过；4个持久化/资源/图标检查文件40项通过。
- 真实独立应用、完全空HANA_HOME且没有预配置模型：默认助手为Enigma，首次向导出现新图标与跳过入口，实际点击后进入主窗口；preferences.setupComplete=true，models.chat仍为空。
- 用户实际应用已升级并重启到0.452.36；实际启动AX显示Enigma准备组件，随后点击跳过进入用户主窗口。旧身份ID仍hanako，名称/yuan变为Enigma/enigma，其他配置与备份逐字段比较一致。
- 产物app.asar、seed和图标与隔离QA副本哈希一致；实际应用路径仍是dist-enigma/mac-arm64/Enigma.app。旧应用备份在 <LOCAL_AUDIT_ROOT>/2026-10-27/enigma-startup-fix/Enigma-before-startup-fix.app。
- 证据目录 <LOCAL_AUDIT_ROOT>/2026-10-27/enigma-startup-fix，包含report.json、onboarding-skip.png、skipped-main.png及user-main-fixed.png。Dock资源和显式设置路径已核对；Dock系统进程AX读取超时，未把它误称为Dock截图验证。

本轮未提交、推送或发布。已有设置与会话保留。模型尚未配置时可以先浏览工作台，发送模型请求前仍需在设置中选择可用模型。

## 0.452.37：欢迎页头像遗漏的后续修复

用户再次指出主界面仍显示人物头像。原因是欢迎页与设置的yuanFallbackAvatar从语言包取图片，而语言包没有enigma条目，虽然身份已改成Enigma，图片仍退回Hanako.png。0.452.36的启动页/默认身份修复并没有覆盖这个分支，之前仅核对主界面标签不充分。

现在共享yuanAvatarAsset优先读取品牌注册表，欢迎页、聊天、设置、截图及角色卡头像导出使用同一映射；旧扩展角色和自定义上传头像仍保留原语义。设置中Enigma可以被正确选中并保持可选。新增没有Enigma翻译、没有上传头像的真实WelcomeScreen组件回归，以及自定义头像失败后的回退测试。

7个相关测试文件57项、3个持久化和资源检查文件36项通过，类型与构建签名通过。用户实际应用已替换成0.452.37，主窗口截图welcome-fixed.png及设置截图settings-fixed.png均在 <LOCAL_AUDIT_ROOT>/2026-10-27/enigma-avatar-fix。旧0.452.36包保留为Enigma-before-avatar-fix.app。未改用户配置或上传头像来掩盖问题，实际使用的hasAvatar仍为false。
