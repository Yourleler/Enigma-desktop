# 上下文交接插件

交接支持同背景新任务、接着做、独立代码方案，以及 Pi 与外部 Agent 的背景复用。它使用 Pi 公开会话接口和 Codex 官方用户输入；通用包不是私有会话文件转换，也不迁移运行中的进程、权限或模型凭证。

## 同背景新对话

原生 Pi 的 `/fork` 和 `/clone` 继续可用。Enigma 会为新原生会话保留原要求来源，缺失的较新要求通过 `task_requirements` 先读取；新会话请求数与来源累计消耗分别记录。

`/new-context` 只选择相关背景并提供新目标：

```json
{
  "goal": "沿用这个项目背景，检查 SDK 的测试覆盖",
  "entries": [{ "id": "SOURCE_ENTRY_ID", "kind": "background" }]
}
```

选中消息的原始角色和位置保留在包中；只导出可见文本，不导出隐藏推理、工具执行历史或系统提示词。新会话中的输入说明源材料是背景；源计划不激活，新任务有独立计划指针。原会话文件不改，仓库位置也不变。

普通原生 fork 接着做选定任务，计划指针分离；旧任务的后续计划版本不被覆盖。源与新任务仍使用同一物理仓库时，Enigma 通过操作锁和版本检查协调；独立写代码方案优先用下面的 code fork。

## 通用包与外部 Agent

`/handoff-export JSON` 选择目标模式、目标、背景条目、证据和必要记忆，写出 `handoff.md` 与 `manifest.json`。CLI 同样支持：

```bash
enigma-next handoff export /path/to/new-package 'JSON_INPUT'
enigma-next handoff inspect /path/to/package
enigma-next handoff import-pi /path/to/package
enigma-next handoff codex /path/to/package
enigma-next handoff codex /path/to/package --write
```

CLI 的 JSON_INPUT 包含 `mode`（background/continue/alternative）、`goal`、`source` 和带 `role`/`kind`/`reference` 的 `notes`；公开结构见 `HandoffInput`。任意能接受文本或文件的 Agent 可读取 Markdown；没有经过验证的适配器不宣称自动接续支持。

包保留仓库 HEAD、内容签名、原要求、证据引用、来源请求数；背景模式不带旧计划。import-pi 创建新原生 Pi 会话，把新目标和包正文作为用户输入，并写入来源关联。接着做模式的计划重新建立，过去完成记录不直接认证目标任务。

`includeEvidence: true` 可携带用户选择的证据 JSON 到 `evidence/`，总大小有界、含来源角色和内容 hash。附件缺失、损坏或被改即拒绝导入；复制来的源检查仍不被当成目标 Agent 已执行的检查。默认只保留引用，便于保持交接简短。

`handoff inspect` 重新核对物理仓库和证据。代码不同或路径缺失时明确标记；存在未知副作用时不启动继续写入。可在领域 API 中给仓库 ID 映射；跨机器原始证据和记忆默认不被当成目标当前事实。长包、附件/正文缺失、符号链接、导出后正文被改均明确拒绝或报告。

记忆正文不复制到包；仅携带被选择的当前条目引用。导入再检查最新忘记和作用域，不读包指向的任意外部记忆目录。需要正文时通过当前记忆工具读取，旧包不能复活已忘记知识。

Codex 适配器使用 `codex exec` 的真实 stdin/目标提示词/JSON 事件，不写私有会话数据库。默认 read-only；用户显式 `--write` 时以第一个可写仓库为 Codex cwd，并只添加其他可写仓库，避免把整个父目录当成可写范围。写入过程在 Enigma 记录窗口中观察全部仓库；Codex 的权限边界仍由它自己的宿主配置决定。Codex 输出报告是带来源的观察，目标需要自行验收实际代码。

## 代码方案与原生会话

`/branch-code` 或 `fork CHECKPOINT DESTINATION` 创建独立代码工作区。若来源检查点关联 Pi 会话节点，适配层用公开 API 复制该分支到新 cwd，并带较新要求、计划与来源消耗记录。`session-start.json` 指向新工作区会话，`enigma-next --workspace NEW agent` 自动打开；显式 `--session`/`--resume` 可覆盖。

上下文复制和代码恢复分开：代码仍来自用户指定的检查点，旧历史中的工具输出不重新执行，旧验收不直接激活。缺失源码/历史或半完成 fork 报错，原工作区和 index 保留。背景任务与独立方案的计划不混用。

## 验证与边界

受控测试验证原文件不变、选定来源角色、背景新目标、计划作用域、较新要求回查、原生 code fork 来源、源码变化、过长包、忘记和未知操作。

真实联调脚本 `scripts/gateway-handoff-probe.mjs` 已完成 Pi → Codex → Pi：Codex 读取三仓库背景和实际源码，新增接口说明而不执行旧迁移；Pi 导入 Codex 观察后回读文档与 Python/JS 源码，确认当前接口为 `GET /greet`、顶层 `message`。这是一项真实任务，不是所有目标 Agent 无损兼容的证明。

该脚本使用已配置的本机 Gateway/Codex，显式调用才运行，普通 CI 不调用。命令正文用 argv/stdin 传递，不拼进 shell。
