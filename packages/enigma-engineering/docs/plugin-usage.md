# Pi 插件使用

Enigma-next 使用 Pi 公开扩展；领域层不加载 Pi 会话或工具运行时。Pi 宿主模块作为 peer dependency，由 Pi 提供。开发与回归固定使用 Pi 1.4.0。

运行时核对 Pi 1.4.0；其他版本在兼容性验证前明确报错，避免新版钩子行为变化后悄悄丢失领域约束。

## 安装与移除

在仓库中运行：

```bash
npm ci --ignore-scripts
npm run build
pi install $HOME/code/Enigma-next
```

这是本地插件安装，不发布到 npm。用 `pi list` 核对，`pi remove $HOME/code/Enigma-next` 移除。移除插件不会删除工作区的领域数据。使用私有 Git 来源安装时需要自己的 GitHub 访问权限和已构建的分发文件；当前验证以本地包为准。

`npm pack` 会构建并包含 `dist/src`，不包含开发宿主或运行时凭证。启动 CLI 的环境需安装 Pi；普通领域 CLI 命令不依赖 Pi。真实模型继续使用 `enigma-next connect gateway` 生成的本地配置。

## 两种模式

- 普通 `pi` 加载为 additive 模式：保留原生工具与其他扩展工具，可按需使用 Enigma 的仓库与阅读工具。不会自动将其他工具完成的任务标成 Enigma 已验收。
- `enigma-next agent` 显式启动 managed 协同模式。原生工具仍存在，但仓库操作需用 Enigma 工具；其他工具调用在派发前被拦截，避免绕过记录。交互式 `!`/`!!` 命令同样应改用受管命令。

也可在空闲的 Pi 会话执行 `/enigma-mode managed` 或 `/enigma-mode additive` 切换。进入 managed 前先用 `/repo-add` 注册仓库。未声明操作效果的其他扩展不会被默认允许；需要它们时显式离开 managed，随后重新核对代码和验收。

这些约束是可信宿主内的工具协调，不是 OS 沙箱。另一个扩展若直接执行进程或文件操作，仍有宿主用户权限；Pi SDK 直接执行命令也不等于经过交互输入钩子。

## 状态与 code fork

Pi 适配层解析原始用户条目并向领域 code fork 传入明确交接件。领域层只接收来源身份、当前要求和累计请求数。缺失、损坏或身份不一致的来源阻止会话关联 fork；无会话来源的纯代码 fork 仍可通过领域 CLI 使用。

会话关联 code fork 已通过 Pi 公开 API 复制选定原生分支到新 cwd，并保存启动会话指针；新会话保留要求交接、分别记录来源消耗，阅读和检查证据重新核对。详见 [上下文交接](context-handoff.md)。

## 可选观察插件

`enigma-next agent --observe` 或原生 Pi 的 `--enigma-observe` 启用运行观察。通过另一终端的 `status` / `why-slow` 独立查询；无需等待主 Agent，也不获取工作区锁。可分别加载/移除观察扩展，未启用时不启动后台采集。详见 [运行观察](runtime-observer.md)。

## 交接与审查命令

交接扩展提供 `/new-context`、`/handoff-export` 和 `/handoff-read`；审查扩展提供 `/enigma-review`。它们只有显式用户调用才开始工作，没有自动后台模型循环。扩展入口分别为 `pi-handoff.js` 与 `pi-review.js`，可通过 Pi package 资源过滤独立启停；详见 [交接](context-handoff.md)和[独立审查](independent-review.md)。
