# 本地界面更新与 macOS 权限身份

此前每次完整打包都采用临时签名，代码变化会改变签名身份。系统可能因此再次询问桌面等受保护目录权限。当前机器没有可用的正式代码签名身份。

从界面资源 0.452.61 起，纯界面修改优先使用 `scripts/stage-enigma-renderer.mjs`，保留已安装应用外壳和服务的字节及签名。脚本校验已安装 seed、公钥、协议和服务 SHA，签署新 renderer manifest，再经现有 artifact 激活及指针机制加载；保留原版本用于回退。不会更改钥匙串或系统隐私权限。

操作时先退出空闲应用，提供已安装应用、数据目录、编译后的 renderer、新版本、匹配的本地签名密钥及公钥集、新输出目录。密钥不写入仓库。脚本拒绝运行中的服务、协议不匹配、错误密钥、旧版本和覆盖已暂存更新。

本地应用外壳/服务仍为 0.452.60；界面版本单独记录。此方式适合纯界面改动，不能替代原生和服务升级的兼容验证。正式发行仍应使用稳定 Developer ID；首次授权或未来原生升级是否提示由 macOS 决定。

参考：[Apple 代码签名需求](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements)、[Apple Developer Forums 临时签名与隐私权限](https://forums.developer.apple.com/forums/thread/678816)。
